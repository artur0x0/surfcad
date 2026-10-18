/**
 * Paint mode writes assembly face colors. A tap paints one face on the
 * session map immediately. A second tap on that face within
 * `PAINT_DOUBLE_TAP_MS` upgrades the same undo entry to every face of the
 * body. Confirm stores the session on `colors`. Cancel drops the session.
 */

import { isSurfId } from './git/surfId.js';
import {
  faceColorKey,
  faceFingerprints,
  matchFaceKeys,
} from './faceColorMatch.js';
import { resolveViewportFaceClick, warmFaceGraph } from './selectFace.js';

/** Eight fixed swatches. A ninth color is the custom hex field. */
export const PAINT_SWATCHES = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#a855f7',
  '#f4f4f5',
];

/** Lowercase `#rrggbb`, or null. */
export function parsePaintHex(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}

/**
 * The color Confirm will write. A non-empty custom field wins when it is a
 * valid hex and blocks Confirm when it is not. An empty field uses the swatch.
 */
export function resolvedPaintColor(swatch, custom) {
  const typed = typeof custom === 'string' ? custom.trim() : '';
  if (typed) return parsePaintHex(typed);
  return parsePaintHex(swatch);
}

/** The palette chip is a CAD control. Game mode does not paint. */
export function paintChipVisible(mode) {
  return mode !== 'game';
}

export function fingerprintsFromGeometry(geometry, faceIDs) {
  const positions = geometry?.attributes?.position?.array;
  const indices = geometry?.index?.array;
  if (!positions || !indices?.length) return [];
  const graph = warmFaceGraph(geometry, faceIDs);
  if (!graph) return [];
  return faceFingerprints(graph, geometry.userData?.triSource || null, { positions, indices });
}

/**
 * The face-graph patch that owns these triangles, as a save key.
 * Same resolver as a normal one-click face pick: a blend stays a blend, and
 * a coplanar seam stays one face.
 */
export function paintPickFromClick({
  geometry,
  faceIDs = null,
  seedFaceIndex,
  faceNormal = null,
  angleTolerance = 3,
}) {
  const resolved = resolveViewportFaceClick({
    geometry,
    seedFaceIndex,
    faceNormal,
    clickCount: 1,
    faceIDs,
    angleTolerance,
    legacy: false,
  });
  const indices = resolved?.indices || [];
  if (!indices.length) return null;
  const faces = fingerprintsFromGeometry(geometry, faceIDs);
  const want = new Set(indices);
  let best = null;
  let bestN = 0;
  for (const face of faces) {
    let n = 0;
    const tris = face.tris || [];
    for (let i = 0; i < tris.length; i++) if (want.has(tris[i])) n++;
    if (n > bestN) {
      best = face;
      bestN = n;
    }
  }
  const key = best ? faceColorKey(best) : null;
  if (!key) return null;
  return { indices: indices.slice(), key };
}

function samePaintFace(a, b) {
  const as = a?.indices || [];
  const bs = b?.indices || [];
  if (as.length && bs.length) {
    const set = new Set(as);
    let n = 0;
    for (const t of bs) if (set.has(t)) n++;
    if (n > 0 && n * 2 >= as.length && n * 2 >= bs.length) return true;
  }
  if (a?.key && b?.key) {
    const face = {
      id: 0,
      tris: [],
      at: b.key.at,
      n: b.key.n,
      area: b.key.area,
    };
    if (Number.isInteger(b.key.src)) {
      face.src = b.key.src;
      face.ord = b.key.ord;
    }
    if (matchFaceKeys([face], [{ key: a.key }]).matched.length === 1) return true;
  }
  return false;
}

/** Tap adds the face. Tap that face again removes it. */
export function togglePaintPick(picks, pick) {
  const list = Array.isArray(picks) ? picks.slice() : [];
  if (!pick?.key) return list;
  const idx = list.findIndex((row) => samePaintFace(row, pick));
  if (idx >= 0) {
    list.splice(idx, 1);
    return list;
  }
  list.push({
    indices: Array.isArray(pick.indices) ? pick.indices.slice() : [],
    key: pick.key,
  });
  return list;
}

/** Drop the last pick. Does not touch saved colors. */
export function undoPaintPick(picks) {
  const list = Array.isArray(picks) ? picks.slice() : [];
  if (list.length) list.pop();
  return list;
}

