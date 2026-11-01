/**
 * v2 Save: planSave + writeVaultCommit (save-model PR 7, docs/git-save-model.md).
 *
 * User Save and git_save on a v2 vault plan with
 *   planSave(branchTip, assemblyCommit, workingCopy, remoteTip, compareFiles)
 * and write only through writeVaultCommit. After a successful commit the
 * caller persists BranchTip.tipSha = the new sha and this AssemblyCommit.
 *
 * No git write on load, reload, edit, online, or connect.
 */
import { normalizeRepoPath } from '../assembly.js';
import { mapLimit, VAULT_READ_CONCURRENCY } from './mapLimit.js';
import { isBinaryContent, toUint8Array } from './binaryContent.js';
import {
  assertGithubAdapter,
  GitAdapterError,
} from './githubAdapterInterface.js';
import { assemblyIdPath, parseIdPath, partIdPath, partMeshIdPath } from './idPaths.js';
import {
  LAST_COMMIT_SCHEMA_VERSION,
  captureLastCommit,
  makeBranchTip,
  parseAssemblyCommit,
  parseBranchTip,
} from './lastCommit.js';
import { planSave } from './planSave.js';
import { parseSurfJsonV2 } from './surfJsonV2.js';
import { isV2SurfId } from './surfId.js';
import { writeVaultCommit } from './writeVaultCommit.js';
import { SAVE_QUEUED_COPY } from './workingSidecar.js';

export const SAVE_CONFLICT_COPY = 'These files also changed on the remote. Nothing was written. Go back, Get latest, Create a new branch, or Overwrite. Go back changes nothing. Get latest does not write git.';
export const SAVE_REFUSED_SUFFIX = ' Nothing was written.';
export const SAVE_PENDING_COPY = SAVE_QUEUED_COPY;

function repoRef(repo) {
  const owner = typeof repo?.owner === 'string' ? repo.owner.trim() : '';
  const name = typeof repo?.name === 'string' ? repo.name.trim() : '';
  if (!owner || !name) return null;
  return { owner, name };
}

function branchNameOf(branch) {
  return (typeof branch === 'string' && branch.trim()) ? branch.trim() : 'main';
}

/** GitHub owner/repo are case-insensitive; branch names are not. */
function sameRepoIgnoreCase(a, b) {
  if (!a || !b) return false;
  return String(a.owner || '').toLowerCase() === String(b.owner || '').toLowerCase()
    && String(a.name || '').toLowerCase() === String(b.name || '').toLowerCase();
}

/**
 * planSave compares saveTarget to BranchTip with string equality. Fold owner/name
 * to the stored tip's casing when they match case-insensitively so Artur/artur
 * does not refuse. A real repo/branch mismatch is passed through so planSave throws.
 */
function saveTargetForPlan(repo, branch, tip) {
  const targetRepo = repoRef(repo);
  const branchName = branchNameOf(branch);
  if (!targetRepo) return null;
  if (tip?.repo && sameRepoIgnoreCase(tip.repo, targetRepo)) {
    return {
      repo: { owner: tip.repo.owner, name: tip.repo.name },
      branch: branchName,
    };
  }
  return { repo: targetRepo, branch: branchName };
}

function assemblyIdOf(workingCopy) {
  const id = workingCopy?.doc?.id || workingCopy?.id;
  return isV2SurfId(id) ? id : '';
}

function docOf(workingCopy) {
  if (workingCopy?.doc && typeof workingCopy.doc === 'object' && !Array.isArray(workingCopy.doc)) {
    return workingCopy.doc;
  }
  return workingCopy;
}

function refused(message, extra = {}) {
  const text = String(message || 'Save was refused.');
  const withSuffix = text.endsWith(SAVE_REFUSED_SUFFIX.trim()) ? text : `${text}${SAVE_REFUSED_SUFFIX}`;
  return {
    status: 'error',
    code: extra.code || 'save_refused',
    error: withSuffix,
    message: withSuffix,
    ...extra,
  };
}

