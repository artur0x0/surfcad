/**
 * Confirmed v2 deletes (§2.7, §2.8, §2.10), owner decision:
 *
 * Assembly, open or not: one writeVaultCommit deletes
 * assemblies/<id>.surf.json. Delete parts also deletes parts/<id>.js
 * and its mesh when no other assembly references that id (tip
 * .surf.json files, plus the open working copy when it is a different
 * assembly). Sibling assemblies are not rewritten.
 *
 * Part: one writeVaultCommit deletes parts/<id>.js (and its mesh when
 * the tree has it) and rewrites only the open assembly's committed
 * .surf.json so a reload does not put the row back. Other assemblies
 * are named in the result and left untouched.
 *
 * A failed scan writes nothing. Offline stores one pending write. A
 * moved tip that touches a planned path is a conflict. The caller
 * adopts the working copy only after status committed or local. A
 * missing file is local: no git write.
 */
import { partDefinitionId } from '../assembly.js';
import { gitBlobSha } from './binaryContent.js';
import { fileDelete, fileWrite, GitAdapterError } from './githubAdapterInterface.js';
import { assemblyIdPath, partIdPath, partMeshIdPath } from './idPaths.js';
import { makeAssemblyCommit, makeBranchTip } from './lastCommit.js';
import { isV2SurfId } from './surfId.js';
import { parseSurfJsonV2, stringifySurfJsonV2 } from './surfJsonV2.js';
import { SAVE_PENDING_COPY } from './executePlanSave.js';
import { PART_USE_SCAN_REFUSED, scanOtherAssemblyPartUses } from './v2VaultRead.js';
import { writeVaultCommit } from './writeVaultCommit.js';

export const DELETE_ASSEMBLY_REFUSED = "Couldn't delete the assembly. Nothing was changed.";
export const DELETE_PART_REFUSED = "Couldn't delete the part. Nothing was changed.";

function refused(extra = {}) {
  return {
    status: 'error',
    code: 'delete_refused',
    error: DELETE_ASSEMBLY_REFUSED,
    message: DELETE_ASSEMBLY_REFUSED,
    ...extra,
  };
}

const DELETE_CONFLICT_COPY = 'These files also changed on the remote. Nothing was deleted.';

function conflictResult(paths) {
  const list = [...new Set((paths || []).filter(Boolean))].sort();
  return {
    status: 'conflict',
    code: 'conflict',
    conflict: true,
    paths: list,
    error: DELETE_CONFLICT_COPY,
    message: DELETE_CONFLICT_COPY,
    model: 'v2',
  };
}

function pendingResult(pending, kind = 'delete-assembly') {
  const files = Array.isArray(pending?.files) ? pending.files : [];
  return {
    status: 'pending',
    code: 'pending_save',
    files: files.map((file) => file.path).filter(Boolean),
    message: SAVE_PENDING_COPY,
    error: SAVE_PENDING_COPY,
    kind,
  };
}

function waitingSave() {
  return {
    status: 'pending',
    code: 'pending_save',
    error: 'A save is already waiting. Nothing was deleted.',
    message: 'A save is already waiting. Nothing was deleted.',
  };
}

function partRefused(message = DELETE_PART_REFUSED) {
  return {
    status: 'error',
    code: 'delete_refused',
    error: message,
    message,
  };
}

function branchNameOf(branch) {
  return (typeof branch === 'string' && branch.trim()) ? branch.trim() : 'main';
}

function addRefs(set, json) {
  for (const row of json?.parts || []) {
    const def = partDefinitionId(row);
    if (isV2SurfId(def)) set.add(def);
    if (isV2SurfId(row?.id)) set.add(row.id);
    if (isV2SurfId(row?.instanceOf)) set.add(row.instanceOf);
  }
  for (const group of json?.groups || []) {
    for (const id of group?.partIds || []) {
      if (isV2SurfId(id)) set.add(id);
    }
  }
}

function definitionIds(json, openDoc, assemblyId) {
  const ids = new Set();
  const take = (parts) => {
    for (const row of parts || []) {
      const def = partDefinitionId(row);
      if (isV2SurfId(def)) ids.add(def);
    }
  };
  take(json?.parts);
  if (openDoc && openDoc.id === assemblyId) take(openDoc.parts);
  return [...ids];
}

async function remoteShaOf(adapter, repo, branch) {
  const head = await adapter.getBranch(repo, branch);
  const sha = head?.sha;
  return typeof sha === 'string' && sha ? sha : null;
}

