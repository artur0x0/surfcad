/**
 * Snap a contour point to an edge while drawing or dragging.
 *
 * The radius is screen pixels, the same 12 px as a sketch tap. An endpoint
 * inside that radius wins over every edge, including a closer one. Targets
 * are part reference edges (sheet refKeys and mesh boundaries) and sketch
 * lines and arcs. Release adds one coincident with two live targets: the
 * point and the edge (on the segment for a reference), or the point and
 * the other endpoint. Dimension, Constrain, Arc, and the Cursor tool do
 * not snap, so those picks keep the cursor.
 */

import { contourFromPolyline, solveContour } from './contourSolve.js';
import { buildConstraint, specFromSolved } from './contourGesture.js';
import { chainSegments, nextReferenceId, sameReference } from './contourRefPick.js';
import { assignSeq } from './contourStrip.js';

export const CONTOUR_SNAP_PX = 12;

/** Two sheet skins can share a screen line. Inside this, the nearer edge wins. */
const COLLINEAR_TIE_PX = 0.75;

const CLOSED_MM = 1e-3;

export function contourSnapAllowed(state) {
  if (!state || state.gesture) return false;
  if (state.tool === 'cursor') return false;
  return true;
}

function dist2(a, b) {
  return Math.hypot((a?.[0] || 0) - (b?.[0] || 0), (a?.[1] || 0) - (b?.[1] || 0));
}

function screenDist(x, y, p) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return Infinity;
  return Math.hypot(x - p.x, y - p.y);
}

function closestOnScreenSeg(x, y, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-12 ? ((x - a.x) * dx + (y - a.y) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const sx = a.x + t * dx;
  const sy = a.y + t * dy;
  return {
    x: sx,
    y: sy,
    t,
    d: Math.hypot(x - sx, y - sy),
  };
}

function prefer(d, bias, bestD, bestBias) {
  if (d < bestD - COLLINEAR_TIE_PX) return true;
  if (d > bestD + COLLINEAR_TIE_PX) return false;
  return (Number(bias) || 0) < bestBias - 1e-9;
}

/**
 * @param {object} args
 * @param {Array<{x:number,y:number,uv:number[],bias?:number,target:object}>} args.endpoints
 * @param {Array<{samples:Array<{x:number,y:number,uv:number[]}>,bias?:number,target:object}>} args.curves
 */
export function chooseContourSnap({
  x,
  y,
  radius = CONTOUR_SNAP_PX,
  endpoints = [],
  curves = [],
} = {}) {
  const limit = radius > 0 ? radius : CONTOUR_SNAP_PX;
  let bestEnd = null;
  let bestEndD = limit;
  let bestEndBias = Infinity;
  for (const end of endpoints) {
    const d = screenDist(x, y, end);
    if (d > limit) continue;
    if (!bestEnd || prefer(d, end.bias, bestEndD, bestEndBias)) {
      bestEnd = end;
      bestEndD = d;
      bestEndBias = Number(end.bias) || 0;
    }
  }
  if (bestEnd) {
    return {
      role: 'endpoint',
      distance: bestEndD,
      uv: bestEnd.uv.slice(),
      screen: { x: bestEnd.x, y: bestEnd.y },
      target: bestEnd.target,
    };
  }
  let best = null;
  let bestD = limit;
  let bestBias = Infinity;
  for (const curve of curves) {
    const samples = curve.samples || [];
    for (let i = 1; i < samples.length; i += 1) {
      const hit = closestOnScreenSeg(x, y, samples[i - 1], samples[i]);
      if (hit.d > limit) continue;
      if (best && !prefer(hit.d, curve.bias, bestD, bestBias)) continue;
      const a = samples[i - 1];
      const b = samples[i];
      bestD = hit.d;
      bestBias = Number(curve.bias) || 0;
      best = {
        curve,
        uv: [
          a.uv[0] + hit.t * (b.uv[0] - a.uv[0]),
          a.uv[1] + hit.t * (b.uv[1] - a.uv[1]),
        ],
        screen: { x: hit.x, y: hit.y },
      };
    }
  }
  if (!best) return null;
  return {
    role: 'edge',
    distance: bestD,
    uv: best.uv,
    screen: best.screen,
    target: best.curve.target,
  };
}

function pointAt(model, id) {
  const point = (model?.points || []).find((item) => item.id === id);
  return point?.at ? [point.at[0], point.at[1]] : null;
}

function projectSamples(uvs, projectUv) {
  const samples = [];
  for (const uv of uvs) {
    if (!uv) {
      if (samples.length) samples.push(null);
      continue;
    }
    const s = projectUv(uv);
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) {
      if (samples.length) samples.push(null);
      continue;
    }
    samples.push({ x: s.x, y: s.y, uv: [uv[0], uv[1]] });
  }
  const runs = [];
  let run = [];
  for (const sample of samples) {
    if (!sample) {
      if (run.length >= 2) runs.push(run);
      run = [];
      continue;
    }
    run.push(sample);
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}

function arcUvs(geom) {
  const c = geom.center;
  const r = Number(geom.radius) || 0;
  if (!c || !(r > 0)) return [];
  if (geom.full) {
    const n = 32;
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
  const n = 24;
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const t = start + (geom.sweep === 'cw' ? -1 : 1) * delta * (i / n);
    pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return pts;
}

function sketchArcUvs(model, arc) {
  const center = pointAt(model, arc.center);
  const r = Number(arc.radius) || 0;
  if (!center || !(r > 0)) return [];
  if (arc.full) return arcUvs({ center, radius: r, full: true });
  const start = pointAt(model, arc.start);
  const end = pointAt(model, arc.end);
  if (!start || !end) return arcUvs({ center, radius: r, full: true });
  const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const a1 = Math.atan2(end[1] - center[1], end[0] - center[0]);
  let delta = arc.sweep === 'cw' ? a0 - a1 : a1 - a0;
  if (delta <= 1e-12) delta += Math.PI * 2;
  const n = 24;
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const t = a0 + (arc.sweep === 'cw' ? -1 : 1) * delta * (i / n);
    pts.push([center[0] + r * Math.cos(t), center[1] + r * Math.sin(t)]);
  }
  return pts;
}

function closedChain(uvs) {
  return uvs.length >= 2 && dist2(uvs[0], uvs[uvs.length - 1]) <= CLOSED_MM;
}

function pushEndpoint(endpoints, uv, projectUv, target, bias) {
  const s = projectUv(uv);
  if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) return;
  endpoints.push({
    x: s.x,
    y: s.y,
    uv: [uv[0], uv[1]],
    bias,
    target,
  });
}

