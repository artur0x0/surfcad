/**
 * Core / cavity split and the parting line (injection molding, M2.1).
 *
 * Ownership is complete visibility along the pull, not the sign of n · d.
 * A depth grid perpendicular to d records the front and back surface.
 * A triangle whose samples are all on the front (the +d side, within the
 * same skin as the undercut grid) is core. One whose samples are all on
 * the back is cavity. Anything only partly in front is not a seed.
 *
 * Walls with |n · d| under half a degree are not rasterized. The test uses
 * the triangle's own normal, so a faceted fillet whose stamp points along
 * the pull is still zero-draft. They take
 * the role of the labelled neighbour they touch. A wall that touches both
 * roles joins the cavity, so the outside of a tray stays outside and an
 * inside wall that only meets the core stays core. A face that contains
 * both draft signs is split at n · d = 0 instead of taking one majority
 * role. Islands smaller than two grid cells are absorbed.
 *
 * The parting line is one polyline: the closed core-cavity loop that is
 * not inside another loop and has the largest projected perimeter.
 * Inner loops are dropped. It is not a band of faces.
 *
 * Vertices within 0.01 mm are one vertex, so a wall whose diagonal was
 * stored twice still floods as one face. A long edge is also split where
 * another mesh edge lies along it, so a T-junction does not open the loop.
 */

import { canonicalEdgeName, vertexPairKey } from '../lib/surfcad/namedEdges.js';

// Same grid and skin as `pullDirection.js`. Kept local so this module does
// not import the pull search (that search imports `classifyParting`).
const GRID_CELLS = 32;
const GRID_CAP = 64;
const MIN_CELL_MM = 0.25;
const SKIN_MM = 0.05;
const SKIN_DIAG_FRAC = 1e-4;

/** Kept for mold draft. Ownership no longer uses this band. */
export const PARTING_NEUTRAL_DEG = 10;
/** Matches `MOLD_REGION_NORMAL_DEG`. Unstamped triangles this close stay one face. */
export const PARTING_CLUSTER_DEG = 35;
/** Below this |n · d| a wall is zero-draft and is not a visibility seed. */
export const PARTING_ZERO_DRAFT_DEG = 0.5;

const ZERO_SIN = Math.sin((PARTING_ZERO_DRAFT_DEG * Math.PI) / 180);
const CLUSTER_COS = Math.cos((PARTING_CLUSTER_DEG * Math.PI) / 180);
const SAMPLE_CAP = 24;
/** Coincident vertices closer than this are one vertex. */
const WELD_MM = 0.01;
const WELD_CELL_MM = 2;
/** Edges shorter than this are not scanned for T-junctions. */
const SPLIT_MIN_MM = 2;

/** Discrete skin colours. Not stress, and not a CSS token. */
export const PARTING_ROLE_RGB = Object.freeze({
  cavity: Object.freeze([0.18, 0.45, 0.78]),
  core: Object.freeze([0.72, 0.36, 0.18]),
});

/** Zero-draft walls. Still owned by core or cavity. Not a parting area. */
export const PARTING_ZERO_DRAFT_RGB = Object.freeze([0.2, 0.55, 0.42]);

