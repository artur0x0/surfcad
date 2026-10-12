// Volume meshing for the FEA solver.
//
// `meshVolume` turns a closed triangle surface (Manifold's positions, indices,
// and a per-triangle face id) into a TET10 mesh. fTetWild, compiled to a
// single-threaded SIMD wasm module, produces the TET4 mesh. This file orients
// each tet so its signed volume is positive, inserts mid-edge nodes, snaps
// boundary mids back onto the input surface, and copies each boundary face's
// face id from the nearest input triangle. A snap that folds a quadratic tet
// (non-positive Jacobian at a Gauss point or a corner) is rolled back to the
// straight-edge midpoint, shared by every element on that edge. If a few
// elements are still folded, their mid-edge nodes are reset to the chord
// midpoint (linear geometry). If any remain folded, the surface is meshed
// once more with a slightly longer edge. Elements that stay folded after
// both attempts fail here, during meshing.
//
// The module does not use shared memory. solveSolid loads it on the first
// Analyze run. A phone solve passes memoryCeilingBytes so the heap stops
// at 512 MiB.
//
// solveSolid keeps the mesh this function returns. meshCacheKey is that
// cache's key: the surface bytes, the mesh target, and the device profile.
// A later run with the same key reuses the mesh. releaseMesh drops the
// typed arrays when the cache evicts an entry. The phone cache holds one
// mesh so the worker stays inside its 512 MiB budget.

import { capWasmMemory } from './wasmMemory.js';

const TET_EDGES = [
  [0, 1, 4],
  [1, 2, 5],
  [2, 0, 6],
  [0, 3, 7],
  [1, 3, 8],
  [2, 3, 9],
];

let modulePromise = null;
let moduleKey = null;

function asFloat64(positions) {
  if (positions instanceof Float64Array) return positions;
  return Float64Array.from(positions);
}

function asUint32(indices) {
  if (indices instanceof Uint32Array) return indices;
  return Uint32Array.from(indices);
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function pointAt(positions, index) {
  return [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
}

export function surfaceVolume(positions, indices) {
  const xyz = asFloat64(positions);
  const tris = asUint32(indices);
  let volume = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const a = pointAt(xyz, tris[i]);
    const b = pointAt(xyz, tris[i + 1]);
    const c = pointAt(xyz, tris[i + 2]);
    volume += dot(a, cross(b, c));
  }
  return volume / 6;
}

export function tetVolume(positions, tet) {
  const a = pointAt(positions, tet[0]);
  const b = pointAt(positions, tet[1]);
  const c = pointAt(positions, tet[2]);
  const d = pointAt(positions, tet[3]);
  return dot(cross(sub(b, a), sub(c, a)), sub(d, a)) / 6;
}

function orientAway(positions, face, opposite) {
  const a = pointAt(positions, face[0]);
  const b = pointAt(positions, face[1]);
  const c = pointAt(positions, face[2]);
  const normal = cross(sub(b, a), sub(c, a));
  if (dot(normal, sub(pointAt(positions, opposite), a)) > 0) {
    return [face[0], face[2], face[1]];
  }
  return face;
}

function outwardFaces(tet) {
  const corners = [
    [tet[1], tet[2], tet[3], tet[0]],
    [tet[0], tet[3], tet[2], tet[1]],
    [tet[0], tet[1], tet[3], tet[2]],
    [tet[0], tet[2], tet[1], tet[3]],
  ];
  return corners;
}

export function tetDihedralDegrees(positions, tet) {
  const oriented = outwardFaces(tet).map(([i, j, k, opposite]) => orientAway(positions, [i, j, k], opposite));
  const normals = oriented.map((face) => {
    const n = cross(
      sub(pointAt(positions, face[1]), pointAt(positions, face[0])),
      sub(pointAt(positions, face[2]), pointAt(positions, face[0])),
    );
    const len = length(n);
    return len === 0 ? [0, 0, 0] : scale(n, 1 / len);
  });
  const angles = [];
  for (let i = 0; i < 4; i += 1) {
    for (let j = i + 1; j < 4; j += 1) {
      const cosine = Math.min(1, Math.max(-1, dot(normals[i], normals[j])));
      angles.push(((Math.PI - Math.acos(cosine)) * 180) / Math.PI);
    }
  }
  return angles;
}

function triangleArea(a, b, c) {
  return 0.5 * length(cross(sub(b, a), sub(c, a)));
}

export function tetAspectRatio(positions, tet) {
  const volume = Math.abs(tetVolume(positions, tet));
  let longest = 0;
  for (let i = 0; i < 4; i += 1) {
    for (let j = i + 1; j < 4; j += 1) {
      longest = Math.max(longest, length(sub(pointAt(positions, tet[i]), pointAt(positions, tet[j]))));
    }
  }
  let shortestAltitude = Infinity;
  for (const [i, j, k, opposite] of outwardFaces(tet)) {
    const face = orientAway(positions, [i, j, k], opposite);
    const area = triangleArea(
      pointAt(positions, face[0]),
      pointAt(positions, face[1]),
      pointAt(positions, face[2]),
    );
    if (area > 0) shortestAltitude = Math.min(shortestAltitude, (3 * volume) / area);
  }
  if (!Number.isFinite(shortestAltitude) || shortestAltitude === 0) return Infinity;
  return longest / shortestAltitude;
}

function bboxDiag(positions) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  return length(sub(max, min));
}

