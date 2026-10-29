/**
 * Working-copy sidecar: pending repo deletes and the pre-rename vault
 * assembly name. Lives next to the IndexedDB working copy, never in the
 * assembly document or `.surf.json` (`validateSurfJson` rejects unknown keys).
 */
import { normalizeRepoPath } from '../assembly.js';
import { githubSaveErrorFields } from './githubAppInstall.js';
import { partRepoPath } from './partIdentity.js';
import { assetPathForScript, vaultSegment } from './vaultLayout.js';

export const NO_REPO_YET_COPY = 'No repo yet. Save creates it.';
export const SAVE_QUEUED_COPY = 'Queued until the next Save.';
/** Existing bridge / MCP git_* refusal when there is no vault yet. */
export const NO_REPO_YET_CODE = 'git_blocked';

export function noRepoYetError() {
  const err = new Error(NO_REPO_YET_COPY);
  err.code = NO_REPO_YET_CODE;
  return err;
}

export function noRepoYetOpResult() {
  return { status: 'error', code: NO_REPO_YET_CODE, error: NO_REPO_YET_COPY };
}

export function gitOpCatchResult(err, fallback = 'Git operation failed') {
  if (err?.message === NO_REPO_YET_COPY || err?.code === NO_REPO_YET_CODE) {
    return noRepoYetOpResult();
  }
  return {
    status: 'error',
    error: err?.message || fallback,
    ...githubSaveErrorFields(err),
  };
}

export function emptyWorkingSidecar() {
  return { renameFrom: null, pendingDeletes: [] };
}

export function normalizeWorkingSidecar(value) {
  const renameFrom = vaultSegment(value?.renameFrom);
  const pendingDeletes = [];
  const seen = new Set();
  for (const raw of Array.isArray(value?.pendingDeletes) ? value.pendingDeletes : []) {
    const path = normalizeRepoPath(raw);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    pendingDeletes.push(path);
  }
  pendingDeletes.sort();
  return {
    renameFrom: renameFrom || null,
    pendingDeletes,
  };
}

/** Script path plus its sibling mesh path, when the script is a vault part. */
export function repoDeletePathsFor(repoPath) {
  const script = normalizeRepoPath(repoPath);
  if (!script) return [];
  const mesh = assetPathForScript(script);
  return mesh && mesh !== script ? [script, mesh] : [script];
}

export function recordPendingDeletes(sidecar, paths) {
  const next = normalizeWorkingSidecar(sidecar);
  const seen = new Set(next.pendingDeletes);
  for (const raw of paths || []) {
    const path = normalizeRepoPath(raw);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    next.pendingDeletes.push(path);
  }
  next.pendingDeletes.sort();
  return next;
}

/** Keep the first pending vault name. A second rename still moves from that folder. */
export function recordRenameFrom(sidecar, oldName) {
  const next = normalizeWorkingSidecar(sidecar);
  if (next.renameFrom) return next;
  const name = vaultSegment(oldName);
  if (!name) return next;
  return { ...next, renameFrom: name };
}

export function sidecarIsDirty(sidecar) {
  const clean = normalizeWorkingSidecar(sidecar);
  return !!(clean.renameFrom || clean.pendingDeletes.length);
}

export function usedRepoPaths(doc) {
  const used = new Set();
  for (const part of doc?.parts || []) {
    const path = partRepoPath(part);
    if (!path) continue;
    used.add(path);
    const mesh = assetPathForScript(path);
    if (mesh) used.add(mesh);
  }
  return used;
}

/** Pending deletes that no current part still occupies. */
export function deletePathsForCommit(sidecar, doc) {
  const used = usedRepoPaths(doc);
  return normalizeWorkingSidecar(sidecar).pendingDeletes.filter((path) => !used.has(path));
}

export function sidecarAssemblyKeys(doc, sidecar) {
  const names = new Set();
  const current = vaultSegment(doc?.name);
  if (current) names.add(current);
  const from = normalizeWorkingSidecar(sidecar).renameFrom;
  if (from) names.add(from);
  return [...names];
}