function vertexTarget(ref, uv, end) {
  return {
    kind: 'ref',
    ref: {
      kind: 'vertex',
      faceA: ref.faceA,
      faceB: ref.faceB,
      mid: ref.mid ? ref.mid.slice() : ref.mid,
      end,
      ...(ref.refKey ? { refKey: ref.refKey } : {}),
      geom: { kind: 'point', at: [uv[0], uv[1]] },
    },
  };
}

function refCurveUvs(geom) {
  if (!geom) return [];
  if (geom.kind === 'line' && geom.a && geom.b) return [[geom.a, geom.b]];
  if (geom.kind === 'polyline' && geom.points?.length >= 2) return [geom.points];
  if (geom.kind === 'arc') {
    const pts = arcUvs(geom);
    return pts.length >= 2 ? [pts] : [];
  }
  return [];
}

function refEndpoints(geom) {
  if (!geom) return [];
  if (geom.kind === 'point' && geom.at) return [geom.at];
  if (geom.kind === 'line' && geom.a && geom.b) return [geom.a, geom.b];
  if (geom.kind === 'polyline' && geom.points?.length >= 2 && !closedChain(geom.points)) {
    return [geom.points[0], geom.points[geom.points.length - 1]];
  }
  if (geom.kind === 'arc' && !geom.full) {
    const pts = arcUvs(geom);
    if (pts.length >= 2) return [pts[0], pts[pts.length - 1]];
  }
  return [];
}

function incidentLine(line, pointId) {
  return !!pointId && (line.a === pointId || line.b === pointId);
}

function incidentArc(arc, pointId) {
  return !!pointId && (arc.center === pointId || arc.start === pointId || arc.end === pointId);
}

/**
 * Screen candidates for one cursor position.
 * The dragged point and the lines and arcs that already end on it are left out,
 * so the point does not stick to its own edge.
 */
export function collectContourSnapCandidates({
  model,
  references = [],
  projectUv,
  excludePointId = null,
} = {}) {
  const endpoints = [];
  const curves = [];
  if (typeof projectUv !== 'function') return { endpoints, curves };
  for (const point of model?.points || []) {
    if (!point?.at || point.id === excludePointId) continue;
    pushEndpoint(endpoints, point.at, projectUv, { kind: 'point', id: point.id }, 0);
  }
  for (const line of model?.lines || []) {
    if (line.guide || incidentLine(line, excludePointId)) continue;
    const a = pointAt(model, line.a);
    const b = pointAt(model, line.b);
    if (!a || !b) continue;
    for (const samples of projectSamples([a, b], projectUv)) {
      curves.push({ samples, bias: 0, target: { kind: 'line', id: line.id } });
    }
  }
  for (const arc of model?.arcs || []) {
    if (incidentArc(arc, excludePointId)) continue;
    for (const samples of projectSamples(sketchArcUvs(model, arc), projectUv)) {
      curves.push({ samples, bias: 0, target: { kind: 'arc', id: arc.id } });
    }
  }
  for (const ref of references) {
    if (!ref?.geom) continue;
    const bias = Number(ref.bias) || 0;
    const ends = refEndpoints(ref.geom);
    ends.forEach((uv, index) => {
      const target = ref.geom.kind === 'point'
        ? { kind: 'ref', ref }
        : vertexTarget(ref, uv, index);
      pushEndpoint(endpoints, uv, projectUv, target, bias);
    });
    if (ref.geom.kind === 'point') continue;
    for (const chain of refCurveUvs(ref.geom)) {
      for (const samples of projectSamples(chain, projectUv)) {
        curves.push({
          samples,
          bias,
          target: { kind: 'ref', ref },
        });
      }
    }
  }
  return { endpoints, curves };
}

