/**
 * Dimension and Arc gestures on a contour.
 *
 * Neither gesture is a profile tool. Selecting one does not reset the
 * points. The first selection promotes a circle, rectangle, polygon, or
 * polyline into a solver contour, once. A polyline stays one entity: the
 * strip does not gain a chip per segment. Cancel writes nothing and
 * leaves that promotion in the session.
 */

import {
  contourFromCircle,
  contourFromPolygon,
  contourFromPolyline,
  contourFromRectangle,
  roundContourCorner,
  solveContour,
} from './contourSolve.js';
import { contourStatusNote } from './contourStatus.js';
import { assignSeq, deleteContourEntity } from './contourStrip.js';
import { stickyPickToggle } from './stickyPick.js';
import {
  nextReferenceId,
  referencePickAllowed,
  referencePickItem,
  sameReference,
} from './contourRefPick.js';

const NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const PARALLEL_SPLIT_DEG = 15;

export function specFromSolved(solved) {
  const spec = {
    points: (solved.points || []).map((p) => ({ id: p.id, at: p.at.slice() })),
    lines: (solved.lines || []).map((l) => {
      const line = { id: l.id, a: l.a, b: l.b };
      if (l.guide) line.guide = true;
      if (Number.isFinite(Number(l.seq)) && Number(l.seq) >= 1) line.seq = Math.round(Number(l.seq));
      return line;
    }),
    arcs: (solved.arcs || []).map((a) => ({ ...a })),
    dimensions: (solved.dimensions || []).map((d) => {
      const copy = {
        ...d,
        items: d.items ? [...d.items] : undefined,
      };
      if (d.at) {
        copy.at = Object.fromEntries(Object.entries(d.at).map(([id, uv]) => [
          id,
          Array.isArray(uv) ? uv.slice() : uv,
        ]));
      }
      if (Array.isArray(d.anchors)) {
        copy.anchors = d.anchors.map((uv) => (Array.isArray(uv) ? uv.slice() : uv));
      }
      return copy;
    }),
    constraints: (solved.constraints || []).map((c) => {
      const copy = { ...c, items: c.items ? [...c.items] : undefined };
      if (c.at) {
        copy.at = Object.fromEntries(Object.entries(c.at).map(([id, uv]) => [
          id,
          Array.isArray(uv) ? uv.slice() : uv,
        ]));
      }
      return copy;
    }),
    refs: (solved.refs || []).map((ref) => {
      const copy = { ...ref, mid: ref.mid ? ref.mid.slice() : undefined };
      if (ref.geom) {
        copy.geom = { ...ref.geom };
        if (ref.geom.at) copy.geom.at = ref.geom.at.slice();
        if (ref.geom.a) copy.geom.a = ref.geom.a.slice();
        if (ref.geom.b) copy.geom.b = ref.geom.b.slice();
        if (ref.geom.center) copy.geom.center = ref.geom.center.slice();
        if (ref.geom.points) copy.geom.points = ref.geom.points.map((p) => p.slice());
      }
      if (ref.boundary) copy.boundary = { ...ref.boundary, mid: ref.boundary.mid.slice() };
      if (Array.isArray(ref.loop)) copy.loop = ref.loop.map((p) => (Array.isArray(p) ? p.slice() : p));
      return copy;
    }),
  };
  if (solved?.polyline) spec.polyline = true;
  return spec;
}

function drawnProfileTool(tool, params) {
  if (tool !== 'cursor') return tool;
  const p = params || {};
  if (Array.isArray(p.points) && p.points.length) return 'polyline';
  if (p.polygonPreset) return 'polygon';
  if (p.width != null || p.height != null) return 'rectangle';
  return 'circle';
}

export function contourFromTool(tool, params = {}) {
  const p = params || {};
  if (p.contour) return p.contour;
  const kind = drawnProfileTool(tool, p);
  if (kind === 'polyline') return contourFromPolyline(p.points || []);
  if (kind === 'rectangle') return contourFromRectangle(p.width, p.height, p.centered !== false);
  if (kind === 'polygon') return contourFromPolygon(p.polygonPreset || 'hexagon', p.radius);
  return contourFromCircle(p.radius, p.segments ?? 64);
}

export function promoteContourState(state) {
  if (!state) return state;
  if (state.params?.contour) return state;
  let contour;
  try {
    contour = contourFromTool(state.tool, state.params);
  } catch (err) {
    return { ...state, gestureNote: err.message || String(err) };
  }
  return {
    ...state,
    params: { ...(state.params || {}), contour },
    gestureNote: null,
  };
}

function refRecord(model, id) {
  return (model?.refs || []).find((ref) => ref.id === id) || null;
}

function geomKindOf(model, pick) {
  if (pick?.kind !== 'ref') return null;
  return pick.geomKind || refRecord(model, pick.id)?.geom?.kind || null;
}

function namedRefIds(contour) {
  const ids = new Set((contour?.refs || []).map((ref) => ref.id));
  const named = new Set();
  const items = [...(contour?.dimensions || []), ...(contour?.constraints || [])];
  for (const item of items) {
    for (const key of ['a', 'b', 'edge', 'point', 'arc']) {
      if (item?.[key] && ids.has(item[key])) named.add(item[key]);
    }
    for (const id of item?.items || []) {
      if (ids.has(id)) named.add(id);
    }
  }
  return named;
}

function dropUnusedRefs(contour) {
  if (!contour?.refs?.length) return contour;
  const named = namedRefIds(contour);
  const refs = contour.refs.filter((ref) => named.has(ref.id));
  if (refs.length === contour.refs.length) return contour;
  return { ...contour, refs };
}

function withRefs(state, contour) {
  if (!state || contour === state.params?.contour) return state;
  return { ...state, params: { ...(state.params || {}), contour } };
}

export function selectContourGesture(state, gesture) {
  const reverted = revertLiveDimension(state);
  const base = withRefs(reverted, dropUnusedRefs(reverted?.params?.contour));
  if (!base || base.entry === 'workplane') return base;
  if (gesture !== 'arc' && gesture !== 'dimension' && gesture !== 'constraints') return base;
  if (base.gesture === gesture) {
    return {
      ...base,
      gesture: null,
      picks: [],
      tagId: null,
      gestureNote: null,
      dimensionEdit: null,
      constraintEdit: null,
      entityCard: null,
    };
  }
  const armed = {
    ...base,
    gesture,
    picks: [],
    tagId: null,
    gestureNote: null,
    dimensionEdit: null,
    constraintEdit: null,
    entityCard: null,
  };
  return promoteContourState(armed);
}