/**
 * Switching parts drops in-progress picks. The same part keeps them.
 * The first part (no previous id) keeps whatever was picked. Leaving the
 * active part with no next id drops them.
 */
export function paintPicksAfterPartChange(prevId, nextId, picks) {
  const list = Array.isArray(picks) ? picks : [];
  if (prevId == null) return list;
  if (nextId == null || String(prevId) !== String(nextId)) return [];
  return list;
}

/** A new mesh invalidates triangle indices, so the picks start over. */
export function paintPicksAfterMeshChange(sameMesh, picks) {
  if (sameMesh) return Array.isArray(picks) ? picks : [];
  return [];
}

function cloneColorMap(colors) {
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return {};
  const out = {};
  for (const [id, entry] of Object.entries(colors)) {
    if (!entry || typeof entry !== 'object') continue;
    const next = {};
    if (entry.part !== undefined) next.part = entry.part;
    if (Array.isArray(entry.faces)) {
      next.faces = entry.faces.map((face) => ({
        color: face.color,
        key: { ...face.key },
      }));
    }
    out[id] = next;
  }
  return out;
}

function paintedFaceIds(faces, keys) {
  const ids = new Set();
  if (!faces?.length) return ids;
  for (const key of keys) {
    if (!key) continue;
    const hit = matchFaceKeys(faces, [{ key }]);
    if (hit.matched.length === 1) ids.add(hit.matched[0].face.id);
  }
  return ids;
}

/** Saved color already on the one face this key matches, or null. */
function colorAlreadyOnKey(existing, faces, key) {
  if (!faces?.length || !key) return null;
  const hit = matchFaceKeys(faces, [{ key }]);
  if (hit.matched.length !== 1) return null;
  const id = hit.matched[0].face.id;
  const list = Array.isArray(existing) ? existing : [];
  for (let i = 0; i < list.length; i++) {
    const prev = matchFaceKeys(faces, [list[i]]);
    if (prev.matched.length === 1 && prev.matched[0].face.id === id) {
      return parsePaintHex(list[i].color);
    }
  }
  return null;
}

/**
 * Drop saved face entries that uniquely match a face we are painting.
 * Ambiguous and missing keys stay. They are not pruned here.
 */
function replaceMatchedFaces(existing, faces, keys) {
  const list = Array.isArray(existing) ? existing : [];
  const painted = paintedFaceIds(faces, keys);
  if (!painted.size) return list.map((face) => ({ color: face.color, key: { ...face.key } }));
  const kept = [];
  for (const face of list) {
    const hit = matchFaceKeys(faces, [face]);
    if (hit.matched.length === 1 && painted.has(hit.matched[0].face.id)) continue;
    kept.push({ color: face.color, key: { ...face.key } });
  }
  return kept;
}

function dedupedEntries(keys, color, faces) {
  const rows = [];
  const seen = new Set();
  const list = Array.isArray(keys) ? keys : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const key = list[i];
    if (!key?.at || !key?.n || !(key.area > 0)) continue;
    const hit = faces?.length ? matchFaceKeys(faces, [{ key }]) : { matched: [] };
    const token = hit.matched.length === 1
      ? `face:${hit.matched[0].face.id}`
      : JSON.stringify(key);
    if (seen.has(token)) continue;
    seen.add(token);
    const clean = {
      at: [key.at[0], key.at[1], key.at[2]],
      n: [key.n[0], key.n[1], key.n[2]],
      area: key.area,
    };
    if (Number.isInteger(key.src) && key.src < 0 && Number.isInteger(key.ord) && key.ord >= 0) {
      clean.src = key.src;
      clean.ord = key.ord;
    }
    rows.push({ color, key: clean });
  }
  rows.reverse();
  return rows;
}

function writeEntry(map, surfId, entry) {
  if (!entry.part && !(entry.faces && entry.faces.length)) {
    delete map[surfId];
  } else {
    const next = {};
    if (entry.part) next.part = entry.part;
    if (entry.faces?.length) next.faces = entry.faces;
    map[surfId] = next;
  }
  return Object.keys(map).length ? map : null;
}

