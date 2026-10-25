import { aggregateAtomAdj, meshFrames, pairDihedral, vertexGrid } from './meshTopology.js';

/**
 * Edges plan PR 2 — Layer 1 patch segmentation (EDGES.md §3 / §5).
 *
 * Atoms = Manifold faceID connected components (over-split, never under-split).
 *
 * Merge rule (curvature class, not fixed dihedral alone — the tangent-junction
 * trap):
 *
 *   1. Coplanar flood — union atoms across dihedral ≤ PLANAR_DEG. Locals that
 *      are just one fillet facet stay tiny; true flat faces grow large.
 *   2. Lock large coplanar groups as flat (area ≥ FRAC × largest coplanar
 *      group). Curvature-class stand-in for κ≈0; survives coarse G1 junctions
 *      (roundedBox ~11°) that inflate mean-κ on perimeter tris. A group that
 *      continues into the same non-feature surface across a shallow edge
 *      (a loft wall flattening toward a rectangle) is not a flat: it stays
 *      unlocked so the curved pass keeps that wall one face.
 *   3. Curved flood — among non-locked atoms, merge across dihedral ≤ SMOOTH
 *      when κ rate agrees. Never merge a locked flat into a curved atom.
 *
 * Pure mesh math. Built lazily on the main thread when the patch-colour
 * debug overlay is requested (never on the worker serialize/postMessage
 * critical path — that caused iOS Safari OOM / black viewport in #88/#89).
 * Face pick reads one patch: the graph component for that face (flat or curved).
 * After the curved merge, triangles that still lie on a locked flat's plane
 * are pulled back onto that face, even when a fillet sits between them and
 * the face ids differ. Vertices within SEAM_VERTEX_MM count as touching, so
 * a duplicate-vertex seam on that plane is the same face. The curved blend
 * stays its own patch.
 * Edge propagation must NOT read patches yet.
 * No visibility BVH (PR 6).
 */

/** Soft cap: skip main-thread build above this triangle count (UI jank). */
export const PARTGRAPH_MAX_TRIANGLES = 250000;

/** Pass 1: dihedral at/below this merges as coplanar. */
export const PATCH_PLANAR_DEG = 0.5;
/**
 * Pass 3 fallback when a feature source has no tessellation on it.
 * A tagged source uses `sourceSmoothDeg` instead: its own facet step and
 * corner-blend join, scaled, clamped to [this floor, PATCH_SMOOTH_CAP_DEG].
 */
export const PATCH_SMOOTH_DEG = 15;
/** Curved gate never opens past this, so a real crease stays a crease. */
export const PATCH_SMOOTH_CAP_DEG = 50;
/** facet step and corner join are scaled by this before the clamp. */
export const PATCH_FACET_GATE_SCALE = 1.15;
/** Relative |κA−κB|/max(κA,κB) for curved↔curved. */
export const PATCH_CURVED_RATE_TOL = 0.55;
/** Dihedrals at/above this are ignored for the curved κ proxy. */
export const PATCH_K_FEATURE_DEG = 25;
/**
 * Coplanar group area ≥ this × median group area → locked flat.
 * Keeps blend shreds (tiny) unlocked so pass 3 can unite them.
 */
/** Coplanar group area ≥ this × the largest coplanar group → locked flat. */
export const PATCH_FLAT_AREA_FRAC_OF_MAX = 0.15;
/**
 * A locked coplanar group that meets the same non-feature surface across an
 * edge this shallow is the flat part of that surface, not a face of its own.
 * Measured on the 64-segment circle-to-rectangle loft: the wall's own
 * continuation is ≤ 3°, and the four sides still meet above that, but the
 * curved pass then walks the smooth end and the wall is one face. A real
 * flat stays locked: a box edge is ~90°, and the radius-change fixture meets
 * its bend at 6–14°. A fillet is another feature source, so it does not
 * unlock the face it sits on.
 */
export const PATCH_FLAT_CONTINUATION_DEG = 3;
/**
 * Closed prism loop: at least this many locked same-source groups, each with
 * exactly two run-neighbors, congruent within PATCH_FACET_AREA_RATIO, meeting
 * at one step that matches that source's facetDeg (or 360°/N). The loop must
 * fit a cylinder. A 64-segment pin is a loop at 5.6°; an open zigzag or fold
 * is a polyline and stays locked.
 */
/**
 * Slack on a smooth gate so a facet step that equals it still merges. A
 * 24-segment cylinder steps exactly 15°, the fallback gate, and float
 * noise put it on either side; without this it listed as 24 flat facets.
 */
export const PATCH_GATE_EPS_DEG = 0.05;
export const PATCH_FACET_RUN_MIN = 3;
export const PATCH_FACET_AREA_RATIO = 0.8;
export const PATCH_FACET_STEP_TOL_DEG = 0.5;
/**
 * Gate for one feature's curved faces, from the tessellation the worker
 * stored with that source. `facetDeg` is the circular step (360°/segments,
 * or 90°/segs of a right-angle fillet wedge — the same angle). `cornerDeg`
 * is the corner-blend join, measured on this mesh when the worker did not
 * already know it. Sources with neither fall back to PATCH_SMOOTH_DEG.
 * @param {number} facetDeg
 * @param {number} cornerDeg
 */
export function sourceSmoothDeg(facetDeg, cornerDeg) {
  const known = [Number(facetDeg), Number(cornerDeg)].filter((d) => Number.isFinite(d) && d > 0);
  if (!known.length) return PATCH_SMOOTH_DEG;
  const gate = Math.max(...known) * PATCH_FACET_GATE_SCALE;
  if (gate < PATCH_SMOOTH_DEG) return PATCH_SMOOTH_DEG;
  if (gate > PATCH_SMOOTH_CAP_DEG) return PATCH_SMOOTH_CAP_DEG;
  return gate;
}

function tessellationBySource(raw) {
  const map = new Map();
  if (!raw) return map;
  const list = Array.isArray(raw)
    ? raw
    : Object.entries(raw).map(([k, v]) => ({
      source: Number(k),
      facetDeg: v && v.facetDeg,
      cornerDeg: v && v.cornerDeg,
    }));
  for (const row of list) {
    if (!row) continue;
    const source = Number(row.source);
    if (!Number.isFinite(source)) continue;
    map.set(source, {
      facetDeg: Number(row.facetDeg) || 0,
      cornerDeg: Number(row.cornerDeg) || 0,
    });
  }
  return map;
}

