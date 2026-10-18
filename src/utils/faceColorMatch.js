/**
 * Which saved face color lands on which face after a rebuild.
 *
 * Reads a PartGraph (one patch is one face). Does not paint and does not
 * touch the viewport. A fingerprint is the `colors[surfId].faces[].key`
 * shape: `at`, `n`, `area`, and for a fillet or chamfer face `src` / `ord`.
 *
 * Tolerances: normal within 8°, `at` within 1 mm, area within ±25% of the
 * saved area. A key that stores `src` or `ord` must match those too. Two or
 * more faces in tolerance drop the key as ambiguous. None drop it as missing.
 * Keys are compared only to the part they were saved on.
 */

export const FACE_MATCH_NORMAL_DEG = 8;
export const FACE_MATCH_AT_MM = 1;
export const FACE_MATCH_AREA_FRAC = 0.25;

const NORMAL_COS = Math.cos((FACE_MATCH_NORMAL_DEG * Math.PI) / 180);
const AT_MM = FACE_MATCH_AT_MM;
const AT_MM2 = AT_MM * AT_MM;
// One component of a unit normal moves by at most sin(8°) ≈ 0.139 under an
// 8° tilt, so a 0.15 cell plus its neighbors cannot skip a true match.
const NORMAL_CELL = 0.15;

function vec3(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

function unit(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 1e-12)) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function triangleNormal(positions, indices, t) {
  const i0 = indices[t * 3] * 3;
  const i1 = indices[t * 3 + 1] * 3;
  const i2 = indices[t * 3 + 2] * 3;
  const ax = positions[i1] - positions[i0];
  const ay = positions[i1 + 1] - positions[i0 + 1];
  const az = positions[i1 + 2] - positions[i0 + 2];
  const bx = positions[i2] - positions[i0];
  const by = positions[i2 + 1] - positions[i0 + 1];
  const bz = positions[i2 + 2] - positions[i0 + 2];
  return unit([ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]);
}

function triangleArea(positions, indices, t) {
  const i0 = indices[t * 3] * 3;
  const i1 = indices[t * 3 + 1] * 3;
  const i2 = indices[t * 3 + 2] * 3;
  const ax = positions[i1] - positions[i0];
  const ay = positions[i1 + 1] - positions[i0 + 1];
  const az = positions[i1 + 2] - positions[i0 + 2];
  const bx = positions[i2] - positions[i0];
  const by = positions[i2 + 1] - positions[i0 + 1];
  const bz = positions[i2 + 2] - positions[i0 + 2];
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  return 0.5 * Math.hypot(cx, cy, cz);
}

/**
 * Feature source for one patch: the negative fillet/chamfer key that owns
 * more than half its triangles. A flat or a mixed scrap keeps no source.
 */
function featureSource(tris, triSource) {
  if (!triSource || !tris || !tris.length) return null;
  const counts = new Map();
  let best = 0;
  let bestN = 0;
  for (let i = 0; i < tris.length; i++) {
    const src = triSource[tris[i]] | 0;
    const n = (counts.get(src) || 0) + 1;
    counts.set(src, n);
    if (n > bestN || (n === bestN && src < best)) {
      best = src;
      bestN = n;
    }
  }
  if (!(best < 0) || bestN * 2 <= tris.length) return null;
  return best;
}

/**
 * One fingerprint per face-graph patch.
 *
 * `at` is the patch centroid (area-weighted, mm). `n` is its unit
 * area-weighted normal. A closed wall whose normals cancel uses the largest
 * triangle's normal so the fingerprint still has a direction. Fillet and
 * chamfer patches also get `src` (negative feature key) and `ord` (index
 * among that feature's patches, sorted by center).
 *
 * @param {{ patches?: Array }} graph
 * @param {ArrayLike<number>|null} [triSource]
 * @param {{ positions?: ArrayLike<number>, indices?: ArrayLike<number> }} [mesh]
 * @returns {Array<{ id: number, tris: number[], at: number[], n: number[], area: number, kind: string, src?: number, ord?: number }>}
 */
