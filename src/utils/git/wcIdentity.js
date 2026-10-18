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

function hash32(str, basis = 2166136261) {
  let h = basis >>> 0;
  const text = String(str ?? '');
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable surf-id from a seed so a crash-and-boot remint matches the first. */
function surfIdFromSeed(seed) {
  const a = hash32(seed, 2166136261);
  const b = hash32(seed, 0x811c9dc5);
  const c = hash32(`#${seed}`, 0x85ebca6b);
  return mintSurfId({
    now: Date.UTC(
      2000 + (a % 100),
      b % 12,
      1 + ((c >>> 8) % 28),
      (a >>> 8) % 24,
      (b >>> 8) % 60,
      (c >>> 16) % 60,
      (a >>> 16) % 1000,
    ),
    rand: ((b >>> 16) ^ (c & 0xffff)).toString(16).padStart(4, '0').slice(-4),
  });
}

function mintUnusedSurfId({ now, rand, used, seed } = {}) {
  if (now == null && rand == null && seed != null) {
    for (let n = 0; n < 0x10000; n += 1) {
      const id = surfIdFromSeed(n === 0 ? String(seed) : `${seed}:${n}`);
      if (!used || !used.has(id)) return id;
    }
  }
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
  seed,
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
    id: mintUnusedSurfId({ now, rand, used, seed }),
    minted: true,
    copiedFrom: colliding || undefined,
  };
}

/**
 * While a re-key persist is in flight, autosave of either pair id must
 * write the same bytes to both `from` and `to` so a crash after saveDoc
 * still has the edit under whichever id the IDB doc kept.
 */
export function dualWriteTargets(id, pairs = []) {
  if (!id) return [];
  const ids = new Set([id]);
  for (const { from, to } of pairs || []) {
    if (!from || !to || from === to) continue;
    if (id === from || id === to) {
      ids.add(from);
      ids.add(to);
    }
  }
  return [...ids];
}

async function readScript(load, id) {
  if (typeof load !== 'function' || !id) return undefined;
  try {
    const got = await load(id);
    return typeof got === 'string' ? got : undefined;
  } catch {
    return undefined;
  }
}

