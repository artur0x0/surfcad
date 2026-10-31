/**
 * Pull-direction search and moldability fit (injection molding, M1.1).
 *
 * The mesh is the one the viewport already builds. Face normals come from
 * `stampedFaceTable` (`src/utils/faceIdentity.js`) when that face's normal
 * did not cancel; otherwise the triangle cross product, the same fallback
 * an unstamped import gets. Candidate axes are the bounding-box axes plus
 * the normals of large planar PartGraph patches (`warmFaceGraph` /
 * `src/utils/partGraphPatches.js`). Bodies are reported with
 * `meshBodyComponents` (`src/utils/meshBodyComponents.js`). Occlusion uses
 * every triangle, so a closed void counts even though it shares no vertices
 * with the outer shell.
 *
 * A triangle is an undercut along unit axis d when it faces that opening
 * (|n · d| > sin(10°)) and another triangle in the same projected cell sits
 * strictly beyond it. Near-parallel faces are left for draft analysis.
 * Connected undercut triangles that share a vertex, face the same way, and
 * agree within 35° are one region. The count is regions.
 *
 * Fit: 0 regions is good, 1–4 is fixable, 5 or more is not_a_fit.
 * d and −d are the same searched axis. An override keeps the caller's sign.
 */

import { meshBodyComponents } from '../utils/meshBodyComponents.js';

export const MOLD_ANALYSIS_VERSION = 1;

/** |n · d| at or under this is parallel to the pull (draft, not an undercut). */
export const MOLD_NEUTRAL_DEG = 10;
/** A face this close to the cell's outer height is skin, not an undercut. */
export const MOLD_SKIN_MM = 0.05;
/** Skin is at least this fraction of the bounding-box diagonal. */
export const MOLD_SKIN_DIAG_FRAC = 1e-4;
export const MOLD_GOOD_MAX_UNDERCUTS = 0;
export const MOLD_FIXABLE_MAX_UNDERCUTS = 4;
/** Planar patches smaller than this fraction of the largest are not candidates. */
export const MOLD_PLANAR_CANDIDATE_FRAC = 0.1;
export const MOLD_DIRECTION_DEDUP_DEG = 5;
/** Undercut triangles whose normals differ by more than this stay separate regions. */
export const MOLD_REGION_NORMAL_DEG = 35;
export const MOLD_GRID_CELLS = 32;
export const MOLD_GRID_CAP = 64;
export const MOLD_MIN_CELL_MM = 0.25;
/** A stamped normal shorter than this cancelled (a closed cylinder wall). */
export const MOLD_STAMP_MIN_LENGTH = 0.5;

const NEUTRAL_SIN = Math.sin((MOLD_NEUTRAL_DEG * Math.PI) / 180);
const DEDUP_COS = Math.cos((MOLD_DIRECTION_DEDUP_DEG * Math.PI) / 180);
const REGION_COS = Math.cos((MOLD_REGION_NORMAL_DEG * Math.PI) / 180);
const AREA_EPS = 1e-12;

