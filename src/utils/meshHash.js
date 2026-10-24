/**
 * Content hash of the part of a worker mesh that becomes GPU buffers:
 * `numProp`, `vertProperties`, `triVerts`, `faceID` and the sheet flag. Two
 * runs that produce the same triangles hash the same, so a part re-run that
 * changes nothing keeps the BufferGeometry (and the GPU buffers) it already
 * shows. The run tables (`runIndex`, `runOriginalID`, the stamp rows) are
 * left out on purpose: Manifold numbers originalIDs per run, so they differ
 * between two identical runs; the solid cache refreshes them onto the kept
 * geometry from the new mesh instead (see `partSolidCache.js`).
 *
 * Two independent 32-bit mixes plus the vertex and triangle counts make the
 * key; a collision would need both to agree on equal-size meshes.
 */

const memo = new WeakMap();

const FNV_PRIME = 0x01000193;
const MURMUR_M = 0x5bd1e995;

function mixA(h, v) {
  h ^= v;
  return Math.imul(h, FNV_PRIME) >>> 0;
}

function mixB(h, v) {
  v = Math.imul(v >>> 0, MURMUR_M) >>> 0;
  v ^= v >>> 24;
  v = Math.imul(v, MURMUR_M) >>> 0;
  h = Math.imul(h, MURMUR_M) >>> 0;
  return (h ^ v) >>> 0;
}

/** Fold an integer array (typed or plain) into both streams. */
function foldInts(s, arr) {
  if (!arr) {
    s.a = mixA(s.a, 0xfffffffe);
    s.b = mixB(s.b, 0xfffffffe);
    return;
  }
  const n = arr.length;
  s.a = mixA(s.a, n);
  s.b = mixB(s.b, n);
  for (let i = 0; i < n; i++) {
    const v = arr[i] >>> 0;
    s.a = mixA(s.a, v);
    s.b = mixB(s.b, v);
  }
}

/** Fold floats by their float32 bit patterns, so 0.1 and 0.1 agree exactly. */
function foldFloats(s, arr) {
  if (!arr) {
    foldInts(s, null);
    return;
  }
  const f = arr instanceof Float32Array ? arr : Float32Array.from(arr);
  const u = new Uint32Array(f.buffer, f.byteOffset, f.length);
  foldInts(s, u);
}

function hex8(v) {
  return (v >>> 0).toString(16).padStart(8, '0');
}

/**
 * @param {object|null|undefined} mesh worker mesh data
 * @returns {string|null} stable key for this mesh content, null when there is no mesh
 */
export function meshContentHash(mesh) {
  if (!mesh || typeof mesh !== 'object') return null;
  if (!mesh.vertProperties || !mesh.triVerts) return null;
  const hit = memo.get(mesh);
  if (hit) return hit;
  const s = { a: 0x811c9dc5, b: 0x9747b28c };
  const np = Number(mesh.numProp) || 3;
  s.a = mixA(s.a, np);
  s.b = mixB(s.b, np);
  foldFloats(s, mesh.vertProperties);
  foldInts(s, mesh.triVerts);
  foldInts(s, mesh.faceID && mesh.faceID.length ? mesh.faceID : null);
  const vertCount = Math.floor(mesh.vertProperties.length / np);
  const triCount = Math.floor(mesh.triVerts.length / 3);
  const key = `${hex8(s.a)}${hex8(s.b)}:${vertCount}:${triCount}${mesh.sheetMetal ? ':sheet' : ''}`;
  memo.set(mesh, key);
  return key;
}
