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
  // Path first: two rows can share an id (v1 duplicate) with different files.
  const path = partPath(part);
  if (path && typeof scripts[path] === 'string') return scripts[path];
  if (typeof scripts[part.id] === 'string') return scripts[part.id];
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
    for (const id of [part?.id, part?.surfId]) {
      if (id == null || id === '') continue;
      if (!owners.has(id)) owners.set(id, i);
    }
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
      // A later free candidate (own id / pathIndex) after a header clash is
      // still this row's copy identity — keep copiedFrom so we restamp.
      return { id: candidate, minted: false, copiedFrom: colliding || undefined };
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
 * first — a crash between delete and save would drop the script. Only delete
 * an old key after its script was loaded and the put under the new key
 * succeeded. `save` should return `false` on failure (as `savePartScript` does).
 */
export async function replaceScriptKeys({ nextScripts, staleIds, pairs = [], save, remove } = {}) {
  const scripts = nextScripts || {};
  const saved = new Set();
  for (const [id, script] of Object.entries(scripts)) {
    try {
      const ok = await save(id, script);
      if (ok !== false) saved.add(id);
    } catch {
      /* put failed — keep the old key */
    }
  }
  const toByFrom = new Map((pairs || []).map((pair) => [pair.from, pair.to]));
  const keep = new Set(Object.keys(scripts));
  const allSaved = Object.keys(scripts).every((id) => saved.has(id));
  for (const id of staleIds || []) {
    if (!id || keep.has(id) || saved.has(id)) continue;
    const to = toByFrom.get(id);
    if (to && !saved.has(to)) continue;
    if (to == null && !allSaved) continue;
    try { await remove(id); } catch { /* ignore */ }
  }
  return { saved };
}

/**
 * Write collapsed script keys, then the assembly document. A part whose
 * script was never loaded, or whose put failed, keeps its old id and key.
 */
export async function persistCollapsedWorkingCopy({
  collapsed,
  sourceDoc,
  sourceScripts,
  save,
  remove,
  saveDoc,
} = {}) {
  const pairs = collapsed?.pairs || [];
  const nextScripts = { ...(collapsed?.scripts || {}) };
  const putScripts = {};
  const already = new Set();
  for (const [id, script] of Object.entries(nextScripts)) {
    if (typeof script !== 'string') continue;
    if (sourceScripts && sourceScripts[id] === script) {
      already.add(id);
      continue;
    }
    putScripts[id] = script;
  }
  for (const { from, to } of pairs) {
    if (!to || from === to) continue;
    if (typeof nextScripts[to] === 'string') putScripts[to] = nextScripts[to];
  }
  const persisted = await replaceScriptKeys({
    nextScripts: putScripts,
    staleIds: pairs.map((pair) => pair.from),
    pairs,
    save,
    remove,
  });
  const saved = new Set([...(persisted?.saved || []), ...already]);
  const failedFrom = new Set();
  for (const { from, to } of pairs) {
    if (!from || !to || from === to) continue;
    if (typeof nextScripts[to] !== 'string' || !saved.has(to)) failedFrom.add(from);
  }
  let doc = collapsed?.doc;
  let scripts = nextScripts;
  if (failedFrom.size && sourceDoc?.parts) {
    const parts = (doc?.parts || []).map((part, i) => {
      const src = sourceDoc.parts[i];
      if (!src || !failedFrom.has(src.id)) return part;
      const original = sourceScripts?.[src.id];
      if (typeof original === 'string') scripts[src.id] = original;
      if (part.id !== src.id) delete scripts[part.id];
      return src;
    });
    let activeId = doc?.activeId;
    if (failedFrom.has(sourceDoc.activeId)) activeId = sourceDoc.activeId;
    else if (activeId && !parts.some((part) => part.id === activeId)) {
      activeId = parts[0]?.id || sourceDoc.activeId || null;
    }
    doc = { ...doc, parts, activeId };
  }
  if (typeof saveDoc === 'function' && doc) {
    try { await saveDoc(doc); } catch { /* caller still has the in-memory doc */ }
  }
  return { doc, scripts, failedFrom, saved };
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
    const loaded = typeof script === 'string';
    // Local/IDB rows with no script: do not remint and drop the old key.
    // Vault rows with a path and no blob still collapse (then mark missing).
    if (!loaded && part?.missing !== true && !partPath(part)) {
      if (part?.id) used.add(part.id);
      if (part?.surfId) used.add(part.surfId);
      assignments.push({
        part,
        nextId: part.id,
        script: undefined,
        picked: { id: part.id, minted: false, copiedFrom: undefined },
        path: partPath(part),
        frozen: true,
      });
      continue;
    }
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
  const parts = assignments.map(({ part, nextId, script, picked, path, frozen }) => {
    if (frozen) return part;
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