/**
 * Corner-blend join for one source: the widest same-source curved dihedral
 * that is finer than the regular facet step. A crease coarser than the
 * tessellation (two fillets of different radius meeting at a cusp) is not
 * a corner blend and does not widen the gate.
 */
function measuredCornerJoin(adjA, adjB, adjMax, nAdj, atomSource, atomLockedFlat, source, facetDeg) {
  let corner = 0;
  const cap = facetDeg - 0.25;
  for (let i = 0; i < nAdj; i++) {
    const a = adjA[i];
    const b = adjB[i];
    if (atomLockedFlat[a] || atomLockedFlat[b]) continue;
    if (atomSource[a] !== source || atomSource[b] !== source) continue;
    const max = adjMax[i];
    if (!(max < cap) || !(max > corner)) continue;
    corner = max;
  }
  return corner;
}
/**
 * Op atoms (negative feature source) skip the κ test. Their dihedral gate
 * is the per-source value above, not a fixed angle. A chamfer corner is
 * about 60°, past the 50° cap, so those faces stay apart.
 */
export const PATCH_OP_SMOOTH_DEG = 40;
/** A triangle is on a flat's plane when its offset matches within this many mm. */
const PLANE_OFFSET_MM = 0.05;
/**
 * A fillet between two pieces of one plane leaves the mesh by about the
 * fillet radius. Triangles within this distance may be crossed so those
 * pieces become one face. On the shelled L the separate coplanar arms are
 * 16mm apart and stay separate at this distance.
 */
const PLANE_BRIDGE_MM = 8;
/**
 * A fillet boolean can leave two copies of a cap vertex about 0.001mm apart.
 * They do not share an index, so an edge walk stops. This is the gap that
 * still counts as the same face. It is far inside the 16mm arm split.
 */
const SEAM_VERTEX_MM = 0.02;

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function len(v) {
  return Math.hypot(v[0], v[1], v[2]);
}
function norm(v) {
  const L = len(v) || 1;
  return [v[0] / L, v[1] / L, v[2] / L];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
/**
 * Cylinder fit for one closed facet loop. Same gates as a joint axis fit:
 * radial normals, radius variance under 25% of the mean.
 */
function closedLoopFitsCylinder(positions, indices, tris) {
  if (!tris || tris.length < 4) return false;
  const normals = [];
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i1] - positions[i0];
    const ay = positions[i1 + 1] - positions[i0 + 1];
    const az = positions[i1 + 2] - positions[i0 + 2];
    const bx = positions[i2] - positions[i0];
    const by = positions[i2 + 1] - positions[i0 + 1];
    const bz = positions[i2 + 2] - positions[i0 + 2];
    const n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    if (len(n) > 1e-18) normals.push(norm(n));
  }
  if (normals.length < 4) return false;
  let axis = [0, 0, 0];
  const stepN = Math.max(1, Math.floor(normals.length / 3));
  for (let i = 0; i < normals.length; i++) {
    let c = cross(normals[i], normals[(i + stepN) % normals.length]);
    if (dot(c, axis) < 0) c = [-c[0], -c[1], -c[2]];
    axis = [axis[0] + c[0], axis[1] + c[1], axis[2] + c[2]];
  }
  const axisLen = len(axis);
  if (!(axisLen > 1e-12)) return false;
  axis = [axis[0] / axisLen, axis[1] / axisLen, axis[2] / axisLen];
  let align = 0;
  for (const n of normals) align += Math.abs(dot(n, axis));
  if (align / normals.length > 0.35) return false;
  const seen = new Set();
  const points = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const vi = indices[t * 3 + k];
      if (seen.has(vi)) continue;
      seen.add(vi);
      points.push([positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]]);
    }
  }
  if (points.length < 6) return false;
  const origin = [0, 0, 0];
  for (const p of points) {
    origin[0] += p[0];
    origin[1] += p[1];
    origin[2] += p[2];
  }
  origin[0] /= points.length;
  origin[1] /= points.length;
  origin[2] /= points.length;
  const radii = [];
  let radius = 0;
  for (const p of points) {
    const d = sub(p, origin);
    const along = dot(d, axis);
    const r = Math.hypot(d[0] - along * axis[0], d[1] - along * axis[1], d[2] - along * axis[2]);
    radii.push(r);
    radius += r;
  }
  radius /= radii.length;
  if (!(radius > 1e-6)) return false;
  let variance = 0;
  for (const r of radii) variance += (r - radius) ** 2;
  variance = Math.sqrt(variance / radii.length);
  return variance <= 0.25 * radius;
}

/**
 * Unlock only a closed prism loop. An open polyline of flats (corrugated
 * plate, N-bend fold) stays locked. A sphere or torus grid has more than
 * two run-neighbors per root, so it stays locked too.
 */
