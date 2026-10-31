/**
 * Core / cavity split and the parting line (injection molding, M2.1).
 *
 * The pull is the one M1 already chose. A triangle whose normal faces that
 * pull (n · d above the 10° band) is cavity. One that faces the other way
 * is core. The band in between is parting-adjacent: a side wall, not a
 * shutoff by itself. That 10° is `MOLD_NEUTRAL_DEG` in `pullDirection.js`.
 *
 * The parting line is every mesh edge whose two triangles are different
 * roles. When both triangles belong to stamped faces, the edge keeps the
 * name `chainNamedEdges` would write (`src/lib/surfcad/namedEdges.js`).
 * An unstamped mesh is chained into loops instead, so a box reports the
 * top loop and the bottom loop.
 */

import { chainNamedEdges, vertexPairKey } from '../lib/surfcad/namedEdges.js';

/** Matches `MOLD_NEUTRAL_DEG`. Side walls inside this band are parting-adjacent. */
export const PARTING_NEUTRAL_DEG = 10;
/** Matches `MOLD_REGION_NORMAL_DEG`. Unstamped triangles this close stay one face. */
export const PARTING_CLUSTER_DEG = 35;

const NEUTRAL_SIN = Math.sin((PARTING_NEUTRAL_DEG * Math.PI) / 180);
const CLUSTER_COS = Math.cos((PARTING_CLUSTER_DEG * Math.PI) / 180);

/** Discrete skin colours. Not stress, and not a CSS token. */
export const PARTING_ROLE_RGB = Object.freeze({
  cavity: Object.freeze([0.18, 0.45, 0.78]),
  core: Object.freeze([0.72, 0.36, 0.18]),
  parting: Object.freeze([0.62, 0.64, 0.68]),
});

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

function round(n, places = 6) {
  const f = 10 ** places;
  const v = Math.round(n * f) / f;
  return Object.is(v, -0) ? 0 : v;
}

function round3(v) {
  return [round(v[0]), round(v[1]), round(v[2])];
}

/** `cavity`, `core`, or `parting` for a unit normal and a unit pull. */
export function triangleRole(normal, pull) {
  const d = dot(normal, pull);
  if (d > NEUTRAL_SIN) return 'cavity';
  if (d < -NEUTRAL_SIN) return 'core';
  return 'parting';
}

