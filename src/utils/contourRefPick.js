/**
 * Part references for Dimension and Constrain.
 *
 * The sketch hit-test runs first at 12 px. This module is the second pass:
 * vertices, then edges, then a face outline. The face outline is that face's
 * boundary loop. The stored geom is the edge under the cursor, which is what
 * a constraint binds. Only the contour's own part is passed in.
 */

import { projectPoint, projectReference } from './contourRef.js';
import { CONTOUR_PICK_COLOR } from './contourStatus.js';

/** Muted zinc, under the sketch strokes. */
export const CONTOUR_REF_COLOR = 0x71717a;

/** Broken reference. Still dashed, still under the sketch strokes. */
export const CONTOUR_REF_BROKEN_COLOR = 0xef4444;

const MID_TOL_MM = 1e-3;

export function referencePickAllowed(gesture) {
  return gesture === 'dimension' || gesture === 'constraints';
}

function dist3(a, b) {
  return Math.hypot((a?.[0] || 0) - (b?.[0] || 0), (a?.[1] || 0) - (b?.[1] || 0), (a?.[2] || 0) - (b?.[2] || 0));
}

function distPoint(px, py, q) {
  if (!q) return Infinity;
  return Math.hypot(px - q.x, py - q.y);
}

function distSegment(px, py, a, b) {
  if (!a || !b) return Infinity;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return distPoint(px, py, a);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function distChain(px, py, screen) {
  let best = Infinity;
  for (let i = 1; i < screen.length; i += 1) {
    best = Math.min(best, distSegment(px, py, screen[i - 1], screen[i]));
  }
  if (screen.length === 1) best = distPoint(px, py, screen[0]);
  return best;
}

/** Ordered world polylines for one boundary's segments. */
export function chainSegments(segments) {
  const list = Array.isArray(segments) ? segments : [];
  if (!list.length) return [];
  const unused = new Set(list.map((_, i) => i));
  const atVert = new Map();
  list.forEach((seg, i) => {
    for (const v of [seg.a, seg.b]) {
      if (!atVert.has(v)) atVert.set(v, []);
      atVert.get(v).push(i);
    }
  });
  const polylines = [];
  while (unused.size) {
    const start = unused.values().next().value;
    unused.delete(start);
    const seg = list[start];
    const pts = [seg.va.slice(), seg.vb.slice()];
    const verts = [seg.a, seg.b];
    const extend = (atStart) => {
      let guard = 0;
      while (guard < list.length + 2) {
        guard += 1;
        const vertex = atStart ? verts[0] : verts[verts.length - 1];
        const next = (atVert.get(vertex) || []).find((i) => unused.has(i));
        if (next == null) return;
        unused.delete(next);
        const s = list[next];
        const forward = s.a === vertex;
        const point = forward ? s.vb : s.va;
        const other = forward ? s.b : s.a;
        if (atStart) {
          pts.unshift(point.slice());
          verts.unshift(other);
        } else {
          pts.push(point.slice());
          verts.push(other);
        }
      }
    };
    extend(false);
    extend(true);
    polylines.push(pts);
  }
  return polylines;
}

function boundaryChain(edge) {
  const chains = chainSegments(edge?.segments || []);
  return chains[0] || null;
}

function pairKey(a, b) {
  const lo = Math.min(Number(a), Number(b));
  const hi = Math.max(Number(a), Number(b));
  return `${lo}:${hi}`;
}

function nearMid(a, b) {
  return Array.isArray(a) && Array.isArray(b) && dist3(a, b) <= MID_TOL_MM;
}

export function sameReference(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'face') {
    return Number(a.faceId) === Number(b.faceId)
      && a.boundary && b.boundary
      && pairKey(a.boundary.faceA, a.boundary.faceB) === pairKey(b.boundary.faceA, b.boundary.faceB)
      && nearMid(a.boundary.mid, b.boundary.mid);
  }
  if (pairKey(a.faceA, a.faceB) !== pairKey(b.faceA, b.faceB) || !nearMid(a.mid, b.mid)) return false;
  if (a.kind === 'vertex') return Number(a.end) === Number(b.end);
  return true;
}

