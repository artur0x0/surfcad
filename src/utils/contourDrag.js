/**
 * Drag one contour point.
 *
 * The drag is a temporary lock, not a stored constraint. The cursor delta is
 * projected onto that point's nullspace block. A fully constrained point and
 * a contour already in conflict do not move. A temporary fix then re-solves.
 * If that lock is inconsistent, the last feasible contour is kept.
 *
 * This module does not write the script. The viewport writes seeds on
 * pointer-up, and only when a contour block is already in the script.
 */

import { analyzeContour, contourFromPolyline, solveContour } from './contourSolve.js';
import { applyContourSnap } from './contourSnap.js';
import { assignSeq } from './contourStrip.js';
import { isLoftEntry, writeLoftSelected } from './contourMode.js';
import { contourBlockReady } from './contourProfileWrite.js';

const BLOCK_EPS = 1e-6;
const DRAG_ID = '__drag';

/** Orthonormal 2D basis of the point's nullspace block. Empty means the point is fixed. */
export function pointFreedom(nullspace, pointIndex) {
  const i = pointIndex * 2;
  const basis = [];
  for (const vec of nullspace || []) {
    let x = vec[i] || 0;
    let y = vec[i + 1] || 0;
    for (const b of basis) {
      const dot = x * b[0] + y * b[1];
      x -= dot * b[0];
      y -= dot * b[1];
    }
    const n = Math.hypot(x, y);
    if (!(n > BLOCK_EPS)) continue;
    basis.push([x / n, y / n]);
  }
  return basis;
}

/**
 * Project a UV delta onto the point's free directions.
 * @returns {{ du: number, dv: number, free: boolean }}
 */
export function projectPointDelta(nullspace, pointIndex, delta) {
  const basis = pointFreedom(nullspace, pointIndex);
  if (!basis.length) return { du: 0, dv: 0, free: false };
  const d0 = Number(delta?.[0]) || 0;
  const d1 = Number(delta?.[1]) || 0;
  let du = 0;
  let dv = 0;
  for (const b of basis) {
    const dot = d0 * b[0] + d1 * b[1];
    du += dot * b[0];
    dv += dot * b[1];
  }
  return { du, dv, free: true };
}

function pointAt(spec, pointId) {
  const point = (spec?.points || []).find((p) => p.id === pointId);
  return point?.at ? [point.at[0], point.at[1]] : null;
}

function hold(spec, pointId, extra = {}) {
  return {
    spec,
    uv: pointAt(spec, pointId),
    moved: false,
    ...extra,
  };
}

/** A conflicted contour and a fully constrained point do not accept a drag. */
export function contourPointDragAllowed(spec, pointId) {
  if (!spec?.points?.length || !pointId) return false;
  try {
    const analyzed = analyzeContour(spec);
    if (analyzed.status === 'conflict') return false;
    const index = analyzed.points.findIndex((p) => p.id === pointId);
    if (index < 0) return false;
    return pointFreedom(analyzed.nullspace, index).length > 0;
  } catch {
    return false;
  }
}

/**
 * Move `pointId` toward `targetUv`, starting from `spec` (the last feasible
 * contour). Does not mutate `spec`.
 */