async function overlap(adapter, repo, branch, store, remoteSha, planned, force) {
  if (force) return null;
  const tipSha = store?.getBranchTip?.(repo, branch)?.tipSha || null;
  if (!tipSha || !remoteSha || tipSha === remoteSha) return null;
  let cmp;
  try {
    cmp = await adapter.compare(repo, tipSha, remoteSha);
  } catch {
    return conflictResult(planned);
  }
  if (!cmp || cmp.truncated === true || cmp.incomplete === true) {
    return conflictResult(planned);
  }
  const changed = new Set(
    (Array.isArray(cmp.files) ? cmp.files : [])
      .map((file) => (typeof file === 'string' ? file : file?.path))
      .filter(Boolean),
  );
  const hit = planned.filter((path) => changed.has(path));
  if (hit.length) return conflictResult(hit);
  return null;
}

async function commitDeletes({
  adapter,
  repo,
  branch,
  store,
  assemblyId,
  files,
  baseSha,
  message,
  assemblies = [],
}) {
  let committed;
  try {
    committed = await writeVaultCommit({
      adapter,
      repo,
      branch,
      baseSha,
      message,
      files,
      create: false,
    });
  } catch (err) {
    if (err instanceof GitAdapterError && err.code === 'non_fast_forward') {
      return conflictResult(files.map((file) => file.path));
    }
    return refused();
  }
  if (store?.putBranchTip) {
    const tip = makeBranchTip({ repo, branch, tipSha: committed.sha });
    if (tip) await store.putBranchTip(repo, branch, tip);
  }
  if (typeof store?.clearAssemblyCommit === 'function') {
    await store.clearAssemblyCommit(repo, branch, assemblyId);
  }
  if (typeof store?.clearPendingSave === 'function') {
    await store.clearPendingSave(repo, branch);
  }
  return {
    status: 'committed',
    sha: committed.sha,
    branch,
    files,
    assemblyId,
    assemblies,
    kind: 'delete-assembly',
  };
}

/**
 * @returns {Promise<object>} committed | local | pending | conflict | error.
 * Does not change the working copy.
 */
export async function executeDeleteV2Assembly({
  adapter,
  repo,
  branch = 'main',
  store = null,
  assemblyId,
  openDoc = null,
  deleteParts = false,
  confirm = false,
  online = true,
  force = false,
  message,
  now = Date.now(),
} = {}) {
  if (confirm !== true) {
    return {
      status: 'error',
      code: 'confirm_required',
      error: 'delete_assembly requires confirm: true',
      message: 'delete_assembly requires confirm: true',
    };
  }
  const id = typeof assemblyId === 'string' ? assemblyId.trim() : '';
  if (!isV2SurfId(id) || !repo?.owner || !repo?.name || !adapter) return refused();
  const branchName = branchNameOf(branch);
  const asmPath = assemblyIdPath(id);
  const dropParts = deleteParts === true;
  const pending = store?.getPendingSave?.(repo, branchName) || null;

  if (pending && pending.kind !== 'delete-assembly') return waitingSave();

  let remoteSha = null;
  try {
    remoteSha = await remoteShaOf(adapter, repo, branchName);
  } catch {
    return refused();
  }

  const samePending = pending?.kind === 'delete-assembly' && pending.assemblyId === id;
  const revMoved = openDoc?.rev != null && pending?.rev != null && openDoc.rev !== pending.rev;
  if (samePending && !online) return pendingResult(pending);
  if (samePending && online && !revMoved && pending.deleteParts === dropParts
    && (pending.baseSha || null) === (remoteSha || null)
    && Array.isArray(pending.files) && pending.files.length) {
    return commitDeletes({
      adapter,
      repo,
      branch: branchName,
      store,
      assemblyId: id,
      files: pending.files,
      baseSha: pending.baseSha,
      message: pending.message || message,
      assemblies: Array.isArray(pending.assemblies) ? pending.assemblies : [],
    });
  }

  let file;
  try {
    file = await adapter.readFile(repo, asmPath, branchName);
  } catch {
    return refused();
  }
  if (!file || file.content == null) return { status: 'local', assemblyId: id, assemblies: [] };

  let json;
  try {
    json = typeof file.content === 'string' ? JSON.parse(file.content) : file.content;
  } catch {
    return refused();
  }
  const label = typeof json?.name === 'string' && json.name.trim()
    ? json.name.trim()
    : id;
  const commitMessage = (typeof message === 'string' && message.trim())
    || `Delete ${label}`;

  const defs = definitionIds(json, openDoc, id);
  const scan = await scanOtherAssemblyPartUses(adapter, repo, branchName, defs, {
    exceptAssemblyId: id,
  });
  if (!scan.ok || !scan.paths.has(asmPath)) return refused();
  const refs = new Set(scan.refs);
  if (openDoc && openDoc.id && openDoc.id !== id) addRefs(refs, openDoc);
  const assemblies = scan.assemblies;

  const files = [fileDelete(asmPath)];
  if (dropParts) {
    for (const partId of defs) {
      if (refs.has(partId)) continue;
      let jsPath;
      let meshPath;
      try {
        jsPath = partIdPath(partId);
        meshPath = partMeshIdPath(partId);
      } catch {
        return refused();
      }
      if (!scan.paths.has(jsPath) && !scan.paths.has(meshPath)) continue;
      if (scan.paths.has(jsPath)) files.push(fileDelete(jsPath));
      if (scan.paths.has(meshPath)) files.push(fileDelete(meshPath));
    }
  }

  const planned = files.map((item) => item.path);
  const blocked = await overlap(adapter, repo, branchName, store, remoteSha, planned, force === true);
  if (blocked) return blocked;

  if (online === false) {
    if (typeof store?.putPendingSave === 'function') {
      await store.putPendingSave(repo, branchName, {
        kind: 'delete-assembly',
        files,
        message: commitMessage,
        baseSha: remoteSha,
        rev: openDoc?.rev ?? null,
        assemblyId: id,
        deleteParts: dropParts,
        assemblies,
        capturedAt: now,
      });
    }
    return pendingResult({ files });
  }

  return commitDeletes({
    adapter,
    repo,
    branch: branchName,
    store,
    assemblyId: id,
    files,
    baseSha: remoteSha,
    message: commitMessage,
    assemblies,
  });
}