function conflictResult(paths, extra = {}) {
  const list = [...new Set((paths || []).filter(Boolean))].sort();
  return {
    status: 'conflict',
    code: 'conflict',
    conflict: true,
    paths: list,
    error: SAVE_CONFLICT_COPY,
    message: SAVE_CONFLICT_COPY,
    model: 'v2',
    ...extra,
  };
}

/** Pending sidecar paths → part ids for planSave `deleteFromRepo`. */
export function deleteFromRepoIdsFromPaths(paths) {
  const ids = [];
  const seen = new Set();
  for (const raw of paths || []) {
    const parsed = parseIdPath(raw);
    if (!parsed || (parsed.kind !== 'part' && parsed.kind !== 'mesh')) continue;
    if (seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    ids.push(parsed.id);
  }
  return ids;
}

/** v2 "delete from assembly & repo" sidecar paths for one part id. */
export function repoDeletePathsForV2Part(partId) {
  if (!isV2SurfId(partId)) return [];
  return [partIdPath(partId), partMeshIdPath(partId)];
}

/**
 * Apply Get-latest contents (v2 paths) onto the open working copy.
 * Does not write git. Does not copy remote `activeId` over WC `activeId`.
 */
export function applySaveReload(doc, scripts, contents) {
  let nextDoc = doc;
  const nextScripts = { ...(scripts || {}) };
  const keepActive = doc?.activeId;
  for (const [path, content] of Object.entries(contents || {})) {
    const parsed = parseIdPath(path);
    if (!parsed) continue;
    if (parsed.kind === 'part' && typeof content === 'string') {
      nextScripts[parsed.id] = content;
      continue;
    }
    if (parsed.kind === 'assembly' && typeof content === 'string') {
      try {
        const loaded = parseSurfJsonV2(content);
        if (!doc?.id || loaded.id === doc.id) {
          nextDoc = {
            ...loaded,
            source: 'git',
            vaultLayout: 'v2',
            activeId: keepActive !== undefined ? keepActive : loaded.activeId,
            rev: doc?.rev,
          };
        }
      } catch { /* keep the open document */ }
    }
  }
  return { doc: nextDoc, scripts: nextScripts };
}

function assemblyRowFromContent(content) {
  let json = null;
  try {
    json = typeof content === 'string' ? JSON.parse(content) : content;
  } catch {
    return {};
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
  return {
    id: json.id,
    name: json.name,
    parts: json.parts,
    groups: json.groups,
    json,
  };
}

function compareChangedPaths(compareFiles) {
  if (compareFiles == null || typeof compareFiles !== 'object') {
    return { paths: [], truncated: true };
  }
  if (compareFiles.truncated === true || compareFiles.incomplete === true) {
    return { paths: [], truncated: true };
  }
  const rows = Array.isArray(compareFiles)
    ? compareFiles
    : (Array.isArray(compareFiles.files) ? compareFiles.files : null);
  if (!rows) return { paths: [], truncated: true };
  const paths = [];
  for (const row of rows) {
    const raws = typeof row === 'string'
      ? [row]
      : [row?.path, row?.filename, row?.previous_filename];
    for (const raw of raws) {
      const path = normalizeRepoPath(raw);
      if (path) paths.push(path);
    }
  }
  return { paths: [...new Set(paths)], truncated: false };
}

/**
 * This assembly's files the remote changed but this Save did not write.
 * Later writes of those paths conflict until Get latest.
 */
function nextStalePaths(previousCommit, writtenPaths, compareFiles) {
  const written = new Set(
    (writtenPaths || []).map((path) => normalizeRepoPath(path)).filter(Boolean),
  );
  const prevFiles = new Set(Object.keys(previousCommit?.files || {}));
  const carried = (previousCommit?.stalePaths || []).filter((path) => !written.has(path));
  const cmp = compareChangedPaths(compareFiles);
  const newly = [];
  if (cmp.truncated) {
    for (const path of prevFiles) {
      if (!written.has(path)) newly.push(path);
    }
  } else {
    for (const path of cmp.paths) {
      if (prevFiles.has(path) && !written.has(path)) newly.push(path);
    }
  }
  return [...new Set([...carried, ...newly])].sort();
}

function withStalePaths(commit, stalePaths) {
  if (!commit) return commit;
  const next = { ...commit };
  if (stalePaths?.length) next.stalePaths = stalePaths;
  else delete next.stalePaths;
  return parseAssemblyCommit(next) || commit;
}

function stalePlannedPaths(commit, files) {
  const stale = new Set(commit?.stalePaths || []);
  if (!stale.size) return [];
  const hits = [];
  for (const file of files || []) {
    const path = normalizeRepoPath(file?.path);
    if (path && stale.has(path)) hits.push(path);
  }
  return [...new Set(hits)].sort();
}

function plannedPathsOf(files) {
  return (files || []).map((file) => normalizeRepoPath(file?.path)).filter(Boolean);
}

/**
 * Tip `.surf.json` rows + blob hashes from the **current remote tip**.
 * A blob hash is the git blob sha of the bytes, which is exactly what the
 * tree listing carries for every entry (the mock's tree shas are git blob
 * shas too), so no part script or mesh is read back to be hashed; only the
 * other assemblies' files are read, for their part rows, in parallel. An
 * entry with no sha goes on `unreadPaths` and refuses a plan that writes
 * it. A failed listTree returns `{ treeFailed: true }`.
 */
export async function loadBranchContext(adapter, repo, tipSha, selfId) {
  const branchFiles = {};
  const branchAssemblies = [];
  const unreadPaths = [];
  if (!tipSha) return { branchFiles, branchAssemblies, unreadPaths };
  let tree;
  try {
    tree = await adapter.listTree(repo, tipSha);
  } catch {
    return { branchFiles: null, branchAssemblies: null, treeFailed: true };
  }
  const others = [];
  for (const entry of tree || []) {
    const path = normalizeRepoPath(entry?.path);
    const parsed = parseIdPath(path);
    if (!parsed) continue;
    if (typeof entry?.sha === 'string' && entry.sha) branchFiles[path] = { contentHash: entry.sha.toLowerCase() };
    else unreadPaths.push(path);
    if (parsed.kind === 'assembly' && parsed.id !== selfId) others.push(path);
  }
  let rows;
  try {
    rows = await mapLimit(others, VAULT_READ_CONCURRENCY, async (path) => {
      const file = await adapter.readFile(repo, path, tipSha);
      if (!file || typeof file.content !== 'string') throw new Error(`unreadable ${path}`);
      return assemblyRowFromContent(file.content);
    });
  } catch {
    // An unreadable sibling assembly would fail-open a part delete.
    return { branchFiles: null, branchAssemblies: null, treeFailed: true };
  }
  branchAssemblies.push(...rows);
  return { branchFiles, branchAssemblies, unreadPaths };
}

function nextTipRecord(plan, repo, branch, sha) {
  const prev = parseBranchTip(plan?.nextBranchTip);
  return parseBranchTip({
    schemaVersion: LAST_COMMIT_SCHEMA_VERSION,
    repo: prev?.repo || repo,
    branch: prev?.branch || branch,
    tipSha: sha,
  }) || makeBranchTip({ repo, branch, tipSha: sha });
}

export async function persistPlanSaveRecords(store, {
  repo,
  branch,
  sha,
  nextBranchTip,
  nextAssemblyCommit,
  adopt = [],
  now,
} = {}) {
  if (!store) return null;
  const tip = nextTipRecord({ nextBranchTip }, repo, branch, sha)
    || makeBranchTip({ repo, branch, tipSha: sha });
  if (tip) await store.putBranchTip(repo, branch, tip);
  if (nextAssemblyCommit) {
    const capturedAt = Number.isFinite(Number(now)) ? Number(now) : nextAssemblyCommit.capturedAt;
    await store.putAssemblyCommit(repo, branch, {
      ...nextAssemblyCommit,
      capturedAt,
    });
  }
  for (const row of adopt || []) {
    const existing = parseAssemblyCommit(store.getAssemblyCommit?.(repo, branch, row.assemblyId));
    if (!existing) continue;
    await store.putAssemblyCommit(repo, branch, {
      ...existing,
      files: { ...existing.files, ...row.files },
      capturedAt: Number.isFinite(Number(now)) ? Number(now) : existing.capturedAt,
    });
  }
  if (typeof store.clearPendingSave === 'function') {
    await store.clearPendingSave(repo, branch);
  }
  return tip;
}

async function compareForPlan(adapter, repo, tipSha, remoteSha, force) {
  if (force || !tipSha || !remoteSha || remoteSha === tipSha) return [];
  try {
    const cmp = await adapter.compare(repo, tipSha, remoteSha);
    if (cmp && typeof cmp === 'object') return cmp;
    return { truncated: true };
  } catch {
    // Incomplete compare is the same fail-closed as truncated:true.
    return { truncated: true };
  }
}

/**
 * Load BranchTip / AssemblyCommit / remote tip / compare / branch extras,
 * then planSave. Does not write git.
 */
export async function planVaultSave({
  adapter,
  repo,
  branch = 'main',
  store = null,
  workingCopy,
  force = false,
  skipRemoteCompare = false,
  now = Date.now(),
} = {}) {
  assertGithubAdapter(adapter);
  const ref = repoRef(repo);
  if (!ref) return refused('Save needs a repo.');
  const branchName = branchNameOf(branch);
  const assemblyId = assemblyIdOf(workingCopy);
  if (!assemblyId) return refused('Save needs a v2 assembly id.');

  let remoteSha = null;
  try {
    const head = await adapter.getBranch(ref, branchName);
    remoteSha = typeof head?.sha === 'string' && head.sha ? head.sha.toLowerCase() : null;
  } catch (err) {
    if (err instanceof GitAdapterError && err.code === 'not_found') {
      remoteSha = null;
    } else {
      throw err;
    }
  }

  const storedTip = parseBranchTip(store?.getBranchTip?.(ref, branchName));
  const storedCommit = parseAssemblyCommit(
    store?.getAssemblyCommit?.(ref, branchName, assemblyId),
  );

  const branchTip = force && remoteSha
    ? parseBranchTip({
      schemaVersion: LAST_COMMIT_SCHEMA_VERSION,
      repo: storedTip?.repo || ref,
      branch: storedTip?.branch || branchName,
      tipSha: remoteSha,
    })
    : storedTip;

  // Always load branchAssemblies + branchFiles from the current remote tip.
  // planSave only checks them when they are passed; empty-on-failure would
  // fail-open a delete.
  const loaded = await loadBranchContext(adapter, ref, remoteSha, assemblyId);
  if (loaded.treeFailed) {
    return refused('Save could not read the current remote tip.');
  }
  const branchAssemblies = loaded.branchAssemblies;
  const branchFiles = loaded.branchFiles;
  const unreadPaths = loaded.unreadPaths || [];

  if (!storedTip && !storedCommit) {
    let assemblyPath = '';
    try { assemblyPath = assemblyIdPath(assemblyId); } catch { assemblyPath = ''; }
    if (assemblyPath && branchFiles?.[assemblyPath]) {
      return refused('Get latest first.');
    }
  }

  const otherAssemblyCommits = Array.isArray(workingCopy?.otherAssemblyCommits)
    ? workingCopy.otherAssemblyCommits
    : (typeof store?.listAssemblyCommits === 'function'
      ? store.listAssemblyCommits(ref, branchName)
      : []);

  // Compare against the stored tip even on overwrite, so unwritten remote
  // files of this assembly can be marked known-stale after a fast-forward.
  const remoteCompare = skipRemoteCompare
    ? []
    : await compareForPlan(adapter, ref, storedTip?.tipSha || null, remoteSha, false);
  const compareFiles = force ? [] : remoteCompare;

  const saveTarget = saveTargetForPlan(ref, branchName, branchTip);
  if (!saveTarget) return refused('Save needs a repo.');

  const planInput = {
    doc: docOf(workingCopy),
    scripts: workingCopy?.scripts,
    meshes: workingCopy?.meshes,
    assets: workingCopy?.assets,
    now: workingCopy?.now ?? now,
    deleteFromRepo: workingCopy?.deleteFromRepo,
    otherAssemblyCommits: Array.isArray(otherAssemblyCommits) ? otherAssemblyCommits : [],
    repo: saveTarget.repo,
    branch: saveTarget.branch,
    saveTarget,
    branchAssemblies,
    branchFiles,
  };
  if (Array.isArray(workingCopy?.openWorkingCopies)) {
    planInput.openWorkingCopies = workingCopy.openWorkingCopies;
  }

  let plan;
  try {
    plan = planSave(branchTip, storedCommit, planInput, remoteSha, compareFiles);
  } catch (err) {
    return refused(err?.message || 'Save was refused.');
  }
  if (plan?.conflict) {
    return conflictResult(plan.paths, {
      remoteTip: remoteSha,
      tipSha: branchTip?.tipSha || null,
      truncated: compareFiles?.truncated === true || compareFiles?.incomplete === true,
    });
  }
  const planned = plannedPathsOf(plan.files);
  const unreadHit = planned.filter((path) => unreadPaths.includes(path));
  if (unreadHit.length) {
    return refused('Save could not read the current remote tip.');
  }
  if (!force && !skipRemoteCompare) {
    const staleHits = stalePlannedPaths(storedCommit, plan.files);
    if (staleHits.length) {
      return conflictResult(staleHits, {
        remoteTip: remoteSha,
        tipSha: branchTip?.tipSha || null,
      });
    }
  }
  return {
    plan,
    remoteSha,
    remoteCompare,
    branchTip,
    storedCommit,
    repo: ref,
    branch: branchName,
    assemblyId,
  };
}

async function writePlannedFiles({
  adapter,
  repo,
  branch,
  store,
  message,
  files,
  baseSha,
  create,
  plan,
  storedCommit = null,
  remoteCompare = [],
  now,
  overwrote = false,
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
      create,
    });
  } catch (err) {
    if (err instanceof GitAdapterError && err.code === 'non_fast_forward') {
      return conflictResult(files.map((file) => file.path), {
        remoteTip: null,
        code: 'conflict',
      });
    }
    throw err;
  }
  const nextAssemblyCommit = withStalePaths(
    plan.nextAssemblyCommit,
    nextStalePaths(storedCommit, files.map((file) => file.path), remoteCompare),
  );
  const tip = await persistPlanSaveRecords(store, {
    repo,
    branch,
    sha: committed.sha,
    nextBranchTip: plan.nextBranchTip,
    nextAssemblyCommit,
    adopt: plan.adopt,
    now,
  });
  return {
    status: 'committed',
    ...(overwrote ? { overwrote: true } : {}),
    sha: committed.sha,
    branch,
    files,
    nextBranchTip: tip,
    nextAssemblyCommit,
    adopt: plan.adopt || [],
    partStillReferenced: plan.partStillReferenced,
  };
}

