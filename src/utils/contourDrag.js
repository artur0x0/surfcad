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