export function snapKey(snap) {
  const target = snap?.target;
  if (!target) return '';
  if (target.kind === 'ref') {
    const ref = target.ref || {};
    if (ref.refKey) return ref.kind === 'vertex' ? `${ref.refKey}#${ref.end}` : ref.refKey;
    return `${ref.kind || 'edge'}:${ref.faceA}:${ref.faceB}:${ref.end ?? ''}`;
  }
  return `${target.kind}:${target.id}`;
}

/**
 * Snap the cursor to a sketch or part edge.
 * @returns {null|{role:'endpoint'|'edge', distance:number, uv:number[], screen:{x:number,y:number}, target:object, key:string}}
 */
export function snapContourPoint({
  x,
  y,
  radius = CONTOUR_SNAP_PX,
  model,
  references,
  projectUv,
  excludePointId = null,
} = {}) {
  const { endpoints, curves } = collectContourSnapCandidates({
    model,
    references,
    projectUv,
    excludePointId,
  });
  const snap = chooseContourSnap({ x, y, radius, endpoints, curves });
  if (!snap) return null;
  return { ...snap, key: snapKey(snap) };
}

/** World polylines a snap can project. Sheet catalogs and mesh boundaries both qualify. */
export function referenceSnapHits(edges) {
  const hits = [];
  for (const edge of edges || []) {
    const worldPoints = chainSegments(edge.segments || [])[0];
    if (!worldPoints || worldPoints.length < 2) continue;
    const hit = {
      kind: 'edge',
      faceA: edge.faceA,
      faceB: edge.faceB,
      mid: edge.mid,
      worldPoints,
    };
    if (edge.refKey) hit.refKey = edge.refKey;
    hits.push(hit);
  }
  return hits;
}