function attachReference(state, incoming) {
  const contour = state.params?.contour;
  if (!contour) return { ...state, gestureNote: 'Draw a contour first.' };
  if (!incoming?.geom) return { ...state, gestureNote: 'That edge is edge-on to the sketch.' };
  const { tap, ...stored } = incoming;
  const refs = (contour.refs || []).slice();
  let found = refs.find((ref) => sameReference(ref, stored));
  if (!found) {
    found = { ...stored, id: nextReferenceId(refs) };
    refs.push(found);
  } else if (stored.geom) {
    const index = refs.indexOf(found);
    refs[index] = { ...found, geom: stored.geom, loop: stored.loop || found.loop };
    found = refs[index];
  }
  const picks = stickyPickToggle(state.picks, referencePickItem(found, tap), 2);
  const kept = picks.some((pick) => pick.kind === 'ref' && pick.id === found.id);
  let nextRefs = refs;
  if (!kept && !namedRefIds(contour).has(found.id)) {
    nextRefs = refs.filter((ref) => ref.id !== found.id);
  }
  return {
    ...state,
    params: { ...state.params, contour: assignSeq({ ...contour, refs: nextRefs }) },
    picks,
    tagId: null,
    gestureNote: null,
  };
}

export function toggleContourPick(state, pick) {
  const base = revertLiveDimension(state);
  if (!base?.gesture) return base;
  if (pick?.kind === 'reference') {
    if (!referencePickAllowed(base.gesture)) return base;
    return attachReference(base, pick.ref);
  }
  const max = base.gesture === 'arc' ? 3 : 2;
  if (base.gesture === 'arc' && pick?.kind !== 'line') {
    return { ...base, gestureNote: 'An arc rounds lines. Tap a segment.' };
  }
  const picks = stickyPickToggle(base.picks, pick, max);
  return { ...base, picks, tagId: null, gestureNote: null };
}

function pointAt(model, id) {
  return (model.points || []).find((p) => p.id === id)?.at || null;
}

function lineEnds(model, id) {
  const line = (model.lines || []).find((l) => l.id === id);
  if (line) {
    const a = pointAt(model, line.a);
    const b = pointAt(model, line.b);
    if (!a || !b) return null;
    return { line, a, b, d: [b[0] - a[0], b[1] - a[1]] };
  }
  const geom = refRecord(model, id)?.geom;
  if (geom?.kind !== 'line' || !geom.a || !geom.b) return null;
  return { line: null, a: geom.a, b: geom.b, d: [geom.b[0] - geom.a[0], geom.b[1] - geom.a[1]], ref: true };
}

function unitDot(d1, d2) {
  const L1 = Math.hypot(d1[0], d1[1]);
  const L2 = Math.hypot(d2[0], d2[1]);
  if (L1 < 1e-12 || L2 < 1e-12) return 1;
  return (d1[0] * d2[0] + d1[1] * d2[1]) / (L1 * L2);
}

export function linesFromParallelDeg(model, idA, idB) {
  const A = lineEnds(model, idA);
  const B = lineEnds(model, idB);
  if (!A || !B) return 90;
  const dot = Math.min(1, Math.abs(unitDot(A.d, B.d)));
  return Math.acos(dot) * 180 / Math.PI;
}

function signedPointLine(p, a, d) {
  const L = Math.hypot(d[0], d[1]);
  if (L < 1e-12) return 0;
  return ((p[0] - a[0]) * (-d[1]) + (p[1] - a[1]) * d[0]) / L;
}

function angleOf(model, idA, idB) {
  const A = lineEnds(model, idA);
  const B = lineEnds(model, idB);
  if (!A || !B) return { value: 90, sense: 1 };
  const cross = A.d[0] * B.d[1] - A.d[1] * B.d[0];
  const dot = A.d[0] * B.d[0] + A.d[1] * B.d[1];
  const sense = cross >= 0 ? 1 : -1;
  const value = Math.atan2(sense * cross, dot) * 180 / Math.PI;
  return { value, sense };
}

function separationOf(model, idA, idB) {
  const A = lineEnds(model, idA);
  const B = lineEnds(model, idB);
  if (!A || !B) return { value: 0, side: 1 };
  const value = signedPointLine(A.a, B.a, B.d);
  return { value, side: value >= 0 ? 1 : -1 };
}

function offsetOf(model, pointId, lineId) {
  const p = pointAt(model, pointId);
  const line = lineEnds(model, lineId);
  if (!p || !line) return { value: 0, side: 1 };
  const value = signedPointLine(p, line.a, line.d);
  return { value, side: value >= 0 ? 1 : -1 };
}

function refGeom(model, pick) {
  if (pick?.kind !== 'ref') return null;
  return refRecord(model, pick.id)?.geom || null;
}

function suggestRefDimension(model, list) {
  const empty = { ok: false, kind: null, kinds: [], value: 0, side: 1, sense: 1, note: 'That pair is not a length, angle, distance, offset, or radius.' };
  const ref = list.find((p) => p.kind === 'ref');
  const other = list.find((p) => p !== ref);
  const geom = refGeom(model, ref);
  if (!geom || !other) return empty;
  if (other.kind === 'point' && geom.kind === 'line') {
    const gap = offsetOf(model, other.id, ref.id);
    return { ok: true, kind: 'distance', kinds: ['distance'], value: gap.value, side: gap.side, sense: 1, note: '' };
  }
  if (other.kind === 'point' && geom.kind === 'point') {
    const a = pointAt(model, other.id);
    const b = geom.at;
    if (!a || !b) return empty;
    const value = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(value > 0)) return { ...empty, note: 'Those points are the same.' };
    return { ok: true, kind: 'distance', kinds: ['distance'], value, side: 1, sense: 1, note: '' };
  }
  if (other.kind === 'point' && (geom.kind === 'polyline' || geom.kind === 'arc')) {
    return { ok: true, kind: 'distance', kinds: ['distance'], value: 0, side: 1, sense: 1, note: '' };
  }
  if (other.kind === 'line' && geom.kind === 'line') {
    const gap = separationOf(model, other.id, ref.id);
    return { ok: true, kind: 'distance', kinds: ['distance'], value: gap.value, side: gap.side, sense: 1, note: '' };
  }
  return { ...empty, note: 'distance to that reference is not supported' };
}