export function dragContourPoint(spec, pointId, targetUv) {
  if (!spec?.points?.length || !pointId || !Array.isArray(targetUv)) {
    return hold(spec, pointId);
  }
  let analyzed;
  try {
    analyzed = analyzeContour(spec);
  } catch {
    return hold(spec, pointId, { held: true });
  }
  const index = analyzed.points.findIndex((p) => p.id === pointId);
  if (index < 0) return hold(spec, pointId, { held: true });
  if (analyzed.status === 'conflict') return hold(spec, pointId, { held: true });
  const current = analyzed.points[index].at;
  const projected = projectPointDelta(analyzed.nullspace, index, [
    targetUv[0] - current[0],
    targetUv[1] - current[1],
  ]);
  if (!projected.free) return hold(spec, pointId, { held: true });
  const locked = [current[0] + projected.du, current[1] + projected.dv];
  const trial = {
    ...spec,
    // Drag from the shape on screen. Leaving `seed` set would jump back to
    // the drawing and undo the previous drag.
    points: spec.points.map((p) => ({
      id: p.id,
      at: p.id === pointId ? [locked[0], locked[1]] : p.at.slice(),
    })),
    arcs: (spec.arcs || []).map((a) => {
      const arc = { ...a };
      delete arc.seedRadius;
      return arc;
    }),
    constraints: [
      ...(spec.constraints || []),
      { id: DRAG_ID, kind: 'fix', items: [pointId], at: { [pointId]: locked } },
    ],
  };
  let solved;
  try {
    solved = analyzeContour(trial);
  } catch {
    return hold(spec, pointId, { held: true, inconsistent: true });
  }
  if (solved.status === 'conflict') {
    return hold(spec, pointId, { held: true, inconsistent: true });
  }
  const next = {
    points: solved.points.map((p) => ({ id: p.id, at: p.at.slice() })),
    lines: (spec.lines || []).map((l) => ({ ...l })),
    arcs: (solved.arcs || []).map((a) => {
      const arc = { ...a };
      delete arc.seedRadius;
      return arc;
    }),
    dimensions: (spec.dimensions || []).map((d) => ({ ...d })),
    constraints: (spec.constraints || []).map((c) => ({ ...c })),
    ...(spec.refs ? { refs: spec.refs.map((ref) => ({ ...ref })) } : {}),
    ...(spec.polyline ? { polyline: true } : {}),
  };
  return {
    spec: next,
    uv: pointAt(next, pointId),
    moved: true,
    held: false,
  };
}

/** Write solved seeds into contour-mode state. Does not touch the script. */
export function applyDraggedContour(state, spec) {
  if (!state || !spec) return state;
  const points = (spec.points || []).map((p) => [p.at[0], p.at[1]]);
  const params = { ...(state.params || {}), contour: spec, points };
  const next = { ...state, params };
  return isLoftEntry(state.entry) ? writeLoftSelected(next, { params }) : next;
}

/**
 * A drag writes the script only on release, and only when that named
 * contour is already in the script. A move never writes. Drafting before
 * the first Confirm does not insert a contour. A feature block is not
 * the contour, so a missing id does not write.
 */
export function planContourDragRelease({ buffer = '', entry = '', moved = false, contourId = null } = {}) {
  return { write: !!(moved && contourId && contourBlockReady(buffer, entry, 0, contourId)) };
}

function rectangleCorners(width, height, centered) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const x0 = centered ? -w / 2 : 0;
  const y0 = centered ? -h / 2 : 0;
  return [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
  ];
}

function polygonSideCount(preset) {
  if (preset === 'triangle') return 3;
  if (preset === 'square') return 4;
  if (preset === 'pentagon') return 5;
  if (preset === 'hexagon') return 6;
  return 0;
}