/**
 * Plan + one writeVaultCommit. Offline: persist one pending write (second
 * Save pushes). `online` never writes on its own.
 */
export async function executePlanSave({
  adapter,
  repo,
  branch = 'main',
  store = null,
  workingCopy,
  message,
  force = false,
  create = false,
  online = true,
  now = Date.now(),
} = {}) {
  const msg = typeof message === 'string' ? message.trim() : '';
  if (!msg) {
    return {
      status: 'error',
      code: 'bad_args',
      error: 'Commit message required',
      message: 'Commit message required',
    };
  }

  const pending = store?.getPendingSave?.(repo, branch) || null;
  // A confirmed delete owns the one pending slot. Save pushes it; it does
  // not become a normal planSave of the open assembly.
  if (pending?.kind === 'delete-assembly') {
    const { executeDeleteV2Assembly } = await import('./deleteV2Assembly.js');
    return executeDeleteV2Assembly({
      adapter,
      repo,
      branch,
      store,
      assemblyId: pending.assemblyId,
      openDoc: docOf(workingCopy),
      deleteParts: pending.deleteParts === true,
      confirm: true,
      online,
      message: pending.message || msg,
      now,
    });
  }
  if (pending?.kind === 'delete-part') {
    const { executeDeleteV2Part } = await import('./deleteV2Assembly.js');
    return executeDeleteV2Part({
      adapter,
      repo,
      branch,
      store,
      partId: pending.partId,
      openDoc: docOf(workingCopy),
      confirm: true,
      online,
      message: pending.message || msg,
      now,
    });
  }
  if (pending && online) {
    const rev = docOf(workingCopy)?.rev;
    const revMoved = rev != null && pending.rev != null && rev !== pending.rev;
    if (!revMoved && Array.isArray(pending.files) && pending.files.length) {
      let remoteSha = null;
      try {
        const head = await adapter.getBranch(repo, branchNameOf(branch));
        remoteSha = head?.sha || null;
      } catch { /* missing */ }
      if ((pending.baseSha || null) === (remoteSha || null)) {
        const prepared = await planVaultSave({
          adapter, repo, branch, store, workingCopy, force, now,
        });
        if (prepared.status) return prepared;
        return writePlannedFiles({
          adapter,
          repo: prepared.repo,
          branch: prepared.branch,
          store,
          message: pending.message || msg,
          files: pending.files,
          baseSha: pending.baseSha,
          create,
          plan: prepared.plan,
          storedCommit: prepared.storedCommit,
          remoteCompare: prepared.remoteCompare,
          now,
          overwrote: force === true,
        });
      }
    }
  }

  const prepared = await planVaultSave({
    adapter, repo, branch, store, workingCopy, force, now,
  });
  if (prepared.status) return prepared;

  const files = prepared.plan.files || [];
  if (!files.length) {
    if (store && typeof store.clearPendingSave === 'function') {
      await store.clearPendingSave(prepared.repo, prepared.branch);
    }
    return {
      status: 'clean',
      files: [],
      nextBranchTip: prepared.plan.nextBranchTip,
      nextAssemblyCommit: prepared.plan.nextAssemblyCommit,
    };
  }

  if (online === false) {
    if (store && typeof store.putPendingSave === 'function') {
      await store.putPendingSave(prepared.repo, prepared.branch, {
        files,
        message: msg,
        baseSha: prepared.remoteSha,
        rev: docOf(workingCopy)?.rev ?? null,
        assemblyId: prepared.assemblyId,
        capturedAt: now,
      });
    }
    return {
      status: 'pending',
      code: 'pending_save',
      files: files.map((file) => file.path),
      message: SAVE_PENDING_COPY,
      error: SAVE_PENDING_COPY,
      nextBranchTip: prepared.plan.nextBranchTip,
      nextAssemblyCommit: prepared.plan.nextAssemblyCommit,
    };
  }

  // Parent is the current remote tip so a non-overlapping remote commit
  // fast-forwards (§7 cases 7–8). Stored tipSha is only the compare base.
  const baseSha = prepared.remoteSha || prepared.branchTip?.tipSha || null;

  return writePlannedFiles({
    adapter,
    repo: prepared.repo,
    branch: prepared.branch,
    store,
    message: msg,
    files,
    baseSha,
    create,
    plan: prepared.plan,
    storedCommit: prepared.storedCommit,
    remoteCompare: prepared.remoteCompare,
    now,
    overwrote: force === true,
  });
}