/** Parting polyline. Not a face colour and not a CSS token. */
export const PARTING_LINE_RGB = Object.freeze([0.96, 0.78, 0.18]);

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function len(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function unit(v) {
  const l = len(v);
  if (!(l > 1e-12)) return null;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function round(n, places = 6) {
  const f = 10 ** places;
  const v = Math.round(n * f) / f;
  return Object.is(v, -0) ? 0 : v;
}

function round3(v) {
  return [round(v[0]), round(v[1]), round(v[2])];
}

function rgbCss(rgb) {
  const [r, g, b] = rgb.map((channel) => Math.round(channel * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

function basisOf(d) {
  const helper = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = unit(cross(helper, d));
  const v = unit(cross(d, u));
  return { u, v };
}

function faceNameAt(triIndex, faceInfo) {
  const triFace = faceInfo?.triFace;
  const names = faceInfo?.names;
  if (!triFace || !names) return null;
  const fi = triFace[triIndex];
  if (fi == null || fi < 0 || fi >= names.length) return null;
  const name = names[fi];
  return typeof name === 'string' && name ? name : null;
}

function faceIndexAt(triIndex, faceInfo) {
  const triFace = faceInfo?.triFace;
  if (!triFace) return -1;
  const fi = triFace[triIndex];
  if (fi == null || fi < 0) return -1;
  return fi;
}

function barycentric(p, a, b, c) {
  const v0x = b[0] - a[0];
  const v0y = b[1] - a[1];
  const v1x = c[0] - a[0];
  const v1y = c[1] - a[1];
  const v2x = p[0] - a[0];
  const v2y = p[1] - a[1];
  const den = v0x * v1y - v1x * v0y;
  if (Math.abs(den) < 1e-18) return null;
  const bv = (v2x * v1y - v1x * v2y) / den;
  const bw = (v0x * v2y - v2x * v0y) / den;
  const bu = 1 - bv - bw;
  if (bu < -1e-6 || bv < -1e-6 || bw < -1e-6) return null;
  return [bu, bv, bw];
}

function diagonalOf(tris) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const tri of tris) {
    for (const p of [tri.a, tri.b, tri.c]) {
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
    }
  }
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
}

/**
 * Front (+d, core) and back (−d, cavity) samples. A triangle is a seed
 * only when every sample it owns sits on that side within `skin`.
 */
function visibilitySeeds(tris, d) {
  const { u, v } = basisOf(d);
  const n = tris.length;
  const rows = tris.map((tri) => {
    const pa = [dot(tri.a, u), dot(tri.a, v)];
    const pb = [dot(tri.b, u), dot(tri.b, v)];
    const pc = [dot(tri.c, u), dot(tri.c, v)];
    const ha = dot(tri.a, d);
    const hb = dot(tri.b, d);
    const hc = dot(tri.c, d);
    return {
      pa,
      pb,
      pc,
      ha,
      hb,
      hc,
      nd: dot(tri.n, d),
      ndGeom: dot(tri.nGeom || tri.n, d),
      u0: Math.min(pa[0], pb[0], pc[0]),
      u1: Math.max(pa[0], pb[0], pc[0]),
      v0: Math.min(pa[1], pb[1], pc[1]),
      v1: Math.max(pa[1], pb[1], pc[1]),
    };
  });
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const row of rows) {
    if (row.u0 < minU) minU = row.u0;
    if (row.u1 > maxU) maxU = row.u1;
    if (row.v0 < minV) minV = row.v0;
    if (row.v1 > maxV) maxV = row.v1;
  }
  const span = Math.max(maxU - minU, maxV - minV, 1e-9);
  let cell = Math.max(MIN_CELL_MM, span / GRID_CELLS);
  if (span / cell > GRID_CAP) cell = span / GRID_CAP;
  const nU = Math.max(1, Math.min(GRID_CAP, Math.ceil((Math.max(maxU - minU, 0) + 1e-9) / cell)));
  const nV = Math.max(1, Math.min(GRID_CAP, Math.ceil((Math.max(maxV - minV, 0) + 1e-9) / cell)));
  const clamp = (i, limit) => (i < 0 ? 0 : i >= limit ? limit - 1 : i);
  const buckets = Array.from({ length: nU * nV }, () => []);
  for (let i = 0; i < n; i++) {
    const row = rows[i];
    const iu0 = clamp(Math.floor((row.u0 - minU) / cell), nU);
    const iu1 = clamp(Math.floor((row.u1 - minU) / cell), nU);
    const iv0 = clamp(Math.floor((row.v0 - minV) / cell), nV);
    const iv1 = clamp(Math.floor((row.v1 - minV) / cell), nV);
    for (let iv = iv0; iv <= iv1; iv++) {
      for (let iu = iu0; iu <= iu1; iu++) buckets[iv * nU + iu].push(i);
    }
  }
  const skin = Math.max(SKIN_MM, SKIN_DIAG_FRAC * diagonalOf(tris));
  const heightAt = (row, bary) => bary[0] * row.ha + bary[1] * row.hb + bary[2] * row.hc;
  const extremes = (pu, pv) => {
    const iu = clamp(Math.floor((pu - minU) / cell), nU);
    const iv = clamp(Math.floor((pv - minV) / cell), nV);
    let hi = -Infinity;
    let lo = Infinity;
    let hit = false;
    for (const i of buckets[iv * nU + iu]) {
      const bary = barycentric([pu, pv], rows[i].pa, rows[i].pb, rows[i].pc);
      if (!bary) continue;
      const h = heightAt(rows[i], bary);
      hit = true;
      if (h > hi) hi = h;
      if (h < lo) lo = h;
    }
    return hit ? { hi, lo } : null;
  };
  const seeds = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const row = rows[i];
    if (Math.abs(row.ndGeom) <= ZERO_SIN) continue;
    const samples = [
      [(row.pa[0] + row.pb[0] + row.pc[0]) / 3, (row.pa[1] + row.pb[1] + row.pc[1]) / 3],
      [row.pa[0] * 0.6 + row.pb[0] * 0.2 + row.pc[0] * 0.2, row.pa[1] * 0.6 + row.pb[1] * 0.2 + row.pc[1] * 0.2],
      [row.pa[0] * 0.2 + row.pb[0] * 0.6 + row.pc[0] * 0.2, row.pa[1] * 0.2 + row.pb[1] * 0.6 + row.pc[1] * 0.2],
      [row.pa[0] * 0.2 + row.pb[0] * 0.2 + row.pc[0] * 0.6, row.pa[1] * 0.2 + row.pb[1] * 0.2 + row.pc[1] * 0.6],
    ];
    const iu0 = clamp(Math.floor((row.u0 - minU) / cell), nU);
    const iu1 = clamp(Math.floor((row.u1 - minU) / cell), nU);
    const iv0 = clamp(Math.floor((row.v0 - minV) / cell), nV);
    const iv1 = clamp(Math.floor((row.v1 - minV) / cell), nV);
    if ((iu1 - iu0 + 1) * (iv1 - iv0 + 1) > 1) {
      for (let iv = iv0; iv <= iv1 && samples.length < SAMPLE_CAP; iv++) {
        for (let iu = iu0; iu <= iu1 && samples.length < SAMPLE_CAP; iu++) {
          const pu = minU + (iu + 0.5) * cell;
          const pv = minV + (iv + 0.5) * cell;
          if (barycentric([pu, pv], row.pa, row.pb, row.pc)) samples.push([pu, pv]);
        }
      }
    }
    let seen = 0;
    let front = 0;
    let back = 0;
    for (const [pu, pv] of samples) {
      const bary = barycentric([pu, pv], row.pa, row.pb, row.pc);
      if (!bary) continue;
      const spanH = extremes(pu, pv);
      if (!spanH) continue;
      const h = heightAt(row, bary);
      seen += 1;
      if (h >= spanH.hi - skin) front += 1;
      if (h <= spanH.lo + skin) back += 1;
    }
    if (!seen || front !== seen && back !== seen) continue;
    if (front === seen && row.nd > ZERO_SIN) seeds[i] = 'core';
    else if (back === seen && row.nd < -ZERO_SIN) seeds[i] = 'cavity';
  }
  return { seeds, cellArea: cell * cell };
}

function edgeSpan(tri, u, w) {
  const at = (index) => (index === tri.ia ? tri.a : index === tri.ib ? tri.b : tri.c);
  const a = at(u);
  const b = at(w);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Map each vertex index to one representative. Two indices whose positions
 * are within `WELD_MM` share a representative, including across a bin edge.
 */
function weldIndex(tris) {
  const scale = 1 / WELD_MM;
  const bins = new Map();
  const points = [];
  const seen = new Set();
  const add = (index, p) => {
    if (seen.has(index)) return;
    seen.add(index);
    const slot = points.length;
    points.push({ index, p });
    const key = `${Math.round(p[0] * scale)},${Math.round(p[1] * scale)},${Math.round(p[2] * scale)}`;
    let list = bins.get(key);
    if (!list) {
      list = [];
      bins.set(key, list);
    }
    list.push(slot);
  };
  for (const tri of tris) {
    add(tri.ia, tri.a);
    add(tri.ib, tri.b);
    add(tri.ic, tri.c);
  }
  const parent = points.map((_, i) => i);
  const find = (i) => {
    let x = i;
    while (parent[x] !== x) x = parent[x];
    let y = i;
    while (parent[y] !== y) {
      const next = parent[y];
      parent[y] = x;
      y = next;
    }
    return x;
  };
  const unite = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pb] = pa;
  };
  const limit = WELD_MM * WELD_MM;
  for (let i = 0; i < points.length; i++) {
    const p = points[i].p;
    const ix = Math.round(p[0] * scale);
    const iy = Math.round(p[1] * scale);
    const iz = Math.round(p[2] * scale);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const list = bins.get(`${ix + dx},${iy + dy},${iz + dz}`);
          if (!list) continue;
          for (const j of list) {
            if (j <= i) continue;
            const q = points[j].p;
            const ddx = p[0] - q[0];
            const ddy = p[1] - q[1];
            const ddz = p[2] - q[2];
            if (ddx * ddx + ddy * ddy + ddz * ddz <= limit) unite(i, j);
          }
        }
      }
    }
  }
  const canon = new Map();
  const pos = new Map();
  for (let i = 0; i < points.length; i++) {
    const root = points[find(i)];
    canon.set(points[i].index, root.index);
    if (!pos.has(root.index)) pos.set(root.index, root.p);
  }
  return { canon, pos };
}