export function nextReferenceId(refs) {
  let max = -1;
  for (const ref of refs || []) {
    const m = /^r(\d+)$/.exec(ref.id || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `r${max + 1}`;
}

function screenOf(project, world) {
  if (typeof project !== 'function' || !world) return null;
  return project(world);
}

/**
 * Nearest part vertex inside the slop. Closed rims have no free end.
 * @returns {object|null}
 */
export function vertexHit(edges, project, px, py, threshold) {
  const limit = threshold > 0 ? threshold : 12;
  let best = null;
  let bestD = limit;
  for (const edge of edges || []) {
    const poly = boundaryChain(edge);
    if (!poly || poly.length < 2) continue;
    if (dist3(poly[0], poly[poly.length - 1]) <= MID_TOL_MM) continue;
    const ends = [{ end: 0, world: poly[0] }, { end: 1, world: poly[poly.length - 1] }];
    for (const item of ends) {
      const s = screenOf(project, item.world);
      const d = distPoint(px, py, s);
      if (d <= bestD) {
        bestD = d;
        best = {
          kind: 'vertex',
          faceA: edge.faceA,
          faceB: edge.faceB,
          mid: edge.mid,
          end: item.end,
          worldPoints: [item.world.slice()],
        };
      }
    }
  }
  return best;
}

/** The boundary a feature-edge segment belongs to, as one reference hit. */
export function edgeReferenceHit(topo, featureEdge) {
  if (!featureEdge) return null;
  const edges = topo?.edges || [];
  const boundary = edges.find((edge) => edge.id === featureEdge.boundaryId)
    || edges.find((edge) => (edge.segments || []).some((seg) => seg.key && seg.key === featureEdge.key));
  if (!boundary) return null;
  const worldPoints = boundaryChain(boundary);
  if (!worldPoints || worldPoints.length < 2) return null;
  return {
    kind: 'edge',
    faceA: boundary.faceA,
    faceB: boundary.faceB,
    mid: boundary.mid,
    worldPoints,
  };
}

/**
 * Screen-space edges after a vertex miss. The viewport uses
 * pickNearestEdgeScreen for this tier; this is the same 12 px order for tests.
 */
export function edgeHit(edges, project, px, py, threshold) {
  const limit = threshold > 0 ? threshold : 12;
  let best = null;
  let bestD = limit;
  for (const edge of edges || []) {
    const worldPoints = boundaryChain(edge);
    if (!worldPoints || worldPoints.length < 2) continue;
    const screen = worldPoints.map((p) => screenOf(project, p)).filter(Boolean);
    const d = distChain(px, py, screen);
    if (d <= bestD) {
      bestD = d;
      best = {
        kind: 'edge',
        faceA: edge.faceA,
        faceB: edge.faceB,
        mid: edge.mid,
        worldPoints,
      };
    }
  }
  return best;
}

function faceSegments(edges, faceId) {
  const segs = [];
  for (const edge of edges || []) {
    if (edge.faceA !== faceId && edge.faceB !== faceId) continue;
    for (const seg of edge.segments || []) segs.push(seg);
  }
  return segs;
}

/**
 * The face's boundary loop, bound to the edge nearest the cursor.
 * The caller only asks after vertices and edges missed.
 */
export function faceOutlineHit(edges, faceId, project, px, py) {
  if (faceId == null) return null;
  const owned = (edges || []).filter((edge) => edge.faceA === faceId || edge.faceB === faceId);
  if (!owned.length) return null;
  const loops = chainSegments(faceSegments(edges, faceId));
  if (!loops.length) return null;
  let loopWorld = loops[0];
  let loopD = Infinity;
  for (const loop of loops) {
    const screen = loop.map((p) => screenOf(project, p)).filter(Boolean);
    const d = distChain(px, py, screen);
    if (d < loopD) {
      loopD = d;
      loopWorld = loop;
    }
  }
  let bound = null;
  let boundD = Infinity;
  for (const edge of owned) {
    const worldPoints = boundaryChain(edge);
    if (!worldPoints) continue;
    const screen = worldPoints.map((p) => screenOf(project, p)).filter(Boolean);
    const d = distChain(px, py, screen);
    if (d < boundD) {
      boundD = d;
      bound = { edge, worldPoints };
    }
  }
  if (!bound) return null;
  return {
    kind: 'face',
    faceId,
    faceA: bound.edge.faceA,
    faceB: bound.edge.faceB,
    mid: bound.edge.mid,
    worldPoints: bound.worldPoints,
    loopWorld,
  };
}

/**
 * Vertices, then edges. A face outline is a later pass.
 * @returns {object|null}
 */
export function pickReferenceScreen(edges, project, px, py, threshold = 12) {
  return vertexHit(edges, project, px, py, threshold)
    || edgeHit(edges, project, px, py, threshold)
    || null;
}

/** Active-part edges only. An edge tagged with another part is ignored. */
export function referenceEdgesForPart(featureEdges, partId) {
  const id = partId == null || partId === '' ? null : String(partId);
  return (featureEdges || []).filter((edge) => {
    if (edge?.partId == null || edge.partId === '') return true;
    return id != null && String(edge.partId) === id;
  });
}

/** Project the hit. A collapsed edge is not a reference. */
export function materializeReference(plane, hit) {
  if (!plane || !hit?.worldPoints?.length) return null;
  let projected;
  try {
    projected = projectReference(plane, hit.worldPoints);
  } catch {
    return null;
  }
  if (!projected?.geom) return null;
  const ref = { kind: hit.kind, geom: projected.geom };
  if (hit.kind === 'face') {
    ref.faceId = hit.faceId;
    ref.boundary = {
      faceA: hit.faceA,
      faceB: hit.faceB,
      mid: hit.mid.slice(),
    };
    try {
      ref.loop = (hit.loopWorld || []).map((p) => projectPoint(plane, p));
    } catch {
      ref.loop = [];
    }
    return ref;
  }
  ref.faceA = hit.faceA;
  ref.faceB = hit.faceB;
  ref.mid = hit.mid.slice();
  if (hit.kind === 'vertex') ref.end = hit.end;
  return ref;
}

/** Where the broken tag sits, in plane UV. */
export function referenceTagAnchor(ref) {
  const geom = ref?.geom;
  if (!geom) return null;
  if (geom.kind === 'point' && Array.isArray(geom.at)) return geom.at.slice();
  if (geom.kind === 'line' && geom.a && geom.b) {
    return [(geom.a[0] + geom.b[0]) / 2, (geom.a[1] + geom.b[1]) / 2];
  }
  if (geom.kind === 'polyline' && geom.points?.length) {
    const p = geom.points[Math.floor((geom.points.length - 1) / 2)];
    return p.slice();
  }
  if (geom.kind === 'arc' && Array.isArray(geom.center)) return geom.center.slice();
  return null;
}

export function referencePickItem(ref, at) {
  const item = {
    kind: 'ref',
    id: ref.id,
    geomKind: ref.geom?.kind || 'line',
    label: ref.id,
  };
  if (Array.isArray(at) && at.length >= 2) item.at = [at[0], at[1]];
  return item;
}

function sampleArc(geom) {
  const c = geom.center;
  const r = Number(geom.radius) || 0;
  if (!c || !(r > 0)) return [];
  if (geom.full) {
    const n = 24;
    const pts = [];
    for (let i = 0; i <= n; i += 1) {
      const t = (i / n) * Math.PI * 2;
      pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
    }
    return pts;
  }
  const start = (Number(geom.start) || 0) * Math.PI / 180;
  const end = (Number(geom.end) || 0) * Math.PI / 180;
  let delta = geom.sweep === 'cw' ? start - end : end - start;
  if (delta <= 1e-12) delta += Math.PI * 2;
  const n = 16;
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const t = start + (geom.sweep === 'cw' ? -1 : 1) * delta * (i / n);
    pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return pts;
}

function geomPolylines(geom) {
  if (!geom) return [];
  if (geom.kind === 'line' && geom.a && geom.b) return [[geom.a, geom.b]];
  if (geom.kind === 'polyline' && geom.points?.length >= 2) return [geom.points];
  if (geom.kind === 'arc') {
    const pts = sampleArc(geom);
    return pts.length >= 2 ? [pts] : [];
  }
  if (geom.kind === 'point' && geom.at) {
    const [u, v] = geom.at;
    const arm = 0.8;
    return [
      [[u - arm, v], [u + arm, v]],
      [[u, v - arm], [u, v + arm]],
    ];
  }
  return [];
}

/**
 * Dashed strokes for the overlay. A face draws its loop. The bound edge is
 * the one that takes the picked colour. No point handles.
 */
export function referencePaintSegments(spec, picks) {
  const selected = new Set((picks || []).filter((p) => p?.kind === 'ref' && p.id).map((p) => p.id));
  const out = [];
  for (const ref of spec?.refs || []) {
    const picked = selected.has(ref.id);
    const broken = !!ref.broken;
    const color = broken
      ? CONTOUR_REF_BROKEN_COLOR
      : (picked ? CONTOUR_PICK_COLOR : CONTOUR_REF_COLOR);
    if (ref.kind === 'face' && Array.isArray(ref.loop) && ref.loop.length >= 2) {
      out.push({
        id: ref.id,
        uvs: ref.loop.map((p) => p.slice()),
        picked: false,
        broken,
        color: broken ? CONTOUR_REF_BROKEN_COLOR : CONTOUR_REF_COLOR,
      });
      for (const uvs of geomPolylines(ref.geom)) {
        if (!picked && !broken) continue;
        out.push({
          id: ref.id,
          uvs,
          picked: !broken && picked,
          broken,
          color,
        });
      }
      continue;
    }
    for (const uvs of geomPolylines(ref.geom)) {
      out.push({
        id: ref.id,
        uvs,
        picked: !broken && picked,
        broken,
        color,
      });
    }
  }
  return out;
}