async function reloadConflictingFiles({
  adapter,
  repo,
  branch,
  store,
  workingCopy,
  paths,
  now,
}) {
  const requested = [...new Set((paths || []).map((path) => normalizeRepoPath(path)).filter(Boolean))];
  if (!requested.length) {
    return refused('Get latest needs the conflicting paths.', { code: 'bad_args' });
  }
  assertGithubAdapter(adapter);
  const branchName = branchNameOf(branch);
  const assemblyId = assemblyIdOf(workingCopy);
  const head = await adapter.getBranch(repo, branchName);
  const headSha = head?.sha || null;
  const moved = await mainMovedPlanSavePaths({
    adapter,
    repo,
    branch: branchName,
    store,
    assemblyId,
  });
  const commit = parseAssemblyCommit(
    store?.getAssemblyCommit?.(repo, branchName, assemblyId),
  );
  const want = [...new Set([
    ...requested,
    ...(moved.paths || []),
    ...(commit?.stalePaths || []),
  ])];
  const contents = {};
  if (headSha) {
    const tree = await adapter.listTree(repo, headSha);
    const shaByPath = new Map(
      (tree || []).filter((entry) => entry?.path).map((entry) => [entry.path, entry.sha]),
    );
    for (const path of want) {
      const sha = shaByPath.get(path);
      if (!sha) continue;
      const parsed = parseIdPath(path);
      if (parsed?.kind === 'mesh') {
        const bytes = await adapter.readBlob(repo, sha);
        if (bytes) contents[path] = toUint8Array(bytes);
        continue;
      }
      const file = await adapter.readFile(repo, path, headSha);
      if (file && typeof file.content === 'string') contents[path] = file.content;
    }
  }
  if (store && headSha) {
    await captureLastCommit({
      adapter,
      repo,
      branch: branchName,
      store,
      assemblyId,
      headSha,
      persistBranchTip: true,
      persistAssemblyCommit: !!assemblyId,
      now,
    });
  }
  return {
    status: 'reloaded',
    files: Object.keys(contents).sort(),
    contents,
  };
}