function unlockClosedPrismLoops({
  atomCount,
  adjA,
  adjB,
  adjMax,
  nAdj,
  atomLockedFlat,
  atomSource,
  atomOff,
  atomList,
  isOpAtom,
  patchUF,
  rootArea,
  tessBySource,
  smoothDeg,
  positions,
  indices,
}) {
  const nbs = new Map();
  const addEdge = (a, b, step) => {
    let row = nbs.get(a);
    if (!row) nbs.set(a, (row = new Map()));
    row.set(b, step);
  };
  for (let i = 0; i < nAdj; i++) {
    const max = adjMax[i];
    if (max <= PATCH_FLAT_CONTINUATION_DEG || max > smoothDeg + PATCH_GATE_EPS_DEG) continue;
    const a = adjA[i];
    const b = adjB[i];
    if (!atomLockedFlat[a] || !atomLockedFlat[b]) continue;
    if (atomSource[a] !== atomSource[b]) continue;
    if (isOpAtom(a) || isOpAtom(b)) continue;
    const ra = patchUF.find(a);
    const rb = patchUF.find(b);
    if (ra === rb) continue;
    const small = Math.min(rootArea[ra], rootArea[rb]);
    const large = Math.max(rootArea[ra], rootArea[rb]);
    if (!(small >= large * PATCH_FACET_AREA_RATIO)) continue;
    addEdge(ra, rb, max);
    addEdge(rb, ra, max);
  }
  const seen = new Set();
  const unlock = new Set();
  for (const start of nbs.keys()) {
    if (seen.has(start)) continue;
    const roots = [];
    const stack = [start];
    seen.add(start);
    let cyclic = true;
    while (stack.length) {
      const r = stack.pop();
      roots.push(r);
      const row = nbs.get(r);
      if (!row || row.size !== 2) cyclic = false;
      if (!row) continue;
      for (const other of row.keys()) {
        if (seen.has(other)) continue;
        seen.add(other);
        stack.push(other);
      }
    }
    if (!cyclic || roots.length < PATCH_FACET_RUN_MIN) continue;
    const inLoop = new Set(roots);
    const steps = [];
    for (const r of roots) {
      for (const step of nbs.get(r).values()) steps.push(step);
    }
    const lo = Math.min(...steps);
    const hi = Math.max(...steps);
    if (hi - lo > Math.max(PATCH_FACET_STEP_TOL_DEG, hi * 0.1)) continue;
    const mean = steps.reduce((sum, v) => sum + v, 0) / steps.length;
    let source = 0;
    const tris = [];
    for (let a = 0; a < atomCount; a++) {
      if (!inLoop.has(patchUF.find(a))) continue;
      source = atomSource[a];
      for (let k = atomOff[a]; k < atomOff[a + 1]; k++) tris.push(atomList[k]);
    }
    const tagged = tessBySource.get(source)?.facetDeg;
    const expected = tagged > 0 ? tagged : 360 / roots.length;
    const tol = Math.max(PATCH_FACET_STEP_TOL_DEG, expected * 0.1);
    if (Math.abs(mean - expected) > tol) continue;
    if (!closedLoopFitsCylinder(positions, indices, tris)) continue;
    for (const r of roots) unlock.add(r);
  }
  if (!unlock.size) return;
  for (let a = 0; a < atomCount; a++) {
    if (unlock.has(patchUF.find(a))) atomLockedFlat[a] = 0;
  }
}

/**
 * Directed seam links. A link t → nb is the old spatial-hash hit: both
 * triangles have area, they share a body, their normals are within the
 * planar gate, and nb's centroid sits on t's plane. Vertices within
 * SEAM_VERTEX_MM count, including a shared index (distance 0). The claim
 * set does not depend on link order.
 */
function seamAdjacency(frames, sameBody) {
  const {
    positions, indices, stride, numTri, nVert,
    nx, ny, nz, area, cx, cy, cz, vOff, vTris,
  } = frames;
  const used = new Uint8Array(nVert);
  for (let t = 0; t < numTri; t++) {
    if (area[t] < 1e-8) continue;
    used[indices[t * 3]] = 1;
    used[indices[t * 3 + 1]] = 1;
    used[indices[t * 3 + 2]] = 1;
  }
  const grid = vertexGrid(positions, used, stride, SEAM_VERTEX_MM);
  const aliasOf = new Array(nVert);
  const aliases = (v) => {
    const hit = aliasOf[v];
    if (hit) return hit;
    const list = [];
    grid.nearby(v, (u) => list.push(u));
    aliasOf[v] = list;
    return list;
  };
  const cosSeam = Math.cos((PATCH_PLANAR_DEG * Math.PI) / 180);
  const seenStamp = new Int32Array(numTri);
  let stamp = 1;
  const touch = (t, emit) => {
    if (area[t] < 1e-8) return;
    if (++stamp === 0x7fffffff) {
      seenStamp.fill(0);
      stamp = 1;
    }
    const nxx = nx[t];
    const nyy = ny[t];
    const nzz = nz[t];
    const off = cx[t] * nxx + cy[t] * nyy + cz[t] * nzz;
    const consider = (nb) => {
      if (nb === t || seenStamp[nb] === stamp) return;
      seenStamp[nb] = stamp;
      if (area[nb] < 1e-8 || !sameBody(t, nb)) return;
      const nd = nxx * nx[nb] + nyy * ny[nb] + nzz * nz[nb];
      if (nd < cosSeam) return;
      const offO = cx[nb] * nxx + cy[nb] * nyy + cz[nb] * nzz;
      if (Math.abs(offO - off) > PLANE_OFFSET_MM) return;
      emit(nb);
    };
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      for (let q = vOff[v]; q < vOff[v + 1]; q++) consider(vTris[q]);
      const near = aliases(v);
      for (let a = 0; a < near.length; a++) {
        const u = near[a];
        for (let r = vOff[u]; r < vOff[u + 1]; r++) consider(vTris[r]);
      }
    }
  };
  return { touch };
}

function makeUF(n) {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    let x = i;
    while (x !== r) {
      const nxt = parent[x];
      parent[x] = r;
      x = nxt;
    }
    return r;
  };
  const unite = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };
  return { find, unite };
}

/**
 * @param {{
 *   positions: ArrayLike<number>,
 *   indices: ArrayLike<number>,
 *   faceIDs: ArrayLike<number>|null|undefined,
 * }} mesh
 * @param {object} [opts]
 */