async function putVerified({ save, load, id, script }) {
  if (!id || typeof script !== 'string') return false;
  try {
    const ok = await save(id, script);
    if (ok === false) return false;
    if (typeof load === 'function') {
      const got = await readScript(load, id);
      if (got !== script) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Test-only: persist throws after the named step so crash-and-boot
 * coverage can inject a kill at 0 (snapshot), 1 (put), 2 (saveDoc),
 * 3 (apply), or 4 (delete).
 */
export class PersistCrash extends Error {
  constructor(step) {
    super(`persist crash after step ${step}`);
    this.name = 'PersistCrash';
    this.step = step;
  }
}

function crashAfterStep(crashAfter, step) {
  if (crashAfter === step) throw new PersistCrash(step);
}

async function deleteStaleKeys({
  staleIds,
  pairs = [],
  saved,
  allSaved,
  snapshot,
  keep,
  save,
  load,
  remove,
} = {}) {
  const toByFrom = new Map((pairs || []).map((pair) => [pair.from, pair.to]));
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : null;
  const moved = {};
  for (const id of staleIds || []) {
    if (!id || keep?.has(id) || saved.has(id)) continue;
    const to = toByFrom.get(id);
    if (to && !saved.has(to)) continue;
    if (to == null && !allSaved) continue;
    if (typeof load === 'function') {
      const current = await readScript(load, id);
      // Failed read-back is unknown: keep `from` rather than deleting it.
      if (typeof current !== 'string') continue;
      const haveSnap = !!(snap && Object.prototype.hasOwnProperty.call(snap, id));
      if (haveSnap && current !== snap[id]) {
        if (to && saved.has(to)) {
          const ok = await putVerified({ save, load, id: to, script: current });
          if (!ok) continue;
          moved[to] = current;
        } else {
          continue;
        }
      } else if (snap && !haveSnap) {
        continue;
      }
    }
    try { await remove(id); } catch { /* ignore */ }
  }
  return { moved };
}

/**
 * Persist new IndexedDB script keys, then drop the old ones. Never delete
 * first — a crash between delete and save would drop the script. Only delete
 * an old key after its script was loaded, the put under the new key
 * succeeded, and a read-back matches the bytes written. `save` should
 * return `false` on failure (as `savePartScript` does).
 *
 * If `from` was edited after the source snapshot, those newer bytes move
 * to `to` instead of being deleted.
 */
export async function replaceScriptKeys({
  nextScripts,
  staleIds,
  pairs = [],
  heldScripts,
  save,
  load,
  remove,
} = {}) {
  const scripts = nextScripts || {};
  const saved = new Set();
  for (const [id, script] of Object.entries(scripts)) {
    if (await putVerified({ save, load, id, script })) saved.add(id);
  }
  const keep = new Set(Object.keys(scripts));
  const allSaved = Object.keys(scripts).every((id) => saved.has(id));
  await deleteStaleKeys({
    staleIds,
    pairs,
    saved,
    allSaved,
    snapshot: heldScripts,
    keep,
    save,
    load,
    remove,
  });
  return { saved };
}

/**
 * Fold live edits onto collapsed ids. An edit typed under `from` while
 * persist is in flight lands on `to`. A pair whose write failed stays on
 * `from` and keeps that script.
 */
export function mergeLiveEdits(live, persisted, pairs = [], sourceScripts = {}, failedFrom = new Set()) {
  const failed = failedFrom instanceof Set ? failedFrom : new Set(failedFrom || []);
  const toByFrom = new Map();
  const fromByTo = new Map();
  for (const { from, to } of pairs) {
    if (!from || !to || from === to) continue;
    if (failed.has(from)) fromByTo.set(to, from);
    else toByFrom.set(from, to);
  }
  const merged = { ...(persisted || {}) };
  for (const [id, text] of Object.entries(live || {})) {
    if (typeof text !== 'string') continue;
    if (sourceScripts[id] === text) continue;
    const dest = failed.has(id) ? id : (fromByTo.get(id) || toByFrom.get(id) || id);
    merged[dest] = text;
  }
  for (const { from, to } of pairs) {
    if (!from || !to || from === to) continue;
    if (failed.has(from)) delete merged[to];
    else delete merged[from];
  }
  return merged;
}

function sourcePartForRow(sourceDoc, part, fromId) {
  const parts = sourceDoc?.parts || [];
  if (fromId) {
    const byId = parts.find((row) => row?.id === fromId);
    if (byId) return byId;
  }
  if (part?.id) {
    const byId = parts.find((row) => row?.id === part.id);
    if (byId) return byId;
  }
  const path = partPath(part);
  if (path) {
    const byPath = parts.find((row) => partPath(row) === path);
    if (byPath) return byPath;
  }
  return null;
}

/**
 * One crash-safe re-key for boot, vault open, and reseed:
 *
 * 0. Snapshot IDB bytes of every `from` key.
 * 1. Write and verify every `to` key. A failed write reverts that row to `from`.
 * 2. Save the IDB document with the final ids. Nothing has been deleted yet.
 * 3. Map live edits (still under old ids) onto `to`, write them, then switch
 *    in-memory doc/scripts via `apply` (caller also switches the baseline).
 * 4. Delete each `from` only if it still equals the snapshot. A real edit
 *    moves to `to` first. A failed read keeps `from`.
 *
 * Skip a put only when the snapshot already holds the same bytes at that
 * id (boot). Vault-open `to` keys are not in the from-key snapshot, so
 * every tip script is written (isSynced / assets).
 *
 * `crashAfter` is test-only (0–4). `onFlight(pairs | null)` marks the
 * dual-write window for part-script autosave.
 */
export async function persistCollapsedWorkingCopy({
  collapsed,
  sourceDoc,
  sourceScripts,
  heldScripts,
  save,
  load,
  remove,
  saveDoc,
  live,
  apply,
  onFlight,
  crashAfter,
} = {}) {
  const pairs = collapsed?.pairs || [];
  const nextScripts = { ...(collapsed?.scripts || {}) };
  const endFlight = () => {
    try { onFlight?.(null); } catch { /* ignore */ }
  };

  // 0. Snapshot the current IDB bytes of every `from` key.
  const snapshot = { ...(heldScripts || {}) };
  for (const { from } of pairs) {
    if (!from || typeof load !== 'function') continue;
    const got = await readScript(load, from);
    if (typeof got === 'string') snapshot[from] = got;
  }
  crashAfterStep(crashAfter, 0);

  try { onFlight?.(pairs); } catch { /* ignore */ }

  // 1. Write and verify every `to` key. Revert a row whose put failed.
  const putScripts = {};
  const already = new Set();
  for (const [id, script] of Object.entries(nextScripts)) {
    if (typeof script !== 'string') continue;
    if (snapshot[id] === script) {
      already.add(id);
      continue;
    }
    putScripts[id] = script;
  }
  for (const { from, to } of pairs) {
    if (!to || from === to) continue;
    if (typeof nextScripts[to] === 'string') putScripts[to] = nextScripts[to];
  }
  const saved = new Set([...already]);
  for (const [id, script] of Object.entries(putScripts)) {
    if (await putVerified({ save, load, id, script })) saved.add(id);
  }
  const failedFrom = new Set();
  for (const { from, to } of pairs) {
    if (!from || !to || from === to) continue;
    if (typeof nextScripts[to] !== 'string' || !saved.has(to)) failedFrom.add(from);
  }
  let doc = collapsed?.doc;
  let scripts = nextScripts;
  if (failedFrom.size && sourceDoc?.parts) {
    const fromByTo = new Map();
    for (const { from, to } of pairs) {
      if (failedFrom.has(from) && to) fromByTo.set(to, from);
    }
    const parts = (doc?.parts || []).map((part) => {
      const from = fromByTo.get(part.id);
      const src = sourcePartForRow(sourceDoc, part, from);
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
  crashAfterStep(crashAfter, 1);

  const foldLiveEditsOntoTo = async () => {
    const liveScripts = typeof live === 'function' ? live() : live;
    if (!liveScripts || typeof liveScripts !== 'object') return;
    scripts = mergeLiveEdits(liveScripts, scripts, pairs, sourceScripts || {}, failedFrom);
    for (const { from, to } of pairs) {
      if (!from || !to || from === to || failedFrom.has(from)) continue;
      const text = scripts[to];
      if (typeof text !== 'string') continue;
      if (text === nextScripts[to] && saved.has(to)) continue;
      if (await putVerified({ save, load, id: to, script: text })) saved.add(to);
    }
  };

  // Fold edits typed during puts onto `to` before the IDB doc switches ids,
  // so a crash after saveDoc still has the latest bytes under the new keys.
  await foldLiveEditsOntoTo();

  // 2. Save the IDB doc with the final ids (including reverted rows).
  // A falsy return or throw is failure: skip 3–4, keep `from`, keep old ids.
  let docSaved = typeof saveDoc !== 'function';
  if (typeof saveDoc === 'function' && doc) {
    try {
      const result = await saveDoc(doc);
      docSaved = result != null && result !== false;
    } catch {
      docSaved = false;
    }
  }
  if (!docSaved) {
    endFlight();
    return {
      doc: sourceDoc || doc,
      scripts: { ...(sourceScripts || {}) },
      failedFrom: new Set(pairs.map((pair) => pair.from).filter(Boolean)),
      saved,
      snapshot,
      docSaved: false,
    };
  }
  crashAfterStep(crashAfter, 2);

  // 3. Fold edits typed during saveDoc, adopt `from` bytes that changed vs
  // the snapshot (vault open has no live), then switch in-memory doc/scripts.
  await foldLiveEditsOntoTo();
  for (const { from, to } of pairs) {
    if (!from || !to || from === to || failedFrom.has(from)) continue;
    const current = await readScript(load, from);
    if (typeof current !== 'string') continue;
    if (!Object.prototype.hasOwnProperty.call(snapshot, from)) continue;
    if (current === snapshot[from]) continue;
    if (await putVerified({ save, load, id: to, script: current })) {
      saved.add(to);
      scripts[to] = current;
    }
  }
  if (typeof apply === 'function') {
    try {
      await apply({ doc, scripts, failedFrom, saved });
    } catch (err) {
      if (err instanceof PersistCrash) throw err;
    }
  }
  crashAfterStep(crashAfter, 3);

  // 4. Delete each `from` only if it still equals the snapshot.
  const keep = new Set(Object.keys(scripts));
  const deleted = await deleteStaleKeys({
    staleIds: pairs.map((pair) => pair.from),
    pairs,
    saved,
    allSaved: true,
    snapshot,
    keep,
    save,
    load,
    remove,
  });
  for (const [id, text] of Object.entries(deleted?.moved || {})) {
    if (typeof text === 'string') scripts[id] = text;
  }
  endFlight();
  crashAfterStep(crashAfter, 4);

  return { doc, scripts, failedFrom, saved, snapshot, docSaved: true };
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
      seed: [doc.id || '', doc.name || '', part?.id || '', partPath(part) || ''].join('\0'),
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
      seed: ['assembly', doc.name || '', doc.id || ''].join('\0'),
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