async function saveMineToNewBranch({
  adapter,
  repo,
  branch,
  store,
  workingCopy,
  message,
  now,
}) {
  const msg = typeof message === 'string' ? message.trim() : '';
  if (!msg) {
    return {
      status: 'error',
      code: 'bad_args',
      error: 'Commit message required',
      message: 'Commit message required',
    };
  }
  const prepared = await planVaultSave({
    adapter,
    repo,
    branch,
    store,
    workingCopy,
    skipRemoteCompare: true,
    now,
  });
  if (prepared.status) return prepared;
  const files = prepared.plan.files || [];
  if (!files.length) {
    return { status: 'clean', files: [] };
  }
  const fromSha = prepared.branchTip?.tipSha || prepared.remoteSha;
  if (!fromSha) {
    return refused('Create a new branch needs a last-commit tip.');
  }
  const stamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const next = `save-${stamp.toString(36)}`;
  const created = await adapter.createBranch(repo, next, fromSha);
  const committed = await writeVaultCommit({
    adapter,
    repo,
    branch: next,
    message: msg,
    files,
    baseSha: created?.sha || fromSha,
  });
  const tip = await persistPlanSaveRecords(store, {
    repo,
    branch: next,
    sha: committed.sha,
    nextBranchTip: makeBranchTip({ repo, branch: next, tipSha: committed.sha }),
    nextAssemblyCommit: prepared.plan.nextAssemblyCommit,
    adopt: prepared.plan.adopt,
    now,
  });
  return {
    status: 'branched',
    branch: next,
    sha: committed.sha,
    files,
    switched: true,
    fromSha,
    nextBranchTip: tip,
    nextAssemblyCommit: prepared.plan.nextAssemblyCommit,
  };
}