function polygonVertices(preset, radius) {
  const sides = polygonSideCount(preset);
  const r = Number(radius) || 0;
  const pts = [];
  for (let i = 0; i < sides; i += 1) {
    const t = (i / sides) * Math.PI * 2 - Math.PI / 2;
    pts.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return pts;
}

/**
 * Grab points for the sketch that is on screen. A contour wins, then a
 * drawn polyline, then the active primitive. The tool id does not hide them.
 */
export function sketchHandles(state) {
  const contour = state?.params?.contour;
  if (contour?.points?.length) {
    return contour.points.filter((p) => p?.at).map((p) => ({
      id: p.id,
      at: [p.at[0], p.at[1]],
      kind: 'contour',
    }));
  }
  const raw = state?.params?.points;
  if (Array.isArray(raw) && raw.length) {
    return raw.map((uv, i) => ({
      id: `p${i}`,
      at: [Number(uv?.[0]) || 0, Number(uv?.[1]) || 0],
      kind: 'polyline',
    }));
  }
  const tool = state?.tool;
  const params = state?.params || {};
  if (tool === 'rectangle') {
    return rectangleCorners(params.width, params.height, params.centered !== false).map((at, i) => ({
      id: `p${i}`,
      at,
      kind: 'rectangle',
    }));
  }
  if (tool === 'circle') {
    const r = Number(params.radius) || 0;
    if (!(r > 0)) return [];
    return [{ id: 'rim', at: [r, 0], kind: 'circle' }];
  }
  if (tool === 'polygon') {
    return polygonVertices(params.polygonPreset || 'hexagon', params.radius).map((at, i) => ({
      id: `p${i + 1}`,
      at,
      kind: 'polygon',
    }));
  }
  return [];
}

/**
 * Drag an unpromoted circle, rectangle, or polygon. The patch is width,
 * height, or radius. Fully constrained contours do not come through here.
 */
export function dragSketchParam(kind, params, index, uv) {
  const p = params || {};
  const u = Number(uv?.[0]);
  const v = Number(uv?.[1]);
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  if (kind === 'circle') {
    const radius = Math.max(0.1, Math.hypot(u, v));
    return { params: { radius }, handles: [{ id: 'rim', at: [u, v] }] };
  }
  if (kind === 'polygon') {
    const radius = Math.max(0.1, Math.hypot(u, v));
    return {
      params: { radius },
      handles: polygonVertices(p.polygonPreset || 'hexagon', radius).map((at, i) => ({
        id: `p${i + 1}`,
        at,
      })),
    };
  }
  if (kind !== 'rectangle') return null;
  const centered = p.centered !== false;
  let width = Number(p.width) || 0;
  let height = Number(p.height) || 0;
  if (centered) {
    width = Math.max(0.1, 2 * Math.abs(u));
    height = Math.max(0.1, 2 * Math.abs(v));
  } else if (index === 1) {
    width = Math.max(0.1, u);
  } else if (index === 2) {
    width = Math.max(0.1, u);
    height = Math.max(0.1, v);
  } else if (index === 3) {
    height = Math.max(0.1, v);
  } else {
    return null;
  }
  return {
    params: { width, height },
    handles: rectangleCorners(width, height, centered).map((at, i) => ({ id: `p${i}`, at })),
  };
}

function nextSeriesId(items, prefix) {
  let max = -1;
  for (const item of items || []) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(item?.id || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

function distToSeg(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Split the nearest profile edge so a new polyline point stays on the chain. */
export function insertContourPoint(spec, uv) {
  if (!spec || !Array.isArray(uv)) return spec;
  const points = (spec.points || []).map((p) => ({ id: p.id, at: p.at.slice() }));
  const lines = (spec.lines || []).map((l) => ({ ...l }));
  const id = nextSeriesId(points, 'p');
  const at = [Number(uv[0]) || 0, Number(uv[1]) || 0];
  if (!lines.length) {
    points.push({ id, at });
    if (points.length >= 2) {
      const prev = points[points.length - 2];
      lines.push({ id: nextSeriesId(lines, 'e'), a: prev.id, b: id });
    }
    return assignSeq({ ...spec, points, lines });
  }
  let best = null;
  let bestD = Infinity;
  for (const line of lines) {
    if (line.guide) continue;
    const a = points.find((p) => p.id === line.a)?.at;
    const b = points.find((p) => p.id === line.b)?.at;
    if (!a || !b) continue;
    const d = distToSeg(at, a, b);
    if (d < bestD) {
      bestD = d;
      best = line;
    }
  }
  points.push({ id, at });
  if (!best) return assignSeq({ ...spec, points, lines });
  const fresh = nextSeriesId(lines, 'e');
  const nextLines = lines.filter((l) => l.id !== best.id);
  const kept = { id: best.id, a: best.a, b: id };
  if (Number.isFinite(Number(best.seq)) && Number(best.seq) >= 1) kept.seq = Math.round(Number(best.seq));
  nextLines.push(kept);
  nextLines.push({ id: fresh, a: id, b: best.b });
  return assignSeq({ ...spec, points, lines: nextLines });
}

/** Keep the new point off the endpoints so the split stays two real segments. */
export function projectUvOnSegment(uv, a, b) {
  const ax = Number(a?.[0]) || 0;
  const ay = Number(a?.[1]) || 0;
  const bx = Number(b?.[0]) || 0;
  const by = Number(b?.[1]) || 0;
  const ux = Number(uv?.[0]) || 0;
  const uy = Number(uv?.[1]) || 0;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = 0.5;
  if (len2 > 1e-18) t = ((ux - ax) * dx + (uy - ay) * dy) / len2;
  t = Math.max(0.08, Math.min(0.92, t));
  return [ax + t * dx, ay + t * dy];
}

/** Split `lineId`. `project` drops the point onto that segment. */
export function splitContourLine(spec, lineId, uv, { project = true } = {}) {
  if (!spec || !lineId || !Array.isArray(uv)) return spec;
  const points = (spec.points || []).map((p) => ({ id: p.id, at: p.at.slice() }));
  const lines = (spec.lines || []).map((l) => ({ ...l }));
  const line = lines.find((l) => l.id === lineId && !l.guide);
  if (!line) return spec;
  const a = points.find((p) => p.id === line.a)?.at;
  const b = points.find((p) => p.id === line.b)?.at;
  if (!a || !b) return spec;
  const at = project
    ? projectUvOnSegment(uv, a, b)
    : [Number(uv[0]) || 0, Number(uv[1]) || 0];
  const id = nextSeriesId(points, 'p');
  points.push({ id, at });
  const fresh = nextSeriesId(lines, 'e');
  const nextLines = lines.filter((l) => l.id !== line.id);
  const kept = { id: line.id, a: line.a, b: id };
  if (Number.isFinite(Number(line.seq)) && Number(line.seq) >= 1) kept.seq = Math.round(Number(line.seq));
  nextLines.push(kept);
  nextLines.push({ id: fresh, a: id, b: line.b });
  return assignSeq({ ...spec, points, lines: nextLines });
}

/** Insert on an unpromoted segment. The closing edge appends. */
export function insertDraftPolylinePoint(points, segment, uv, { project = true } = {}) {
  const raw = (points || []).map((p) => [Number(p?.[0]) || 0, Number(p?.[1]) || 0]);
  const a = raw[segment?.indexA];
  const b = raw[segment?.indexB];
  if (!a || !b) return { points: raw, index: -1 };
  const at = project
    ? projectUvOnSegment(uv, a, b)
    : [Number(uv?.[0]) || 0, Number(uv?.[1]) || 0];
  const closing = segment.indexB === 0 && segment.indexA === raw.length - 1;
  const index = closing ? raw.length : segment.indexA + 1;
  const next = raw.slice();
  next.splice(index, 0, at);
  return { points: next, index };
}

function snapOwnsSegment(snap, segment) {
  if (!snap?.target || snap.target.kind !== 'line' || !segment) return false;
  if (segment.kind === 'contour') return snap.target.id === segment.id;
  const match = /^e(\d+)$/.exec(String(snap.target.id || ''));
  return !!(match && segment.kind === 'polyline' && Number(match[1]) === segment.indexA);
}

function writeDraftPoints(state, points) {
  const params = { ...(state.params || {}), points };
  delete params.contour;
  const next = { ...state, params };
  return isLoftEntry(state.entry) ? writeLoftSelected(next, { params }) : next;
}

function withPolylineFlag(spec) {
  if (!spec || spec.polyline) return spec;
  return { ...spec, polyline: true };
}

/**
 * Insert a point on one polyline segment.
 * A snap to that same segment is the finger projected onto it, with no
 * coincident. A snap to a part edge or another point uses the snap and
 * stores the coincident. A failed promote keeps the inserted draft points.
 */
export function applyPolylineSegmentInsert(state, segment, uv, snap) {
  if (!state || !segment) return state;
  const own = snapOwnsSegment(snap, segment);
  const external = !!(snap?.target && snap.uv && !own);
  const tap = Array.isArray(uv) ? uv : (snap?.uv || null);
  if (!tap && !external) return state;

  const contour = state.params?.contour;
  if (contour && segment.kind === 'contour') {
    const before = (contour.points || []).length;
    let spec = splitContourLine(contour, segment.id, external ? snap.uv : tap, { project: !external });
    if ((spec.points || []).length === before) return state;
    spec = withPolylineFlag(spec);
    if (external) {
      const pointId = spec.points[spec.points.length - 1]?.id;
      if (pointId) spec = withPolylineFlag(applyContourSnap(spec, pointId, snap).spec || spec);
    }
    return applyDraggedContour(state, spec);
  }

  const raw = state.params?.points;
  if (!Array.isArray(raw) || segment.kind !== 'polyline') return state;
  if (external) {
    try {
      let spec = contourFromPolyline(raw);
      const before = spec.points.length;
      spec = splitContourLine(spec, `e${segment.indexA}`, snap.uv, { project: false });
      if (spec.points.length === before) throw new Error('segment missing');
      const pointId = spec.points[spec.points.length - 1]?.id;
      if (pointId) spec = applyContourSnap(spec, pointId, snap).spec || spec;
      return applyDraggedContour(state, withPolylineFlag(spec));
    } catch {
      const inserted = insertDraftPolylinePoint(raw, segment, snap.uv, { project: false });
      return writeDraftPoints(state, inserted.points);
    }
  }
  const inserted = insertDraftPolylinePoint(raw, segment, tap, { project: true });
  return writeDraftPoints(state, inserted.points);
}

/** Three points is the auto-closed polyline. Fewer than that is not a shape. */
export const POLYLINE_CLOSE_MIN = 3;

/** Same window as a paint double-tap. The first tap is not delayed. */
export const POLYLINE_DOUBLE_TAP_MS = 300;

/**
 * A second note this soon is the synthetic mouse event after the same touch.
 * It is not a second tap.
 */
export const POLYLINE_SAME_TAP_MS = 45;

/**
 * True when `now` is a later tap on the same point, inside the double-tap window.
 * Two mouseups in the same millisecond count. The synthetic mouse after a
 * finger-up does not: that pair is a touch note followed by a mouse note.
 */
export function isPolylineDoubleTap(prev, pointId, now, source) {
  if (!prev || prev.id !== pointId || !Number.isFinite(now) || !Number.isFinite(prev.at)) return false;
  const dt = now - prev.at;
  if (dt < 0 || dt > POLYLINE_DOUBLE_TAP_MS) return false;
  if (source == null) return dt > POLYLINE_SAME_TAP_MS;
  if (prev.source === 'touch' && source === 'mouse' && dt <= POLYLINE_SAME_TAP_MS) return false;
  return true;
}

/** Segments a polyline tap can split. A promoted contour wins over the draft list. */
export function sketchSegments(state) {
  const spec = state?.params?.contour;
  if (spec?.lines?.length) {
    const out = [];
    for (const line of spec.lines) {
      if (!line || line.guide) continue;
      const a = spec.points?.find((p) => p.id === line.a);
      const b = spec.points?.find((p) => p.id === line.b);
      if (!a?.at || !b?.at) continue;
      out.push({
        id: line.id,
        a: a.at,
        b: b.at,
        pointA: line.a,
        pointB: line.b,
        kind: 'contour',
      });
    }
    if (out.length) return out;
  }
  const raw = state?.params?.points;
  if (!Array.isArray(raw) || raw.length < 2) return [];
  const closed = raw.length >= POLYLINE_CLOSE_MIN;
  const count = closed ? raw.length : raw.length - 1;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % raw.length;
    out.push({
      id: `seg${i}`,
      a: raw[i],
      b: raw[j],
      indexA: i,
      indexB: j,
      kind: 'polyline',
    });
  }
  return out;
}

/** Sketch line under a snap, when the finger missed the segment slop. */
export function segmentForSnap(state, snap) {
  if (!snap?.target || snap.target.kind !== 'line') return null;
  const segments = sketchSegments(state);
  const direct = segments.find((segment) => segment.kind === 'contour' && segment.id === snap.target.id);
  if (direct) return direct;
  const match = /^e(\d+)$/.exec(String(snap.target.id || ''));
  if (!match) return null;
  const index = Number(match[1]);
  return segments.find((segment) => segment.kind === 'polyline' && segment.indexA === index) || null;
}

/** A polyline dot is a draft point, or a contour point on a real segment. */
export function isPolylineDot(state, handle) {
  if (!handle) return false;
  if (handle.kind === 'polyline') return true;
  if (handle.kind !== 'contour') return false;
  const spec = state?.params?.contour;
  return (spec?.lines || []).some((line) => (
    line && !line.guide && (line.a === handle.id || line.b === handle.id)
  ));
}

function profilePointIds(spec) {
  const ids = new Set();
  for (const line of spec?.lines || []) {
    if (!line || line.guide) continue;
    if (line.a) ids.add(line.a);
    if (line.b) ids.add(line.b);
  }
  return ids;
}

function copyLine(line) {
  const next = { id: line.id, a: line.a, b: line.b };
  if (line.guide) next.guide = true;
  if (Number.isFinite(Number(line.seq)) && Number(line.seq) >= 1) next.seq = Math.round(Number(line.seq));
  return next;
}

/** Drop a vertex and bridge its two neighbors. Constraints that named it stay. */
export function removeContourPoint(spec, pointId) {
  const lines = (spec?.lines || []).map(copyLine);
  const incident = lines.filter((line) => !line.guide && (line.a === pointId || line.b === pointId));
  const neighbors = [];
  for (const line of incident) {
    const other = line.a === pointId ? line.b : line.a;
    if (other && other !== pointId && !neighbors.includes(other)) neighbors.push(other);
  }
  const drop = new Set();
  for (const line of lines) {
    if (line.a === pointId || line.b === pointId) drop.add(line.id);
  }
  const kept = lines.filter((line) => !drop.has(line.id));
  if (neighbors.length === 2) {
    const bridge = { id: incident[0]?.id || nextSeriesId(kept, 'e'), a: neighbors[0], b: neighbors[1] };
    if (incident[0]?.seq) bridge.seq = incident[0].seq;
    kept.push(bridge);
  }
  const dropArcs = new Set();
  for (const arc of spec?.arcs || []) {
    if (arc?.center === pointId || arc?.start === pointId || arc?.end === pointId) dropArcs.add(arc.id);
  }
  return assignSeq({
    ...spec,
    points: (spec.points || []).filter((p) => p.id !== pointId).map((p) => ({
      id: p.id,
      at: p.at.slice(),
    })),
    lines: kept,
    arcs: (spec.arcs || []).filter((arc) => !dropArcs.has(arc.id)).map((arc) => {
      const copy = { ...arc };
      delete copy.seedRadius;
      return copy;
    }),
    dimensions: (spec.dimensions || []).map((item) => ({ ...item })),
    constraints: (spec.constraints || []).map((item) => ({
      ...item,
      items: item.items ? [...item.items] : item.items,
    })),
    ...(spec.refs ? { refs: spec.refs.map((ref) => ({ ...ref })) } : {}),
  });
}

function stampBroken(spec) {
  let solved;
  try {
    // Stay on the current shape. A delete should not leap back to the draw seed.
    solved = solveContour({
      ...spec,
      points: (spec.points || []).map((p) => ({ id: p.id, at: p.at.slice() })),
      arcs: (spec.arcs || []).map((a) => {
        const arc = { ...a };
        delete arc.seedRadius;
        return arc;
      }),
    });
  } catch {
    return spec;
  }
  const dimBroken = new Set((solved.dimensions || []).filter((item) => item.broken).map((item) => item.id));
  const conBroken = new Set((solved.constraints || []).filter((item) => item.broken).map((item) => item.id));
  const flag = (item, broken) => {
    const copy = { ...item };
    if (broken) copy.broken = true;
    else delete copy.broken;
    return copy;
  };
  return {
    ...spec,
    points: (solved.points || []).map((p) => ({ id: p.id, at: p.at.slice() })),
    lines: (solved.lines || []).map((line) => ({ ...line })),
    arcs: (solved.arcs || []).map((arc) => {
      const copy = { ...arc };
      delete copy.seedRadius;
      return copy;
    }),
    dimensions: (spec.dimensions || []).map((item) => flag(item, dimBroken.has(item.id))),
    constraints: (spec.constraints || []).map((item) => flag(item, conBroken.has(item.id))),
    ...(spec.refs ? { refs: spec.refs.map((ref) => ({ ...ref })) } : {}),
  };
}

/** Drop the polyline. A saved id is cleared so a later Confirm does not rewrite it. */
export function clearPolylineShape(state, { dropIdentity = false } = {}) {
  if (!state) return state;
  const params = { ...(state.params || {}), points: [] };
  delete params.contour;
  let next = {
    ...state,
    params,
    picks: [],
    tagId: null,
    gestureNote: null,
    dimensionEdit: null,
    constraintEdit: null,
    dimensionLive: null,
  };
  if (dropIdentity) {
    next = { ...next, contourId: null, contourName: null };
  }
  return isLoftEntry(state.entry) ? writeLoftSelected(next, { params: next.params }) : next;
}

/**
 * Remove one polyline dot. Constraints that named it stay, marked broken
 * when the remainder solves. Below the auto-closed minimum the shape goes.
 * @returns {{ action: 'none'|'remove'|'delete-shape', state: object, contourId?: string|null }}
 */
export function planPolylinePointRemoval(state, pointId) {
  if (!state || !pointId) return { action: 'none', state };
  const spec = state.params?.contour;
  if (spec?.points?.some((p) => p.id === pointId)) {
    const profile = profilePointIds(spec);
    if (!profile.has(pointId)) return { action: 'none', state };
    if (profile.size - 1 < POLYLINE_CLOSE_MIN) {
      return {
        action: 'delete-shape',
        contourId: state.contourId || null,
        state: clearPolylineShape(state, { dropIdentity: true }),
      };
    }
    const stamped = stampBroken(removeContourPoint(spec, pointId));
    return { action: 'remove', state: applyDraggedContour(state, stamped) };
  }
  const raw = state.params?.points;
  if (!Array.isArray(raw) || !raw.length) return { action: 'none', state };
  const match = /^p(\d+)$/.exec(String(pointId));
  const index = match ? Number(match[1]) : -1;
  if (index < 0 || index >= raw.length) return { action: 'none', state };
  if (raw.length - 1 < POLYLINE_CLOSE_MIN) {
    return {
      action: 'delete-shape',
      contourId: state.contourId || null,
      state: clearPolylineShape(state, { dropIdentity: true }),
    };
  }
  const points = raw.filter((_, i) => i !== index).map((uv) => [Number(uv?.[0]) || 0, Number(uv?.[1]) || 0]);
  const params = { ...(state.params || {}), points };
  let next = { ...state, params };
  if (isLoftEntry(next.entry)) next = writeLoftSelected(next, { params });
  return { action: 'remove', state: next };
}