function vertexGrid(pos) {
  const grid = new Map();
  for (const [id, p] of pos) {
    const key = `${Math.floor(p[0] / WELD_CELL_MM)},${Math.floor(p[1] / WELD_CELL_MM)},${Math.floor(p[2] / WELD_CELL_MM)}`;
    let list = grid.get(key);
    if (!list) {
      list = [];
      grid.set(key, list);
    }
    list.push(id);
  }
  return grid;
}

function onSegment(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const ab2 = abx * abx + aby * aby + abz * abz;
  if (ab2 < 1e-18) return null;
  const t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / ab2;
  if (t <= 1e-6 || t >= 1 - 1e-6) return null;
  const dx = p[0] - (a[0] + abx * t);
  const dy = p[1] - (a[1] + aby * t);
  const dz = p[2] - (a[2] + abz * t);
  if (dx * dx + dy * dy + dz * dz > WELD_MM * WELD_MM) return null;
  return t;
}

/** Split `u`–`w` where another mesh edge lies along it. */
function splitIds(u, w, pos, grid, edgeSet) {
  const a = pos.get(u);
  const b = pos.get(w);
  const min = [
    Math.min(a[0], b[0]) - WELD_MM,
    Math.min(a[1], b[1]) - WELD_MM,
    Math.min(a[2], b[2]) - WELD_MM,
  ];
  const max = [
    Math.max(a[0], b[0]) + WELD_MM,
    Math.max(a[1], b[1]) + WELD_MM,
    Math.max(a[2], b[2]) + WELD_MM,
  ];
  const hits = [];
  const seen = new Set();
  const i0 = Math.floor(min[0] / WELD_CELL_MM);
  const i1 = Math.floor(max[0] / WELD_CELL_MM);
  const j0 = Math.floor(min[1] / WELD_CELL_MM);
  const j1 = Math.floor(max[1] / WELD_CELL_MM);
  const k0 = Math.floor(min[2] / WELD_CELL_MM);
  const k1 = Math.floor(max[2] / WELD_CELL_MM);
  for (let iz = k0; iz <= k1; iz++) {
    for (let iy = j0; iy <= j1; iy++) {
      for (let ix = i0; ix <= i1; ix++) {
        const list = grid.get(`${ix},${iy},${iz}`);
        if (!list) continue;
        for (const id of list) {
          if (id === u || id === w || seen.has(id)) continue;
          const t = onSegment(pos.get(id), a, b);
          if (t == null) continue;
          seen.add(id);
          hits.push({ id, t });
        }
      }
    }
  }
  const keep = hits.filter((hit) => {
    if (edgeSet.has(vertexPairKey(hit.id, u)) || edgeSet.has(vertexPairKey(hit.id, w))) return true;
    return hits.some((other) => other.id !== hit.id && edgeSet.has(vertexPairKey(hit.id, other.id)));
  });
  keep.sort((p, q) => p.t - q.t);
  const ids = [u];
  for (const hit of keep) ids.push(hit.id);
  ids.push(w);
  return ids;
}

