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
  reuseTo,
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

  if (isSurfId(reuseTo) && !taken(reuseTo)) {
    return { id: reuseTo, minted: false, copiedFrom: colliding || undefined };
  }

  return {
    id: mintUnusedSurfId({ now, rand, used }),
    minted: true,
    copiedFrom: colliding || undefined,
  };
}

export const WORKING_COPY_DOC_UNSAVED = 'Could not save the opened assembly. The previous working copy was kept.';

/**
 * Stable key for the pending-rekey journal. One IndexedDB database holds
 * one current assembly; the key still names it so a leftover record is
 * not applied to a different document.
 */
export function assemblyRekeyKey(doc) {
  if (!doc || typeof doc !== 'object') return '';
  if (typeof doc.id === 'string' && doc.id) return doc.id;
  if (typeof doc.name === 'string' && doc.name) return `name:${doc.name}`;
  return '';
}

/**
 * Pairs to reuse on a crash-and-boot remint. Empty when the journal is
 * missing or belongs to another assembly.
 */
export function reusePairsFromJournal(journal, doc) {
  if (!journal || !Array.isArray(journal.pairs) || !journal.pairs.length) return [];
  const key = assemblyRekeyKey(doc);
  if (!key || journal.assemblyKey !== key) return [];
  return journal.pairs
    .filter((row) => row && row.from && row.to && row.from !== row.to)
    .map((row) => ({ from: String(row.from), to: String(row.to) }));
}

export function feaIdMapFromPairs(pairs = []) {
  const map = new Map();
  for (const { from, to } of pairs || []) {
    if (!from || !to || from === to) continue;
    map.set(from, to);
  }
  return map;
}

/**
 * Remap FEA study part ids on bytes that land on a `to` key. A write to
 * `from` keeps the live editor's ids so snapshot comparison stays honest.
 */
export function remapFeaForPersist(script, pairs = [], destId = null) {
  if (typeof script !== 'string') return script;
  const map = feaIdMapFromPairs(pairs);
  if (!map.size) return script;
  if (destId) {
    let writingTo = false;
    for (const to of map.values()) {
      if (to === destId) {
        writingTo = true;
        break;
      }
    }
    if (!writingTo) return script;
  }
  return rewriteFeaStudyPartIds(script, map);
}

function remapToScripts(scripts, pairs) {
  const map = feaIdMapFromPairs(pairs);
  if (!map.size) return scripts;
  const next = { ...scripts };
  const toIds = new Set(map.values());
  for (const id of toIds) {
    if (typeof next[id] !== 'string') continue;
    next[id] = rewriteFeaStudyPartIds(next[id], map);
  }
  return next;
}

/**
 * While a re-key persist is in flight, autosave of either pair id must
 * write the same bytes to both `from` and `to` so a crash after saveDoc
 * still has the edit under whichever id the IDB doc kept. Once step 4
 * begins, `toOnly` is true: write `to` only so a late `from` put cannot
 * resurrect a deleted key.
 */
