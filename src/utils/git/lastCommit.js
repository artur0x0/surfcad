/**
 * lastCommit: persisted BranchTip + AssemblyCommit (save-model v2 PR 3).
 *
 * Built from committed tip bytes — never by serializing the working copy.
 * Capture is read-only: no git writes, no repo creation.
 * Stored in surfcad-sync kv (see syncStore). lastCommit is advisory: a
 * missing or corrupt row is empty, not a throw.
 *
 * files keys are f(id) paths (assemblyIdPath / partIdPath / partMeshIdPath).
 * v1 blob paths arrive as blobSources from the legacy reader — import that
 * module directly so lastCommit never loads upgrade.js (cycle).
 */
import { normalizeRepoPath, partDefinitionId } from '../assembly.js';
import { assertGithubAdapter } from './githubAdapterInterface.js';
import {
  assemblyIdPath,
  parseIdPath,
  partIdPath,
  partMeshIdPath,
} from './idPaths.js';
import { lastCommitBlobSources } from './legacyVault/reader.js';
import { isV2SurfId } from './surfId.js';

export const LAST_COMMIT_SCHEMA_VERSION = 1;
export const LAST_COMMIT_CAPTURE_TIMEOUT_MS = 15_000;

const BLOB_SHA = /^[0-9a-f]{40}$/i;

function isBlobSha(value) {
  return typeof value === 'string' && BLOB_SHA.test(value);
}