function textHash(text) {
  return gitBlobSha(new TextEncoder().encode(String(text ?? '')));
}

/**
 * Committed .surf.json with this part (and its instances) removed.
 * `changed` is false when a round-trip of the original already matches,
 * so a sibling file that does not list the part is not rewritten.
 * `{ ok: false }` when the file cannot be parsed.
 */
function rewrittenAssemblyText(content, partId) {
  try {
    const original = stringifySurfJsonV2(parseSurfJsonV2(content));
    const raw = typeof content === 'string' ? JSON.parse(content) : content;
    const parts = (Array.isArray(raw?.parts) ? raw.parts : []).filter((row) => {
      if (!row || typeof row !== 'object') return false;
      if (row.id === partId || row.instanceOf === partId) return false;
      return partDefinitionId(row) !== partId;
    });
    let activeId = raw?.activeId ?? null;
    if (activeId === partId || !parts.some((row) => row.id === activeId)) {
      activeId = parts[0]?.id ?? null;
    }
    const draft = { ...raw, parts, activeId };
    if (Array.isArray(raw?.groups)) {
      draft.groups = raw.groups.map((group) => ({
        ...group,
        partIds: (Array.isArray(group?.partIds) ? group.partIds : []).filter((rowId) => rowId !== partId),
      }));
    }
    const text = stringifySurfJsonV2(parseSurfJsonV2(draft));
    return { ok: true, text, changed: text !== original };
  } catch {
    return { ok: false };
  }
}

async function rememberOpenPartDelete(store, repo, branch, assemblyId, partId, nextText, asmPath) {
  if (!store?.getAssemblyCommit || typeof store.putAssemblyCommit !== 'function') return;
  if (!isV2SurfId(assemblyId)) return;
  const existing = store.getAssemblyCommit(repo, branch, assemblyId);
  if (!existing) return;
  const files = { ...existing.files };
  try {
    delete files[partIdPath(partId)];
    delete files[partMeshIdPath(partId)];
  } catch {
    return;
  }
  let json = existing.json;
  if (typeof nextText === 'string' && asmPath) {
    files[asmPath] = { contentHash: textHash(nextText) };
    try {
      json = JSON.parse(nextText);
    } catch {
      json = existing.json;
    }
  }
  const next = makeAssemblyCommit({
    assemblyId,
    files,
    json,
    capturedAt: existing.capturedAt,
    stalePaths: existing.stalePaths,
  });
  if (next) await store.putAssemblyCommit(repo, branch, next);
}

async function commitPartDeletes({
  adapter,
  repo,
  branch,
  store,
  partId,
  assemblyId,
  files,
  baseSha,
  message,
  assemblies = [],
  nextText = null,
  asmPath = null,
}) {
  let committed;
  try {
    committed = await writeVaultCommit({
      adapter,
      repo,
      branch,
      baseSha,
      message,
      files,
      create: false,
    });
  } catch (err) {
    if (err instanceof GitAdapterError && err.code === 'non_fast_forward') {
      return conflictResult(files.map((file) => file.path));
    }
    return partRefused();
  }
  if (store?.putBranchTip) {
    const tip = makeBranchTip({ repo, branch, tipSha: committed.sha });
    if (tip) await store.putBranchTip(repo, branch, tip);
  }
  await rememberOpenPartDelete(store, repo, branch, assemblyId, partId, nextText, asmPath);
  if (typeof store?.clearPendingSave === 'function') {
    await store.clearPendingSave(repo, branch);
  }
  return {
    status: 'committed',
    sha: committed.sha,
    branch,
    files,
    partId,
    assemblyId: assemblyId || null,
    assemblies,
    kind: 'delete-part',
  };
}

