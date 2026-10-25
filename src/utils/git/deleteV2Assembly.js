/**
 * Delete one committed v2 assembly (§2.7, §2.8, §2.10).
 *
 * One writeVaultCommit after confirm. Deletes assemblies/<id>.surf.json.
 * Delete parts also deletes parts/<id>.js and its mesh when no other
 * assembly on the branch references that id (tip .surf.json files, plus
 * the open working copy when it is a different assembly). Sibling
 * assemblies are not rewritten.
 *
 * listTree or a sibling read that fails refuses the delete and writes
 * nothing. Offline stores one pending write. A moved tip that touches a
 * planned path is a conflict. The caller adopts the working copy only
 * after status committed. A missing assembly file is local: no git write.
 */
import { partDefinitionId } from '../assembly.js';
import { fileDelete, GitAdapterError } from './githubAdapterInterface.js';
import { assemblyIdPath, parseIdPath, partIdPath, partMeshIdPath } from './idPaths.js';
import { makeBranchTip } from './lastCommit.js';
import { isV2SurfId } from './surfId.js';
import { SAVE_PENDING_COPY } from './executePlanSave.js';
import { writeVaultCommit } from './writeVaultCommit.js';

export const DELETE_ASSEMBLY_REFUSED = "Couldn't delete the assembly. Nothing was changed.";

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

function pendingResult(pending) {
  const files = Array.isArray(pending?.files) ? pending.files : [];
  return {
    status: 'pending',
    code: 'pending_save',
    files: files.map((file) => file.path).filter(Boolean),
    message: SAVE_PENDING_COPY,
    error: SAVE_PENDING_COPY,
    kind: 'delete-assembly',
  };
}

function branchNameOf(branch) {
  return (typeof branch === 'string' && branch.trim()) ? branch.trim() : 'main';
}

function entryPath(entry) {
  return typeof entry === 'string' ? entry : entry?.path;
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

/**
 * Other assemblies' part ids. Fail closed when the tree or a sibling
 * .surf.json cannot be read.
 */
async function referenceScan(adapter, repo, branch, assemblyId, assemblyPath, openDoc) {
  let tree;
  try {
    tree = await adapter.listTree(repo, branch);
  } catch {
    return { ok: false };
  }
  if (!Array.isArray(tree)) return { ok: false };
  const paths = new Set();
  const refs = new Set();
  let sawTarget = false;
  if (openDoc && openDoc.id && openDoc.id !== assemblyId) addRefs(refs, openDoc);
  for (const entry of tree) {
    const path = entryPath(entry);
    if (!path) continue;
    paths.add(path);
    const parsed = parseIdPath(path);
    if (parsed?.kind !== 'assembly') continue;
    if (parsed.id === assemblyId || path === assemblyPath) {
      sawTarget = true;
      continue;
    }
    let file;
    try {
      file = await adapter.readFile(repo, path, branch);
    } catch {
      return { ok: false };
    }
    if (!file || file.content == null) return { ok: false };
    let json;
    try {
      json = typeof file.content === 'string' ? JSON.parse(file.content) : file.content;
    } catch {
      return { ok: false };
    }
    if (!json || typeof json !== 'object') return { ok: false };
    addRefs(refs, json);
  }
  if (!sawTarget) return { ok: false };
  return { ok: true, refs, paths };
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

  if (pending && pending.kind !== 'delete-assembly') {
    return {
      status: 'pending',
      code: 'pending_save',
      error: 'A save is already waiting. Nothing was deleted.',
      message: 'A save is already waiting. Nothing was deleted.',
    };
  }

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
    });
  }

  let file;
  try {
    file = await adapter.readFile(repo, asmPath, branchName);
  } catch {
    return refused();
  }
  if (!file || file.content == null) return { status: 'local', assemblyId: id };

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

  const files = [fileDelete(asmPath)];
  if (dropParts) {
    const scan = await referenceScan(adapter, repo, branchName, id, asmPath, openDoc);
    if (!scan.ok) return refused();
    for (const partId of definitionIds(json, openDoc, id)) {
      if (scan.refs.has(partId)) continue;
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
  });
}