function repoRef(repo) {
  const owner = typeof repo?.owner === 'string' ? repo.owner.trim() : '';
  const name = typeof repo?.name === 'string' ? repo.name.trim() : '';
  if (!owner || !name) return null;
  return { owner, name };
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function tryIdPath(fn, id) {
  try {
    return fn(id);
  } catch {
    return null;
  }
}

function parseCommittedJson(content) {
  let raw = content;
  if (typeof content === 'string') {
    try { raw = JSON.parse(content); } catch { return null; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return cloneJson(raw);
}

/** Committed v2 `.surf.json` object, else null (v1 / invalid). */
function committedV2Json(raw) {
  if (!raw || raw.version !== 2) return null;
  return raw;
}

/**
 * True when this capture must not write. Overlay `signal()` is true-while-
 * live (`isCurrent(gen)`) — that is the opposite polarity and must not be
 * passed here. AbortSignal.aborted is stale.
 */
function staleNow(isStale) {
  if (typeof isStale === 'function') return !!isStale();
  if (isStale && typeof isStale === 'object' && isStale.aborted === true) return true;
  return false;
}

function abortError(label) {
  const err = new Error(label || 'lastCommit capture aborted');
  err.name = 'AbortError';
  return err;
}

async function withTimeout(promise, ms, label) {
  const timeout = Number(ms);
  if (!Number.isFinite(timeout) || timeout <= 0) return promise;
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(abortError(`${label} timed out`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function addHashedFile(files, shaByPath, idPath, blobPath) {
  const key = normalizeRepoPath(idPath);
  if (!key || !parseIdPath(key) || files[key]) return;
  const lookup = normalizeRepoPath(blobPath) || key;
  const sha = shaByPath.get(lookup) || (lookup !== key ? shaByPath.get(key) : null);
  if (!isBlobSha(sha)) return;
  files[key] = { contentHash: sha.toLowerCase() };
}

function collectFileHashes(shaByPath, {
  assemblyId = null,
  json = null,
  blobSources = null,
} = {}) {
  const files = {};
  const sources = blobSources && typeof blobSources === 'object' && !Array.isArray(blobSources)
    ? blobSources
    : {};
  const asmPath = tryIdPath(assemblyIdPath, assemblyId);
  if (asmPath) addHashedFile(files, shaByPath, asmPath, sources[asmPath]);
  if (json?.version === 2) {
    for (const part of Array.isArray(json.parts) ? json.parts : []) {
      const def = partDefinitionId(part);
      const js = tryIdPath(partIdPath, def);
      if (!js) continue;
      addHashedFile(files, shaByPath, js, sources[js]);
      const mesh = tryIdPath(partMeshIdPath, def);
      if (mesh) addHashedFile(files, shaByPath, mesh, sources[mesh]);
    }
  }
  for (const [idPath, blobPath] of Object.entries(sources)) {
    addHashedFile(files, shaByPath, idPath, blobPath);
  }
  return files;
}

function parseFilesMap(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) return null;
  const out = {};
  for (const [path, row] of Object.entries(files)) {
    const p = normalizeRepoPath(path);
    if (!p || !parseIdPath(p)) continue;
    const hash = row?.contentHash;
    if (!isBlobSha(hash)) return null;
    out[p] = { contentHash: hash.toLowerCase() };
  }
  return out;
}

/** Known-stale f(id) paths this Save skipped; empty / missing is none. */
function parseStalePaths(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const path = normalizeRepoPath(raw);
    if (!path || !parseIdPath(path) || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out.sort();
}

/** BranchTip or null when the row is missing / corrupt. */
export function parseBranchTip(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schemaVersion !== LAST_COMMIT_SCHEMA_VERSION) return null;
  const repo = repoRef(value.repo);
  const branch = typeof value.branch === 'string' ? value.branch.trim() : '';
  if (!repo || !branch) return null;
  let tipSha = value.tipSha;
  if (tipSha == null || tipSha === '') tipSha = null;
  else if (!isBlobSha(tipSha)) return null;
  else tipSha = tipSha.toLowerCase();
  return {
    schemaVersion: LAST_COMMIT_SCHEMA_VERSION,
    repo,
    branch,
    tipSha,
  };
}

/** AssemblyCommit or null when the row is missing / corrupt. */
export function parseAssemblyCommit(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schemaVersion !== LAST_COMMIT_SCHEMA_VERSION) return null;
  const assemblyId = typeof value.assemblyId === 'string' ? value.assemblyId.trim() : '';
  if (!isV2SurfId(assemblyId)) return null;
  const files = parseFilesMap(value.files);
  if (!files) return null;
  let json = value.json;
  if (json != null) {
    if (typeof json !== 'object' || Array.isArray(json)) return null;
    json = cloneJson(json);
    if (!json) return null;
  } else {
    json = null;
  }
  const capturedAt = Number(value.capturedAt);
  if (!Number.isFinite(capturedAt)) return null;
  const stalePaths = parseStalePaths(value.stalePaths);
  const record = {
    schemaVersion: LAST_COMMIT_SCHEMA_VERSION,
    assemblyId,
    files,
    json,
    capturedAt,
  };
  if (stalePaths.length) record.stalePaths = stalePaths;
  return record;
}

export function makeBranchTip({ repo, branch, tipSha = null } = {}) {
  return parseBranchTip({
    schemaVersion: LAST_COMMIT_SCHEMA_VERSION,
    repo,
    branch: branch || 'main',
    tipSha: tipSha || null,
  });
}

export function makeAssemblyCommit({
  assemblyId,
  files = {},
  json = null,
  capturedAt = Date.now(),
  stalePaths,
} = {}) {
  return parseAssemblyCommit({
    schemaVersion: LAST_COMMIT_SCHEMA_VERSION,
    assemblyId,
    files,
    json,
    capturedAt,
    stalePaths,
  });
}

/**
 * Reload restores hashes from the store. Recapture only when a record is
 * missing or invalid — never to chase a moved remote (§2.9 C/I).
 */
export function lastCommitReloadPlan(store, repo, branch, assemblyId) {
  const needTip = !parseBranchTip(store?.getBranchTip?.(repo, branch));
  const needCommit = isV2SurfId(assemblyId)
    && !parseAssemblyCommit(store?.getAssemblyCommit?.(repo, branch, assemblyId));
  return {
    skip: !needTip && !needCommit,
    persistBranchTip: needTip ? 'if-absent' : false,
    persistAssemblyCommit: needCommit,
  };
}

/**
 * True when a later open/reload targets a different repo or branch.
 * Same repo+branch is not stale: overlay finish() bumps generation, and
 * reload effect cleanup runs because this reload updates assemblyDoc /
 * gitBaseline. A late write of a pinned tip sha is still correct.
 */
export function lastCommitIsStale(started, current) {
  if (!current) return false;
  const from = repoRef(started?.repo);
  const to = repoRef(current?.repo);
  if (!from || !to) return false;
  const a = (typeof started?.branch === 'string' && started.branch.trim()) || 'main';
  const b = (typeof current?.branch === 'string' && current.branch.trim()) || 'main';
  return from.owner !== to.owner || from.name !== to.name || a !== b;
}

/**
 * Capture args after adopt / baseline reseed. Pins `headSha`.
 *
 * Do not pass overlay `signal()` as `isStale`. That hook is true while the
 * open is live (`isCurrent(gen)` in assemblyOpenOverlay). finish() then
 * bumps generation, so treating either polarity as cancel skips every
 * open.
 *
 * isStale is true only when `liveSession()` is a different repo/branch.
 */
export function lastCommitAfterAdoptArgs({
  adapter,
  repo,
  branch = 'main',
  store = null,
  assemblyId = null,
  headSha = null,
  blobSources = null,
  persistBranchTip = 'if-absent',
  persistAssemblyCommit = true,
  liveSession = null,
  now,
  timeoutMs,
} = {}) {
  const started = {
    repo: repoRef(repo),
    branch: (typeof branch === 'string' && branch.trim()) ? branch.trim() : 'main',
  };
  return {
    adapter,
    repo,
    branch: started.branch,
    store,
    assemblyId,
    headSha,
    blobSources,
    persistBranchTip,
    persistAssemblyCommit,
    now,
    timeoutMs,
    isStale: () => lastCommitIsStale(
      started,
      typeof liveSession === 'function' ? liveSession() : liveSession,
    ),
  };
}

async function loadTreeShas(adapter, repo, tipSha, timeoutMs) {
  const tree = await withTimeout(adapter.listTree(repo, tipSha), timeoutMs, 'listTree');
  const shaByPath = new Map();
  for (const entry of tree || []) {
    if (entry?.path && isBlobSha(entry.sha)) shaByPath.set(entry.path, entry.sha);
  }
  return shaByPath;
}

/**
 * Read the assembly blob when it is in the tree. A failed or timed-out
 * read of an in-tree file must not produce a partial AssemblyCommit —
 * lastCommitReloadPlan refills it next time. A path not in the tree is a
 * missing blob, not a failed read.
 */
async function readInTreeAssemblyJson(adapter, repo, tipSha, blobPath, shaByPath, timeoutMs) {
  const path = normalizeRepoPath(blobPath);
  if (!path || !shaByPath.has(path)) return { ok: true, json: null };
  try {
    const file = await withTimeout(adapter.readFile(repo, path, tipSha), timeoutMs, 'readFile');
    if (!file) return { ok: false, skipped: 'readFile' };
    return { ok: true, json: parseCommittedJson(file.content) };
  } catch {
    return { ok: false, skipped: 'readFile' };
  }
}

async function resolveTipSha(adapter, repo, branchName, headSha, timeoutMs) {
  if (isBlobSha(headSha)) return { tipSha: headSha.toLowerCase(), read: true };
  const info = await withTimeout(adapter.getBranch(repo, branchName), timeoutMs, 'getBranch');
  const sha = info?.sha;
  if (sha == null || sha === '') return { tipSha: null, read: true };
  if (!isBlobSha(sha)) return { tipSha: null, read: true };
  return { tipSha: sha.toLowerCase(), read: true };
}

async function maybePutBranchTip(store, repo, branch, record, mode, isStale) {
  if (!store || !record || !mode) return;
  if (staleNow(isStale)) return;
  if (mode === 'if-absent' && parseBranchTip(store.getBranchTip(repo, branch))) return;
  await store.putBranchTip(repo, branch, record);
}

async function maybePutAssemblyCommit(store, repo, branch, record, mode, isStale) {
  if (!store || !record || !mode) return;
  if (staleNow(isStale)) return;
  const existing = parseAssemblyCommit(
    store.getAssemblyCommit(repo, branch, record.assemblyId),
  );
  if (mode === 'if-absent' && existing) return;
  // Stalled capture must not roll back a newer record (PR 7 Save writes these).
  if (existing && existing.capturedAt > record.capturedAt) return;
  await store.putAssemblyCommit(repo, branch, record);
}

/**
 * Capture BranchTip + AssemblyCommit from one tip sha.
 * Read-only vs git. A failed getBranch / listTree persists nothing.
 * An in-tree readFile failure / timeout stores no AssemblyCommit.
 * Never throws for a missing path, path-less row, or corrupt previous record.
 *
 * Extra fields (`doc`, `scripts`, …) are ignored — capture does not
 * serialize the working copy.
 *
 * `isStale()` true → skip remaining store writes. Not overlay `signal()`.
 */
export async function captureLastCommit({
  adapter,
  repo,
  branch = 'main',
  store = null,
  assemblyId = null,
  headSha = null,
  blobSources = null,
  persistBranchTip = 'if-absent',
  persistAssemblyCommit = true,
  isStale = null,
  now = Date.now(),
  timeoutMs = LAST_COMMIT_CAPTURE_TIMEOUT_MS,
} = {}) {
  try {
    if (staleNow(isStale)) {
      return { branchTip: null, assemblyCommit: null, skipped: 'stale' };
    }
    const branchName = (typeof branch === 'string' && branch.trim()) ? branch.trim() : 'main';
    const ref = repoRef(repo);
    if (!adapter || !ref) {
      return { branchTip: null, assemblyCommit: null, skipped: 'no-adapter' };
    }
    assertGithubAdapter(adapter);

    let tipSha = null;
    try {
      const resolved = await resolveTipSha(adapter, ref, branchName, headSha, timeoutMs);
      tipSha = resolved.tipSha;
    } catch {
      return { branchTip: null, assemblyCommit: null, skipped: 'getBranch' };
    }
    if (staleNow(isStale)) {
      return { branchTip: null, assemblyCommit: null, skipped: 'stale' };
    }

    let shaByPath;
    try {
      if (tipSha) {
        shaByPath = await loadTreeShas(adapter, ref, tipSha, timeoutMs);
      } else {
        shaByPath = new Map();
      }
    } catch {
      return { branchTip: null, assemblyCommit: null, skipped: 'listTree' };
    }
    if (staleNow(isStale)) {
      return { branchTip: null, assemblyCommit: null, skipped: 'stale' };
    }

    // BranchTip is if-absent: opening assembly B must not move a tip that
    // still describes A's lastCommit. AssemblyCommit is this assembly at
    // the current (pinned) tip. When BranchTip stays older than that tip,
    // planSave may false-conflict (remote is current, tipSha is older).
    // That errs on the safe side; PR 6 settles compare.
    const branchTip = makeBranchTip({ repo: ref, branch: branchName, tipSha });
    await maybePutBranchTip(store, ref, branchName, branchTip, persistBranchTip, isStale);
    if (staleNow(isStale)) {
      return { branchTip, assemblyCommit: null, skipped: 'stale' };
    }

    const id = typeof assemblyId === 'string' ? assemblyId.trim() : '';
    if (!isV2SurfId(id)) {
      if (id || persistAssemblyCommit) {
        console.warn('[git] lastCommit skip AssemblyCommit: no assembly surf-id');
      }
      return { branchTip, assemblyCommit: null };
    }

    const asmPath = tryIdPath(assemblyIdPath, id);
    const sources = blobSources && typeof blobSources === 'object' ? blobSources : {};
    const blobPath = normalizeRepoPath(sources[asmPath]) || asmPath;
    const readPath = blobPath && shaByPath.has(blobPath)
      ? blobPath
      : (asmPath && shaByPath.has(asmPath) ? asmPath : blobPath);
    const read = tipSha
      ? await readInTreeAssemblyJson(adapter, ref, tipSha, readPath, shaByPath, timeoutMs)
      : { ok: true, json: null };
    if (!read.ok) {
      return { branchTip, assemblyCommit: null, skipped: read.skipped || 'readFile' };
    }
    if (staleNow(isStale)) {
      return { branchTip, assemblyCommit: null, skipped: 'stale' };
    }
    const json = committedV2Json(read.json);
    const files = collectFileHashes(shaByPath, {
      assemblyId: id,
      json: json || read.json,
      blobSources: sources,
    });
    const assemblyCommit = makeAssemblyCommit({
      assemblyId: id,
      files,
      json,
      capturedAt: now,
    });
    await maybePutAssemblyCommit(
      store,
      ref,
      branchName,
      assemblyCommit,
      persistAssemblyCommit,
      isStale,
    );
    return { branchTip, assemblyCommit };
  } catch (err) {
    return { branchTip: null, assemblyCommit: null, error: err };
  }
}

/** Fire-and-forget capture. A throw / timeout never blocks open or reload. */
export function scheduleLastCommitCapture(args) {
  return captureLastCommit(args).catch((err) => {
    console.warn('[git] lastCommit capture skipped', err?.message || err);
  });
}

/** Fire-and-forget capture after adopt/reseed. See lastCommitAfterAdoptArgs. */
export function scheduleLastCommitAfterAdopt(args) {
  return scheduleLastCommitCapture(lastCommitAfterAdoptArgs(args));
}

/**
 * App open (after adopt) and reload lastCommit. One call site shape.
 * Open: BranchTip if-absent + AssemblyCommit. Reload (`reload: true`):
 * skip when the store already has valid records.
 */
export function scheduleLastCommitFromApp({
  adapter,
  repo,
  branch = 'main',
  store = null,
  opened = null,
  adopted = null,
  workingCopyId = null,
  tip = null,
  reload = false,
  liveSession = null,
  now,
  timeoutMs,
} = {}) {
  try {
    const assemblyId = adopted?.saved?.id || opened?.doc?.id || workingCopyId || null;
    const plan = reload
      ? lastCommitReloadPlan(store, repo, branch, assemblyId)
      : { skip: false, persistBranchTip: 'if-absent', persistAssemblyCommit: true };
    if (plan.skip) return Promise.resolve({ skipped: 'reload-plan' });
    return scheduleLastCommitAfterAdopt({
      adapter,
      repo,
      branch,
      store,
      assemblyId,
      headSha: opened?.baseline?.headSha || tip,
      blobSources: lastCommitBlobSources(opened),
      persistBranchTip: plan.persistBranchTip,
      persistAssemblyCommit: plan.persistAssemblyCommit,
      liveSession,
      now,
      timeoutMs,
    });
  } catch (err) {
    console.warn('[git] lastCommit capture skipped', err?.message || err);
    return Promise.resolve({ skipped: 'error', error: err });
  }
}