function nextSeriesId(items, prefix) {
  let max = -1;
  for (const item of items || []) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(item?.id || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

function copySpec(spec) {
  return {
    ...spec,
    points: (spec.points || []).map((p) => ({ id: p.id, at: p.at.slice() })),
    lines: (spec.lines || []).map((l) => ({ ...l })),
    arcs: (spec.arcs || []).map((a) => ({ ...a })),
    dimensions: (spec.dimensions || []).map((d) => ({ ...d })),
    constraints: (spec.constraints || []).map((c) => ({
      ...c,
      items: c.items ? [...c.items] : c.items,
    })),
    ...(spec.refs ? { refs: spec.refs.map((ref) => ({ ...ref })) } : {}),
    ...(spec.polyline ? { polyline: true } : {}),
  };
}

function openEnd(spec) {
  const deg = new Map();
  for (const point of spec.points || []) deg.set(point.id, 0);
  for (const line of spec.lines || []) {
    if (line.guide) continue;
    deg.set(line.a, (deg.get(line.a) || 0) + 1);
    deg.set(line.b, (deg.get(line.b) || 0) + 1);
  }
  for (const arc of spec.arcs || []) {
    if (arc.start) deg.set(arc.start, (deg.get(arc.start) || 0) + 1);
    if (arc.end) deg.set(arc.end, (deg.get(arc.end) || 0) + 1);
  }
  const ends = (spec.points || []).filter((p) => deg.get(p.id) === 1);
  if (ends.length) return ends[ends.length - 1].id;
  const isolated = (spec.points || []).filter((p) => (deg.get(p.id) || 0) === 0);
  if (isolated.length >= 2) return isolated[isolated.length - 2].id;
  if ((spec.points || []).length === 1) return null;
  return null;
}

/**
 * Put a new point at `uv`. A snap to a sketch line splits that line.
 * A snap to a part edge or an endpoint extends an open chain and does not
 * split some other sketch line that merely happens to be nearest.
 */
export function placeSnappedContourPoint(spec, uv, snap) {
  if (!spec || !Array.isArray(uv) || !snap?.target) return { spec, pointId: null };
  const target = snap.target;
  if (target.kind === 'line') {
    const model = copySpec(spec);
    const line = model.lines.find((item) => item.id === target.id && !item.guide);
    const id = nextSeriesId(model.points, 'p');
    const at = [Number(uv[0]) || 0, Number(uv[1]) || 0];
    model.points.push({ id, at });
    if (line) {
      const fresh = nextSeriesId(model.lines, 'e');
      const kept = { id: line.id, a: line.a, b: id };
      if (Number.isFinite(Number(line.seq)) && Number(line.seq) >= 1) kept.seq = Math.round(Number(line.seq));
      model.lines = model.lines.filter((item) => item.id !== line.id);
      model.lines.push(kept, { id: fresh, a: id, b: line.b });
    }
    return { spec: assignSeq(model), pointId: id };
  }
  const model = copySpec(spec);
  const id = nextSeriesId(model.points, 'p');
  const at = [Number(uv[0]) || 0, Number(uv[1]) || 0];
  const tail = openEnd(model);
  model.points.push({ id, at });
  // Coincident with that endpoint already pins the new point. A segment
  // between them would be zero length.
  const ontoTail = target.kind === 'point' && tail === target.id;
  if (tail && !ontoTail) model.lines.push({ id: nextSeriesId(model.lines, 'e'), a: tail, b: id });
  return { spec: assignSeq(model), pointId: id };
}

function movePoint(spec, pointId, uv) {
  const model = copySpec(spec);
  const point = model.points.find((item) => item.id === pointId);
  if (point) point.at = [uv[0], uv[1]];
  return model;
}

function hasCoincident(model, a, b) {
  return (model.constraints || []).some((con) => {
    if (con.kind !== 'coincident' || (con.items || []).length !== 2) return false;
    return (con.items[0] === a && con.items[1] === b) || (con.items[0] === b && con.items[1] === a);
  });
}

function bindTarget(model, target) {
  if (!target) return null;
  if (target.kind === 'point' || target.kind === 'line' || target.kind === 'arc') {
    const list = target.kind === 'point' ? model.points : target.kind === 'line' ? model.lines : model.arcs;
    if (!(list || []).some((item) => item.id === target.id)) return null;
    return { model, id: target.id, kind: target.kind, geomKind: null };
  }
  if (target.kind !== 'ref' || !target.ref?.geom) return null;
  const refs = (model.refs || []).slice();
  let found = refs.find((ref) => sameReference(ref, target.ref));
  if (!found) {
    found = { ...target.ref, id: nextReferenceId(refs) };
    if (found.mid) found.mid = found.mid.slice();
    refs.push(found);
  }
  return {
    model: { ...model, refs },
    id: found.id,
    kind: 'ref',
    geomKind: found.geom?.kind || null,
  };
}

/**
 * Move `pointId` onto the snap and add one coincident, unless that pair
 * is already stored. The constraint always names two live targets.
 */
export function applyContourSnap(spec, pointId, snap) {
  if (!spec || !pointId || !snap?.uv || !snap.target) return { spec, added: false };
  let model = movePoint(spec, pointId, snap.uv);
  if (!model.points.some((point) => point.id === pointId)) return { spec, added: false };
  const bound = bindTarget(model, snap.target);
  if (!bound) return { spec: model, added: false };
  model = bound.model;
  if (bound.id === pointId) return { spec: model, added: false };
  if (hasCoincident(model, pointId, bound.id)) return { spec: model, added: false, duplicate: true };
  const built = buildConstraint(model, [
    { kind: 'point', id: pointId },
    { kind: bound.kind, id: bound.id, geomKind: bound.geomKind },
  ], { kind: 'coincident' });
  if (!built.ok) return { spec: model, added: false, error: built.message };
  model = {
    ...model,
    constraints: [...(model.constraints || []), built.constraint],
  };
  try {
    return {
      spec: specFromSolved(solveContour(model)),
      added: true,
      constraint: built.constraint,
    };
  } catch (err) {
    return {
      spec: model,
      added: true,
      constraint: built.constraint,
      error: err.message || String(err),
    };
  }
}

/** An unpromoted polyline becomes a contour so the snap constraint has a home. */
export function promoteSnappedPolyline(points, index, uv, snap) {
  const next = (points || []).map((pt, i) => (i === index ? [uv[0], uv[1]] : [pt[0], pt[1]]));
  const contour = contourFromPolyline(next);
  const pointId = contour.points[index]?.id;
  if (!pointId || !snap) return contour;
  return applyContourSnap(contour, pointId, snap).spec || contour;
}

/** A tap that lands on a snap promotes, including the new point. */
export function promoteDrawnSnap(points, uv, snap) {
  const contour = contourFromPolyline([...(points || []).map((pt) => [pt[0], pt[1]]), [uv[0], uv[1]]]);
  const pointId = contour.points[contour.points.length - 1]?.id;
  if (!pointId || !snap) return contour;
  return applyContourSnap(contour, pointId, snap).spec || contour;
}