function adjacency(tris) {
  const { canon } = weldIndex(tris);
  const edges = new Map();
  tris.forEach((tri, i) => {
    for (const [u, w] of [[tri.ia, tri.ib], [tri.ib, tri.ic], [tri.ic, tri.ia]]) {
      const cu = canon.get(u);
      const cw = canon.get(w);
      if (cu == null || cw == null || cu === cw) continue;
      const key = vertexPairKey(cu, cw);
      let list = edges.get(key);
      if (!list) {
        list = [];
        edges.set(key, list);
      }
      list.push({ i, u, w });
    }
  });
  const neighbors = tris.map(() => []);
  for (const list of edges.values()) {
    if (list.length < 2) continue;
    const span = edgeSpan(tris[list[0].i], list[0].u, list[0].w) || 1;
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        neighbors[list[a].i].push({ j: list[b].i, length: span });
        neighbors[list[b].i].push({ j: list[a].i, length: span });
      }
    }
  }
  return neighbors;
}

function reachable(roleOf, neighbors, seed) {
  const seen = new Set();
  const queue = [];
  for (let i = 0; i < roleOf.length; i++) if (roleOf[i] === seed) queue.push(i);
  for (let q = 0; q < queue.length; q++) {
    for (const link of neighbors[queue[q]]) {
      const next = link.j;
      if (roleOf[next] || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function growRoles(tris, roleOf, neighbors, pull) {
  const fromCore = reachable(roleOf, neighbors, 'core');
  const fromCavity = reachable(roleOf, neighbors, 'cavity');
  for (let i = 0; i < tris.length; i++) {
    if (roleOf[i]) continue;
    const core = fromCore.has(i);
    const cavity = fromCavity.has(i);
    if (core && !cavity) roleOf[i] = 'core';
    else if (cavity) roleOf[i] = 'cavity';
    else roleOf[i] = dot(tris[i].n, pull) > ZERO_SIN ? 'core' : 'cavity';
  }
}

function splitStraddles(tris, roleOf, faceInfo) {
  const groups = new Map();
  tris.forEach((tri, i) => {
    const stamped = faceIndexAt(tri.t, faceInfo);
    const key = stamped >= 0 ? `s:${stamped}` : `n:${Math.round(tri.n[0] * 20)}:${Math.round(tri.n[1] * 20)}:${Math.round(tri.n[2] * 20)}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(i);
  });
  for (const group of groups.values()) {
    let pos = false;
    let neg = false;
    for (const i of group) {
      const nd = dot(tris[i].n, roleOf.pull);
      if (nd > ZERO_SIN) pos = true;
      else if (nd < -ZERO_SIN) neg = true;
    }
    if (!pos || !neg) continue;
    for (const i of group) {
      if (roleOf.roles[i]) continue;
      const nd = dot(tris[i].n, roleOf.pull);
      if (nd > ZERO_SIN) roleOf.roles[i] = 'core';
      else if (nd < -ZERO_SIN) roleOf.roles[i] = 'cavity';
    }
  }
}

function absorbSpeckles(tris, roleOf, neighbors, limit) {
  const n = tris.length;
  const parent = tris.map((_, i) => i);
  const find = (i) => {
    let x = i;
    while (parent[x] !== x) x = parent[x];
    return x;
  };
  const unite = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pb] = pa;
  };
  for (let i = 0; i < n; i++) {
    for (const link of neighbors[i]) {
      if (roleOf[i] && roleOf[i] === roleOf[link.j]) unite(i, link.j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let group = groups.get(root);
    if (!group) {
      group = { role: roleOf[i], members: [], area: 0, touch: 0 };
      groups.set(root, group);
    }
    group.members.push(i);
    group.area += tris[i].area;
  }
  for (const group of groups.values()) {
    for (const i of group.members) {
      for (const link of neighbors[i]) {
        if (roleOf[link.j] && roleOf[link.j] !== group.role) group.touch += link.length;
      }
    }
  }
  const roleArea = { core: 0, cavity: 0 };
  for (let i = 0; i < n; i++) roleArea[roleOf[i]] += tris[i].area;
  const ordered = [...groups.values()].sort((a, b) => a.area - b.area);
  for (const group of ordered) {
    if (!(group.area <= limit) || group.touch <= 0) continue;
    const other = group.role === 'core' ? 'cavity' : 'core';
    if (roleArea[group.role] - group.area <= 1e-6) continue;
    for (const i of group.members) roleOf[i] = other;
    roleArea[group.role] -= group.area;
    roleArea[other] += group.area;
  }
}

function assignRoles(tris, pull, faceInfo) {
  const { seeds, cellArea } = visibilitySeeds(tris, pull);
  const roleOf = seeds.map((role) => role);
  const bag = { roles: roleOf, pull };
  splitStraddles(tris, bag, faceInfo);
  const neighbors = adjacency(tris);
  growRoles(tris, roleOf, neighbors, pull);
  absorbSpeckles(tris, roleOf, neighbors, Math.max(2 * cellArea, 1e-6));
  return roleOf;
}

/**
 * Unstamped triangles of one role that share a vertex and agree within
 * 35° are one face. Stamped triangles stay on their stamp, split by role
 * when the face straddles the zero-draft curve.
 */
function clusterFaces(tris, roleOf, faceInfo) {
  const parent = tris.map((_, i) => i);
  const find = (i) => {
    let x = i;
    while (parent[x] !== x) x = parent[x];
    let y = i;
    while (parent[y] !== y) {
      const next = parent[y];
      parent[y] = x;
      y = next;
    }
    return x;
  };
  const unite = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pb] = pa;
  };
  const buckets = new Map();
  tris.forEach((tri, i) => {
    if (faceIndexAt(tri.t, faceInfo) >= 0) return;
    for (const v of [tri.ia, tri.ib, tri.ic]) {
      const key = `${roleOf[i]}:${v}`;
      let list = buckets.get(key);
      if (!list) {
        list = [];
        buckets.set(key, list);
      }
      list.push(i);
    }
  });
  for (const list of buckets.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const ia = list[a];
        const ib = list[b];
        if (dot(tris[ia].n, tris[ib].n) >= CLUSTER_COS) unite(ia, ib);
      }
    }
  }
  const groups = new Map();
  tris.forEach((tri, i) => {
    const stamped = faceIndexAt(tri.t, faceInfo);
    const key = stamped >= 0 ? `s:${stamped}:${roleOf[i]}` : `u:${find(i)}`;
    let group = groups.get(key);
    if (!group) {
      group = { stamped, name: stamped >= 0 ? faceNameAt(tri.t, faceInfo) : null, members: [], role: roleOf[i] };
      groups.set(key, group);
    }
    group.members.push(i);
  });
  const faces = [];
  for (const group of groups.values()) {
    let area = 0;
    const normal = [0, 0, 0];
    for (const i of group.members) {
      const tri = tris[i];
      area += tri.area;
      for (let k = 0; k < 3; k++) normal[k] += tri.n[k] * tri.area;
    }
    faces.push({
      name: group.name,
      role: group.role === 'cavity' ? 'cavity' : 'core',
      area: round(area),
      triangleCount: group.members.length,
      normal: round3(unit(normal) || [0, 0, 0]),
    });
  }
  faces.sort((a, b) => {
    if (a.name && b.name && a.name !== b.name) return a.name < b.name ? -1 : 1;
    if (a.name && !b.name) return -1;
    if (!a.name && b.name) return 1;
    if (a.role !== b.role) return a.role < b.role ? -1 : 1;
    return b.area - a.area;
  });
  faces.forEach((face, id) => { face.id = id; });
  return faces;
}

function boundarySegments(tris, roleOf, faceInfo) {
  const { canon, pos } = weldIndex(tris);
  const raw = [];
  const edgeSet = new Set();
  tris.forEach((tri, i) => {
    for (const [u0, w0] of [[tri.ia, tri.ib], [tri.ib, tri.ic], [tri.ic, tri.ia]]) {
      const u = canon.get(u0);
      const w = canon.get(w0);
      if (u == null || w == null || u === w) continue;
      raw.push({ u, w, i });
      edgeSet.add(vertexPairKey(u, w));
    }
  });
  const grid = vertexGrid(pos);
  const edges = new Map();
  const splitMin2 = SPLIT_MIN_MM * SPLIT_MIN_MM;
  for (const edge of raw) {
    const a = pos.get(edge.u);
    const b = pos.get(edge.w);
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    const ids = dx * dx + dy * dy + dz * dz < splitMin2
      ? [edge.u, edge.w]
      : splitIds(edge.u, edge.w, pos, grid, edgeSet);
    for (let k = 0; k + 1 < ids.length; k++) {
      const u = ids[k];
      const w = ids[k + 1];
      if (u === w) continue;
      const key = vertexPairKey(u, w);
      let list = edges.get(key);
      if (!list) {
        list = [];
        edges.set(key, list);
      }
      list.push({ i: edge.i, u, w });
    }
  }
  const segments = [];
  for (const list of edges.values()) {
    if (list.length < 2) continue;
    let core = null;
    let cavity = null;
    for (const entry of list) {
      const role = roleOf[entry.i];
      if (role === 'core' && !core) core = entry;
      else if (role === 'cavity' && !cavity) cavity = entry;
    }
    if (!core || !cavity) continue;
    const nameA = faceNameAt(tris[core.i].t, faceInfo);
    const nameB = faceNameAt(tris[cavity.i].t, faceInfo);
    segments.push({
      u: core.u,
      w: core.w,
      name: nameA && nameB ? canonicalEdgeName(nameA, nameB) : null,
    });
  }
  return segments;
}

function stepFrom(adj, segments, used, cur, prev) {
  const options = adj.get(cur) || [];
  for (const si of options) {
    if (used.has(si)) continue;
    const seg = segments[si];
    const other = seg.u === cur ? seg.w : seg.u;
    if (other === prev && options.length > 1) continue;
    return si;
  }
  return -1;
}

function walkChains(segments) {
  const adj = new Map();
  segments.forEach((seg, i) => {
    for (const v of [seg.u, seg.w]) {
      let list = adj.get(v);
      if (!list) {
        list = [];
        adj.set(v, list);
      }
      list.push(i);
    }
  });
  const used = new Set();
  const chains = [];
  for (let s = 0; s < segments.length; s++) {
    if (used.has(s)) continue;
    used.add(s);
    const names = [];
    if (segments[s].name) names.push(segments[s].name);
    const forward = [];
    let prev = segments[s].u;
    let cur = segments[s].w;
    forward.push(cur);
    let guard = segments.length + 2;
    let closed = false;
    while (guard > 0) {
      guard -= 1;
      if (cur === segments[s].u) {
        closed = true;
        forward.pop();
        break;
      }
      const next = stepFrom(adj, segments, used, cur, prev);
      if (next < 0) break;
      used.add(next);
      const seg = segments[next];
      if (seg.name) names.push(seg.name);
      prev = cur;
      cur = seg.u === cur ? seg.w : seg.u;
      forward.push(cur);
    }
    const backward = [];
    if (!closed) {
      prev = segments[s].w;
      cur = segments[s].u;
      backward.push(cur);
      guard = segments.length + 2;
      while (guard > 0) {
        guard -= 1;
        const next = stepFrom(adj, segments, used, cur, prev);
        if (next < 0) break;
        used.add(next);
        const seg = segments[next];
        if (seg.name) names.push(seg.name);
        prev = cur;
        cur = seg.u === cur ? seg.w : seg.u;
        backward.push(cur);
      }
    }
    const head = closed ? [segments[s].u] : backward.reverse();
    const verts = head.concat(forward);
    if (verts.length >= 2) chains.push({ verts, closed, names });
  }
  return chains;
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const yi = poly[i][1];
    const yj = poly[j][1];
    const xi = poly[i][0];
    const xj = poly[j][0];
    const hit = (yi > pt[1]) !== (yj > pt[1])
      && pt[0] < ((xj - xi) * (pt[1] - yi)) / ((yj - yi) || 1e-18) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function outerPolyline(tris, roleOf, pull, faceInfo) {
  const segments = boundarySegments(tris, roleOf, faceInfo);
  if (!segments.length) return [];
  const pos = new Map();
  for (const tri of tris) {
    pos.set(tri.ia, tri.a);
    pos.set(tri.ib, tri.b);
    pos.set(tri.ic, tri.c);
  }
  const { u, v } = basisOf(pull);
  const measured = walkChains(segments).map((chain) => {
    const points = chain.verts.map((index) => pos.get(index) || [0, 0, 0]);
    const poly = points.map((p) => [dot(p, u), dot(p, v)]);
    let perimeter = 0;
    let area = 0;
    let length = 0;
    const center = [0, 0, 0];
    const nPts = poly.length;
    for (let i = 0; i < nPts; i++) {
      const j = (i + 1) % nPts;
      const a = poly[i];
      const b = chain.closed ? poly[j] : (i + 1 < nPts ? poly[i + 1] : null);
      if (!b) break;
      const pa = points[i];
      const pb = points[chain.closed ? j : i + 1];
      const edge = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      length += edge;
      perimeter += Math.hypot(a[0] - b[0], a[1] - b[1]);
      area += a[0] * b[1] - b[0] * a[1];
      for (let k = 0; k < 3; k++) center[k] += (pa[k] + pb[k]) * 0.5 * (edge || 1);
    }
    const weight = length || nPts;
    const centroid = [0, 0];
    for (const p of poly) {
      centroid[0] += p[0];
      centroid[1] += p[1];
    }
    centroid[0] /= nPts || 1;
    centroid[1] /= nPts || 1;
    return {
      chain,
      points,
      poly,
      perimeter,
      area: Math.abs(area) * 0.5,
      length,
      center: center.map((c) => c / weight),
      centroid,
    };
  });
  const closed = measured.filter((row) => row.chain.closed && row.points.length >= 3);
  const pool = closed.length ? closed : measured;
  const outermost = pool.filter((row) => !pool.some((other) => (
    other !== row
    && other.area > row.area * 1.001
    && other.chain.closed
    && pointInPoly(row.centroid, other.poly)
  )));
  outermost.sort((a, b) => b.perimeter - a.perimeter || b.length - a.length);
  const chosen = outermost[0];
  if (!chosen) return [];
  const names = [];
  const seen = new Set();
  for (const name of chosen.chain.names) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  names.sort();
  return [{
    id: 0,
    name: null,
    edgeNames: names,
    faces: null,
    length: round(chosen.length),
    projectedPerimeter: round(chosen.perimeter),
    closed: chosen.chain.closed,
    segmentCount: chosen.chain.closed ? chosen.points.length : chosen.points.length - 1,
    center: round3(chosen.center),
    points: chosen.points.map((p) => round3(p)),
  }];
}

/**
 * Classify `tris` (the rows `prepareTriangles` builds) along a pull.
 * `faceInfo` is `{ triFace, names }` from `stampedFaceTable` when the mesh
 * has stamps. Returns null when the pull is zero.
 */
export function classifyParting(tris, pull, faceInfo = null) {
  const d = unit(pull);
  if (!d || !Array.isArray(tris) || !tris.length) return null;
  const roleOf = assignRoles(tris, d, faceInfo);
  let zeroDraft = 0;
  const roleByTriangle = tris.map((tri, i) => {
    const n = tri.nGeom || tri.n;
    const vertical = !!(n && Math.abs(dot(n, d)) <= ZERO_SIN);
    if (vertical) zeroDraft += tri.area;
    const row = { index: tri.t, role: roleOf[i] };
    if (vertical) row.zeroDraft = true;
    return row;
  });
  const faces = clusterFaces(tris, roleOf, faceInfo);
  const counts = { core: 0, cavity: 0, parting: 0 };
  const areas = { core: 0, cavity: 0, parting: 0, zeroDraft: round(zeroDraft) };
  for (const face of faces) {
    counts[face.role] += 1;
    areas[face.role] = round(areas[face.role] + face.area);
  }
  const lines = outerPolyline(tris, roleOf, d, faceInfo);
  return {
    neutralDeg: PARTING_NEUTRAL_DEG,
    faces,
    counts,
    areas,
    lines,
    triangles: roleByTriangle,
  };
}

/** Legend rows. Zero-draft is a paint class on top of core or cavity, not an area bucket. */
export function partingLegendModel(parting) {
  if (!parting?.counts) return null;
  return {
    rows: [
      { role: 'core', label: 'Core', css: rgbCss(PARTING_ROLE_RGB.core) },
      { role: 'cavity', label: 'Cavity', css: rgbCss(PARTING_ROLE_RGB.cavity) },
      { role: 'zero-draft', label: 'Zero-draft', css: rgbCss(PARTING_ZERO_DRAFT_RGB) },
      { role: 'parting-line', label: 'Parting line', css: rgbCss(PARTING_LINE_RGB) },
    ],
  };
}