export function faceFingerprints(graph, triSource = null, mesh = null) {
  const patches = graph?.patches;
  if (!Array.isArray(patches) || !patches.length) return [];
  const positions = mesh?.positions;
  const indices = mesh?.indices;
  const faces = [];
  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    const at = vec3(patch?.center);
    const area = Number(patch?.area);
    if (!at || !(area > 0)) continue;
    let n = unit(vec3(patch?.normal) || [0, 0, 0]);
    if (!n && positions && indices && patch.tris?.length) {
      let bestT = -1;
      let bestA = 0;
      for (let k = 0; k < patch.tris.length; k++) {
        const a = triangleArea(positions, indices, patch.tris[k]);
        if (a > bestA) {
          bestA = a;
          bestT = patch.tris[k];
        }
      }
      if (bestT >= 0) n = triangleNormal(positions, indices, bestT);
    }
    if (!n) continue;
    const face = {
      id: patch.id ?? i,
      tris: patch.tris,
      at,
      n,
      area,
      kind: patch.kind || 'general',
    };
    const src = featureSource(patch.tris, triSource);
    if (src != null) face.src = src;
    faces.push(face);
  }
  const groups = new Map();
  for (const face of faces) {
    if (face.src == null) continue;
    let group = groups.get(face.src);
    if (!group) {
      group = [];
      groups.set(face.src, group);
    }
    group.push(face);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1] || a.at[2] - b.at[2] || a.id - b.id);
    for (let i = 0; i < group.length; i++) group[i].ord = i;
  }
  return faces;
}

/** The save-format key for one fingerprint. Omits `src` / `ord` on a plain face. */
export function faceColorKey(face) {
  const at = vec3(face?.at);
  const n = unit(vec3(face?.n) || [0, 0, 0]);
  const area = Number(face?.area);
  if (!at || !n || !(area > 0)) return null;
  const key = { at, n, area };
  if (Number.isInteger(face.src) && face.src < 0) {
    key.src = face.src;
    if (Number.isInteger(face.ord) && face.ord >= 0) key.ord = face.ord;
  }
  return key;
}

function unwrapItem(item) {
  if (item && typeof item === 'object' && item.key && typeof item.key === 'object') {
    return { key: item.key, color: item.color };
  }
  return { key: item, color: undefined };
}

function readKey(raw) {
  const at = vec3(raw?.at);
  const n = unit(vec3(raw?.n) || [0, 0, 0]);
  const area = Number(raw?.area);
  if (!at || !n || !(area > 0)) return null;
  const key = { at, n, area, hasSrc: false, hasOrd: false };
  if (raw.src != null && raw.src !== '') {
    const src = Number(raw.src);
    if (!Number.isInteger(src)) return null;
    key.src = src;
    key.hasSrc = true;
  }
  if (raw.ord != null && raw.ord !== '') {
    const ord = Number(raw.ord);
    if (!Number.isInteger(ord) || ord < 0) return null;
    key.ord = ord;
    key.hasOrd = true;
  }
  return key;
}

function atCell(v) {
  return Math.floor(v / AT_MM);
}

function nCell(v) {
  return Math.floor(v / NORMAL_CELL);
}

function cellId(x, y, z) {
  return x + ',' + y + ',' + z;
}

function indexFaces(faces) {
  const atBuckets = new Map();
  for (const face of faces) {
    const at = vec3(face?.at);
    const n = unit(vec3(face?.n) || [0, 0, 0]);
    const area = Number(face?.area);
    if (!at || !n || !(area > 0)) continue;
    const row = { face, at, n, area, nq: [nCell(n[0]), nCell(n[1]), nCell(n[2])] };
    const id = cellId(atCell(at[0]), atCell(at[1]), atCell(at[2]));
    let bucket = atBuckets.get(id);
    if (!bucket) {
      bucket = [];
      atBuckets.set(id, bucket);
    }
    bucket.push(row);
  }
  return { atBuckets };
}

function featureOk(row, key) {
  if (key.hasSrc && row.face.src !== key.src) return false;
  if (key.hasOrd && row.face.ord !== key.ord) return false;
  return true;
}

function geometryOk(row, key) {
  const nDot = row.n[0] * key.n[0] + row.n[1] * key.n[1] + row.n[2] * key.n[2];
  if (nDot < NORMAL_COS) return false;
  const dx = row.at[0] - key.at[0];
  const dy = row.at[1] - key.at[1];
  const dz = row.at[2] - key.at[2];
  if (dx * dx + dy * dy + dz * dz > AT_MM2) return false;
  return Math.abs(row.area - key.area) / key.area <= FACE_MATCH_AREA_FRAC;
}