/**
 * What a dimension pick offers. Two lines more than 15° from parallel
 * suggest an angle. Otherwise they suggest a distance. Both stay available.
 */
export function suggestContourDimension(model, picks) {
  const list = Array.isArray(picks) ? picks : [];
  const empty = { ok: false, kind: null, kinds: [], value: 0, side: 1, sense: 1, note: 'Tap a line, an arc, two points, or a point and a line.' };
  if (!model) return { ...empty, note: 'Draw a contour first.' };
  const refCount = list.filter((p) => p.kind === 'ref').length;
  if (refCount >= 2) return { ...empty, note: 'a constraint cannot join two references' };
  if (refCount === 1 && list.length === 1) {
    return { ...empty, note: 'A reference keeps its size. Tap a sketch point or a sketch line as well.' };
  }
  if (refCount === 1 && list.length === 2) return suggestRefDimension(model, list);
  if (list.length === 1 && list[0].kind === 'line') {
    const ends = lineEnds(model, list[0].id);
    const value = ends ? Math.hypot(ends.d[0], ends.d[1]) : 0;
    return { ok: value > 0, kind: 'length', kinds: ['length'], value, side: 1, sense: 1, note: value > 0 ? '' : 'That line has no length.' };
  }
  if (list.length === 1 && list[0].kind === 'arc') {
    const arc = (model.arcs || []).find((a) => a.id === list[0].id);
    const value = Number(arc?.radius) || 0;
    return { ok: value > 0, kind: 'radius', kinds: ['radius'], value, side: 1, sense: 1, note: '' };
  }
  if (list.length === 1 && list[0].kind === 'point') {
    return { ...empty, note: 'Tap a line as well to offset the point.' };
  }
  if (list.length === 2 && list.every((p) => p.kind === 'line')) {
    const fromParallel = linesFromParallelDeg(model, list[0].id, list[1].id);
    const angle = angleOf(model, list[0].id, list[1].id);
    const gap = separationOf(model, list[0].id, list[1].id);
    if (fromParallel > PARALLEL_SPLIT_DEG) {
      return { ok: true, kind: 'angle', kinds: ['angle', 'distance'], value: angle.value, side: gap.side, sense: angle.sense, note: '' };
    }
    return { ok: true, kind: 'distance', kinds: ['distance', 'angle'], value: gap.value, side: gap.side, sense: angle.sense, note: '' };
  }
  if (list.length === 2 && list.every((p) => p.kind === 'point')) {
    const a = pointAt(model, list[0].id);
    const b = pointAt(model, list[1].id);
    if (!a || !b) return { ...empty, note: 'That pair is not a length, angle, distance, offset, or radius.' };
    const value = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(value > 0)) {
      return { ok: false, kind: 'distance', kinds: ['distance'], value: 0, side: 1, sense: 1, note: 'Those points are the same.' };
    }
    return { ok: true, kind: 'distance', kinds: ['distance'], value, side: 1, sense: 1, note: '' };
  }
  if (list.length === 2) {
    const point = list.find((p) => p.kind === 'point');
    const line = list.find((p) => p.kind === 'line');
    if (point && line) {
      const gap = offsetOf(model, point.id, line.id);
      return { ok: true, kind: 'offset', kinds: ['offset'], value: gap.value, side: gap.side, sense: 1, note: '' };
    }
  }
  if (list.length === 0) return empty;
  return { ...empty, note: 'That pair is not a length, angle, distance, offset, or radius.' };
}

export function prefillForKind(model, picks, kind) {
  const suggested = suggestContourDimension(model, picks);
  if (kind === 'angle') {
    if (picks?.length === 2 && picks.every((p) => p.kind === 'line')) {
      const angle = angleOf(model, picks[0].id, picks[1].id);
      return { value: angle.value, side: suggested.side, sense: angle.sense };
    }
  }
  if (kind === 'distance' && picks?.length === 2 && picks.every((p) => p.kind === 'line')) {
    const gap = separationOf(model, picks[0].id, picks[1].id);
    return { value: gap.value, side: gap.side, sense: suggested.sense };
  }
  if (kind === suggested.kind) return { value: suggested.value, side: suggested.side, sense: suggested.sense };
  return { value: suggested.value, side: suggested.side, sense: suggested.sense };
}

export function validateDimensionName(name, model, ignoreId = null) {
  const text = String(name || '').trim();
  if (!text) return { ok: true, name: '' };
  if (!NAME_RE.test(text)) {
    return { ok: false, message: 'A dimension name is one word: a letter, then letters or digits.' };
  }
  const taken = (model?.dimensions || []).some((d) => d.name === text && d.id !== ignoreId);
  if (taken) return { ok: false, message: `“${text}” is already a dimension on this contour.` };
  return { ok: true, name: text };
}