/**
 * Confirm. `part` sets `colors[surfId].part` and leaves face keys alone.
 * Otherwise each key is written into `faces[]`, replacing a saved key that
 * uniquely matches that same face. The same color on a face that still
 * matches keeps the saved key, so a script re-run does not look like a new paint.
 * Returns the input when the color or surf id cannot be stored.
 */
export function commitPaintColors(colors, surfId, { color, part = false, keys = [], faces = null } = {}) {
  const hex = parsePaintHex(color);
  if (!hex || !isSurfId(surfId)) return colors ?? null;
  const map = cloneColorMap(colors);
  const prev = map[surfId] ? { ...map[surfId] } : {};
  if (part) {
    prev.part = hex;
    return writeEntry(map, surfId, prev);
  }
  const incoming = dedupedEntries(keys, hex, faces);
  if (!incoming.length) return colors ?? null;
  const fresh = [];
  for (let i = 0; i < incoming.length; i++) {
    if (colorAlreadyOnKey(prev.faces, faces, incoming[i].key) === hex) continue;
    fresh.push(incoming[i]);
  }
  if (!fresh.length) return colors ?? null;
  prev.faces = [
    ...replaceMatchedFaces(prev.faces, faces, fresh.map((row) => row.key)),
    ...fresh,
  ];
  return writeEntry(map, surfId, prev);
}

/**
 * Clear. Part mode removes `colors[surfId].part`. Face mode removes saved
 * keys that uniquely match the picked faces. Ambiguous and missing keys stay.
 */
export function clearPaintColors(colors, surfId, { part = false, keys = [], faces = null } = {}) {
  if (!isSurfId(surfId)) return colors ?? null;
  const map = cloneColorMap(colors);
  const prev = map[surfId];
  if (!prev) return colors ?? null;
  if (part) {
    delete prev.part;
    return writeEntry(map, surfId, prev);
  }
  const drop = paintedFaceIds(faces, keys);
  if (!drop.size) return colors ?? null;
  prev.faces = (prev.faces || []).filter((face) => {
    const hit = matchFaceKeys(faces, [face]);
    return !(hit.matched.length === 1 && drop.has(hit.matched[0].face.id));
  });
  return writeEntry(map, surfId, prev);
}

/**
 * Explicit cleanup for the current part: drop face keys that are missing or
 * ambiguous against the faces just shown. Matched keys and the part color stay.
 * Not called from paint or from render.
 */
export function removeUnmatchedColors(colors, surfId, faces) {
  if (!isSurfId(surfId) || !faces?.length) return colors ?? null;
  const map = cloneColorMap(colors);
  const prev = map[surfId];
  if (!prev?.faces?.length) return colors ?? null;
  const kept = [];
  let dropped = false;
  for (const face of prev.faces) {
    const hit = matchFaceKeys(faces, [face]);
    if (hit.matched.length === 1) kept.push(face);
    else dropped = true;
  }
  if (!dropped) return colors ?? null;
  prev.faces = kept;
  return writeEntry(map, surfId, prev);
}

/** How many face keys on this part the matcher will not draw. */
export function unmatchedColorCount(colors, surfId, faces) {
  if (!surfId || !faces?.length) return 0;
  const items = colors?.[surfId]?.faces;
  if (!items?.length) return 0;
  const hit = matchFaceKeys(faces, items);
  return hit.ambiguous.length + hit.missing.length;
}

/** Second tap on the same face upgrades that paint to the whole body. */
export const PAINT_DOUBLE_TAP_MS = 300;

/** Session copy of an assembly color map. Empty in, empty out. */
export function clonePaintSession(colors) {
  return cloneColorMap(colors);
}

function sessionJson(colors) {
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return 'null';
  if (!Object.keys(colors).length) return 'null';
  return JSON.stringify(colors);
}

function asSession(colors) {
  return cloneColorMap(colors);
}

function copyUndo(undo) {
  return (Array.isArray(undo) ? undo : []).map((snap) => cloneColorMap(snap));
}

/** True when the session differs from the map captured as the popup opened. */
export function livePaintChanged(session, baseline) {
  return sessionJson(session) !== sessionJson(baseline);
}

/**
 * Face keys whose triangles intersect `indices`. Used to upgrade one face
 * to every face of the body under the finger.
 */
