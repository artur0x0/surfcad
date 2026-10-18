/**
 * Stable part identity vs vault path.
 *
 * The row `id` is a permanent surf id (or a UUID from create_part). The
 * repo path is `path` on the row and in `.surf.json`. Older in-memory docs
 * that still use a vault path as `id` keep working: that id is treated as
 * the path until the next explicit save writes `{ id, path }`.
 */
import { normalizeRepoPath } from '../assembly.js';
import { isSurfId, mintSurfId, partSurfId, readSurfId, withSurfId } from './surfId.js';
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

/**
 * Stamp a surf id on path-less rows that still lack one. Working copy only:
 * no repo path and no git write. Git rows that already have a vault path
 * keep waiting for Open / Save.
 */
export function stampMissingSurfIds(doc, scripts = {}, { now, randFor } = {}) {
  if (!doc) return { doc, scripts: scripts || {}, changed: false };
  const nextScripts = { ...(scripts || {}) };
  let changed = false;
  const parts = (doc.parts || []).map((row, index) => {
    if (!row || partSurfId(row) || partRepoPath(row)) return row;
    const surfId = mintSurfId({
      now,
      rand: typeof randFor === 'function' ? randFor(row, index) : undefined,
    });
    nextScripts[row.id] = withSurfId(nextScripts[row.id] || '', surfId);
    changed = true;
    return { ...row, surfId };
  });
  return {
    doc: changed ? { ...doc, parts } : doc,
    scripts: nextScripts,
    changed,
  };
}

/** True when `id` is the identity, not a repo path. */
export function partKeepsStableId(part) {
  return isStablePartId(part?.id) || !partRowVaultPathOk(part?.id);
}

export function findAssemblyPart(doc, hint) {
  if (!doc || hint == null) return null;
  const key = String(hint);
  return (doc.parts || []).find((part) => (
    part.id === key || part.surfId === key || partSurfId(part) === key || part.path === key
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

function applyActiveId(doc, parts, pairs) {
  const idByOld = new Map(pairs.map((pair) => [pair.from, pair.to]));
  let activeId = doc.activeId;
  if (activeId && idByOld.has(activeId)) activeId = idByOld.get(activeId);
  else if (activeId && !parts.some((part) => part.id === activeId)) {
    const byPath = parts.find((part) => part.path === activeId || partRepoPath(part) === activeId);
    if (byPath) activeId = byPath.id;
  }
  return { ...doc, parts, activeId };
}

/**
 * After scripts are loaded: header `@surf-id` wins, then a local pathIndex
 * cache, then a mint. Does not write git. Callers persist minted ids only
 * in the local path index.
 * -> { doc, scripts, minted, pairs, cached: [{ path, id }] }
 */
export function assignVaultPartIdentities(doc, scripts = {}, {
  pathIndex = {},
  now,
  randFor,
} = {}) {
  if (!doc) return { doc, scripts: scripts || {}, minted: 0, pairs: [], cached: [] };
  const pairs = [];
  const cached = [];
  let minted = 0;
  const workScripts = { ...(scripts || {}) };
  const parts = (doc.parts || []).map((part, i) => {
    const path = partRepoPath(part);
    const header = readSurfId(partScriptText(part, workScripts) || '');
    let nextId = part?.id;
    let surfId = isSurfId(part?.surfId) ? part.surfId : undefined;
    if (isStablePartId(nextId)) {
      if (isSurfId(header)) surfId = header;
      else if (isSurfId(nextId) && !surfId) surfId = nextId;
    } else if (isSurfId(header)) {
      nextId = header;
      surfId = header;
    } else if (isSurfId(surfId)) {
      nextId = surfId;
    } else if (path && isStablePartId(pathIndex[path])) {
      nextId = pathIndex[path];
      if (isSurfId(nextId)) surfId = nextId;
    } else {
      nextId = mintSurfId({
        now,
        rand: typeof randFor === 'function' ? randFor(part, i) : undefined,
      });
      minted += 1;
    }
    if (part?.id && part.id !== nextId) pairs.push({ from: part.id, to: nextId });
    if (path && isStablePartId(nextId)) cached.push({ path, id: nextId });
    return {
      ...part,
      id: nextId,
      ...(path ? { path } : {}),
      ...(surfId ? { surfId } : {}),
    };
  });
  const nextDoc = applyActiveId(doc, parts, pairs);
  return {
    doc: nextDoc,
    scripts: rekeyScripts(workScripts, pairs),
    minted,
    pairs,
    cached,
  };
}

/**
 * Rekey a browser working copy onto tip part ids, matching by vault path.
 * Keeps local script text. Parts with no tip path stay as they are.
 * -> { doc, scripts, pairs, histories, meshMeta, cadPartId }
 */
export function rekeyWorkingCopyToTip(browserDoc, browserScripts, tipDoc, {
  histories = {},
  meshMeta = {},
  cadPartId = null,
} = {}) {
  if (!browserDoc) {
    return {
      doc: browserDoc,
      scripts: browserScripts || {},
      pairs: [],
      histories,
      meshMeta,
      cadPartId,
    };
  }
  const tipByPath = new Map();
  for (const part of tipDoc?.parts || []) {
    const path = partRepoPath(part);
    if (path) tipByPath.set(path, part);
  }
  const pairs = [];
  const parts = (browserDoc.parts || []).map((part) => {
    const path = partRepoPath(part);
    const tip = path ? tipByPath.get(path) : null;
    if (!tip || part.id === tip.id) {
      return path && !part.path ? { ...part, path } : part;
    }
    pairs.push({ from: part.id, to: tip.id });
    return {
      ...part,
      id: tip.id,
      path: tip.path || path,
      surfId: tip.surfId || part.surfId,
    };
  });
  const doc = applyActiveId(browserDoc, parts, pairs);
  let nextCad = cadPartId;
  const cadPair = pairs.find((pair) => pair.from === cadPartId);
  if (cadPair) nextCad = cadPair.to;
  return {
    doc,
    scripts: rekeyScripts(browserScripts, pairs),
    pairs,
    histories: rekeyScripts(histories, pairs),
    meshMeta: rekeyScripts(meshMeta, pairs),
    cadPartId: nextCad,
  };
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