function closestPointOnTriangle(p, a, b, c) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return add(a, scale(ab, v));
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return add(a, scale(ac, w));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return add(b, scale(sub(c, b), w));
  }
  const denom = 1 / (va + vb + vc);
  return add(a, add(scale(ab, vb * denom), scale(ac, vc * denom)));
}

function edgeKey(a, b) {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

function decodeTet4(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const view = new DataView(buffer);
  const status = view.getInt32(0, true);
  const nVertices = view.getUint32(4, true);
  const nTets = view.getUint32(8, true);
  const messageLen = view.getUint32(12, true);
  let offset = 24 + messageLen;
  offset = (offset + 7) & ~7;
  const message = new TextDecoder().decode(new Uint8Array(buffer, 24, messageLen));
  const positions = new Float64Array(nVertices * 3);
  positions.set(new Float64Array(buffer, offset, nVertices * 3));
  offset += nVertices * 3 * 8;
  const tets = new Uint32Array(nTets * 4);
  tets.set(new Uint32Array(buffer, offset, nTets * 4));
  return { status, message, positions, tets };
}

async function readWasm(url) {
  if (globalThis.process && globalThis.process.versions && globalThis.process.versions.node) {
    const { readFile } = await import('node:fs/promises');
    return new Uint8Array(await readFile(url));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`mesh wasm fetch failed (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

function factoryWithBinary(factory, bytes) {
  let rejectLoad = null;
  const failed = new Promise((_, reject) => {
    rejectLoad = reject;
  });
  const loaded = factory({
    instantiateWasm(imports, receive) {
      WebAssembly.instantiate(bytes, imports).then(
        (result) => {
          try {
            receive(result.instance);
          } catch (error) {
            rejectLoad(error);
          }
        },
        (error) => rejectLoad(error),
      );
      return {};
    },
  });
  return Promise.race([loaded, failed]);
}

/**
 * fTetWild's committed entry point is one call and does not report stages.
 * If a build exposes setProgress / onProgress / setMeshProgress, forward it.
 */
function bindMeshProgress(module, onProgress) {
  if (!module || typeof onProgress !== 'function') return;
  const hook = module.setProgress || module.onProgress || module.setMeshProgress;
  if (typeof hook !== 'function') return;
  try {
    hook((update) => {
      const fraction = update && Number.isFinite(Number(update.fraction)) ? Number(update.fraction) : undefined;
      onProgress({ stage: (update && update.stage) || 'meshing', fraction, blocking: true });
    });
  } catch {
    /* no stage callback in this build */
  }
}

async function loadMeshModule(ceilingBytes) {
  const key = ceilingBytes > 0 ? ceilingBytes : 0;
  if (modulePromise && moduleKey === key) return modulePromise;
  moduleKey = key;
  modulePromise = (async () => {
    const glue = await import('../../packages/surfcad-mesh/pkg/surfcad_mesh.js');
    const factory = glue.default;
    const wasmUrl = new URL('../../packages/surfcad-mesh/pkg/surfcad_mesh.wasm', import.meta.url);
    let bytes = await readWasm(wasmUrl);
    if (key > 0) bytes = capWasmMemory(bytes, key);
    return factoryWithBinary(factory, bytes);
  })().catch((error) => {
    modulePromise = null;
    moduleKey = null;
    throw error;
  });
  return modulePromise;
}

function meshTet4(module, positions, indices, edgeLength, epsilon, maxTets, sizing) {
  const nVertices = positions.length / 3;
  const nTriangles = indices.length / 3;
  const sized = !!(sizing && sizing.positions && sizing.tets && sizing.values
    && sizing.positions.length >= 12 && sizing.tets.length >= 4 && sizing.values.length >= 4);
  const posPtr = module._malloc(nVertices * 3 * 8);
  const indexPtr = module._malloc(nTriangles * 3 * 4);
  const bytesPtr = module._malloc(4);
  const sizingPositions = sized
    ? (sizing.positions instanceof Float64Array ? sizing.positions : Float64Array.from(sizing.positions))
    : null;
  const sizingTets = sized
    ? (sizing.tets instanceof Uint32Array ? sizing.tets : Uint32Array.from(sizing.tets))
    : null;
  const sizingValues = sized
    ? (sizing.values instanceof Float64Array ? sizing.values : Float64Array.from(sizing.values))
    : null;
  const sizingPosPtr = sized ? module._malloc(sizingPositions.length * 8) : 0;
  const sizingTetPtr = sized ? module._malloc(sizingTets.length * 4) : 0;
  const sizingValPtr = sized ? module._malloc(sizingValues.length * 8) : 0;
  if (posPtr === 0 || indexPtr === 0 || bytesPtr === 0
    || (sized && (sizingPosPtr === 0 || sizingTetPtr === 0 || sizingValPtr === 0))) {
    if (posPtr) module._free(posPtr);
    if (indexPtr) module._free(indexPtr);
    if (bytesPtr) module._free(bytesPtr);
    if (sizingPosPtr) module._free(sizingPosPtr);
    if (sizingTetPtr) module._free(sizingTetPtr);
    if (sizingValPtr) module._free(sizingValPtr);
    throw new Error('mesh wasm is out of memory');
  }
  try {
    module.HEAPF64.set(positions, posPtr / 8);
    module.HEAPU32.set(indices, indexPtr / 4);
    let blobPtr;
    if (sized) {
      module.HEAPF64.set(sizingPositions, sizingPosPtr / 8);
      module.HEAPU32.set(sizingTets, sizingTetPtr / 4);
      module.HEAPF64.set(sizingValues, sizingValPtr / 8);
      blobPtr = module._surfcad_mesh_tet4_sized(
        posPtr,
        nVertices,
        indexPtr,
        nTriangles,
        edgeLength,
        epsilon,
        maxTets,
        sizingPosPtr,
        sizingPositions.length / 3,
        sizingTetPtr,
        sizingTets.length / 4,
        sizingValPtr,
        bytesPtr,
      );
    } else {
      blobPtr = module._surfcad_mesh_tet4(
        posPtr,
        nVertices,
        indexPtr,
        nTriangles,
        edgeLength,
        epsilon,
        maxTets,
        bytesPtr,
      );
    }
    if (blobPtr === 0) throw new Error('mesh wasm returned no result');
    const byteLength = module.getValue(bytesPtr, 'i32') >>> 0;
    const copy = new Uint8Array(byteLength);
    copy.set(module.HEAPU8.subarray(blobPtr, blobPtr + byteLength));
    module._surfcad_mesh_free(blobPtr);
    return { decoded: decodeTet4(copy), wasmBytes: module.HEAPU8.byteLength };
  } finally {
    module._free(posPtr);
    module._free(indexPtr);
    module._free(bytesPtr);
    if (sizingPosPtr) module._free(sizingPosPtr);
    if (sizingTetPtr) module._free(sizingTetPtr);
    if (sizingValPtr) module._free(sizingValPtr);
  }
}

/**
 * Swap two corners of every TET4 with a negative signed volume so the tet is
 * right-handed before mid-edge nodes are inserted. A zero-volume tet is left
 * as it is; the Jacobian check reports it.
 */
export function orientTet4s(positions, tets) {
  const oriented = new Uint32Array(tets.length);
  oriented.set(tets);
  let flipped = 0;
  for (let t = 0; t < oriented.length; t += 4) {
    const tet = [oriented[t], oriented[t + 1], oriented[t + 2], oriented[t + 3]];
    if (tetVolume(positions, tet) < 0) {
      const swap = oriented[t];
      oriented[t] = oriented[t + 1];
      oriented[t + 1] = swap;
      flipped += 1;
    }
  }
  return { tets: oriented, flipped };
}

// 4-point rule from packages/surfcad-fea tet10.rs, then the four corners.
const GAUSS_SQRT5 = Math.sqrt(5);
const GAUSS_ALPHA = (5 + 3 * GAUSS_SQRT5) / 20;
const GAUSS_BETA = (5 - GAUSS_SQRT5) / 20;
const TET10_JACOBIAN_SAMPLES = [
  [GAUSS_BETA, GAUSS_BETA, GAUSS_BETA],
  [GAUSS_ALPHA, GAUSS_BETA, GAUSS_BETA],
  [GAUSS_BETA, GAUSS_ALPHA, GAUSS_BETA],
  [GAUSS_BETA, GAUSS_BETA, GAUSS_ALPHA],
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** Solver treats |det| below this as a singular Jacobian. */
const MIN_JACOBIAN = 1e-30;

/**
 * How many still-folded elements may drop back to linear edges. More than
 * this means the tet mesh itself is wrong, so the caller remeshes instead of
 * straightening a large part of the surface.
 */
export const INVERTED_TET_LINEAR_LIMIT = 4;

/** Second mesh uses a 2% longer edge so a sliver tet is not repeated. */
export const REMESH_EDGE_SCALE = 1.02;

function nodeXYZ(nodes, index) {
  if (nodes instanceof Float64Array || nodes instanceof Float32Array) {
    return [nodes[index * 3], nodes[index * 3 + 1], nodes[index * 3 + 2]];
  }
  const point = nodes[index];
  return [point[0], point[1], point[2]];
}

function writeNode(nodes, index, xyz) {
  if (nodes instanceof Float64Array || nodes instanceof Float32Array) {
    nodes[index * 3] = xyz[0];
    nodes[index * 3 + 1] = xyz[1];
    nodes[index * 3 + 2] = xyz[2];
    return;
  }
  nodes[index][0] = xyz[0];
  nodes[index][1] = xyz[1];
  nodes[index][2] = xyz[2];
}

function shapeDerivatives(l1, l2, l3) {
  const l0 = 1 - l1 - l2 - l3;
  const d0 = -(4 * l0 - 1);
  return [
    [d0, d0, d0],
    [4 * l1 - 1, 0, 0],
    [0, 4 * l2 - 1, 0],
    [0, 0, 4 * l3 - 1],
    [4 * (l0 - l1), -4 * l1, -4 * l1],
    [4 * l2, 4 * l1, 0],
    [-4 * l2, 4 * (l0 - l2), -4 * l2],
    [-4 * l3, -4 * l3, 4 * (l0 - l3)],
    [4 * l3, 0, 4 * l1],
    [0, 4 * l3, 4 * l2],
  ];
}

function jacobianDet(xyz, sample) {
  const dn = shapeDerivatives(sample[0], sample[1], sample[2]);
  const jac = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let a = 0; a < 10; a += 1) {
    const point = xyz[a];
    for (let row = 0; row < 3; row += 1) {
      jac[row][0] += dn[a][0] * point[row];
      jac[row][1] += dn[a][1] * point[row];
      jac[row][2] += dn[a][2] * point[row];
    }
  }
  return jac[0][0] * (jac[1][1] * jac[2][2] - jac[1][2] * jac[2][1])
    - jac[0][1] * (jac[1][0] * jac[2][2] - jac[1][2] * jac[2][0])
    + jac[0][2] * (jac[1][0] * jac[2][1] - jac[1][1] * jac[2][0]);
}

/** Minimum det(J) at the Gauss points and the corners. Non-finite if any sample is. */
export function tet10MinJacobian(nodes, elem) {
  const xyz = [];
  for (let a = 0; a < 10; a += 1) xyz.push(nodeXYZ(nodes, elem[a]));
  let min = Infinity;
  for (let s = 0; s < TET10_JACOBIAN_SAMPLES.length; s += 1) {
    const det = jacobianDet(xyz, TET10_JACOBIAN_SAMPLES[s]);
    if (!Number.isFinite(det)) return det;
    if (det < min) min = det;
  }
  return min;
}

export function jacobianAcceptable(det) {
  return Number.isFinite(det) && det > MIN_JACOBIAN;
}

/**
 * Straighten snapped mid-edge nodes of every TET10 whose Jacobian is not
 * positive. A mid-node is one index shared by every element on that edge, so
 * the rollback is the same point for all of them. Repeats until the mesh is
 * valid or no snapped mid-node is left to move.
 */
export function repairTet10Jacobians(nodes, elements, midMeta) {
  let rolled = 0;
  const limit = 8;
  const nTets = elements.length / 10;
  for (let pass = 0; pass < limit; pass += 1) {
    const bad = [];
    for (let t = 0; t < nTets; t += 1) {
      const elem = elements.subarray(t * 10, t * 10 + 10);
      if (!jacobianAcceptable(tet10MinJacobian(nodes, elem))) bad.push(t);
    }
    if (bad.length === 0) return { invalid: 0, rolled, passes: pass };
    let moved = 0;
    for (let i = 0; i < bad.length; i += 1) {
      const base = bad[i] * 10;
      for (let slot = 4; slot < 10; slot += 1) {
        const id = elements[base + slot];
        const meta = midMeta.get(id);
        if (!meta || !meta.snapped) continue;
        writeNode(nodes, id, meta.straight);
        meta.snapped = false;
        moved += 1;
        rolled += 1;
      }
    }
    if (moved === 0) return { invalid: bad.length, rolled, passes: pass + 1 };
  }
  let invalid = 0;
  for (let t = 0; t < nTets; t += 1) {
    const elem = elements.subarray(t * 10, t * 10 + 10);
    if (!jacobianAcceptable(tet10MinJacobian(nodes, elem))) invalid += 1;
  }
  return { invalid, rolled, passes: limit };
}

function invertedTetIndices(nodes, elements) {
  const bad = [];
  const nTets = elements.length / 10;
  for (let t = 0; t < nTets; t += 1) {
    const elem = elements.subarray(t * 10, t * 10 + 10);
    if (!jacobianAcceptable(tet10MinJacobian(nodes, elem))) bad.push(t);
  }
  return bad;
}

/**
 * Reset every mid-edge node of a still-folded element to the chord midpoint.
 * Used after snapped mids have already been straightened, for the few
 * elements whose remaining curve (or a mid that was never flagged) still
 * folds the Jacobian. A tet that is flat at its corners stays invalid.
 */
export function linearizeInvertedTet10s(nodes, elements, midMeta) {
  let linearized = 0;
  const touched = new Set();
  const limit = 4;
  for (let pass = 0; pass < limit; pass += 1) {
    const bad = invertedTetIndices(nodes, elements);
    if (bad.length === 0) return { invalid: 0, linearized, passes: pass };
    if (bad.length > INVERTED_TET_LINEAR_LIMIT) {
      return { invalid: bad.length, linearized, passes: pass };
    }
    let moved = 0;
    for (let i = 0; i < bad.length; i += 1) {
      const base = bad[i] * 10;
      for (let e = 0; e < TET_EDGES.length; e += 1) {
        const [a, b, slot] = TET_EDGES[e];
        const id = elements[base + slot];
        const straight = scale(add(
          nodeXYZ(nodes, elements[base + a]),
          nodeXYZ(nodes, elements[base + b]),
        ), 0.5);
        const current = nodeXYZ(nodes, id);
        if (length(sub(current, straight)) > 1e-12) {
          writeNode(nodes, id, straight);
          moved += 1;
          if (!touched.has(id)) {
            touched.add(id);
            linearized += 1;
          }
        }
        const meta = midMeta && midMeta.get(id);
        if (meta) {
          meta.straight = [straight[0], straight[1], straight[2]];
          meta.snapped = false;
        }
      }
    }
    if (moved === 0) return { invalid: bad.length, linearized, passes: pass + 1 };
  }
  return { invalid: invertedTetIndices(nodes, elements).length, linearized, passes: limit };
}

function jacobianStopError(invalid) {
  const noun = invalid === 1 ? 'element still has' : 'elements still have';
  return new Error(
    `Meshing stopped: ${invalid} TET10 ${noun} a non-positive Jacobian after straightening curved mid-edge nodes.`,
  );
}

export function isJacobianStop(error) {
  return error instanceof Error
    && error.message.startsWith('Meshing stopped:')
    && error.message.includes('non-positive Jacobian');
}

/**
 * Options for the single remesh after linear mids still leave a folded tet.
 * The target edge (and a sizing field, when present) grows by
 * `REMESH_EDGE_SCALE`. The caller's options are not modified.
 */
export function perturbMeshOptions(surface, options = {}) {
  const positions = asFloat64(surface && surface.positions);
  const diag = bboxDiag(positions);
  const requested = options.edgeLength ?? 0;
  const base = requested > 0 ? requested : (diag > 0 ? diag / 20 : 0);
  const edgeLength = base > 0 ? base * REMESH_EDGE_SCALE : requested;
  let sizing = options.sizing;
  if (sizing && sizing.values && typeof sizing.values.length === 'number' && sizing.values.length > 0) {
    const values = Float64Array.from(sizing.values, (value) => value * REMESH_EDGE_SCALE);
    sizing = { ...sizing, values };
  }
  return { ...options, edgeLength, sizing };
}

/**
 * How many corner-tets a segment crosses. Used to count elements through a
 * wall: `origin` on the outer face, `direction` the inward normal, `distance`
 * the gauge.
 */
export function countTetsAlong(nodes, elements, origin, direction, distance, steps = 48) {
  const span = length(direction);
  if (!(span > 0) || !(distance > 0)) return 0;
  const unit = scale(direction, 1 / span);
  const seen = new Set();
  const nTets = elements.length / 10;
  for (let s = 1; s < steps; s += 1) {
    const point = add(origin, scale(unit, (distance * s) / steps));
    for (let t = 0; t < nTets; t += 1) {
      if (seen.has(t)) continue;
      const base = t * 10;
      const bary = tetBarycentric(
        point,
        nodeXYZ(nodes, elements[base]),
        nodeXYZ(nodes, elements[base + 1]),
        nodeXYZ(nodes, elements[base + 2]),
        nodeXYZ(nodes, elements[base + 3]),
      );
      if (bary && bary[0] >= -1e-8 && bary[1] >= -1e-8 && bary[2] >= -1e-8 && bary[3] >= -1e-8) {
        seen.add(t);
      }
    }
  }
  return seen.size;
}

function tetBarycentric(p, a, b, c, d) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ad = sub(d, a);
  const ap = sub(p, a);
  const det = dot(ab, cross(ac, ad));
  if (!(Math.abs(det) > 1e-18)) return null;
  const u = dot(ap, cross(ac, ad)) / det;
  const v = dot(ab, cross(ap, ad)) / det;
  const w = dot(ab, cross(ac, ap)) / det;
  return [1 - u - v - w, u, v, w];
}

function upgradeTet10(tet4Positions, tet4Tets, inputPositions, inputIndices, inputFaceIds, edgeLength, epsilon) {
  const oriented = orientTet4s(tet4Positions, tet4Tets);
  tet4Tets = oriented.tets;
  const inputTriangles = [];
  for (let i = 0; i < inputIndices.length; i += 3) {
    inputTriangles.push({
      faceId: inputFaceIds[i / 3],
      a: pointAt(inputPositions, inputIndices[i]),
      b: pointAt(inputPositions, inputIndices[i + 1]),
      c: pointAt(inputPositions, inputIndices[i + 2]),
    });
  }
  const boundary = [];
  const counts = new Map();
  const nTets = tet4Tets.length / 4;
  for (let t = 0; t < nTets; t += 1) {
    const tet = [
      tet4Tets[t * 4],
      tet4Tets[t * 4 + 1],
      tet4Tets[t * 4 + 2],
      tet4Tets[t * 4 + 3],
    ];
    for (const [i, j, k, opposite] of outwardFaces(tet)) {
      const oriented = orientAway(tet4Positions, [i, j, k], opposite);
      const key = [...oriented].sort((a, b) => a - b).join(',');
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { face: oriented, count: 1 });
    }
  }
  for (const entry of counts.values()) {
    if (entry.count === 1) boundary.push(entry);
  }

  const boundaryEdgeIds = new Map();
  for (const entry of boundary) {
    const face = entry.face;
    const centroid = scale(
      add(add(pointAt(tet4Positions, face[0]), pointAt(tet4Positions, face[1])), pointAt(tet4Positions, face[2])),
      1 / 3,
    );
    let best = Infinity;
    let faceId = inputTriangles[0] ? inputTriangles[0].faceId : 0;
    for (const triangle of inputTriangles) {
      const q = closestPointOnTriangle(centroid, triangle.a, triangle.b, triangle.c);
      const dist = length(sub(centroid, q));
      if (dist < best) {
        best = dist;
        faceId = triangle.faceId;
      }
    }
    entry.faceId = faceId;
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const key = edgeKey(face[a], face[b]);
      let ids = boundaryEdgeIds.get(key);
      if (!ids) {
        ids = new Set();
        boundaryEdgeIds.set(key, ids);
      }
      ids.add(faceId);
    }
  }

  const diag = bboxDiag(inputPositions);
  const epsAbs = (epsilon > 0 ? epsilon : 1e-3) * diag;
  const targetEdge = edgeLength > 0 ? edgeLength : diag / 20;
  const snapTol = Math.max(epsAbs * 4, targetEdge * 0.25, diag * 1e-8);

  const nodes = [];
  for (let i = 0; i < tet4Positions.length; i += 3) {
    nodes.push([tet4Positions[i], tet4Positions[i + 1], tet4Positions[i + 2]]);
  }
  const mids = new Map();
  const midMeta = new Map();
  const midOf = (a, b) => {
    const key = edgeKey(a, b);
    const existing = mids.get(key);
    if (existing !== undefined) return existing;
    const pa = nodes[a];
    const pb = nodes[b];
    const straight = scale(add(pa, pb), 0.5);
    let mid = straight;
    let snapped = false;
    const allowed = boundaryEdgeIds.get(key);
    if (allowed) {
      let best = Infinity;
      let bestPoint = mid;
      for (const triangle of inputTriangles) {
        if (!allowed.has(triangle.faceId)) continue;
        const q = closestPointOnTriangle(mid, triangle.a, triangle.b, triangle.c);
        const dist = length(sub(mid, q));
        if (dist < best) {
          best = dist;
          bestPoint = q;
        }
      }
      if (best <= snapTol && length(sub(bestPoint, straight)) > 1e-12) {
        mid = bestPoint;
        snapped = true;
      }
    }
    const id = nodes.length;
    nodes.push([mid[0], mid[1], mid[2]]);
    midMeta.set(id, { straight: [straight[0], straight[1], straight[2]], snapped });
    mids.set(key, id);
    return id;
  };

  const elements = new Uint32Array(nTets * 10);
  for (let t = 0; t < nTets; t += 1) {
    const tet = [
      tet4Tets[t * 4],
      tet4Tets[t * 4 + 1],
      tet4Tets[t * 4 + 2],
      tet4Tets[t * 4 + 3],
    ];
    const elem = elements.subarray(t * 10, t * 10 + 10);
    elem[0] = tet[0];
    elem[1] = tet[1];
    elem[2] = tet[2];
    elem[3] = tet[3];
    for (const [a, b, slot] of TET_EDGES) {
      elem[slot] = midOf(tet[a], tet[b]);
    }
  }

  const faces = new Uint32Array(boundary.length * 6);
  const faceIds = new Uint32Array(boundary.length);
  for (let i = 0; i < boundary.length; i += 1) {
    const face = boundary[i].face;
    faces[i * 6] = face[0];
    faces[i * 6 + 1] = face[1];
    faces[i * 6 + 2] = face[2];
    faces[i * 6 + 3] = midOf(face[0], face[1]);
    faces[i * 6 + 4] = midOf(face[1], face[2]);
    faces[i * 6 + 5] = midOf(face[2], face[0]);
    faceIds[i] = boundary[i].faceId;
  }

  const repair = repairTet10Jacobians(nodes, elements, midMeta);
  let linearized = 0;
  if (repair.invalid > 0) {
    const linear = linearizeInvertedTet10s(nodes, elements, midMeta);
    linearized = linear.linearized;
    if (linear.invalid > 0) throw jacobianStopError(linear.invalid);
  }

  const flat = new Float64Array(nodes.length * 3);
  for (let i = 0; i < nodes.length; i += 1) {
    flat[i * 3] = nodes[i][0];
    flat[i * 3 + 1] = nodes[i][1];
    flat[i * 3 + 2] = nodes[i][2];
  }
  return {
    nodes: flat,
    elements,
    faces,
    faceIds,
    flipped: oriented.flipped,
    rolled: repair.rolled,
    linearized,
  };
}

function qualityStats(nodes, elements) {
  const nTets = elements.length / 10;
  let volume = 0;
  let minDihedral = Infinity;
  let maxDihedral = -Infinity;
  let minAspect = Infinity;
  let maxAspect = 0;
  let aspectSum = 0;
  let positive = true;
  for (let t = 0; t < nTets; t += 1) {
    const tet = [elements[t * 10], elements[t * 10 + 1], elements[t * 10 + 2], elements[t * 10 + 3]];
    const vol = tetVolume(nodes, tet);
    if (!(vol > 0)) positive = false;
    volume += vol;
    for (const angle of tetDihedralDegrees(nodes, tet)) {
      minDihedral = Math.min(minDihedral, angle);
      maxDihedral = Math.max(maxDihedral, angle);
    }
    const aspect = tetAspectRatio(nodes, tet);
    minAspect = Math.min(minAspect, aspect);
    maxAspect = Math.max(maxAspect, aspect);
    aspectSum += aspect;
  }
  return {
    volume,
    minDihedralDeg: nTets === 0 ? 0 : minDihedral,
    maxDihedralDeg: nTets === 0 ? 0 : maxDihedral,
    minAspect: nTets === 0 ? 0 : minAspect,
    maxAspect: nTets === 0 ? 0 : maxAspect,
    meanAspect: nTets === 0 ? 0 : aspectSum / nTets,
    positive,
  };
}

/**
 * Mesh a closed triangle surface.
 *
 * `surface.positions` is xyz, Float32Array or Float64Array, in the caller's
 * length unit (millimetres for a study). `surface.indices` is three indices
 * per triangle. `surface.faceIds` (or `faceIDs`) is one id per triangle.
 *
 * `options.edgeLength` is the target edge length in the same unit. `0` leaves
 * fTetWild's relative default (1/20 of the bbox diagonal). `options.epsilon`
 * is fTetWild's relative envelope, a fraction of that diagonal. `0` leaves
 * the default `1e-3`. `options.maxTets` fails the call when the TET4 mesh
 * would be larger. `0` means no cap. `options.sizing` is an optional
 * background tet mesh `{ positions, tets, values }` of absolute target
 * edge lengths. `edgeLength` should be the coarsest value in that field.
 *
 * Boundary `faces` are 6-node triangles in the same order `solve_tet10` uses
 * for pressure: corners, then mid-edge nodes 01, 12, 20. The right-hand
 * normal of the corners points out of the solid.
 *
 * A folded tet that survives straightening and the linear-mid fallback is
 * meshed once more with `perturbMeshOptions`. The error is raised only when
 * that second mesh is folded too.
 */
async function meshVolumeOnce(surface, options = {}) {
  const positions = asFloat64(surface.positions);
  const indices = asUint32(surface.indices);
  const faceIds = asUint32(surface.faceIds ?? surface.faceIDs ?? new Uint32Array(indices.length / 3));
  if (positions.length % 3 !== 0) throw new Error('positions length must be a multiple of 3');
  if (indices.length % 3 !== 0) throw new Error('indices length must be a multiple of 3');
  if (faceIds.length !== indices.length / 3) {
    throw new Error('faceIds must contain one id per triangle');
  }
  const edgeLength = options.edgeLength ?? 0;
  const epsilon = options.epsilon ?? 0;
  const maxTets = options.maxTets ?? 0;
  const started = Date.now();
  const module = await loadMeshModule(options.memoryCeilingBytes);
  bindMeshProgress(module, options.onProgress);
  if (typeof options.onProgress === 'function') {
    options.onProgress({ stage: 'meshing', blocking: true });
  }
  let decoded;
  let wasmBytes;
  try {
    ({ decoded, wasmBytes } = meshTet4(
      module,
      positions,
      indices,
      edgeLength,
      epsilon,
      maxTets,
      options.sizing,
    ));
  } finally {
    if (typeof options.onProgress === 'function') {
      options.onProgress({ stage: 'meshing', blocking: false });
    }
  }
  if (decoded.status !== 0) {
    throw new Error(decoded.message || `volume mesher failed (${decoded.status})`);
  }
  const upgraded = upgradeTet10(
    decoded.positions,
    decoded.tets,
    positions,
    indices,
    faceIds,
    edgeLength,
    epsilon,
  );
  const quality = qualityStats(upgraded.nodes, upgraded.elements);
  const inputVolume = Math.abs(surfaceVolume(positions, indices));
  const volumeError = inputVolume === 0 ? 0 : Math.abs(quality.volume - inputVolume) / inputVolume;
  return {
    nodes: upgraded.nodes,
    elements: upgraded.elements,
    faces: upgraded.faces,
    faceIds: upgraded.faceIds,
    stats: {
      nodes: upgraded.nodes.length / 3,
      elements: upgraded.elements.length / 10,
      boundaryFaces: upgraded.faceIds.length,
      volume: quality.volume,
      inputVolume,
      volumeError,
      minDihedralDeg: quality.minDihedralDeg,
      maxDihedralDeg: quality.maxDihedralDeg,
      minAspect: quality.minAspect,
      meanAspect: quality.meanAspect,
      maxAspect: quality.maxAspect,
      positive: quality.positive,
      oriented: upgraded.flipped,
      straightenedMids: upgraded.rolled,
      linearizedMids: upgraded.linearized,
      ms: Date.now() - started,
      wasmBytes,
      dofs: upgraded.nodes.length,
    },
  };
}

/** Run `attempt(false)`, and on a folded-tet stop run `attempt(true)` once. */
export async function withJacobianRetry(attempt) {
  try {
    return await attempt(false);
  } catch (error) {
    if (!isJacobianStop(error)) throw error;
    return attempt(true);
  }
}

export async function meshVolume(surface, options = {}) {
  const started = Date.now();
  const mesh = await withJacobianRetry(async (remesh) => {
    const opts = remesh ? perturbMeshOptions(surface, options) : options;
    const built = await meshVolumeOnce(surface, opts);
    if (remesh && built && built.stats) built.stats.remeshed = true;
    return built;
  });
  if (mesh && mesh.stats) mesh.stats.ms = Date.now() - started;
  return mesh;
}

/**
 * One cached mesh on a phone, where the worker heap stops at 512 MiB.
 * Desktop keeps two, so a switch between two geometries can still hit.
 */
export function meshCacheLimit(profile) {
  return profile === 'phone' ? 1 : 2;
}

/** Drop the mesh arrays so the worker can return those bytes to the GC. */
export function releaseMesh(mesh) {
  if (!mesh || typeof mesh !== 'object') return;
  mesh.nodes = null;
  mesh.elements = null;
  mesh.faces = null;
  mesh.faceIds = null;
  if (mesh.stats && typeof mesh.stats === 'object') mesh.stats.wasmBytes = 0;
}

/**
 * Key for the TET10 cache. Positions, indices, and face ids are hashed
 * from their bytes, so a geometry edit misses. The mesh target and the
 * device profile select the edge length, so they are part of the key.
 * Material, fixtures, and loads are not: a load edit reuses the mesh and
 * the solver decides whether the cached solution still applies. `bcKey`
 * is optional and unused by the solid solve.
 */
export function meshCacheKey(surface, target, profile, bcKey = '') {
  const source = surface || {};
  const faceIDs = source.faceIDs ?? source.faceIds;
  const profileKey = profile === 'phone' ? 'phone' : 'desktop';
  let targetKey = '';
  if (typeof target === 'number' && Number.isFinite(target)) targetKey = `n:${target}`;
  else if (target != null && target !== '') targetKey = `s:${String(target)}`;
  const parts = [
    hashBuffer(source.positions),
    hashBuffer(source.indices),
    hashBuffer(faceIDs),
    targetKey,
    profileKey,
  ];
  if (bcKey) parts.push(String(bcKey));
  return parts.join('|');
}

function hashBuffer(view) {
  if (view == null) return 'none';
  let bytes;
  if (ArrayBuffer.isView(view)) {
    bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  } else if (typeof view.length === 'number') {
    const packed = Float64Array.from(view);
    bytes = new Uint8Array(packed.buffer);
  } else {
    return 'none';
  }
  const n = bytes.length;
  let h0 = (0x811c9dc5 ^ n) >>> 0;
  let h1 = (0x811c9dc5 ^ Math.imul(n, 0x01000193)) >>> 0;
  let h2 = (0x811c9dc5 ^ 0x9e3779b9) >>> 0;
  let h3 = (0x811c9dc5 ^ 0x85ebca6b) >>> 0;
  const end = n & ~3;
  for (let i = 0; i < end; i += 4) {
    h0 = Math.imul(h0 ^ bytes[i], 0x01000193) >>> 0;
    h1 = Math.imul(h1 ^ bytes[i + 1], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ bytes[i + 2], 0x01000193) >>> 0;
    h3 = Math.imul(h3 ^ bytes[i + 3], 0x01000193) >>> 0;
  }
  for (let i = end; i < n; i += 1) {
    h0 = Math.imul(h0 ^ bytes[i], 0x01000193) >>> 0;
  }
  return `${n.toString(16)}:${h0.toString(16)}:${h1.toString(16)}:${h2.toString(16)}:${h3.toString(16)}`;
}