function rgbCss(rgb) {
  const [r, g, b] = rgb.map((channel) => Math.round(channel * 255));
  return `rgb(${r}, ${g}, ${b})`;
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

/**
 * Unstamped triangles of one role that share a vertex and agree within
 * 35° are one face. Stamped triangles stay on their stamp instead.
 */
function clusterFaces(tris, roleOf, faceInfo) {
  const parent = tris.map((_, i) => i);
  const find = (i) => {
    let x = i;
    while (parent[x] !== x) x = parent[x];
    let y = i;
    while (parent[y] !== y) {
      const n = parent[y];
      parent[y] = x;
      y = n;
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
      if (!list) { list = []; buckets.set(key, list); }
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
    const key = stamped >= 0 ? `s:${stamped}` : `u:${find(i)}`;
    let group = groups.get(key);
    if (!group) {
      group = { stamped, name: stamped >= 0 ? faceNameAt(tri.t, faceInfo) : null, members: [] };
      groups.set(key, group);
    }
    group.members.push(i);
  });
  const faces = [];
  for (const group of groups.values()) {
    const areaOf = { core: 0, cavity: 0, parting: 0 };
    let area = 0;
    const normal = [0, 0, 0];
    for (const i of group.members) {
      const tri = tris[i];
      area += tri.area;
      areaOf[roleOf[i]] += tri.area;
      for (let k = 0; k < 3; k++) normal[k] += tri.n[k] * tri.area;
    }
    let role = 'parting';
    if (areaOf.cavity > areaOf[role]) role = 'cavity';
    if (areaOf.core > areaOf[role]) role = 'core';
    faces.push({
      name: group.name,
      role,
      area: round(area),
      triangleCount: group.members.length,
      normal: round3(unit(normal) || [0, 0, 0]),
    });
  }
  faces.sort((a, b) => {
    if (a.name && b.name && a.name !== b.name) return a.name < b.name ? -1 : 1;
    if (a.name && !b.name) return -1;
    if (!a.name && b.name) return 1;
    return a.role < b.role ? -1 : a.role > b.role ? 1 : b.area - a.area;
  });
  faces.forEach((face, id) => { face.id = id; });
  return faces;
}

function edgeLength(trisByT, u, w) {
  const sample = trisByT.values().next().value;
  if (!sample) return 0;
  const pos = new Map();
  for (const tri of trisByT.values()) {
    pos.set(tri.ia, tri.a);
    pos.set(tri.ib, tri.b);
    pos.set(tri.ic, tri.c);
  }
  const a = pos.get(u);
  const b = pos.get(w);
  if (!a || !b) return 0;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function midpoint(trisByT, u, w) {
  const pos = new Map();
  for (const tri of trisByT.values()) {
    pos.set(tri.ia, tri.a);
    pos.set(tri.ib, tri.b);
    pos.set(tri.ic, tri.c);
  }
  const a = pos.get(u);
  const b = pos.get(w);
  if (!a || !b) return [0, 0, 0];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function chainLoops(segments, trisByT) {
  if (!segments.length) return [];
  const parent = segments.map((_, i) => i);
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
  const at = new Map();
  segments.forEach((seg, i) => {
    for (const v of [seg.u, seg.w]) {
      const prev = at.get(v);
      if (prev != null) unite(prev, i);
      else at.set(v, i);
    }
  });
  const groups = new Map();
  segments.forEach((seg, i) => {
    const root = find(i);
    let list = groups.get(root);
    if (!list) { list = []; groups.set(root, list); }
    list.push(seg);
  });
  const chains = [];
  for (const list of groups.values()) {
    const degree = new Map();
    let length = 0;
    const center = [0, 0, 0];
    for (const seg of list) {
      const L = edgeLength(trisByT, seg.u, seg.w);
      length += L;
      const mid = midpoint(trisByT, seg.u, seg.w);
      for (let k = 0; k < 3; k++) center[k] += mid[k] * (L || 1);
      degree.set(seg.u, (degree.get(seg.u) || 0) + 1);
      degree.set(seg.w, (degree.get(seg.w) || 0) + 1);
    }
    const weight = length || list.length;
    let closed = true;
    for (const d of degree.values()) if (d === 1) closed = false;
    chains.push({
      name: null,
      faces: null,
      length: round(length),
      closed,
      segmentCount: list.length,
      center: round3(center.map((c) => c / weight)),
    });
  }
  chains.sort((a, b) => a.center[0] - b.center[0] || a.center[1] - b.center[1] || a.center[2] - b.center[2] || b.length - a.length);
  return chains;
}

function namedFromIndices(tris, triFace, names, faceRole, posAt) {
  let nTri = 0;
  for (const tri of tris) if (tri.t + 1 > nTri) nTri = tri.t + 1;
  const triVerts = new Array(nTri * 3).fill(0);
  for (const tri of tris) {
    triVerts[tri.t * 3] = tri.ia;
    triVerts[tri.t * 3 + 1] = tri.ib;
    triVerts[tri.t * 3 + 2] = tri.ic;
  }
  const edges = chainNamedEdges({
    nTri,
    triVerts,
    posAt,
    triFace,
    faceName: (fi) => names[fi],
  });
  const lines = [];
  const used = new Set();
  for (const edge of edges) {
    const [nameA, nameB] = edge.faces;
    const ia = names.indexOf(nameA);
    const ib = names.indexOf(nameB);
    if (ia < 0 || ib < 0) continue;
    if (faceRole(ia) === faceRole(ib)) continue;
    lines.push({
      name: edge.name,
      faces: [nameA, nameB],
      length: round(edge.length),
      closed: edge.closed,
      segmentCount: edge.segments.length,
      center: round3(edge.center),
    });
    for (const [u, w] of edge.segments) used.add(vertexPairKey(u, w));
  }
  return { lines, used };
}

/**
 * Classify `tris` (the rows `prepareTriangles` builds) along a pull.
 * `faceInfo` is `{ triFace, names }` from `stampedFaceTable` when the mesh
 * has stamps. Returns null when the pull is zero.
 */
export function classifyParting(tris, pull, faceInfo = null) {
  const d = unit(pull);
  if (!d || !Array.isArray(tris) || !tris.length) return null;
  const roleOf = tris.map((tri) => triangleRole(tri.n, d));
  const roleByTriangle = tris.map((tri, i) => ({ index: tri.t, role: roleOf[i] }));
  const faces = clusterFaces(tris, roleOf, faceInfo);
  const counts = { core: 0, cavity: 0, parting: 0 };
  const areas = { core: 0, cavity: 0, parting: 0 };
  for (const face of faces) {
    counts[face.role] += 1;
    areas[face.role] = round(areas[face.role] + face.area);
  }
  const trisByT = new Map(tris.map((tri) => [tri.t, tri]));
  const named = faceInfo?.names?.length
    ? namedFromIndices(
      tris,
      (() => {
        let nTri = 0;
        for (const tri of tris) if (tri.t + 1 > nTri) nTri = tri.t + 1;
        const triFace = new Array(nTri).fill(-1);
        const src = faceInfo.triFace;
        const names = faceInfo.names;
        for (const tri of tris) {
          const fi = src?.[tri.t];
          triFace[tri.t] = fi >= 0 && names[fi] ? fi : -1;
        }
        return triFace;
      })(),
      faceInfo.names,
      (fi) => {
        const areaOf = { core: 0, cavity: 0, parting: 0 };
        tris.forEach((tri, i) => {
          if (faceInfo.triFace?.[tri.t] !== fi) return;
          areaOf[roleOf[i]] += tri.area;
        });
        let role = 'parting';
        if (areaOf.cavity > areaOf[role]) role = 'cavity';
        if (areaOf.core > areaOf[role]) role = 'core';
        return role;
      },
      (v) => {
        for (const tri of tris) {
          if (tri.ia === v) return tri.a;
          if (tri.ib === v) return tri.b;
          if (tri.ic === v) return tri.c;
        }
        return [0, 0, 0];
      },
    )
    : { lines: [], used: new Set() };

  const loose = [];
  const seen = new Map();
  for (const tri of tris) {
    for (const [u, w] of [[tri.ia, tri.ib], [tri.ib, tri.ic], [tri.ic, tri.ia]]) {
      const key = vertexPairKey(u, w);
      const prev = seen.get(key);
      if (prev == null) { seen.set(key, tri.t); continue; }
      if (named.used.has(key)) continue;
      const ra = roleOf[tris.findIndex((row) => row.t === prev)];
      const rb = roleOf[tris.findIndex((row) => row.t === tri.t)];
      if (!ra || !rb || ra === rb) continue;
      const nameA = faceNameAt(prev, faceInfo);
      const nameB = faceNameAt(tri.t, faceInfo);
      if (nameA && nameB) continue;
      loose.push({ u, w, t0: prev, t1: tri.t });
    }
  }
  const lines = [...named.lines, ...chainLoops(loose, trisByT)];
  lines.forEach((line, id) => { line.id = id; });
  return {
    neutralDeg: PARTING_NEUTRAL_DEG,
    faces,
    counts,
    areas,
    lines,
    triangles: roleByTriangle,
  };
}

/** Legend rows for the parting overlay. Null without a classification. */
export function partingLegendModel(parting) {
  if (!parting?.counts) return null;
  const rows = [
    { role: 'cavity', label: 'Cavity', count: parting.counts.cavity, css: rgbCss(PARTING_ROLE_RGB.cavity) },
    { role: 'core', label: 'Core', count: parting.counts.core, css: rgbCss(PARTING_ROLE_RGB.core) },
    { role: 'parting', label: 'Parting', count: parting.counts.parting, css: rgbCss(PARTING_ROLE_RGB.parting) },
  ];
  const named = (parting.lines || []).filter((line) => line.name).map((line) => line.name);
  return {
    rows,
    lineCount: parting.lines?.length || 0,
    named: named.slice(0, 4),
    namedMore: Math.max(0, named.length - 4),
  };
}
