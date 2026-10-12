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

import { analyzeContour } from './contourSolve.js';
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
    points: spec.points.map((p) => (
      p.id === pointId ? { ...p, at: [locked[0], locked[1]] } : { ...p, at: p.at.slice() }
    )),
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
    arcs: (solved.arcs || []).map((a) => ({ ...a })),
    dimensions: (spec.dimensions || []).map((d) => ({ ...d })),
    constraints: (spec.constraints || []).map((c) => ({ ...c })),
    ...(spec.refs ? { refs: spec.refs.map((ref) => ({ ...ref })) } : {}),
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