function nextDimId(model) {
  let max = -1;
  for (const dim of model.dimensions || []) {
    const m = /^d(\d+)$/.exec(dim.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `d${max + 1}`;
}

function pickIsLine(pick) {
  return pick?.kind === 'line' || (pick?.kind === 'ref' && pick.geomKind === 'line');
}

function pickIsPoint(pick) {
  return pick?.kind === 'point' || (pick?.kind === 'ref' && pick.geomKind === 'point');
}

/**
 * Offset, and a distance to a line or a reference edge, carry a side.
 * Length, radius, angle, and point-to-point distance do not.
 */
export function dimensionUsesSide(kind, picks) {
  if (kind === 'offset') return true;
  const list = Array.isArray(picks) ? picks : [];
  if (kind !== 'distance' || list.length !== 2) return false;
  if (list.every(pickIsLine)) return true;
  return list.some(pickIsPoint) && list.some(pickIsLine);
}

/**
 * The card and the tag show a positive size. The stored value keeps the
 * side, so the solver residual does not flip the geometry.
 */
export function dimensionStoredValue(kind, picks, typed, side) {
  const n = Number(typed);
  if (!Number.isFinite(n) || !dimensionUsesSide(kind, picks)) return n;
  return (side < 0 ? -1 : 1) * Math.abs(n);
}

/** What the field and the tag print. Angles stay signed; lengths do not. */
export function dimensionShownNumber(kind, value) {
  const n = Number(value);
  if (!Number.isFinite(n) || kind === 'angle') return n;
  return Math.abs(n);
}

export function buildDimension(model, picks, draft) {
  const kind = draft?.kind;
  const list = picks || [];
  const side = draft?.side < 0 ? -1 : 1;
  const value = dimensionStoredValue(kind, list, draft?.valueMm, side);
  if (!Number.isFinite(value)) return { ok: false, message: 'Enter a number.' };
  const nameCheck = validateDimensionName(draft?.name, model, draft?.id);
  if (!nameCheck.ok) return nameCheck;
  const dim = { id: draft?.id || nextDimId(model), kind, value };
  if (nameCheck.name) dim.name = nameCheck.name;
  if (kind === 'length' && list.length === 1 && list[0].kind === 'line') {
    if (!(value > 0)) return { ok: false, message: 'Length must be greater than 0.' };
    dim.edge = list[0].id;
  } else if (kind === 'radius' && list.length === 1 && list[0].kind === 'arc') {
    if (!(value > 0)) return { ok: false, message: 'Radius must be greater than 0.' };
    dim.arc = list[0].id;
  } else if (kind === 'distance' && list.length === 2 && list.every((p) => p.kind === 'point')) {
    if (!(value > 0)) return { ok: false, message: 'Distance must be greater than 0.' };
    const a = pointAt(model, list[0].id);
    const b = pointAt(model, list[1].id);
    if (!a || !b || !(Math.hypot(b[0] - a[0], b[1] - a[1]) > 0)) {
      return { ok: false, message: 'That dimension does not match the pick.' };
    }
    dim.a = list[0].id;
    dim.b = list[1].id;
    dim.at = { [list[0].id]: [a[0], a[1]] };
  } else if ((kind === 'angle' || kind === 'distance') && list.length === 2 && list.every((p) => p.kind === 'line')) {
    dim.a = list[0].id;
    dim.b = list[1].id;
    if (kind === 'distance' && list[0].at && list[1].at) {
      dim.anchors = [[list[0].at[0], list[0].at[1]], [list[1].at[0], list[1].at[1]]];
    }
    if (kind === 'angle') dim.sense = draft.sense < 0 ? -1 : 1;
    else dim.side = side;
  } else if (kind === 'distance' && list.length === 2 && list.some((p) => p.kind === 'ref')) {
    if (list.filter((p) => p.kind === 'ref').length >= 2) {
      return { ok: false, message: 'a constraint cannot join two references' };
    }
    const offer = suggestRefDimension(model, list);
    if (!offer.ok) return { ok: false, message: offer.note || 'That dimension does not match the pick.' };
    const ref = list.find((p) => p.kind === 'ref');
    const other = list.find((p) => p !== ref);
    if (other?.kind === 'point' && geomKindOf(model, ref) === 'point' && !(value > 0)) {
      return { ok: false, message: 'Distance must be greater than 0.' };
    }
    dim.a = list[0].id;
    dim.b = list[1].id;
    if (other?.kind === 'point') {
      const at = pointAt(model, other.id);
      if (at) dim.at = { [other.id]: [at[0], at[1]] };
    }
  } else if (kind === 'offset') {
    const point = list.find((p) => p.kind === 'point');
    const line = list.find((p) => p.kind === 'line');
    if (!point || !line) return { ok: false, message: 'Offset needs a point and a line.' };
    dim.point = point.id;
    dim.edge = line.id;
    dim.side = side;
  } else {
    return { ok: false, message: 'That dimension does not match the pick.' };
  }
  if (dimensionUsesSide(kind, list)) dim.side = side;
  return { ok: true, dimension: dim };
}

function storeSolved(state, model) {
  let solved;
  try {
    solved = solveContour(model);
  } catch (err) {
    return { state, error: err.message || String(err) };
  }
  const contour = specFromSolved(solved);
  const params = { ...(state.params || {}), contour };
  const next = { ...state, params, picks: [], gestureNote: null };
  const statusNote = contourStatusNote(solved);
  if (statusNote.text) next.gestureNote = statusNote.text;
  return { state: next, error: null, solved };
}

/**
 * The item is already gone from `model`. Solve what remains. A solver
 * failure is status, not a reason to put the item back.
 */
function storeRemoved(state, model) {
  let solved = null;
  let warning = null;
  try {
    solved = solveContour(model);
  } catch (err) {
    warning = err.message || String(err);
  }
  let contour = model;
  try {
    contour = specFromSolved(solved || model);
  } catch {
    contour = model;
  }
  const params = { ...(state.params || {}), contour };
  const next = { ...state, params, picks: [], gestureNote: warning };
  if (solved) {
    const statusNote = contourStatusNote(solved);
    next.gestureNote = statusNote.text || null;
  }
  return { state: next, error: null, warning, solved };
}

function copyContour(contour) {
  return specFromSolved(contour);
}

/** Present only while a typed point distance is solved. Not a stored lock. */
const DRIVE_PIN = '__contourDrivePin';

/**
 * The first picked point stays put for this edit solve, so the second point
 * takes the typed distance. The pin is a temporary fix and is stripped
 * before the contour is kept.
 */
function withEditPin(contour, dimension) {
  const pin = dimension?.at?.[dimension.a];
  if (!pin || dimension.kind !== 'distance' || !dimension.a || !dimension.b) return contour;
  const pointIds = new Set((contour.points || []).map((p) => p.id));
  const lineIds = new Set((contour.lines || []).map((l) => l.id));
  if (!pointIds.has(dimension.a) || !pointIds.has(dimension.b)) return contour;
  if (lineIds.has(dimension.a) || lineIds.has(dimension.b)) return contour;
  return {
    ...contour,
    constraints: [
      ...(contour.constraints || []),
      {
        id: DRIVE_PIN,
        kind: 'fix',
        items: [dimension.a],
        at: { [dimension.a]: [pin[0], pin[1]] },
      },
    ],
  };
}

function withoutEditPin(contour) {
  if (!(contour?.constraints || []).some((item) => item.id === DRIVE_PIN)) return contour;
  return {
    ...contour,
    constraints: contour.constraints.filter((item) => item.id !== DRIVE_PIN),
  };
}

/** Drop a typed preview and put the contour back to the shape before it. */
export function revertLiveDimension(state) {
  if (!state?.dimensionLive?.base) return state;
  return {
    ...state,
    params: { ...(state.params || {}), contour: copyContour(state.dimensionLive.base) },
    dimensionLive: null,
  };
}

function withLiveBase(state, live, gestureNote) {
  return {
    ...state,
    params: { ...(state.params || {}), contour: copyContour(live.base) },
    picks: state.picks,
    gesture: state.gesture,
    tagId: state.tagId,
    dimensionLive: live,
    gestureNote: gestureNote || null,
  };
}

/**
 * Re-solve one dimension from the contour as it was when typing started.
 * A point distance pins the first pick for this solve only, then drops
 * that pin, so the stored dimension locks the distance and nothing else.
 * The preview keeps the picks, so the card does not reset. Confirm is what
 * writes the block. An empty or non-positive length, radius, or point
 * distance puts the contour back.
 */
export function liveDimension(state, draft) {
  if (!draft) return { state: revertLiveDimension(state), error: null };
  const ready = state?.params?.contour ? state : promoteContourState(state);
  if (!ready?.params?.contour) {
    return { state: ready, error: ready?.gestureNote || 'Draw a contour first.' };
  }
  const live = ready.dimensionLive?.base
    ? { base: ready.dimensionLive.base, id: ready.dimensionLive.id }
    : {
      base: copyContour(ready.params.contour),
      id: ready.dimensionEdit || nextDimId(ready.params.contour),
    };
  const kind = draft.kind;
  const value = Number(draft.valueMm);
  const picks = ready.picks || [];
  const pointDistance = kind === 'distance'
    && picks.length === 2
    && picks.every((p) => p.kind === 'point');
  const needsPositive = kind === 'length' || kind === 'radius' || pointDistance;
  if (!Number.isFinite(value) || (needsPositive && !(value > 0))) {
    return { state: withLiveBase(ready, live, null), error: null };
  }
  const built = buildDimension(live.base, picks, { ...draft, id: live.id });
  if (!built.ok) {
    return { state: withLiveBase(ready, live, built.message), error: built.message };
  }
  let solved;
  try {
    solved = solveContour(withEditPin(replaceDimension(live.base, built.dimension), built.dimension));
  } catch (err) {
    const message = err.message || String(err);
    return { state: withLiveBase(ready, live, message), error: message };
  }
  const contour = withoutEditPin(specFromSolved(solved));
  const statusNote = contourStatusNote(solved);
  return {
    state: {
      ...ready,
      params: { ...(ready.params || {}), contour },
      picks: ready.picks,
      gesture: ready.gesture,
      tagId: ready.tagId,
      dimensionLive: live,
      gestureNote: statusNote.text || null,
    },
    error: null,
    solved,
  };
}

function finalizeLiveDimension(state, draft) {
  const live = liveDimension(state, draft);
  if (live.error || !live.state) return live;
  return {
    state: { ...live.state, dimensionLive: null, picks: [] },
    error: null,
    solved: live.solved,
  };
}

export function commitDimension(state, draft) {
  if (state?.dimensionLive?.base) return finalizeLiveDimension(state, draft);
  const ready = state?.params?.contour ? state : promoteContourState(state);
  if (!ready?.params?.contour) {
    return { state: ready, error: ready?.gestureNote || 'Draw a contour first.' };
  }
  const built = buildDimension(ready.params.contour, ready.picks, draft);
  if (!built.ok) return { state: ready, error: built.message };
  return storeSolved(ready, replaceDimension(ready.params.contour, built.dimension));
}

function replaceDimension(contour, dim) {
  const prev = (contour?.dimensions || []).find((item) => item.id === dim.id);
  const next = { ...dim };
  if (next.placement == null && prev?.placement != null) next.placement = prev.placement;
  if (!Number.isFinite(Number(next.seq)) && Number.isFinite(Number(prev?.seq))) {
    next.seq = Math.round(Number(prev.seq));
  }
  const kept = (contour?.dimensions || []).filter((item) => item.id !== next.id);
  return { ...contour, dimensions: [...kept, next] };
}

/** Picks that reopen a saved dimension in the card. */
export function picksForDimension(model, dim) {
  if (!model || !dim) return [];
  const hasPoint = (id) => (model.points || []).some((p) => p.id === id);
  const hasLine = (id) => (model.lines || []).some((l) => l.id === id);
  const chip = (kind, id, at) => {
    const ref = refRecord(model, id);
    if (ref) {
      const pick = { kind: 'ref', id, geomKind: ref.geom?.kind || 'line', label: id };
      if (at) pick.at = [at[0], at[1]];
      return pick;
    }
    const pick = { kind, id, label: id };
    if (at) pick.at = [at[0], at[1]];
    return pick;
  };
  const atOf = (id) => (model.points || []).find((p) => p.id === id)?.at || null;
  if (dim.kind === 'length' && dim.edge) return [chip('line', dim.edge)];
  if (dim.kind === 'radius' && dim.arc) return [chip('arc', dim.arc)];
  if (dim.kind === 'offset' && dim.point && dim.edge) {
    return [chip('point', dim.point, atOf(dim.point)), chip('line', dim.edge)];
  }
  if ((dim.kind === 'angle' || dim.kind === 'distance') && dim.a && dim.b) {
    const kindOf = (id) => (hasPoint(id) && !hasLine(id) ? 'point' : 'line');
    const a = chip(kindOf(dim.a), dim.a, kindOf(dim.a) === 'point' ? atOf(dim.a) : dim.anchors?.[0]);
    const b = chip(kindOf(dim.b), dim.b, kindOf(dim.b) === 'point' ? atOf(dim.b) : dim.anchors?.[1]);
    return [a, b];
  }
  return [];
}

/** Tap a dimension tag. The card opens on that dimension, picks highlighted. */
export function beginDimensionEdit(state, id) {
  const base = revertLiveDimension(state);
  const contour = base?.params?.contour;
  const dim = (contour?.dimensions || []).find((item) => item.id === id);
  if (!dim) return base;
  return {
    ...base,
    gesture: 'dimension',
    picks: picksForDimension(contour, dim),
    tagId: null,
    dimensionEdit: id,
    constraintEdit: null,
    dimensionLive: { base: copyContour(contour), id },
    gestureNote: null,
  };
}

/** Picks that reopen a saved constraint. */
export function picksForConstraint(model, con) {
  if (!model || !con) return [];
  const has = (list, id) => (list || []).some((item) => item.id === id);
  return (con.items || []).map((id) => {
    const ref = refRecord(model, id);
    if (ref) return { kind: 'ref', id, geomKind: ref.geom?.kind || 'line', label: id };
    if (has(model.points, id)) {
      const at = (model.points || []).find((p) => p.id === id)?.at;
      const pick = { kind: 'point', id, label: id };
      if (at) pick.at = [at[0], at[1]];
      return pick;
    }
    if (has(model.lines, id)) return { kind: 'line', id, label: id };
    if (has(model.arcs, id)) return { kind: 'arc', id, label: id };
    return null;
  }).filter(Boolean);
}

/** Tap a constraint tag. The card opens on that constraint, picks highlighted. */
export function beginConstraintEdit(state, id) {
  const base = revertLiveDimension(state);
  const contour = base?.params?.contour;
  const con = (contour?.constraints || []).find((item) => item.id === id);
  if (!con) return base;
  return {
    ...base,
    gesture: 'constraints',
    picks: picksForConstraint(contour, con),
    tagId: null,
    dimensionEdit: null,
    constraintEdit: id,
    dimensionLive: null,
    gestureNote: null,
  };
}

export function deleteContourDimension(state, id) {
  const cleared = revertLiveDimension(state);
  const contour = cleared?.params?.contour;
  if (!contour) return { state: cleared, error: 'No contour.' };
  if (state?.dimensionLive?.id === id && !(contour.dimensions || []).some((d) => d.id === id)) {
    return { state: { ...cleared, tagId: null, dimensionEdit: null }, error: null };
  }
  const dimensions = (contour.dimensions || []).filter((d) => d.id !== id);
  if (dimensions.length === (contour.dimensions || []).length) {
    return { state: cleared, error: 'That dimension is already gone.' };
  }
  const result = storeRemoved(cleared, { ...contour, dimensions });
  if (result.state) {
    result.state = {
      ...result.state,
      tagId: null,
      dimensionLive: null,
      dimensionEdit: result.state.dimensionEdit === id ? null : result.state.dimensionEdit,
    };
  }
  return result;
}

function fitRadius(model, ids) {
  try {
    roundContourCorner(model, ids, 1);
  } catch {
    /* probed below */
  }
  const lines = ids.map((id) => (model.lines || []).find((l) => l.id === id)).filter(Boolean);
  if (lines.length < 2) return 2;
  const lens = lines.map((line) => {
    const ends = lineEnds(model, line.id);
    return ends ? Math.hypot(ends.d[0], ends.d[1]) : 0;
  });
  const shortest = Math.min(...lens.filter((n) => n > 0));
  if (!Number.isFinite(shortest)) return 2;
  return Math.max(0.5, Math.round(shortest * 0.2 * 10) / 10);
}

export function suggestContourArc(model, picks) {
  const lines = (model?.lines || []);
  if (!lines.length) {
    return { ok: false, radius: 2, note: 'A circle has no corner to round. Draw a polyline.' };
  }
  const ids = (picks || []).filter((p) => p.kind === 'line').map((p) => p.id);
  if (ids.length < 2) {
    return { ok: false, radius: fitRadius(model, lines.slice(0, 2).map((l) => l.id)), note: 'Tap two or three adjacent segments.' };
  }
  if (ids.length > 3) return { ok: false, radius: 2, note: 'An arc rounds two or three segments.' };
  const radius = fitRadius(model, ids);
  try {
    roundContourCorner(model, ids, radius);
    return { ok: true, radius, note: '' };
  } catch (err) {
    return { ok: false, radius, note: err.message || String(err) };
  }
}

export function commitArc(state, radiusMm) {
  const ready = state?.params?.contour ? state : promoteContourState(state);
  if (!ready?.params?.contour) {
    return { state: ready, error: ready?.gestureNote || 'Draw a polyline first.' };
  }
  const ids = (ready.picks || []).filter((p) => p.kind === 'line').map((p) => p.id);
  const radius = Number(radiusMm);
  if (!(radius > 0)) return { state: ready, error: 'Radius must be greater than 0.' };
  let rounded;
  try {
    rounded = roundContourCorner(ready.params.contour, ids, radius);
  } catch (err) {
    return { state: ready, error: err.message || String(err) };
  }
  const result = storeSolved(ready, rounded);
  return result;
}

export const DIMENSION_LABELS = {
  length: 'Length',
  angle: 'Angle',
  distance: 'Distance',
  offset: 'Offset',
  radius: 'Radius',
};

const AXIS_BAND_DEG = 20;
const PARALLEL_BAND_DEG = 15;
const CLOSE_RATIO = 0.1;

export const CONSTRAINT_LABELS = {
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  parallel: 'Parallel',
  perpendicular: 'Perpendicular',
  tangent: 'Tangent',
  equal: 'Equal',
  coincident: 'Coincident',
  fix: 'Fix',
};

/** Undirected angle from +u, in degrees, from 0 (horizontal) to 90 (vertical). */
export function lineAxisDeg(model, id) {
  const ends = lineEnds(model, id);
  if (!ends) return 0;
  const len = Math.hypot(ends.d[0], ends.d[1]);
  if (len < 1e-12) return 0;
  return Math.atan2(Math.abs(ends.d[1]), Math.abs(ends.d[0])) * 180 / Math.PI;
}

function lineById(model, id) {
  return (model.lines || []).find((line) => line.id === id) || null;
}

function arcById(model, id) {
  return (model.arcs || []).find((arc) => arc.id === id) || null;
}

function arcRadius(arc) {
  const r = Number(arc?.radius);
  return Number.isFinite(r) ? r : 0;
}

function tangentSideLineArc(model, lineId, arcId) {
  const ends = lineEnds(model, lineId);
  const arc = arcById(model, arcId);
  const center = arc && pointAt(model, arc.center);
  if (!ends || !center) return 1;
  return signedPointLine(center, ends.a, ends.d) >= 0 ? 1 : -1;
}

function arcSeparation(model, idA, idB) {
  const a = arcById(model, idA);
  const b = arcById(model, idB);
  const ca = a && pointAt(model, a.center);
  const cb = b && pointAt(model, b.center);
  if (!ca || !cb) return null;
  const ra = arcRadius(a);
  const rb = arcRadius(b);
  const dist = Math.hypot(ca[0] - cb[0], ca[1] - cb[1]);
  return { dist, ra, rb };
}

function nearlyTangentArcs(sep) {
  if (!sep) return false;
  const external = sep.ra + sep.rb;
  const internal = Math.abs(sep.ra - sep.rb);
  const extScale = Math.max(external, 1e-9);
  const intScale = Math.max(sep.ra, sep.rb, 1e-9);
  return Math.abs(sep.dist - external) / extScale <= CLOSE_RATIO
    || Math.abs(sep.dist - internal) / intScale <= CLOSE_RATIO;
}

function tangentSideArcs(sep) {
  if (!sep) return 1;
  const external = Math.abs(sep.dist - (sep.ra + sep.rb));
  const internal = Math.abs(sep.dist - Math.abs(sep.ra - sep.rb));
  return internal < external ? -1 : 1;
}

function radiiWithin(sep) {
  if (!sep) return false;
  const scale = Math.max(sep.ra, sep.rb, 1e-9);
  return Math.abs(sep.ra - sep.rb) / scale <= CLOSE_RATIO;
}

function oneLineOffer(model, id) {
  const ends = lineEnds(model, id);
  const len = ends ? Math.hypot(ends.d[0], ends.d[1]) : 0;
  if (!(len > 0)) {
    return { ok: false, kind: null, kinds: [], side: 1, band: null, note: 'That line has no length.' };
  }
  const axis = lineAxisDeg(model, id);
  const kinds = ['horizontal', 'vertical', 'fix'];
  const slack = 1e-6;
  if (axis <= AXIS_BAND_DEG + slack) {
    return { ok: true, kind: 'horizontal', kinds, side: 1, band: 'x', note: '' };
  }
  if (axis >= 90 - AXIS_BAND_DEG - slack) {
    return { ok: true, kind: 'vertical', kinds, side: 1, band: 'y', note: '' };
  }
  const du = Math.abs(ends.d[0]);
  const dv = Math.abs(ends.d[1]);
  const kind = du >= dv ? 'horizontal' : 'vertical';
  return { ok: true, kind, kinds, side: 1, band: 'span', note: '' };
}

function twoLineOffer(model, idA, idB) {
  const fromParallel = linesFromParallelDeg(model, idA, idB);
  const kinds = ['parallel', 'perpendicular', 'equal'];
  // Trig of an exact boundary can land a few ulps past the number.
  const slack = 1e-6;
  if (fromParallel >= 90 - PARALLEL_BAND_DEG - slack) {
    return { ok: true, kind: 'perpendicular', kinds, side: 1, band: 'perpendicular', note: '' };
  }
  const band = fromParallel <= PARALLEL_BAND_DEG + slack ? 'parallel' : 'other';
  return { ok: true, kind: 'parallel', kinds, side: 1, band, note: '' };
}

function suggestRefConstraint(model, list) {
  const empty = { ok: false, kind: null, kinds: [], side: 1, band: null, note: 'That pair is not a constraint.' };
  const ref = list.find((p) => p.kind === 'ref');
  const other = list.find((p) => p !== ref);
  const kind = geomKindOf(model, ref);
  if (!other || !kind) return empty;
  if (kind === 'polyline' && (other.kind === 'line')) {
    return { ...empty, note: 'parallel needs a line reference' };
  }
  if (other.kind === 'line' && kind === 'line') {
    const offer = twoLineOffer(model, other.id, ref.id);
    return { ...offer, kinds: offer.kinds.filter((item) => item !== 'equal') };
  }
  if (other.kind === 'point' && (kind === 'line' || kind === 'polyline' || kind === 'point' || kind === 'arc')) {
    return { ok: true, kind: 'coincident', kinds: ['coincident'], side: 1, band: 'reference', note: '' };
  }
  if (other.kind === 'line' && kind === 'arc') {
    return { ok: true, kind: 'tangent', kinds: ['tangent'], side: 1, band: 'line-arc', note: '' };
  }
  if (other.kind === 'arc' && kind === 'arc') {
    return { ok: true, kind: 'tangent', kinds: ['tangent'], side: 1, band: 'arcs', note: '' };
  }
  if (other.kind === 'arc' && kind === 'line') {
    return { ok: true, kind: 'tangent', kinds: ['tangent'], side: 1, band: 'line-arc', note: '' };
  }
  return empty;
}

/**
 * What a constraint pick offers. Boundaries are inclusive: 20° from an
 * axis, 15° from parallel or perpendicular, and 10% on radii and on
 * tangent distance.
 */
export function suggestContourConstraint(model, picks) {
  const list = Array.isArray(picks) ? picks : [];
  const empty = { ok: false, kind: null, kinds: [], side: 1, band: null, note: 'Tap a line, a point, or an arc.' };
  if (!model) return { ...empty, note: 'Draw a contour first.' };
  const refCount = list.filter((p) => p.kind === 'ref').length;
  if (refCount >= 2) return { ...empty, note: 'a constraint cannot join two references' };
  if (refCount === 1 && list.length === 1) {
    return { ...empty, note: 'A reference stays fixed. Tap a sketch line or a sketch point as well.' };
  }
  if (refCount === 1 && list.length === 2) return suggestRefConstraint(model, list);
  if (list.length === 1 && list[0].kind === 'line') return oneLineOffer(model, list[0].id);
  if (list.length === 1 && (list[0].kind === 'point' || list[0].kind === 'arc')) {
    return { ok: true, kind: 'fix', kinds: ['fix'], side: 1, band: 'fix', note: '' };
  }
  if (list.length === 2 && list.every((p) => p.kind === 'line')) {
    return twoLineOffer(model, list[0].id, list[1].id);
  }
  if (list.length === 2 && list.every((p) => p.kind === 'point')) {
    return { ok: true, kind: 'coincident', kinds: ['coincident'], side: 1, band: 'points', note: '' };
  }
  if (list.length === 2 && list.every((p) => p.kind === 'arc')) {
    const sep = arcSeparation(model, list[0].id, list[1].id);
    const side = tangentSideArcs(sep);
    if (nearlyTangentArcs(sep)) {
      return { ok: true, kind: 'tangent', kinds: ['tangent', 'equal'], side, band: 'tangent', note: '' };
    }
    if (radiiWithin(sep)) {
      return { ok: true, kind: 'equal', kinds: ['equal', 'tangent'], side, band: 'equal', note: '' };
    }
    return { ok: true, kind: 'tangent', kinds: ['tangent', 'equal'], side, band: 'apart', note: '' };
  }
  if (list.length === 2) {
    const point = list.find((p) => p.kind === 'point');
    const line = list.find((p) => p.kind === 'line');
    const arc = list.find((p) => p.kind === 'arc');
    if (point && line) {
      return { ok: true, kind: 'coincident', kinds: ['coincident'], side: 1, band: 'point-line', note: '' };
    }
    if (point && arc) {
      return { ok: true, kind: 'coincident', kinds: ['coincident'], side: 1, band: 'point-arc', note: '' };
    }
    if (line && arc) {
      const side = tangentSideLineArc(model, line.id, arc.id);
      return { ok: true, kind: 'tangent', kinds: ['tangent'], side, band: 'line-arc', note: '' };
    }
  }
  if (list.length === 0) return empty;
  return { ...empty, note: 'That pair is not a constraint.' };
}

function fixAt(model, pick) {
  if (pick.kind === 'point') {
    const at = pointAt(model, pick.id);
    return at ? { [pick.id]: at.slice() } : null;
  }
  if (pick.kind === 'line') {
    const line = lineById(model, pick.id);
    const ends = lineEnds(model, pick.id);
    if (!line || !ends) return null;
    return { [line.a]: ends.a.slice(), [line.b]: ends.b.slice() };
  }
  if (pick.kind === 'arc') {
    const arc = arcById(model, pick.id);
    const center = arc && pointAt(model, arc.center);
    if (!arc || !center) return null;
    return { [arc.center]: center.slice(), [arc.id]: [arcRadius(arc)] };
  }
  return null;
}

function nextConstraintId(model) {
  let max = -1;
  for (const con of model.constraints || []) {
    const m = /^k(\d+)$/.exec(con.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `k${max + 1}`;
}

function liveTarget(model, pick) {
  if (!pick?.id || !model) return false;
  if (pick.kind === 'ref') return (model.refs || []).some((ref) => ref.id === pick.id);
  if (pick.kind === 'point') return (model.points || []).some((item) => item.id === pick.id);
  if (pick.kind === 'line') return (model.lines || []).some((item) => item.id === pick.id);
  if (pick.kind === 'arc') return (model.arcs || []).some((item) => item.id === pick.id);
  return false;
}

export function buildConstraint(model, picks, draft) {
  const list = Array.isArray(picks) ? picks : [];
  if (list.some((pick) => !liveTarget(model, pick))) {
    return { ok: false, message: 'That target is not on the contour.' };
  }
  const offered = suggestContourConstraint(model, list);
  const kind = draft?.kind;
  if (!offered.ok || !offered.kinds.includes(kind)) {
    return { ok: false, message: offered.note || 'That constraint does not match the pick.' };
  }
  if (kind === 'coincident' && new Set(list.map((pick) => pick.id)).size !== 2) {
    return { ok: false, message: 'Coincident needs two targets.' };
  }
  const con = { id: nextConstraintId(model), kind, items: list.map((p) => p.id) };
  if (kind === 'tangent') {
    const side = Number.isFinite(Number(draft?.side)) ? Number(draft.side) : offered.side;
    con.side = side < 0 ? -1 : 1;
  }
  if (kind === 'fix') {
    const at = fixAt(model, list[0]);
    if (!at) return { ok: false, message: 'That item cannot be fixed.' };
    con.at = at;
  }
  return { ok: true, constraint: con };
}

export function commitConstraint(state, draft) {
  const ready = state?.params?.contour ? state : promoteContourState(state);
  if (!ready?.params?.contour) {
    return { state: ready, error: ready?.gestureNote || 'Draw a contour first.' };
  }
  const built = buildConstraint(ready.params.contour, ready.picks, draft);
  if (!built.ok) return { state: ready, error: built.message };
  const id = ready.constraintEdit || built.constraint.id;
  const prev = (ready.params.contour.constraints || []).find((item) => item.id === id);
  const con = { ...built.constraint, id };
  if (!Number.isFinite(Number(con.seq)) && Number.isFinite(Number(prev?.seq))) {
    con.seq = Math.round(Number(prev.seq));
  }
  const kept = (ready.params.contour.constraints || []).filter((item) => item.id !== id);
  const model = {
    ...ready.params.contour,
    constraints: [...kept, con],
  };
  return storeSolved(ready, model);
}

export function deleteContourConstraint(state, id) {
  const contour = state?.params?.contour;
  if (!contour) return { state, error: 'No contour.' };
  const constraints = (contour.constraints || []).filter((c) => c.id !== id);
  if (constraints.length === (contour.constraints || []).length) {
    return { state, error: 'That constraint is already gone.' };
  }
  const result = storeRemoved(state, { ...contour, constraints });
  if (result.state) {
    result.state = {
      ...result.state,
      tagId: null,
      constraintEdit: result.state.constraintEdit === id ? null : result.state.constraintEdit,
    };
  }
  return result;
}

/** Drop a reference and anything that names it, then solve what remains. */
export function deleteContourRef(state, id) {
  const contour = state?.params?.contour;
  if (!contour) return { state, error: 'No contour.' };
  if (!(contour.refs || []).some((ref) => ref.id === id)) {
    return { state, error: 'That reference is already gone.' };
  }
  const dropped = deleteContourEntity(state, id);
  const nextContour = dropped.state?.params?.contour;
  if (!nextContour) return { state: dropped.state, error: null };
  const result = storeRemoved(dropped.state, nextContour);
  if (result.state) result.state = { ...result.state, tagId: null };
  return result;
}