export function moldFitScore(undercutCount) {
  const n = Number(undercutCount) || 0;
  if (n <= MOLD_GOOD_MAX_UNDERCUTS) return 'good';
  if (n <= MOLD_FIXABLE_MAX_UNDERCUTS) return 'fixable';
  return 'not_a_fit';
}

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

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function len(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function unit(v) {
  const l = len(v);
  if (!(l > 1e-12)) return null;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function round(n, places = 9) {
  const f = 10 ** places;
  const v = Math.round(n * f) / f;
  return Object.is(v, -0) ? 0 : v;
}

function round3(v) {
  return [round(v[0]), round(v[1]), round(v[2])];
}

function vertAt(positions, i) {
  const o = i * 3;
  return [positions[o], positions[o + 1], positions[o + 2]];
}

/** Flip so the strongest component is positive. d and −d are one pull axis. */
export function canonicalPull(d) {
  const u = unit(d);
  if (!u) return null;
  let axis = 0;
  let mag = Math.abs(u[0]);
  for (let i = 1; i < 3; i++) {
    const m = Math.abs(u[i]);
    if (m > mag + 1e-12) {
      mag = m;
      axis = i;
    }
  }
  if (u[axis] < 0) return [-u[0], -u[1], -u[2]];
  return u;
}

function asOverride(pull) {
  if (pull == null) return { pull: null };
  if (!Array.isArray(pull) || pull.length < 3) {
    return { error: { code: 'bad_args', message: 'pull must be a non-zero [x, y, z] vector' } };
  }
  const xyz = [Number(pull[0]), Number(pull[1]), Number(pull[2])];
  if (xyz.some((n) => !Number.isFinite(n))) {
    return { error: { code: 'bad_args', message: 'pull must be a non-zero [x, y, z] vector' } };
  }
  const u = unit(xyz);
  if (!u) return { error: { code: 'bad_args', message: 'pull must be a non-zero [x, y, z] vector' } };
  return { pull: u };
}

function stampedNormal(t, stamped) {
  const triFace = stamped?.triFace;
  const normals = stamped?.normals;
  if (!triFace || !normals || t < 0 || t >= triFace.length) return null;
  const fi = triFace[t];
  if (fi == null || fi < 0 || fi >= normals.length) return null;
  const n = normals[fi];
  if (!n || n.length < 3) return null;
  if (len(n) < MOLD_STAMP_MIN_LENGTH) return null;
  return unit(n);
}

function prepareTriangles(positions, indices, stamped) {
  const nTri = Math.floor(indices.length / 3);
  const tris = [];
  let stampedCount = 0;
  let triangleCount = 0;
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < nTri; t++) {
    const ia = indices[t * 3];
    const ib = indices[t * 3 + 1];
    const ic = indices[t * 3 + 2];
    const a = vertAt(positions, ia);
    const b = vertAt(positions, ib);
    const c = vertAt(positions, ic);
    for (const p of [a, b, c]) {
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
    }
    const cr = cross(sub(b, a), sub(c, a));
    const area = 0.5 * len(cr);
    if (!(area > AREA_EPS)) continue;
    const geometric = unit(cr);
    const stampedN = stampedNormal(t, stamped);
    const n = stampedN || geometric;
    if (!n) continue;
    if (stampedN) stampedCount += 1;
    else triangleCount += 1;
    tris.push({
      t,
      ia,
      ib,
      ic,
      a,
      b,
      c,
      area,
      n,
      centroid: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3],
    });
  }
  return { tris, stampedCount, triangleCount, min, max };
}

function addDirection(dirs, raw) {
  const u = canonicalPull(raw);
  if (!u) return;
  for (const d of dirs) {
    if (Math.abs(dot(d, u)) > DEDUP_COS) return;
  }
  dirs.push(u);
}

function planarGroupsFromTriangles(tris) {
  const groups = [];
  for (const tri of tris) {
    let group = null;
    for (const g of groups) {
      if (dot(g.n, tri.n) > DEDUP_COS) {
        group = g;
        break;
      }
    }
    if (!group) {
      group = { n: tri.n.slice(), area: 0 };
      groups.push(group);
    }
    group.area += tri.area;
  }
  return groups;
}

function planarGroupsFromPatches(patches) {
  const groups = [];
  for (const patch of patches) {
    if (patch?.kind !== 'planar' || !(patch.area > 0)) continue;
    const n = unit(patch.normal);
    if (!n) continue;
    groups.push({ n, area: patch.area });
  }
  return groups;
}

function pickPrimary(groups) {
  let best = null;
  for (const g of groups) {
    if (!best || betterPlanar(g, best)) best = g;
  }
  return best?.n || null;
}

function betterPlanar(a, b) {
  const scale = Math.max(a.area, b.area, 1);
  if (Math.abs(a.area - b.area) > 1e-6 * scale) return a.area > b.area;
  if (Math.abs(a.n[2] - b.n[2]) > 1e-9) return a.n[2] > b.n[2];
  if (Math.abs(a.n[1] - b.n[1]) > 1e-9) return a.n[1] > b.n[1];
  return a.n[0] > b.n[0];
}

function candidateDirections(tris, patches) {
  const dirs = [];
  addDirection(dirs, [1, 0, 0]);
  addDirection(dirs, [0, 1, 0]);
  addDirection(dirs, [0, 0, 1]);
  const fromPatches = Array.isArray(patches) && patches.length ? planarGroupsFromPatches(patches) : [];
  const groups = fromPatches.length ? fromPatches : planarGroupsFromTriangles(tris);
  let maxArea = 0;
  for (const g of groups) if (g.area > maxArea) maxArea = g.area;
  const floor = MOLD_PLANAR_CANDIDATE_FRAC * maxArea;
  for (const g of groups) {
    if (g.area >= floor) addDirection(dirs, g.n);
  }
  return { dirs, primary: pickPrimary(groups) };
}

function betterPull(a, b, primary) {
  if (a.undercutCount !== b.undercutCount) return a.undercutCount < b.undercutCount;
  const pa = primary ? Math.abs(dot(a.pull, primary)) : 0;
  const pb = primary ? Math.abs(dot(b.pull, primary)) : 0;
  if (Math.abs(pa - pb) > 1e-9) return pa > pb;
  if (Math.abs(a.pull[2] - b.pull[2]) > 1e-9) return a.pull[2] > b.pull[2];
  if (Math.abs(a.pull[1] - b.pull[1]) > 1e-9) return a.pull[1] > b.pull[1];
  return a.pull[0] > b.pull[0];
}