export function dualWriteTargets(id, pairs = [], toOnly = false) {
  if (!id) return [];
  if (toOnly) {
    for (const { from, to } of pairs || []) {
      if (!from || !to || from === to) continue;
      if (id === from || id === to) return [to];
    }
    return [id];
  }
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
  remapTo,
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
          const outgoing = typeof remapTo === 'function' ? remapTo(current, to) : current;
          const ok = await putVerified({ save, load, id: to, script: outgoing });
          if (!ok) continue;
          moved[to] = outgoing;
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
 * 0. Snapshot IDB bytes of every `from` key. Record {assemblyKey, pairs}
 *    in the pending-rekey journal so a crash-and-boot remint reuses `to`.
 * 1. Write and verify every `to` key. A failed write reverts that row to `from`.
 * 2. Save the IDB document with the final ids. Nothing has been deleted yet.
 * 3. Map live edits (still under old ids) onto `to`, write them, then switch
 *    in-memory doc/scripts via `apply` (caller also switches the baseline).
 * 4. Stop dual-writing `from`. Delete each `from` only if it still equals
 *    the snapshot. A real edit moves to `to` first. A failed read keeps `from`.
 *
 * Skip a put only when the snapshot already holds the same bytes at that
 * id (boot). Vault-open `to` keys are not in the from-key snapshot, so
 * every tip script is written (isSynced / assets).
 *
 * `crashAfter` is test-only (0–4). `onFlight(pairs, { toOnly } | null)`
 * marks the dual-write window for part-script autosave. Journal clear and
 * endFlight run in `finally`. PersistCrash and a failed saveDoc keep the
 * journal so the next boot reuses the same `to`.
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
  assemblyKey,
  saveJournal,
  clearJournal,
} = {}) {
  const pairs = collapsed?.pairs || [];
  const nextScripts = { ...(collapsed?.scripts || {}) };
  const endFlight = () => {
    try { onFlight?.(null); } catch { /* ignore */ }
  };
  const remapTo = (script, id) => remapFeaForPersist(script, pairs, id);
  let clearPendingJournal = false;

  try {
    // 0. Snapshot the current IDB bytes of every `from` key.
    const snapshot = { ...(heldScripts || {}) };
    for (const { from } of pairs) {
      if (!from || typeof load !== 'function') continue;
      const got = await readScript(load, from);
      if (typeof got === 'string') snapshot[from] = got;
    }
    const journalPairs = pairs
      .filter((pair) => pair?.from && pair?.to && pair.from !== pair.to)
      .map((pair) => ({ from: pair.from, to: pair.to }));
    if (typeof saveJournal === 'function' && journalPairs.length) {
      try {
        await saveJournal({
          assemblyKey: assemblyKey || assemblyRekeyKey(sourceDoc) || assemblyRekeyKey(collapsed?.doc),
          pairs: journalPairs,
        });
      } catch { /* next boot remints if the journal never landed */ }
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
      const text = remapTo(script, id);
      if (await putVerified({ save, load, id, script: text })) saved.add(id);
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
      scripts = remapToScripts(scripts, pairs);
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
      const remapped = remapTo(current, to);
      if (await putVerified({ save, load, id: to, script: remapped })) {
        saved.add(to);
        scripts[to] = remapped;
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

    // 4. Dual-write `to` only, then delete each `from` if it still equals the snapshot.
    try { onFlight?.(pairs, { toOnly: true }); } catch { /* ignore */ }
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
      remapTo,
    });
    for (const [id, text] of Object.entries(deleted?.moved || {})) {
      if (typeof text === 'string') scripts[id] = text;
    }
    clearPendingJournal = true;
    crashAfterStep(crashAfter, 4);

    return { doc, scripts, failedFrom, saved, snapshot, docSaved: true };
  } finally {
    endFlight();
    if (clearPendingJournal && typeof clearJournal === 'function') {
      try { await clearJournal(); } catch { /* ignore */ }
    }
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
  reusePairs = [],
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
  const reuseByFrom = new Map();
  for (const pair of reusePairs || []) {
    if (!pair?.from || !pair?.to || pair.from === pair.to) continue;
    reuseByFrom.set(pair.from, pair.to);
  }
  const assignments = [];
  let minted = 0;
  let restamped = false;

  for (let i = 0; i < sourceParts.length; i += 1) {
    const part = sourceParts[i];
    const instance = typeof part?.instanceOf === 'string' && part.instanceOf && part.instanceOf !== part?.id;
    let script = instance ? undefined : scriptForPart(part, sourceScripts);
    const loaded = typeof script === 'string';
    // Local/IDB rows with no script: do not remint and drop the old key.
    // Vault rows with a path and no blob still collapse (then mark missing).
    // An instance row has no script of its own (its definition's header
    // names the definition), so it keeps its row id as it is.
    if (instance || (!loaded && part?.missing !== true && !partPath(part))) {
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
      reuseTo: reuseByFrom.get(part?.id) || reuseByFrom.get(partPath(part)) || undefined,
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
  }).map((row) => {
    // A frozen instance row follows its definition when that row was remapped.
    const ref = row?.instanceOf;
    if (typeof ref === 'string' && map.has(ref)) return { ...row, instanceOf: map.get(ref) };
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