function candidates(index, key) {
  const ix = atCell(key.at[0]);
  const iy = atCell(key.at[1]);
  const iz = atCell(key.at[2]);
  const nx = nCell(key.n[0]);
  const ny = nCell(key.n[1]);
  const nz = nCell(key.n[2]);
  const hits = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = index.atBuckets.get(cellId(ix + dx, iy + dy, iz + dz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const row = bucket[i];
          if (Math.abs(row.nq[0] - nx) > 1) continue;
          if (Math.abs(row.nq[1] - ny) > 1) continue;
          if (Math.abs(row.nq[2] - nz) > 1) continue;
          hits.push(row);
        }
      }
    }
  }
  return hits;
}

function dropped(surfId, item) {
  const out = { key: item.key };
  if (surfId != null) out.surfId = surfId;
  if (item.color != null) out.color = item.color;
  return out;
}

/**
 * Match saved keys to one part's fingerprints.
 * Each item is a key or `{ key, color }`.
 * @returns {{ matched: Array<{ key: object, color?: string, face: object }>, ambiguous: Array<{ key: object, color?: string }>, missing: Array<{ key: object, color?: string }> }}
 */
export function matchFaceKeys(faces, items) {
  const index = indexFaces(Array.isArray(faces) ? faces : []);
  const matched = [];
  const ambiguous = [];
  const missing = [];
  const rows = Array.isArray(items) ? items : [];
  for (let i = 0; i < rows.length; i++) {
    const item = unwrapItem(rows[i]);
    const key = readKey(item.key);
    if (!key) {
      missing.push(dropped(null, item));
      continue;
    }
    const hits = [];
    const pool = candidates(index, key);
    for (let c = 0; c < pool.length; c++) {
      const row = pool[c];
      if (!featureOk(row, key) || !geometryOk(row, key)) continue;
      hits.push(row.face);
      if (hits.length > 1) break;
    }
    if (hits.length === 1) {
      const rec = dropped(null, item);
      rec.face = hits[0];
      matched.push(rec);
    } else if (hits.length > 1) {
      ambiguous.push(dropped(null, item));
    } else {
      missing.push(dropped(null, item));
    }
  }
  return { matched, ambiguous, missing };
}

/**
 * Match an assembly color map. A key stored under surf id A is never
 * compared to part B. A surf id with no part here, or a key with no face,
 * is missing. Whole-part `colors[id].part` is left for the painter.
 *
 * @param {Array<{ surfId: string, faces: Array }>} parts
 * @param {Record<string, { faces?: Array<{ color?: string, key: object }> }>|null} colors
 */
export function matchFaceColors(parts, colors) {
  const byId = new Map();
  const list = Array.isArray(parts) ? parts : [];
  for (let i = 0; i < list.length; i++) {
    const part = list[i];
    if (part && (part.surfId != null || part.id != null)) {
      byId.set(String(part.surfId != null ? part.surfId : part.id), part.faces || []);
    }
  }
  const matched = [];
  const ambiguous = [];
  const missing = [];
  if (!colors || typeof colors !== 'object') return { matched, ambiguous, missing };
  const ids = Object.keys(colors);
  for (let i = 0; i < ids.length; i++) {
    const surfId = ids[i];
    const entry = colors[surfId];
    const faceItems = Array.isArray(entry?.faces) ? entry.faces : [];
    if (!faceItems.length) continue;
    const faces = byId.get(surfId);
    if (!faces) {
      for (let k = 0; k < faceItems.length; k++) {
        missing.push(dropped(surfId, unwrapItem(faceItems[k])));
      }
      continue;
    }
    const one = matchFaceKeys(faces, faceItems);
    for (let k = 0; k < one.matched.length; k++) {
      const rec = one.matched[k];
      rec.surfId = surfId;
      matched.push(rec);
    }
    for (let k = 0; k < one.ambiguous.length; k++) {
      const rec = one.ambiguous[k];
      rec.surfId = surfId;
      ambiguous.push(rec);
    }
    for (let k = 0; k < one.missing.length; k++) {
      const rec = one.missing[k];
      rec.surfId = surfId;
      missing.push(rec);
    }
  }
  return { matched, ambiguous, missing };
}