function basisOf(d) {
  const helper = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = unit(cross(helper, d));
  const v = unit(cross(d, u));
  return { u, v };
}

/**
 * Projected height field. A triangle is inserted into every cell its
 * projected box touches, so a large outer face covers a recess.
 */
function undercutsAlong(d, tris, skin) {
  const { u, v } = basisOf(d);
  const proj = (p) => [dot(p, u), dot(p, v)];
  const height = (p) => dot(p, d);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  const prepared = tris.map((tri) => {
    const pa = proj(tri.a);
    const pb = proj(tri.b);
    const pc = proj(tri.c);
    const us = [pa[0], pb[0], pc[0]];
    const vs = [pa[1], pb[1], pc[1]];
    const u0 = Math.min(...us);
    const u1 = Math.max(...us);
    const v0 = Math.min(...vs);
    const v1 = Math.max(...vs);
    if (u0 < minU) minU = u0;
    if (u1 > maxU) maxU = u1;
    if (v0 < minV) minV = v0;
    if (v1 > maxV) maxV = v1;
    const hs = [height(tri.a), height(tri.b), height(tri.c)];
    return {
      tri,
      u0,
      u1,
      v0,
      v1,
      cu: dot(tri.centroid, u),
      cv: dot(tri.centroid, v),
      hMin: Math.min(...hs),
      hMax: Math.max(...hs),
      nd: dot(tri.n, d),
    };
  });
  const spanU = Math.max(maxU - minU, 0);
  const spanV = Math.max(maxV - minV, 0);
  const span = Math.max(spanU, spanV, 1e-9);
  let cell = Math.max(MOLD_MIN_CELL_MM, span / MOLD_GRID_CELLS);
  if (span / cell > MOLD_GRID_CAP) cell = span / MOLD_GRID_CAP;
  let nU = Math.max(1, Math.ceil((spanU + 1e-9) / cell));
  let nV = Math.max(1, Math.ceil((spanV + 1e-9) / cell));
  if (nU > MOLD_GRID_CAP) nU = MOLD_GRID_CAP;
  if (nV > MOLD_GRID_CAP) nV = MOLD_GRID_CAP;
  const nCell = nU * nV;
  const zMin = new Float64Array(nCell);
  const zMax = new Float64Array(nCell);
  zMin.fill(Infinity);
  zMax.fill(-Infinity);
  const clamp = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i);
  const cellAt = (pu, pv) => {
    const iu = clamp(Math.floor((pu - minU) / cell), nU);
    const iv = clamp(Math.floor((pv - minV) / cell), nV);
    return iv * nU + iu;
  };
  for (const row of prepared) {
    const iu0 = clamp(Math.floor((row.u0 - minU) / cell), nU);
    const iu1 = clamp(Math.floor((row.u1 - minU) / cell), nU);
    const iv0 = clamp(Math.floor((row.v0 - minV) / cell), nV);
    const iv1 = clamp(Math.floor((row.v1 - minV) / cell), nV);
    for (let iv = iv0; iv <= iv1; iv++) {
      for (let iu = iu0; iu <= iu1; iu++) {
        const id = iv * nU + iu;
        if (row.hMin < zMin[id]) zMin[id] = row.hMin;
        if (row.hMax > zMax[id]) zMax[id] = row.hMax;
      }
    }
  }
  const hits = [];
  for (const row of prepared) {
    if (Math.abs(row.nd) <= NEUTRAL_SIN) continue;
    const id = cellAt(row.cu, row.cv);
    const facingOut = row.nd > 0;
    const occluded = facingOut ? zMax[id] > row.hMax + skin : zMin[id] < row.hMin - skin;
    if (!occluded) continue;
    hits.push({ ...row.tri, side: facingOut ? 1 : -1 });
  }
  return clusterRegions(hits);
}

function clusterRegions(hits) {
  const n = hits.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    let x = i;
    while (parent[x] !== r) {
      const next = parent[x];
      parent[x] = r;
      x = next;
    }
    return r;
  };
  const unite = (i, j) => {
    if (hits[i].side !== hits[j].side) return;
    if (dot(hits[i].n, hits[j].n) < REGION_COS) return;
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  };
  const byVert = new Map();
  for (let i = 0; i < n; i++) {
    for (const v of [hits[i].ia, hits[i].ib, hits[i].ic]) {
      let list = byVert.get(v);
      if (!list) {
        list = [];
        byVert.set(v, list);
      }
      list.push(i);
    }
  }
  for (const list of byVert.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) unite(list[i], list[j]);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = groups.get(r);
    if (!g) {
      g = { area: 0, triangleCount: 0, n: [0, 0, 0], side: hits[i].side, seed: hits[i].t };
      groups.set(r, g);
    }
    g.area += hits[i].area;
    g.triangleCount += 1;
    g.n[0] += hits[i].n[0] * hits[i].area;
    g.n[1] += hits[i].n[1] * hits[i].area;
    g.n[2] += hits[i].n[2] * hits[i].area;
  }
  const regions = [...groups.values()];
  regions.sort((a, b) => b.area - a.area || b.n[2] - a.n[2] || b.n[1] - a.n[1] || b.n[0] - a.n[0]);
  return regions.map((g, id) => {
    const n = unit(g.n) || [0, 0, 0];
    return {
      id,
      area: round(g.area, 6),
      triangleCount: g.triangleCount,
      normal: round3(n),
      side: g.side,
      seed: g.seed,
    };
  });
}