export function buildPartGraphPatches(mesh, opts = {}) {
  const positions = mesh?.positions;
  const indices = mesh?.indices;
  const faceIDs = mesh?.faceIDs;
  // Feature source per triangle (Manifold run: fillet op or originalID).
  const triSource = mesh?.triSource && mesh.triSource.length >= Math.floor((mesh?.indices?.length || 0) / 3)
    ? mesh.triSource
    : null;
  const sameSource = (t0, t1) => !triSource || triSource[t0] === triSource[t1];
  const tessBySource = tessellationBySource(mesh?.featureTessellation);
  const planarDeg = opts.planarDeg ?? PATCH_PLANAR_DEG;
  const smoothDeg = opts.smoothDeg ?? PATCH_SMOOTH_DEG;
  const curvedRateTol = opts.curvedRateTol ?? PATCH_CURVED_RATE_TOL;
  const kFeatureDeg = opts.kFeatureDeg ?? PATCH_K_FEATURE_DEG;
  const flatAreaFracOfMax = opts.flatAreaFracOfMax ?? PATCH_FLAT_AREA_FRAC_OF_MAX;

  if (!positions || !indices) return emptyResult();
  const numTri = Math.floor(indices.length / 3);
  if (numTri < 1) return emptyResult();

  const frames = meshFrames(positions, indices, 3);
  const triNx = frames.nx;
  const triNy = frames.ny;
  const triNz = frames.nz;
  const triArea = frames.area;
  const triCx = frames.cx;
  const triCy = frames.cy;
  const triCz = frames.cz;
  const { pairN, pairTri0, pairTri1, bodyOf, multiBody } = frames;
  const pairDeg = pairDihedral(frames);
  const sameBody = (t0, t1) => !multiBody || bodyOf[t0] === bodyOf[t1];

  const rawFid = new Int32Array(numTri);
  for (let t = 0; t < numTri; t++) {
    rawFid[t] = faceIDs && faceIDs.length > t ? Number(faceIDs[t]) | 0 : t;
  }

  // --- Atoms: faceID connected components ---------------------------------
  // Face ids restart per source mesh, so equal ids from two features are not one face.
  let needsMerge = false;
  for (let i = 0; i < pairN; i++) {
    const t0 = pairTri0[i];
    const t1 = pairTri1[i];
    if (!sameBody(t0, t1)) continue;
    if (rawFid[t0] === rawFid[t1] && sameSource(t0, t1)) {
      needsMerge = true;
      break;
    }
  }
  let triAtom = null;
  let atomCount = numTri;
  if (needsMerge) {
    const atomUF = makeUF(numTri);
    for (let i = 0; i < pairN; i++) {
      const t0 = pairTri0[i];
      const t1 = pairTri1[i];
      if (!sameBody(t0, t1)) continue;
      if (rawFid[t0] === rawFid[t1] && sameSource(t0, t1)) atomUF.unite(t0, t1);
    }
    const atomRootToIdx = new Map();
    triAtom = new Int32Array(numTri);
    atomCount = 0;
    for (let t = 0; t < numTri; t++) {
      const r = atomUF.find(t);
      let ai = atomRootToIdx.get(r);
      if (ai == null) {
        ai = atomCount++;
        atomRootToIdx.set(r, ai);
      }
      triAtom[t] = ai;
    }
  }
  const atomOf = (t) => (triAtom ? triAtom[t] : t);

  const atomTriCount = new Uint32Array(atomCount);
  for (let t = 0; t < numTri; t++) atomTriCount[atomOf(t)]++;
  const atomOff = new Uint32Array(atomCount + 1);
  for (let a = 0; a < atomCount; a++) atomOff[a + 1] = atomOff[a] + atomTriCount[a];
  const atomCursor = new Uint32Array(atomCount);
  for (let a = 0; a < atomCount; a++) atomCursor[a] = atomOff[a];
  const atomList = new Uint32Array(numTri);
  for (let t = 0; t < numTri; t++) {
    const a = atomOf(t);
    atomList[atomCursor[a]++] = t;
  }

  const atomArea = new Float64Array(atomCount);
  for (let a = 0; a < atomCount; a++) {
    let area = 0;
    for (let k = atomOff[a]; k < atomOff[a + 1]; k++) area += triArea[atomList[k]];
    atomArea[a] = area;
  }

  const adj = aggregateAtomAdj(frames, pairDeg, triAtom, sameBody);
  const { n: adjN, adjA, adjB, adjSum, adjMax, adjCount } = {
    n: adj.n,
    adjA: adj.adjA,
    adjB: adj.adjB,
    adjSum: adj.adjSum,
    adjMax: adj.adjMax,
    adjCount: adj.adjN,
  };

  // --- Pass 1: coplanar flood --------------------------------------------
  const patchUF = makeUF(atomCount);
  for (let i = 0; i < adjN; i++) {
    if (adjMax[i] <= planarDeg) patchUF.unite(adjA[i], adjB[i]);
  }

  // Area per coplanar component (rooted).
  const rootArea = new Float64Array(atomCount);
  for (let a = 0; a < atomCount; a++) rootArea[patchUF.find(a)] += atomArea[a];
  // Op-sourced area (a fillet strip, a chamfer face) never earns the flat
  // lock: a wide fillet strip can pass the area gate and then the curved
  // pass skips it. Coplanar op scraps on a real face still ride its lock.
  const atomSource = new Int32Array(atomCount);
  if (triSource) {
    for (let a = 0; a < atomCount; a++) atomSource[a] = triSource[atomList[atomOff[a]]];
  }
  const isOpAtom = (a) => !!triSource && atomSource[a] < 0;
  const rootLockArea = new Float64Array(atomCount);
  for (let a = 0; a < atomCount; a++) {
    if (!isOpAtom(a)) rootLockArea[patchUF.find(a)] += atomArea[a];
  }

  let maxRootArea = 0;
  for (let a = 0; a < atomCount; a++) {
    if (patchUF.find(a) !== a) continue;
    if (rootArea[a] > maxRootArea) maxRootArea = rootArea[a];
  }
  // Fraction of the largest coplanar group — flats on roundedBox are hundreds
  // of units; cylinder/sphere shreds stay ~30–70 and must remain unlocked so
  // the curved pass can unite them. Median×factor wrongly locked those shreds.
  const flatAreaGate = Math.max(maxRootArea * flatAreaFracOfMax, 1e-6);

  // Also lock islands that only meet the mesh across sharp creases (box face
  // with unique faceID, no coplanar partner) — they are flats even if small.
  const atomLockedFlat = new Uint8Array(atomCount);
  for (let a = 0; a < atomCount; a++) {
    const r = patchUF.find(a);
    if (rootLockArea[r] >= flatAreaGate) atomLockedFlat[a] = 1;
  }
  // A tagged feature's own facet can be one big quad (8 segments around a
  // rounded box) and trip the area lock. That quad meets the next facet at
  // the recorded step. A real flat meets the fillet at about half that step
  // and stays locked, so the area rule itself is unchanged.
  if (tessBySource.size) {
    const facetTouch = new Uint8Array(atomCount);
    for (let i = 0; i < adjN; i++) {
      const a = adjA[i];
      const b = adjB[i];
      if (atomSource[a] !== atomSource[b]) continue;
      const info = tessBySource.get(atomSource[a]);
      const step = info && info.facetDeg;
      if (!(step > 0)) continue;
      const tol = Math.max(1.5, step * 0.12);
      if (Math.abs(adjMax[i] - step) > tol) continue;
      facetTouch[patchUF.find(a)] = 1;
      facetTouch[patchUF.find(b)] = 1;
    }
    for (let a = 0; a < atomCount; a++) {
      if (facetTouch[patchUF.find(a)]) atomLockedFlat[a] = 0;
    }
  }
  // A loft wall's flatter side is large enough to lock, and the lock then
  // stops the curved pass. The triangles just outside it are the same wall
  // (shared edge ≤ PATCH_FLAT_CONTINUATION_DEG, same source, not a fillet).
  // Unlock that group. This needs triSource: without it a fillet reads as
  // the same surface and the G1 join would unlock the flat it sits on.
  // A box face has no such neighbour, so it stays locked.
  if (triSource) {
    const continuation = new Uint8Array(atomCount);
    for (let i = 0; i < adjN; i++) {
      if (adjMax[i] > PATCH_FLAT_CONTINUATION_DEG) continue;
      const a = adjA[i];
      const b = adjB[i];
      if (atomSource[a] !== atomSource[b]) continue;
      if (isOpAtom(a) || isOpAtom(b)) continue;
      if (patchUF.find(a) === patchUF.find(b)) continue;
      if (atomLockedFlat[a] && !atomLockedFlat[b]) continuation[patchUF.find(a)] = 1;
      if (atomLockedFlat[b] && !atomLockedFlat[a]) continuation[patchUF.find(b)] = 1;
    }
    for (let a = 0; a < atomCount; a++) {
      if (continuation[patchUF.find(a)]) atomLockedFlat[a] = 0;
    }
  }
  // A tall, thin prism wall (a pin from Manifold.cylinder) has side facets
  // larger than the area gate, so each facet locked and one click picked a
  // single facet. Unlock only a CLOSED loop of those facets: every root has
  // two run-neighbors, the step matches that source's facetDeg (or 360°/N),
  // and the loop fits a cylinder. An open polyline of flats stays locked.
  if (triSource) {
    unlockClosedPrismLoops({
      atomCount,
      adjA,
      adjB,
      adjMax,
      nAdj: adjN,
      atomLockedFlat,
      atomSource,
      atomOff,
      atomList,
      isOpAtom,
      patchUF,
      rootArea,
      tessBySource,
      smoothDeg,
      positions,
      indices,
    });
  }
  // Sharp-only islands (every neighbour dihedral > smoothDeg) used to be
  // locked flat here so a lone box faceID stayed planar. That also froze
  // roundedBox sphere-corner shreds whose facet turns sit at 18–22°, so
  // they never joined their blend. Cube faces already coplanar-merge in
  // pass 1; leftover sharp islands stay singleton patches — fine.

  // κ for unlocked (curved-candidate) atoms: mean smooth dihedral to other
  // unlocked atoms. Locked flats do not inflate the proxy.
  // Neighbor lists keep atomAdj insertion order, so the mean matches the
  // old scan of every record (Manifold's per-triangle faceID makes one atom
  // per triangle, and that scan was quadratic in the fillet).
  const kTouch = new Uint32Array(atomCount);
  for (let i = 0; i < adjN; i++) {
    kTouch[adjA[i]]++;
    if (adjB[i] !== adjA[i]) kTouch[adjB[i]]++;
  }
  const kOff = new Uint32Array(atomCount + 1);
  for (let a = 0; a < atomCount; a++) kOff[a + 1] = kOff[a] + kTouch[a];
  const kCursor = new Uint32Array(kOff);
  const kIdx = new Uint32Array(kOff[atomCount]);
  for (let i = 0; i < adjN; i++) {
    kIdx[kCursor[adjA[i]]++] = i;
    if (adjB[i] !== adjA[i]) kIdx[kCursor[adjB[i]]++] = i;
  }
  const atomK = new Float64Array(atomCount);
  for (let a = 0; a < atomCount; a++) {
    if (atomLockedFlat[a]) {
      atomK[a] = 0;
      continue;
    }
    // Only this atom's own feature source rates it, and only across a real
    // step. A tube wall that other bodies are unioned into is re-cut along
    // the junctions: a facet becomes two coplanar atoms, and the 0° record
    // between them halved that facet's rate, so the wall split into
    // fragments at every junction. The other body's facets meet the wall
    // at shallow angles there too; those steps are its curvature, not ours.
    // Neighbor lists stay in adjacency-record order, so the mean matches
    // the old scan.
    const rates = (i, other) => !atomLockedFlat[other]
      && adjMax[i] > planarDeg
      && adjMax[i] < kFeatureDeg
      && !(triSource && atomSource[other] !== atomSource[a]);
    let sum = 0;
    let n = 0;
    for (let q = kOff[a]; q < kOff[a + 1]; q++) {
      const i = kIdx[q];
      const other = adjA[i] === a ? adjB[i] : adjA[i];
      if (!rates(i, other)) continue;
      sum += adjSum[i] / adjCount[i];
      n++;
    }
    // Fall back to any smooth boundary (incl. to flats) so isolated shreds
    // still get a rate signal relative to their blend neighbours.
    if (n === 0) {
      for (let q = kOff[a]; q < kOff[a + 1]; q++) {
        const i = kIdx[q];
        const other = adjA[i] === a ? adjB[i] : adjA[i];
        if (adjMax[i] <= planarDeg || adjMax[i] >= kFeatureDeg) continue;
        if (triSource && atomSource[other] !== atomSource[a]) continue;
        sum += adjSum[i] / adjCount[i];
        n++;
      }
    }
    atomK[a] = n > 0 ? sum / n : 0;
  }

  // --- Pass 3: curvature-consistent merge among non-flats ----------------
  // The dihedral gate is that source's own tessellation. Inside one op the
  // κ test stays off, so a coarse fillet strip is still one face.
  // A later fillet call cuts the previous fillet into strips that no longer
  // share an edge with each other. Those strips meet the new fillet at a
  // couple of degrees. The walk crosses that seam only when both sides are
  // fillet ops and the angle clears both gates. A loft, a flat, a hole, and
  // a chamfer have no fillet step, so the wall stays.
  const gateBySource = new Map();
  const gateFor = (source) => {
    const hit = gateBySource.get(source);
    if (hit != null) return hit;
    const info = tessBySource.get(source);
    let gate = smoothDeg;
    if (info && (info.facetDeg > 0 || info.cornerDeg > 0)) {
      const measured = info.facetDeg > 0
        ? measuredCornerJoin(adjA, adjB, adjMax, adjN, atomSource, atomLockedFlat, source, info.facetDeg)
        : 0;
      gate = sourceSmoothDeg(info.facetDeg, Math.max(info.cornerDeg, measured));
    }
    gateBySource.set(source, gate);
    return gate;
  };
  const filletOpSource = (source) => {
    if (!triSource || !(source < 0)) return false;
    const info = tessBySource.get(source);
    return !!(info && info.facetDeg > 0);
  };
  for (let i = 0; i < adjN; i++) {
    const a = adjA[i];
    const b = adjB[i];
    if (atomLockedFlat[a] || atomLockedFlat[b]) continue;
    if (atomSource[a] !== atomSource[b]) {
      if (!filletOpSource(atomSource[a]) || !filletOpSource(atomSource[b])) continue;
      const crossGate = Math.min(gateFor(atomSource[a]), gateFor(atomSource[b]));
      if (adjMax[i] > crossGate + PATCH_GATE_EPS_DEG) continue;
      patchUF.unite(a, b);
      continue;
    }
    const gate = gateFor(atomSource[a]);
    if (adjMax[i] > gate + PATCH_GATE_EPS_DEG) continue;
    // A tagged tessellation is one feature's own facets. κ stays off there,
    // as it does for a fillet op, so a coarse step is not read as a radius change.
    // Untagged curves still split when the κ rate exceeds the tolerance.
    if (isOpAtom(a) || tessBySource.has(atomSource[a])) {
      patchUF.unite(a, b);
      continue;
    }
    const ka = atomK[a];
    const kb = atomK[b];
    if (ka > 1e-6 || kb > 1e-6) {
      const denom = Math.max(ka, kb, 1e-6);
      if (Math.abs(ka - kb) / denom > curvedRateTol) continue;
    }
    patchUF.unite(a, b);
  }

  // --- Emit --------------------------------------------------------------
  const rootToPid = new Map();
  const atomPatch = new Int32Array(atomCount);
  let patchCount = 0;
  for (let a = 0; a < atomCount; a++) {
    const r = patchUF.find(a);
    let pid = rootToPid.get(r);
    if (pid == null) {
      pid = patchCount++;
      rootToPid.set(r, pid);
    }
    atomPatch[a] = pid;
  }

  const patchTris = Array.from({ length: patchCount }, () => []);
  const patchAtomCount = new Int32Array(patchCount);
  const patchLocked = new Uint8Array(patchCount);
  for (let a = 0; a < atomCount; a++) {
    const pid = atomPatch[a];
    patchAtomCount[pid]++;
    if (atomLockedFlat[a]) patchLocked[pid] = 1;
    for (let k = atomOff[a]; k < atomOff[a + 1]; k++) patchTris[pid].push(atomList[k]);
  }

  const triPatch = new Int32Array(numTri);
  const patches = [];
  const cosPlanarKind = Math.cos((planarDeg * Math.PI) / 180);
  for (let pid = 0; pid < patchCount; pid++) {
    const tris = patchTris[pid];
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let area = 0;
    let kSum = 0;
    let kSumSq = 0;
    let kArea = 0;
    const seenAtom = new Set();
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      triPatch[t] = pid;
      const ar = triArea[t];
      nx += triNx[t] * ar;
      ny += triNy[t] * ar;
      nz += triNz[t] * ar;
      cx += triCx[t] * ar;
      cy += triCy[t] * ar;
      cz += triCz[t] * ar;
      area += ar;
      const a = atomOf(t);
      if (!seenAtom.has(a)) {
        seenAtom.add(a);
        kSum += atomK[a] * atomArea[a];
        kSumSq += atomK[a] * atomK[a] * atomArea[a];
        kArea += atomArea[a];
      }
    }
    const meanK = kArea > 1e-18 ? kSum / kArea : 0;
    const meanK2 = kArea > 1e-18 ? kSumSq / kArea : 0;
    const variance = Math.max(0, meanK2 - meanK * meanK);
    const nrm = norm([nx, ny, nz]);
    const center =
      area > 1e-18 ? [cx / area, cy / area, cz / area] : [0, 0, 0];
    // Planar when every triangle normal sits within the coplanar gate of
    // the patch normal. The curvature proxy is not used for this: a flat
    // annulus on a tilted tube far from the origin carries float noise of
    // ~1e-4° between its triangles, which read as curvature once it was
    // too small for the flat lock next to a large ring.
    let minDot = 1;
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      const nd = triNx[t] * nrm[0] + triNy[t] * nrm[1] + triNz[t] * nrm[2];
      minDot = Math.min(minDot, nd);
    }
    const flat = minDot >= cosPlanarKind && meanK < planarDeg;
    let kind = 'general';
    if (patchLocked[pid] || flat) kind = 'planar';
    else if (variance < (meanK * 0.4) ** 2 + 0.5) kind = 'blend';
    patches.push({
      id: pid,
      tris,
      normal: nrm,
      center,
      area,
      kind,
      curvature: { mean: meanK, variance },
      atomCount: patchAtomCount[pid],
      faceIds: [],
    });
  }
  const planarOrder = patches
    .filter((p) => p.kind === 'planar' && p.tris.length)
    .sort((a, b) => b.area - a.area);
  let planarCover = 0;
  for (let i = 0; i < planarOrder.length; i++) planarCover += planarOrder[i].tris.length;
  // One planar patch that already owns every triangle has nothing to claim.
  // Two flats still run: the larger one can pull the smaller one across a blend.
  const runBridge = planarOrder.length > 1 || (planarOrder.length === 1 && planarCover < numTri);

  // A fillet can leave the rest of a cap on the same plane, past the blend,
  // still wearing the other body's face id. Pass 1 stops at the blend, and
  // pass 3 then swallows the smaller piece. Cross triangles that stay near
  // the plane and pull the on-plane ones back onto the larger flat. Curved
  // triangles are crossed, not collected. A coplanar wall whose path leaves
  // the plane stays its own face.
  if (runBridge) {
    const cosPlanar = Math.cos((planarDeg * Math.PI) / 180);
    const planeOffset = (patch) => patch.center[0] * patch.normal[0]
      + patch.center[1] * patch.normal[1]
      + patch.center[2] * patch.normal[2];
    const onPlane = (t, patch, offP) => {
      if (triArea[t] < 1e-8) return false;
      const nd = triNx[t] * patch.normal[0] + triNy[t] * patch.normal[1] + triNz[t] * patch.normal[2];
      if (nd < cosPlanar) return false;
      const offT = triCx[t] * patch.normal[0] + triCy[t] * patch.normal[1] + triCz[t] * patch.normal[2];
      return Math.abs(offP - offT) <= PLANE_OFFSET_MM;
    };
    const bridgeOff = (t, normal, offP) => {
      let max = 0;
      for (let k = 0; k < 3; k++) {
        const i = indices[t * 3 + k];
        const d = positions[i * 3] * normal[0]
          + positions[i * 3 + 1] * normal[1]
          + positions[i * 3 + 2] * normal[2];
        const off = Math.abs(d - offP);
        if (off > max) max = off;
      }
      return max;
    };
    // Triangles that can be claimed by a plane sit in a tight normal/offset
    // bin (onPlane is 0.5° and 0.05 mm). The bridge flood is the same no-op
    // when that bin has nothing claimable, which is the common case for a
    // fillet facet. Bins are a superset: cell size is coarser than the test,
    // and the search covers every adjacent cell, so a real on-plane triangle
    // is never missed. The flood and the seam walk still run when any
    // candidate passes the exact test.
    const NBIN = 0.02;
    const OBIN = 0.05;
    const packBin = (ix, iy, iz, io) => (
      (((ix + 80) * 160 + (iy + 80)) * 160 + (iz + 80)) * 400001 + (io + 200000)
    );
    let binCap = 1;
    while (binCap < numTri * 2) binCap *= 2;
    const binMask = binCap - 1;
    const binOcc = new Uint8Array(binCap);
    const binKey = new Float64Array(binCap);
    const binHead = new Int32Array(binCap);
    binHead.fill(-1);
    const binNext = new Int32Array(numTri);
    const mixBin = (key) => {
      let x = Math.imul(key | 0, 0x9E3779B1) ^ Math.imul(Math.floor(key / 4294967296), 0x85EBCA77);
      x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
      x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
      return (x ^ (x >>> 16)) >>> 0;
    };
    const binSlot = (key) => {
      let h = mixBin(key) & binMask;
      while (binOcc[h] && binKey[h] !== key) h = (h + 1) & binMask;
      return h;
    };
    for (let t = 0; t < numTri; t++) {
      if (triArea[t] < 1e-8) continue;
      const key = packBin(
        Math.floor(triNx[t] / NBIN),
        Math.floor(triNy[t] / NBIN),
        Math.floor(triNz[t] / NBIN),
        Math.floor((triCx[t] * triNx[t] + triCy[t] * triNy[t] + triCz[t] * triNz[t]) / OBIN),
      );
      const h = binSlot(key);
      if (!binOcc[h]) {
        binOcc[h] = 1;
        binKey[h] = key;
      }
      binNext[t] = binHead[h];
      binHead[h] = t;
    }
    const claimableNow = (p, offP) => {
      const pn = p.normal;
      const pix = Math.floor(pn[0] / NBIN);
      const piy = Math.floor(pn[1] / NBIN);
      const piz = Math.floor(pn[2] / NBIN);
      const pio = Math.floor(offP / OBIN);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (let dOff = -2; dOff <= 2; dOff++) {
              const key = packBin(pix + dx, piy + dy, piz + dz, pio + dOff);
              const h = binSlot(key);
              if (!binOcc[h]) continue;
              for (let nb = binHead[h]; nb >= 0; nb = binNext[nb]) {
                if (!onPlane(nb, p, offP) || triPatch[nb] === p.id) continue;
                const owner = patches[triPatch[nb]];
                if (owner && owner.kind === 'planar' && owner.area > p.area) continue;
                return true;
              }
            }
          }
        }
      }
      return false;
    };
    let anyClaim = false;
    const offAt = new Float64Array(planarOrder.length);
    for (let i = 0; i < planarOrder.length; i++) {
      offAt[i] = planeOffset(planarOrder[i]);
      if (!anyClaim && claimableNow(planarOrder[i], offAt[i])) anyClaim = true;
    }
    if (anyClaim) {
      const nCount = new Uint32Array(numTri);
      for (let i = 0; i < pairN; i++) {
        const t0 = pairTri0[i];
        const t1 = pairTri1[i];
        if (!sameBody(t0, t1)) continue;
        nCount[t0]++;
        nCount[t1]++;
      }
      const nOff = new Uint32Array(numTri + 1);
      for (let t = 0; t < numTri; t++) nOff[t + 1] = nOff[t] + nCount[t];
      const nCursor = new Uint32Array(nOff);
      const nIdx = new Uint32Array(nOff[numTri]);
      for (let i = 0; i < pairN; i++) {
        const t0 = pairTri0[i];
        const t1 = pairTri1[i];
        if (!sameBody(t0, t1)) continue;
        nIdx[nCursor[t0]++] = t1;
        nIdx[nCursor[t1]++] = t0;
      }
      // Duplicate vertices across a fillet seam are not an edge. Record coplanar
      // same-body triangles whose vertices are within SEAM_VERTEX_MM. The walk
      // below claims across that gap and then stays on the plane. It does not
      // enter the blend, so coplanar arms whose path leaves the plane stay apart.
      const seam = seamAdjacency(frames, sameBody);
      // One stamp for every planar patch. A fresh Uint8Array per patch was a
      // large allocation on a filleted solid (hundreds of flats).
      const bridgeSeen = new Int32Array(numTri);
      let bridgeGen = 1;
      for (let pi = 0; pi < planarOrder.length; pi++) {
        const p = planarOrder[pi];
        const offP = offAt[pi];
        const seed = p.tris.filter((t) => triPatch[t] === p.id);
        if (!seed.length || !claimableNow(p, offP)) continue;
        const stack = seed.slice();
        // Triangles that belong to this patch after the bridge walk. Starts as
        // the seed (every triangle still labelled p, since each triangle begins
        // in exactly one patch) and grows when the walk claims one. Avoids a
        // scan of the whole mesh once per planar patch.
        const members = seed.slice();
        if (++bridgeGen === 0x7fffffff) {
          bridgeSeen.fill(0);
          bridgeGen = 1;
        }
        const gen = bridgeGen;
        for (let i = 0; i < stack.length; i++) bridgeSeen[stack[i]] = gen;
        while (stack.length) {
          const t = stack.pop();
          for (let i = nOff[t]; i < nOff[t + 1]; i++) {
            const nb = nIdx[i];
            if (bridgeSeen[nb] === gen) continue;
            bridgeSeen[nb] = gen;
            if (bridgeOff(nb, p.normal, offP) > PLANE_BRIDGE_MM) continue;
            stack.push(nb);
            if (!onPlane(nb, p, offP) || triPatch[nb] === p.id) continue;
            const owner = patches[triPatch[nb]];
            if (owner && owner.kind === 'planar' && owner.area > p.area) continue;
            triPatch[nb] = p.id;
            members.push(nb);
          }
        }
        // The needle between two copies of a cap vertex is not an edge, and it
        // is dropped from the draw. Step across that gap, then keep walking
        // only on this plane so the rest of the cap comes along. A blend
        // triangle fails onPlane, so this does not reach a coplanar arm whose
        // path leaves the plane.
        const seamStack = [];
        const seamSeen = new Uint8Array(numTri);
        for (let i = 0; i < members.length; i++) {
          const t = members[i];
          if (triPatch[t] !== p.id) continue;
          seamSeen[t] = 1;
          seamStack.push(t);
        }
        const claimOnPlane = (nb) => {
          if (seamSeen[nb] || !onPlane(nb, p, offP)) return;
          const owner = patches[triPatch[nb]];
          if (triPatch[nb] !== p.id && owner && owner.kind === 'planar' && owner.area > p.area) return;
          seamSeen[nb] = 1;
          triPatch[nb] = p.id;
          seamStack.push(nb);
        };
        while (seamStack.length) {
          const t = seamStack.pop();
          seam.touch(t, claimOnPlane);
          for (let i = nOff[t]; i < nOff[t + 1]; i++) claimOnPlane(nIdx[i]);
        }
      }
    }
  }
  for (const p of patches) p.tris = [];
  for (let t = 0; t < numTri; t++) patches[triPatch[t]].tris.push(t);
  for (const p of patches) {
    let area = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    const fids = new Set();
    for (let i = 0; i < p.tris.length; i++) {
      const t = p.tris[i];
      const ar = triArea[t];
      area += ar;
      cx += triCx[t] * ar;
      cy += triCy[t] * ar;
      cz += triCz[t] * ar;
      fids.add(rawFid[t]);
    }
    p.area = area;
    if (area > 1e-18) p.center = [cx / area, cy / area, cz / area];
    p.faceIds = [...fids].sort((a, b) => a - b);
  }
  const remap = new Int32Array(patches.length);
  let kept = 0;
  for (let i = 0; i < patches.length; i++) {
    if (!patches[i].tris.length) {
      remap[i] = -1;
      continue;
    }
    remap[i] = kept;
    patches[i].id = kept;
    patches[kept] = patches[i];
    kept++;
  }
  patches.length = kept;
  for (let t = 0; t < numTri; t++) triPatch[t] = remap[triPatch[t]];
  patchCount = kept;


  let hash = numTri * 2654435761;
  hash = (hash ^ (atomCount * 97531)) >>> 0;
  hash = (hash ^ (patchCount * 50311)) >>> 0;
  if (faceIDs && faceIDs.length) {
    hash = (hash ^ (Number(faceIDs[0]) | 0)) >>> 0;
    hash = (hash ^ (Number(faceIDs[numTri - 1]) | 0)) >>> 0;
  }
  const nVert = Math.floor(positions.length / 3);
  hash = (hash ^ nVert) >>> 0;

  return {
    patches,
    triPatch,
    atomCount,
    version: `pg-${nVert}-${numTri}-${patchCount}-${hash.toString(16)}`,
  };
}