export function paintKeysForTriangles(geometry, faceIDs, indices) {
  const faces = fingerprintsFromGeometry(geometry, faceIDs);
  const want = new Set(indices || []);
  if (!want.size) return [];
  const keys = [];
  for (const face of faces) {
    const tris = face.tris || [];
    let hit = false;
    for (let i = 0; i < tris.length; i += 1) {
      if (want.has(tris[i])) {
        hit = true;
        break;
      }
    }
    if (!hit) continue;
    const key = faceColorKey(face);
    if (key) keys.push(key);
  }
  return keys;
}

function paintResult(session, undo, lastTap, changed) {
  return { session, undo, lastTap, changed };
}

/**
 * Paint one face now. A second call for that same face inside the double-tap
 * window rewrites the pre-tap snapshot with every body face and does not push
 * another undo entry. A different face, or a tap after the window, is a new
 * action. A write that does not change the map pushes nothing.
 */
export function livePaintTap(state, {
  surfId,
  color,
  key,
  bodyKeys = null,
  faces = null,
  now = 0,
  doubleTapMs = PAINT_DOUBLE_TAP_MS,
} = {}) {
  const session = asSession(state?.session);
  const undo = copyUndo(state?.undo);
  const last = state?.lastTap || null;
  const hex = parsePaintHex(color);
  if (!hex || !isSurfId(surfId) || !key?.at) {
    return paintResult(session, undo, last, false);
  }
  const keyJson = JSON.stringify(key);
  const upgrade = !!(
    last
    && last.surfId === surfId
    && last.keyJson === keyJson
    && Number(now) - Number(last.at) <= doubleTapMs
    && Array.isArray(bodyKeys)
    && bodyKeys.length
  );
  if (upgrade) {
    const base = last.pushed && undo.length
      ? cloneColorMap(undo[undo.length - 1])
      : cloneColorMap(session);
    const next = asSession(commitPaintColors(base, surfId, { color: hex, keys: bodyKeys, faces }));
    if (!last.pushed) {
      if (!livePaintChanged(next, session)) return paintResult(session, undo, null, false);
      undo.push(cloneColorMap(session));
      return paintResult(next, undo, null, true);
    }
    if (!livePaintChanged(next, session)) return paintResult(session, undo, null, false);
    return paintResult(next, undo, null, true);
  }
  const before = cloneColorMap(session);
  const next = asSession(commitPaintColors(session, surfId, { color: hex, keys: [key], faces }));
  const changed = livePaintChanged(next, before);
  if (changed) undo.push(before);
  return paintResult(next, undo, {
    surfId,
    keyJson,
    at: Number(now) || 0,
    pushed: changed,
  }, changed);
}

/** Paint `colors[surfId].part` for the whole part. One undo entry when it changes. */
export function livePaintPart(state, { surfId, color } = {}) {
  const session = asSession(state?.session);
  const undo = copyUndo(state?.undo);
  const hex = parsePaintHex(color);
  if (!hex || !isSurfId(surfId)) return paintResult(session, undo, null, false);
  const next = asSession(commitPaintColors(session, surfId, { color: hex, part: true }));
  if (!livePaintChanged(next, session)) return paintResult(session, undo, null, false);
  undo.push(cloneColorMap(session));
  return paintResult(next, undo, null, true);
}

/** Step back one paint action. */
export function livePaintUndo(state) {
  const undo = copyUndo(state?.undo);
  if (!undo.length) return paintResult(asSession(state?.session), undo, null, false);
  const session = undo.pop();
  return paintResult(session, undo, null, true);
}

/** Restore the map from when the popup opened. That restore is itself one undo step. */
export function livePaintClear(state) {
  const session = asSession(state?.session);
  const baseline = asSession(state?.baseline);
  const undo = copyUndo(state?.undo);
  if (!livePaintChanged(session, baseline)) return paintResult(session, undo, null, false);
  undo.push(cloneColorMap(session));
  return paintResult(baseline, undo, null, true);
}

/** Drop unmatched face keys on the session. Not written until Confirm. */
export function livePaintUnmatched(state, { surfId, faces } = {}) {
  const session = asSession(state?.session);
  const undo = copyUndo(state?.undo);
  const next = asSession(removeUnmatchedColors(session, surfId, faces));
  if (!livePaintChanged(next, session)) return paintResult(session, undo, null, false);
  undo.push(cloneColorMap(session));
  return paintResult(next, undo, null, true);
}