function thresholds() {
  return {
    neutralDeg: MOLD_NEUTRAL_DEG,
    skinMm: MOLD_SKIN_MM,
    goodMaxUndercuts: MOLD_GOOD_MAX_UNDERCUTS,
    fixableMaxUndercuts: MOLD_FIXABLE_MAX_UNDERCUTS,
  };
}

function bodyReport(positions, indices, regions) {
  const bodies = meshBodyComponents(positions, indices);
  const triBody = new Map();
  bodies.forEach((body, index) => {
    for (const t of body.triangles) triBody.set(t, index);
  });
  const counts = new Map();
  for (const region of regions) {
    const index = triBody.get(region.seed);
    if (index == null) continue;
    counts.set(index, (counts.get(index) || 0) + 1);
  }
  return bodies.map((body, index) => {
    const undercutCount = counts.get(index) || 0;
    return {
      index,
      triangleCount: body.triangles.length,
      undercutCount,
      fit: moldFitScore(undercutCount),
    };
  });
}

function publicRegions(regions) {
  return regions.map(({ id, area, triangleCount, normal, side }) => ({
    id,
    area,
    triangleCount,
    normal,
    side,
  }));
}

function resultOf({ pull, pullSource, regions, candidates, normals, positions, indices, skinMm }) {
  const undercutCount = regions.length;
  return {
    version: MOLD_ANALYSIS_VERSION,
    kind: 'mold-analysis',
    fit: moldFitScore(undercutCount),
    undercutCount,
    pull: round3(pull),
    pullSource,
    thresholds: thresholds(),
    appliedSkinMm: round(skinMm, 6),
    normals,
    candidates: candidates.map((row) => ({
      pull: round3(row.pull),
      undercutCount: row.undercutCount,
    })),
    undercuts: publicRegions(regions),
    bodies: bodyReport(positions, indices, regions),
  };
}

/**
 * Search pull directions, or score one override.
 *
 * @param {{
 *   positions: ArrayLike<number>,
 *   indices: ArrayLike<number>,
 *   patches?: Array<{ kind?: string, area?: number, normal?: number[] }>|null,
 *   stamped?: { triFace: ArrayLike<number>, normals: ArrayLike<ArrayLike<number>> }|null,
 *   pull?: number[]|null,
 * }} input
 */
export function analyzePullDirection(input) {
  const positions = input?.positions;
  const indices = input?.indices;
  if (!positions || !indices || indices.length < 3 || positions.length < 9) {
    return { error: { code: 'no_mesh', message: 'No mesh to score' } };
  }
  const override = asOverride(input.pull);
  if (override.error) return override;
  const prepared = prepareTriangles(positions, indices, input.stamped || null);
  if (!prepared.tris.length) return { error: { code: 'no_mesh', message: 'No mesh to score' } };
  const diag = len(sub(prepared.max, prepared.min));
  const skinMm = Math.max(MOLD_SKIN_MM, MOLD_SKIN_DIAG_FRAC * diag);
  const normals = { stamped: prepared.stampedCount, triangle: prepared.triangleCount };
  if (override.pull) {
    const regions = undercutsAlong(override.pull, prepared.tris, skinMm);
    return resultOf({
      pull: override.pull,
      pullSource: 'override',
      regions,
      candidates: [{ pull: override.pull, undercutCount: regions.length }],
      normals,
      positions,
      indices,
      skinMm,
    });
  }
  const { dirs, primary } = candidateDirections(prepared.tris, input.patches);
  let best = null;
  const candidates = [];
  for (const pull of dirs) {
    const regions = undercutsAlong(pull, prepared.tris, skinMm);
    const row = { pull, undercutCount: regions.length, regions };
    candidates.push(row);
    if (!best || betterPull(row, best, primary)) best = row;
  }
  return resultOf({
    pull: best.pull,
    pullSource: 'search',
    regions: best.regions,
    candidates,
    normals,
    positions,
    indices,
    skinMm,
  });
}