/**
 * Confirmed delete of one part file. Does not change the working copy.
 * Other assemblies that list the id are returned and not rewritten.
 * @returns {Promise<object>} committed | local | pending | conflict | error.
 */
export async function executeDeleteV2Part({
  adapter,
  repo,
  branch = 'main',
  store = null,
  partId,
  openDoc = null,
  confirm = false,
  online = true,
  force = false,
  message,
  now = Date.now(),
} = {}) {
  if (confirm !== true) {
    return {
      status: 'error',
      code: 'confirm_required',
      error: 'delete_part requires confirm: true',
      message: 'delete_part requires confirm: true',
    };
  }
  const id = typeof partId === 'string' ? partId.trim() : '';
  if (!isV2SurfId(id) || !repo?.owner || !repo?.name || !adapter) return partRefused();
  const branchName = branchNameOf(branch);
  const openId = isV2SurfId(openDoc?.id) ? openDoc.id : '';
  const pending = store?.getPendingSave?.(repo, branchName) || null;

  if (pending && !(pending.kind === 'delete-part' && pending.partId === id)) return waitingSave();

  let remoteSha = null;
  try {
    remoteSha = await remoteShaOf(adapter, repo, branchName);
  } catch {
    return partRefused();
  }

  const samePending = pending?.kind === 'delete-part' && pending.partId === id;
  const revMoved = openDoc?.rev != null && pending?.rev != null && openDoc.rev !== pending.rev;
  if (samePending && !online) return pendingResult(pending, 'delete-part');
  if (samePending && online && !revMoved
    && (pending.baseSha || null) === (remoteSha || null)
    && Array.isArray(pending.files) && pending.files.length) {
    return commitPartDeletes({
      adapter,
      repo,
      branch: branchName,
      store,
      partId: id,
      assemblyId: pending.assemblyId || openId || null,
      files: pending.files,
      baseSha: pending.baseSha,
      message: pending.message || message,
      assemblies: Array.isArray(pending.assemblies) ? pending.assemblies : [],
      nextText: typeof pending.nextText === 'string' ? pending.nextText : null,
      asmPath: pending.asmPath || null,
    });
  }

  const scan = await scanOtherAssemblyPartUses(adapter, repo, branchName, [id], {
    exceptAssemblyId: openId || null,
  });
  if (!scan.ok) return partRefused(PART_USE_SCAN_REFUSED);
  const assemblies = scan.assemblies;

  let jsPath;
  let meshPath;
  try {
    jsPath = partIdPath(id);
    meshPath = partMeshIdPath(id);
  } catch {
    return partRefused();
  }

  let file;
  try {
    file = await adapter.readFile(repo, jsPath, branchName);
  } catch {
    return partRefused();
  }
  if (!file || file.content == null) {
    return { status: 'local', partId: id, assemblies };
  }

  const files = [fileDelete(jsPath)];
  if (scan.paths.has(meshPath)) files.push(fileDelete(meshPath));

  let nextText = null;
  let asmPath = null;
  if (openId) {
    asmPath = assemblyIdPath(openId);
    if (scan.paths.has(asmPath)) {
      let asmFile;
      try {
        asmFile = await adapter.readFile(repo, asmPath, branchName);
      } catch {
        return partRefused();
      }
      if (asmFile && asmFile.content != null) {
        const rewritten = rewrittenAssemblyText(asmFile.content, id);
        if (!rewritten.ok) return partRefused();
        if (rewritten.changed) {
          nextText = rewritten.text;
          files.push(fileWrite(asmPath, nextText));
        }
      }
    }
  }

  const label = (openDoc?.parts || []).find((row) => partDefinitionId(row) === id)?.name
    || id;
  const commitMessage = (typeof message === 'string' && message.trim())
    || `Delete ${label}`;

  const planned = files.map((item) => item.path);
  const blocked = await overlap(adapter, repo, branchName, store, remoteSha, planned, force === true);
  if (blocked) return blocked;

  if (online === false) {
    if (typeof store?.putPendingSave === 'function') {
      await store.putPendingSave(repo, branchName, {
        kind: 'delete-part',
        files,
        message: commitMessage,
        baseSha: remoteSha,
        rev: openDoc?.rev ?? null,
        partId: id,
        assemblyId: openId || null,
        assemblies,
        nextText,
        asmPath: nextText ? asmPath : null,
        capturedAt: now,
      });
    }
    return { ...pendingResult({ files }, 'delete-part'), partId: id, assemblies };
  }

  return commitPartDeletes({
    adapter,
    repo,
    branch: branchName,
    store,
    partId: id,
    assemblyId: openId || null,
    files,
    baseSha: remoteSha,
    message: commitMessage,
    assemblies,
    nextText,
    asmPath: nextText ? asmPath : null,
  });
}