function emptyResult() {
  return {
    patches: [],
    triPatch: new Int32Array(0),
    atomCount: 0,
    version: 'pg-empty',
  };
}

export function patchDebugColor(patchId) {
  const id = Number(patchId) | 0;
  const hue = ((id * 0.618033988749895) % 1 + 1) % 1;
  const sat = 0.72 + (0.2 * ((id * 3) % 5)) / 4;
  const val = 0.78 + (0.18 * ((id * 5) % 3)) / 2;
  return hsvToRgb(hue, sat, val);
}

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r;
  let g;
  let b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return [r, g, b];
}

export function buildPatchOverlayArrays(mesh, triPatch) {
  const positions = mesh.positions;
  const indices = mesh.indices;
  const numTri = Math.floor(indices.length / 3);
  const outPos = new Float32Array(numTri * 9);
  const outCol = new Float32Array(numTri * 9);
  for (let t = 0; t < numTri; t++) {
    const pid = triPatch[t] ?? 0;
    const [cr, cg, cb] = patchDebugColor(pid);
    for (let k = 0; k < 3; k++) {
      const vi = indices[t * 3 + k];
      const o = t * 9 + k * 3;
      outPos[o] = positions[vi * 3];
      outPos[o + 1] = positions[vi * 3 + 1];
      outPos[o + 2] = positions[vi * 3 + 2];
      outCol[o] = cr;
      outCol[o + 1] = cg;
      outCol[o + 2] = cb;
    }
  }
  return { positions: outPos, colors: outCol };
}