export async function executePlanSaveConflictChoice({
  action,
  adapter,
  repo,
  branch = 'main',
  store = null,
  workingCopy,
  message,
  paths = [],
  now = Date.now(),
} = {}) {
  if (action === 'dismiss') {
    return { status: 'dismissed' };
  }
  if (action === 'overwrite') {
    return executePlanSave({
      adapter,
      repo,
      branch,
      store,
      workingCopy,
      message,
      force: true,
      now,
    });
  }
  if (action === 'reload') {
    return reloadConflictingFiles({
      adapter,
      repo,
      branch,
      store,
      workingCopy,
      paths,
      now,
    });
  }
  if (action === 'branch') {
    return saveMineToNewBranch({
      adapter,
      repo,
      branch,
      store,
      workingCopy,
      message,
      now,
    });
  }
  return {
    status: 'error',
    code: 'bad_args',
    error: 'Unknown conflict action',
    message: 'Go back, Get latest, Create a new branch, or Overwrite.',
  };
}

export function meshesFromPartRecords(records) {
  const meshes = {};
  for (const [id, rec] of Object.entries(records || {})) {
    if (isBinaryContent(rec)) {
      meshes[id] = toUint8Array(rec);
      continue;
    }
    if (isBinaryContent(rec?.bytes)) {
      meshes[id] = toUint8Array(rec.bytes);
      continue;
    }
    const bags = [rec?.assets, rec];
    for (const bag of bags) {
      if (!bag || typeof bag !== 'object') continue;
      try {
        const v2 = partMeshIdPath(id);
        if (isBinaryContent(bag[v2])) {
          meshes[id] = toUint8Array(bag[v2]);
          break;
        }
      } catch { /* skip */ }
      if (isBinaryContent(bag[id])) {
        meshes[id] = toUint8Array(bag[id]);
        break;
      }
      if (isBinaryContent(bag[id]?.bytes)) {
        meshes[id] = toUint8Array(bag[id].bytes);
        break;
      }
    }
  }
  return meshes;
}

