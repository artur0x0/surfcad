/**
 * Collapse working-copy identity onto one surf-id per part (and one per
 * assembly). UUID row ids and path-as-id rows take this once. `surfId` is
 * dropped; the row `id` is the surf-id. Does not write git and does not
 * stamp `// @surf-id` / `// @name` — that happens on Save or Upgrade.
 *
 * §4.1 of docs/git-save-model.md.
 */
import { isSurfId, mintSurfId, readSurfId, rewriteColorMap, rewriteJointSurfIds } from './surfId.js';
import { rekeyScripts } from './partIdentity.js';

function partPath(part) {
  if (typeof part?.path === 'string' && part.path.trim()) return part.path;
  const id = String(part?.id || '');
  if (id.includes('/') && id.endsWith('.js')) return id;
  return null;
}

function scriptForPart(part, scripts) {
  if (!part || !scripts) return undefined;
  if (typeof scripts[part.id] === 'string') return scripts[part.id];
  const path = partPath(part);
  if (path && typeof scripts[path] === 'string') return scripts[path];
  if (part.surfId && typeof scripts[part.surfId] === 'string') return scripts[part.surfId];
  return undefined;
}

function mintUnusedSurfId({ now, rand, used } = {}) {
  let id = mintSurfId({ now, rand });
  if (!used || !used.has(id)) return id;
  const parsed = Number.parseInt(String(rand ?? '0'), 16);
  const start = Number.isFinite(parsed) ? parsed : 0;
  for (let n = 1; n < 0x10000; n += 1) {
    id = mintSurfId({
      now,
      rand: ((start + n) & 0xffff).toString(16).padStart(4, '0'),
    });
    if (!used.has(id)) return id;
  }
  return mintSurfId({ now });
}

/**
 * Pick the permanent part id: header, then `surfId`, then a surf-id-shaped
 * row id, then a pathIndex hit, else mint. A collision with an id already
 * used in this assembly keeps the first row and mints + `copiedFrom`.
 */
export function pickCollapsedPartId(part, script, pathIndex = {}, { now, rand, used } = {}) {
  const header = readSurfId(script || '');
  let id = null;
  let minted = false;
  if (isSurfId(header)) id = header;
  else if (isSurfId(part?.surfId)) id = part.surfId;
  else if (isSurfId(part?.id)) id = part.id;
  else {
    const path = partPath(part);
    const cached = path ? pathIndex[path] : null;
    if (isSurfId(cached)) id = cached;
    else {
      id = mintUnusedSurfId({ now, rand, used });
      minted = true;
    }
  }
  if (used?.has(id)) {
    return {
      id: mintUnusedSurfId({ now, rand, used }),
      minted: true,
      copiedFrom: id,
    };
  }
  return { id, minted, copiedFrom: undefined };
}

/**
 * Persist new IndexedDB script keys, then drop the old ones. Never delete
 * first — a crash between delete and save would drop the script.
 */
export async function replaceScriptKeys({ nextScripts, staleIds, save, remove } = {}) {
  const scripts = nextScripts || {};
  for (const [id, script] of Object.entries(scripts)) {
    await save(id, script);
  }
  const keep = new Set(Object.keys(scripts));
  for (const id of staleIds || []) {
    if (!id || keep.has(id)) continue;
    await remove(id);
  }
}

function rewriteGroupIds(groups, map) {
  if (!Array.isArray(groups)) return groups;
  const get = (id) => map.get(id) || id;
  let changed = false;
  const next = groups.map((group) => {
    if (!group || typeof group !== 'object') return group;
    const id = get(group.id);
    const partIds = Array.isArray(group.partIds)
      ? group.partIds.map((partId) => get(partId))
      : group.partIds;
    if (id === group.id && (!partIds || partIds.every((partId, i) => partId === group.partIds[i]))) {
      return group;
    }
    changed = true;
    return { ...group, id, partIds };
  });
  return changed ? next : groups;
}

/**
 * Rekey a working copy so every part `id` is a surf-id and `surfId` is gone.
 * Scripts that lack a header are not rewritten (Save / Upgrade stamp them).
 * -> { doc, scripts, pairs, cached, minted, changed }
 */
