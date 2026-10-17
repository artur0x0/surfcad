/**
 * Stable part identity vs vault path.
 *
 * The row `id` is a permanent surf id (or a UUID from create_part). The
 * repo path is `path` on the row and in `.surf.json`. Older in-memory docs
 * that still use a vault path as `id` keep working: that id is treated as
 * the path until the next explicit save writes `{ id, path }`.
 */
import { normalizeRepoPath } from '../assembly.js';
import { isSurfId, mintSurfId } from './surfId.js';
import { PART_EXT, isVaultPartPath } from './vaultLayout.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidPartId(value) {
  return UUID_RE.test(String(value || ''));
}

/** Id that may be stored on a part row and in `.surf.json`. */
export function isStablePartId(value) {
  return isSurfId(value) || isUuidPartId(value);
}

export function partRowVaultPathOk(id) {
  const text = String(id || '').trim();
  if (!text) return false;
  const path = normalizeRepoPath(text);
  if (!path || path !== text) return false;
  if (!path.endsWith(PART_EXT)) return false;
  return isVaultPartPath(path);
}

/** Repo script path for a part, or null when it has none yet. */
export function partRepoPath(part) {
  const stored = typeof part?.path === 'string' ? normalizeRepoPath(part.path) : null;
  if (stored && stored.endsWith(PART_EXT) && isVaultPartPath(stored)) return stored;
  if (partRowVaultPathOk(part?.id)) return part.id;
  return null;
}

export function partRowNeedsVaultPath(part) {
  return !partRepoPath(part);
}

/** True when `id` is the identity, not a repo path. */
export function partKeepsStableId(part) {
  return isStablePartId(part?.id) || !partRowVaultPathOk(part?.id);
}

export function findAssemblyPart(doc, hint) {
  if (!doc || hint == null) return null;
  const key = String(hint);
  return (doc.parts || []).find((part) => (
    part.id === key || part.surfId === key || part.path === key
  )) || null;
}

export function partScriptText(part, scripts) {
  if (!part || !scripts) return undefined;
  if (typeof scripts[part.id] === 'string') return scripts[part.id];
  const path = partRepoPath(part);
  if (path && typeof scripts[path] === 'string') return scripts[path];
  return undefined;
}

export function occupancyPathsFromParts(parts = []) {
  return (parts || []).map((part) => partRepoPath(part)).filter(Boolean);
}

/**
 * Give every row a stable id and a `path` when one is already known.
 * Minted ids stay in memory; callers write them only on an explicit save.
 * -> { doc, minted, pairs: [{ from, to }] }
 */
export function stabilizePartIdentities(doc, {
  now,
  randFor,
  pathIndex = {},
} = {}) {
  if (!doc) return { doc, minted: 0, pairs: [] };
  const pairs = [];
  let minted = 0;
  const parts = (doc.parts || []).map((part, i) => {
    const path = partRepoPath(part);
    let id = part?.id;
    if (isStablePartId(id)) {
      return path && part.path !== path ? { ...part, path } : part;
    }
    if (isSurfId(part?.surfId)) {
      const next = { ...part, id: part.surfId, surfId: part.surfId };
      if (path) next.path = path;
      if (id && id !== next.id) pairs.push({ from: id, to: next.id });
      return next;
    }
    const cached = path && pathIndex[path];
    const mintedId = (cached && isStablePartId(cached))
      ? cached
      : mintSurfId({
        now,
        rand: typeof randFor === 'function' ? randFor(part, i) : undefined,
      });
    if (!cached) minted += 1;
    if (id && id !== mintedId) pairs.push({ from: id, to: mintedId });
    return {
      ...part,
      id: mintedId,
      surfId: isSurfId(part?.surfId) ? part.surfId : undefined,
      ...(path ? { path } : {}),
    };
  });
  const idByOld = new Map(pairs.map((pair) => [pair.from, pair.to]));
  let activeId = doc.activeId;
  if (activeId && idByOld.has(activeId)) activeId = idByOld.get(activeId);
  else if (activeId && !parts.some((part) => part.id === activeId)) {
    const byPath = parts.find((part) => part.path === activeId || partRepoPath(part) === activeId);
    if (byPath) activeId = byPath.id;
  }
  return { doc: { ...doc, parts, activeId }, minted, pairs };
}

/** Rekey a script map through `{ from, to }` pairs. */
export function rekeyScripts(scripts, pairs) {
  if (!pairs?.length) return scripts || {};
  const next = { ...(scripts || {}) };
  for (const { from, to } of pairs) {
    if (!from || !to || from === to) continue;
    if (Object.prototype.hasOwnProperty.call(next, from) && next[to] == null) {
      next[to] = next[from];
    }
    delete next[from];
  }
  return next;
}
