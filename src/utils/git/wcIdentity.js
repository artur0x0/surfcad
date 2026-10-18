/**
 * Collapse working-copy identity onto one surf-id per part (and one per
 * assembly). UUID row ids and path-as-id rows take this once. `surfId` is
 * dropped; the row `id` is the surf-id. Does not write git and does not
 * stamp `// @surf-id` / `// @name` on clean files — that happens on Save
 * or Upgrade. A copy whose header collides is restamped in the working
 * copy only (no git write) so the next open is stable.
 *
 * §4.1 of docs/git-save-model.md.
 */
import { isSurfId, mintSurfId, readSurfId, rewriteColorMap, rewriteJointSurfIds, withSurfId } from './surfId.js';
import { rewriteFeaStudyPartIds } from './feaStudyIds.js';

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

function firstOwnerIndex(parts) {
  const owners = new Map();
  (parts || []).forEach((part, i) => {
    const id = part?.id;
    if (id == null || id === '') return;
    if (!owners.has(id)) owners.set(id, i);
  });
  return owners;
}

/**
 * Pick the permanent part id: header, then `surfId`, then a surf-id-shaped
 * row id, then a pathIndex hit, else mint. A candidate already owned by
 * another row in this assembly is skipped — the first row keeps it; a copy
 * keeps its own free surf-id or mints + `copiedFrom`. Never steal another
 * row's id just because the header still names it.
 */
export function pickCollapsedPartId(part, script, pathIndex = {}, {
  now,
  rand,
  used,
  index = 0,
  firstOwner = null,
} = {}) {
  const taken = (id) => {
    if (!id) return false;
    if (used?.has(id)) return true;
    if (firstOwner && firstOwner.get(id) != null && firstOwner.get(id) !== index) return true;
    return false;
  };

  const header = readSurfId(script || '');
  const path = partPath(part);
  const cached = path ? pathIndex[path] : null;
  const candidates = [header, part?.surfId, part?.id, cached];
  let colliding = null;
  for (const candidate of candidates) {
    if (!isSurfId(candidate)) continue;
    if (!taken(candidate)) {
      return { id: candidate, minted: false, copiedFrom: undefined };
    }
    if (!colliding) colliding = candidate;
  }

  // Header (or surfId) collided. Keep this row's own free surf-id so a
  // copy does not remint on every open (§2.2 ids stay stable across reload).
  if (isSurfId(part?.id) && !taken(part.id)) {
    return { id: part.id, minted: false, copiedFrom: colliding || undefined };
  }

  return {
    id: mintUnusedSurfId({ now, rand, used }),
    minted: true,
    copiedFrom: colliding || undefined,
  };
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
 * A colliding copy is restamped in WC only so the next open is stable.
 * Never overwrite an occupied script slot; never map an id a live row still holds.
 * -> { doc, scripts, pairs, cached, minted, changed }
 */
export function collapseWorkingCopyIds(doc, scripts = {}, {
  pathIndex = {},
  now,
  randFor,
  usedAssemblyIds = null,
  readOnly = false,
} = {}) {
  if (!doc || readOnly) {
    return {
      doc,
      scripts: scripts || {},
      pairs: [],
      cached: [],
      minted: 0,
      changed: false,
    };
  }
  const sourceScripts = scripts || {};
  const sourceParts = doc.parts || [];
  const owners = firstOwnerIndex(sourceParts);
  const used = new Set();
  const assignments = [];
  let minted = 0;
  let restamped = false;

  for (let i = 0; i < sourceParts.length; i += 1) {
    const part = sourceParts[i];
    let script = scriptForPart(part, sourceScripts);
    const picked = pickCollapsedPartId(part, script, pathIndex, {
      now,
      rand: typeof randFor === 'function' ? randFor(part, i) : undefined,
      used,
      index: i,
      firstOwner: owners,
    });
    if (picked.minted) minted += 1;
    const nextId = picked.id;
    used.add(nextId);
    if (picked.copiedFrom && typeof script === 'string') {
      const header = readSurfId(script);
      if (header && header !== nextId) {
        script = withSurfId(script, nextId);
        restamped = true;
      }
    }
    assignments.push({ part, nextId, script, picked, path: partPath(part) });
  }

  const liveIds = new Set(assignments.map((row) => row.nextId));
  const pairs = [];
  const cached = [];
  const map = new Map();
  const nextScripts = {};
  const parts = assignments.map(({ part, nextId, script, picked, path }) => {
    if (part?.id && part.id !== nextId && !liveIds.has(part.id)) {
      pairs.push({ from: part.id, to: nextId });
      map.set(part.id, nextId);
    }
    if (part?.surfId && part.surfId !== nextId && !liveIds.has(part.surfId)) {
      map.set(part.surfId, nextId);
    }
    if (path && path !== nextId && !liveIds.has(path)) map.set(path, nextId);
    if (path && isSurfId(nextId)) cached.push({ path, id: nextId });
    if (typeof script === 'string' && !Object.prototype.hasOwnProperty.call(nextScripts, nextId)) {
      nextScripts[nextId] = script;
    }
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
  let studiesRewritten = false;
  if (map.size) {
    for (const [id, text] of Object.entries(nextScripts)) {
      const next = rewriteFeaStudyPartIds(text, map);
      if (next !== text) {
        nextScripts[id] = next;
        studiesRewritten = true;
      }
    }
  }
  const changed = assemblyMinted
    || minted > 0
    || restamped
    || studiesRewritten
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
    scripts: nextScripts,
    pairs,
    cached,
    minted,
    assemblyMinted,
    changed,
  };
}