export function collapseWorkingCopyIds(doc, scripts = {}, {
  pathIndex = {},
  now,
  randFor,
  usedAssemblyIds = null,
} = {}) {
  if (!doc) {
    return {
      doc,
      scripts: scripts || {},
      pairs: [],
      cached: [],
      minted: 0,
      changed: false,
    };
  }
  const pairs = [];
  const cached = [];
  const map = new Map();
  const used = new Set();
  let minted = 0;
  const nextScripts = { ...(scripts || {}) };
  const parts = (doc.parts || []).map((part, i) => {
    const script = scriptForPart(part, nextScripts);
    const picked = pickCollapsedPartId(part, script, pathIndex, {
      now,
      rand: typeof randFor === 'function' ? randFor(part, i) : undefined,
      used,
    });
    if (picked.minted) minted += 1;
    const nextId = picked.id;
    used.add(nextId);
    const path = partPath(part);
    if (part?.id && part.id !== nextId) {
      pairs.push({ from: part.id, to: nextId });
      map.set(part.id, nextId);
    }
    if (part?.surfId && part.surfId !== nextId) map.set(part.surfId, nextId);
    if (path && path !== nextId) map.set(path, nextId);
    if (path && isSurfId(nextId)) cached.push({ path, id: nextId });
    if (typeof script === 'string') nextScripts[nextId] = script;
    const sameId = part.id === nextId;
    const noSurfField = part.surfId == null;
    const pathOk = !path || part.path === path;
    const copiedOk = !picked.copiedFrom || part.copiedFrom === picked.copiedFrom;
    if (sameId && noSurfField && pathOk && copiedOk) return part;
    const row = { ...part, id: nextId };
    delete row.surfId;
    if (path && !row.path) row.path = path;
    if (picked.copiedFrom) row.copiedFrom = picked.copiedFrom;
    if (part?.missing === true) row.missing = true;
    else delete row.missing;
    return row;
  });
  for (const { from, to } of pairs) {
    if (from && from !== to) delete nextScripts[from];
  }
  for (const part of parts) {
    const path = partPath(part);
    if (path && path !== part.id) delete nextScripts[path];
  }
  const keyedScripts = pairs.length ? rekeyScripts(nextScripts, pairs) : nextScripts;
  let activeId = doc.activeId;
  if (activeId && map.has(String(activeId))) activeId = map.get(String(activeId));
  else if (activeId && !parts.some((part) => part.id === activeId)) {
    const byPath = parts.find((part) => part.path === activeId);
    if (byPath) activeId = byPath.id;
  }
  const groups = rewriteGroupIds(doc.groups, map);
  const colors = rewriteColorMap(doc.colors, map);
  const joints = rewriteJointSurfIds(doc.joints, map);
  const usedAsm = new Set(usedAssemblyIds || []);
  let assemblyId = isSurfId(doc.id) ? doc.id : null;
  let assemblyMinted = false;
  if (!assemblyId) {
    assemblyId = mintUnusedSurfId({
      now,
      rand: typeof randFor === 'function' ? randFor({ id: '$assembly', name: doc.name }, -1) : undefined,
      used: usedAsm,
    });
    assemblyMinted = true;
  }
  const nextDoc = {
    ...doc,
    id: assemblyId,
    parts,
    activeId,
  };
  if (groups !== doc.groups) nextDoc.groups = groups;
  if (colors !== doc.colors) nextDoc.colors = colors;
  if (joints !== doc.joints) nextDoc.joints = joints;
  const changed = assemblyMinted
    || minted > 0
    || pairs.length > 0
    || parts.some((part, i) => part !== (doc.parts || [])[i])
    || nextDoc.groups !== doc.groups
    || nextDoc.colors !== doc.colors
    || nextDoc.joints !== doc.joints
    || nextDoc.activeId !== doc.activeId
    || nextDoc.id !== doc.id
    || parts.some((part) => part.surfId);
  return {
    doc: nextDoc,
    scripts: keyedScripts,
    pairs,
    cached,
    minted,
    assemblyMinted,
    changed,
  };
}