/**
 * Main-moved notice for a v2 assembly: this assembly's `.surf.json` and/or
 * its last-commit part files that appear in compare(tipSha, remoteTip).
 * Truncated compare is a conflict (no write). Empty list = no notice.
 */
export async function mainMovedPlanSavePaths({
  adapter,
  repo,
  branch = 'main',
  store = null,
  assemblyId,
} = {}) {
  const ref = repoRef(repo);
  const branchName = branchNameOf(branch);
  const id = isV2SurfId(assemblyId) ? assemblyId : '';
  if (!ref || !id) return { paths: [], truncated: false };
  const tip = parseBranchTip(store?.getBranchTip?.(ref, branchName));
  let remoteSha = null;
  try {
    const head = await adapter.getBranch(ref, branchName);
    remoteSha = typeof head?.sha === 'string' && head.sha ? head.sha.toLowerCase() : null;
  } catch {
    remoteSha = null;
  }
  const tipSha = tip?.tipSha || null;
  if (!tipSha || !remoteSha || remoteSha === tipSha) {
    return { paths: [], truncated: false };
  }
  const compareFiles = await compareForPlan(adapter, ref, tipSha, remoteSha, false);
  const truncated = compareFiles?.truncated === true || compareFiles?.incomplete === true;
  const commit = parseAssemblyCommit(store?.getAssemblyCommit?.(ref, branchName, id));
  let assemblyPath = '';
  try { assemblyPath = assemblyIdPath(id); } catch { assemblyPath = ''; }
  const mine = new Set([
    ...(assemblyPath ? [assemblyPath] : []),
    ...Object.keys(commit?.files || {}),
    ...(commit?.stalePaths || []),
  ]);
  if (truncated) {
    return { paths: [...mine].sort(), truncated: true };
  }
  const rows = Array.isArray(compareFiles)
    ? compareFiles
    : (Array.isArray(compareFiles?.files) ? compareFiles.files : []);
  const paths = [];
  for (const row of rows) {
    const path = normalizeRepoPath(row?.path);
    if (path && mine.has(path)) paths.push(path);
  }
  return { paths: [...new Set(paths)].sort(), truncated: false };
}

/** True when Save must use planSave + writeVaultCommit (v2 vault). */
export function isV2PlanSaveDoc(doc) {
  return doc?.source === 'git' && doc?.vaultLayout === 'v2' && isV2SurfId(doc?.id);
}
