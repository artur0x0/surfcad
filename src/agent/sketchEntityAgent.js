/**
 * Sketch entity catalog and hole-centre picks for agent list_sketch_entities / pick_points.
 */

import { contourPickFromRef } from './sketchGestureAgent.js';
import { stickyPickKey } from '../utils/stickyPick.js';
import { promoteContourState } from '../utils/contourGesture.js';
import { insertContourPoint } from '../utils/contourDrag.js';
import { holeSketchContour } from '../utils/holeCard.js';
import { isHoleEntry } from '../utils/contourMode.js';

function modelFromState(state) {
  if (!state) return null;
  if (state.params?.contour) return state.params.contour;
  const promoted = promoteContourState(state);
  return promoted?.params?.contour || null;
}

export function listSketchEntities(state) {
  const model = modelFromState(state);
  if (!model) {
    return { points: [], lines: [], arcs: [], refs: [] };
  }
  const points = (model.points || []).map((p) => ({
    id: p.id,
    at: Array.isArray(p.at) ? p.at.map(Number) : null,
  }));
  const lines = (model.lines || []).map((l) => ({ id: l.id, a: l.a, b: l.b }));
  const arcs = (model.arcs || []).map((a) => ({
    id: a.id,
    center: a.center,
    radius: a.radius,
  }));
  const refs = (model.refs || []).map((r) => ({ id: r.id, kind: r.kind }));
  // Dimensions and constraints are part of the saved contour (solveContour),
  // so a reopened sketch lists them with the ids sketch_dimension /
  // sketch_constrain take back (dimension_id / constraint_id).
  const item = (row) => {
    const out = {};
    for (const key of Object.keys(row || {})) {
      if (key === 'seq') continue;
      out[key] = row[key];
    }
    return out;
  };
  const dimensions = (model.dimensions || []).map(item);
  const constraints = (model.constraints || []).map(item);
  return { points, lines, arcs, refs, dimensions, constraints };
}

export function sketchPickKey(kind, key) {
  const k = String(kind || '').toLowerCase();
  if (typeof key === 'string' && key) return `${k}:${key}`;
  if (key && typeof key === 'object' && key.id) return `${k}:${key.id}`;
  if (k === 'point' && Array.isArray(key?.at) && key.at.length >= 2) {
    const u = Number(key.at[0]);
    const v = Number(key.at[1]);
    if (Number.isFinite(u) && Number.isFinite(v)) return `uv:${u.toFixed(4)},${v.toFixed(4)}`;
  }
  return null;
}

export function resolveSketchPickKeys(state, kind, keys) {
  const model = modelFromState(state);
  if (!model) return { error: { code: 'no_sketch', message: 'No sketch profile to pick on' } };
  const groups = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (kind === 'point' && Array.isArray(key?.at)) {
      const u = Number(key.at[0]);
      const v = Number(key.at[1]);
      if (!Number.isFinite(u) || !Number.isFinite(v)) {
        return { error: { code: 'bad_args', message: `key at index ${i} needs a finite at: [u, v]` } };
      }
      groups.push([{ id: `uv:${u},${v}`, entry: { kind: 'uv', at: [u, v] } }]);
      continue;
    }
    const pick = contourPickFromRef(model, typeof key === 'string' ? { kind, id: key } : { kind, ...key });
    if (!pick) {
      return { error: { code: 'unknown_entity', message: `No ${kind} matched key at index ${i}`, details: { index: i } } };
    }
    groups.push([{ id: stickyPickKey(pick), entry: pick }]);
  }
  return { groups };
}

/** Add hole centres from UV taps or sketch entity picks (same as canvas taps). */
export function applyHoleCentreWrites(state, entries) {
  if (!state || !isHoleEntry(state.entry)) {
    return { error: { code: 'wrong_entry', message: 'Hole centres are only open on the hole sketch' } };
  }
  let next = state;
  for (const row of entries) {
    const pick = row.entry;
    if (pick?.kind === 'centre') continue;
    if (pick?.kind === 'uv') {
      const uv = pick.at;
      if (next.params?.contour) {
        const spec = insertContourPoint(next.params.contour, uv);
        next = { ...next, params: { ...next.params, contour: spec } };
      } else {
        const points = [...(next.params?.points || []), [uv[0], uv[1]]];
        next = { ...next, params: { ...next.params, points } };
      }
      continue;
    }
    if (pick?.kind === 'point') {
      const model = modelFromState(next);
      const pt = (model?.points || []).find((p) => p.id === pick.id);
      if (!pt?.at) {
        return { error: { code: 'unknown_entity', message: `Point ${pick.id} is not in the sketch` } };
      }
      if (next.params?.contour?.centers === true
        && (next.params.contour.points || []).some((row) => row.id === pick.id)) {
        continue;
      }
      const uv = pt.at;
      if (next.params?.contour) {
        const spec = insertContourPoint(next.params.contour, uv);
        next = { ...next, params: { ...next.params, contour: spec } };
      } else {
        const points = [...(next.params?.points || []), [uv[0], uv[1]]];
        next = { ...next, params: { ...next.params, points } };
      }
      continue;
    }
    if (pick?.kind === 'arc') {
      const model = modelFromState(next);
      const arc = (model?.arcs || []).find((a) => a.id === pick.id);
      const centerId = arc?.center;
      const pt = (model?.points || []).find((p) => p.id === centerId);
      if (!pt?.at) {
        return { error: { code: 'unknown_entity', message: `Arc ${pick.id} has no centre point` } };
      }
      const uv = pt.at;
      if (next.params?.contour) {
        const spec = insertContourPoint(next.params.contour, uv);
        next = { ...next, params: { ...next.params, contour: spec } };
      } else {
        const points = [...(next.params?.points || []), [uv[0], uv[1]]];
        next = { ...next, params: { ...next.params, points } };
      }
      continue;
    }
    return { error: { code: 'bad_args', message: `Hole centres need point or uv picks, not ${pick?.kind}` } };
  }
  return { state: next };
}

export function holeCentreCount(state) {
  const contour = holeSketchContour(state);
  return contour?.points?.length || 0;
}
