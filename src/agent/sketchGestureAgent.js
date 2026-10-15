/**
 * Agent sketch_dimension / sketch_constrain: picks and drafts from args.
 */

import {
  applyContourPick,
  armContourGesture,
  saveContourConstraint,
  saveContourDimension,
} from '../utils/contourMode.js';
import {
  dimensionShownNumber,
  promoteContourState,
  specFromSolved,
  suggestContourConstraint,
  suggestContourDimension,
} from '../utils/contourGesture.js';
import { solveContour } from '../utils/contourSolve.js';

const PICK_KINDS = new Set(['point', 'line', 'arc', 'ref']);

function entityLists(model) {
  return {
    point: model?.points || [],
    line: model?.lines || [],
    arc: model?.arcs || [],
    ref: model?.refs || [],
  };
}

function hasEntity(model, kind, id) {
  const list = entityLists(model)[kind];
  return Array.isArray(list) && list.some((row) => row.id === id);
}

/**
 * @param {object} model contour spec
 * @param {{ kind?: string, id?: string, entity?: string } | string} ref
 */
export function contourPickFromRef(model, ref) {
  if (ref == null) return null;
  if (typeof ref === 'string') {
    const id = ref;
    if (hasEntity(model, 'line', id)) return { kind: 'line', id, label: id };
    if (hasEntity(model, 'point', id)) return { kind: 'point', id, label: id };
    if (hasEntity(model, 'arc', id)) return { kind: 'arc', id, label: id };
    if (hasEntity(model, 'ref', id)) return { kind: 'ref', id, label: id, geomKind: 'line' };
    return null;
  }
  const id = String(ref.id || ref.entity || '');
  if (!id) return null;
  let kind = String(ref.kind || '').toLowerCase();
  if (!PICK_KINDS.has(kind)) {
    if (hasEntity(model, 'line', id)) kind = 'line';
    else if (hasEntity(model, 'point', id)) kind = 'point';
    else if (hasEntity(model, 'arc', id)) kind = 'arc';
    else if (hasEntity(model, 'ref', id)) kind = 'ref';
    else return null;
  }
  if (!hasEntity(model, kind, id)) return null;
  const pick = { kind, id, label: id };
  if (kind === 'ref' && ref.geomKind) pick.geomKind = ref.geomKind;
  return pick;
}

export function picksFromArgs(model, args = {}) {
  const raw = args.picks ?? args.targets ?? args.entities ?? args.items;
  if (Array.isArray(raw) && raw.length) {
    return raw.map((row) => contourPickFromRef(model, row)).filter(Boolean);
  }
  const shorthand = [];
  for (const key of ['edge', 'line', 'arc', 'point', 'a', 'b']) {
    const id = args[key];
    if (!id) continue;
    const kind = key === 'arc' ? 'arc' : (key === 'point' ? 'point' : 'line');
    const pick = contourPickFromRef(model, { kind, id: String(id) });
    if (pick) shorthand.push(pick);
  }
  return shorthand;
}

function readValueMm(args, kind, fallback) {
  const raw = args.value_mm ?? args.value ?? args.valueMm ?? fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return NaN;
  return dimensionShownNumber(kind, n);
}

export function buildDimensionDraft(model, picks, args = {}) {
  const suggested = suggestContourDimension(model, picks);
  const kind = args.kind || suggested.kind;
  if (!kind) {
    return { error: { code: 'bad_args', message: 'sketch_dimension needs kind or valid picks' } };
  }
  const valueMm = readValueMm(args, kind, suggested.value);
  if (!Number.isFinite(valueMm)) {
    return { error: { code: 'bad_args', message: 'sketch_dimension needs a numeric value' } };
  }
  let id = args.dimension_id || args.id || undefined;
  if (!id && kind === 'length') {
    const edgeId = args.edge || args.line || picks.find((p) => p.kind === 'line')?.id;
    if (edgeId) {
      const existing = (model?.dimensions || []).find((row) => row.kind === 'length' && row.edge === edgeId);
      if (existing) id = existing.id;
    }
  }
  if (!id && kind === 'radius') {
    const arcId = args.arc || picks.find((p) => p.kind === 'arc')?.id;
    if (arcId) {
      const existing = (model?.dimensions || []).find((row) => row.kind === 'radius' && row.arc === arcId);
      if (existing) id = existing.id;
    }
  }
  const draft = {
    kind,
    valueMm,
    name: args.name != null ? String(args.name) : '',
    side: args.side,
    sense: args.sense,
    id,
  };
  return { draft, suggested };
}

export function buildConstraintDraft(model, picks, args = {}) {
  const offered = suggestContourConstraint(model, picks);
  const kind = args.kind || offered.kind;
  if (!kind) {
    return { error: { code: 'bad_args', message: 'sketch_constrain needs kind or valid picks' } };
  }
  if (!offered.kinds?.includes(kind)) {
    return {
      error: {
        code: 'bad_args',
        message: offered.note || 'That constraint does not match the picks',
      },
    };
  }
  const draft = { kind, side: args.side };
  if (args.constraint_id || args.id) draft.id = args.constraint_id || args.id;
  return { draft };
}

function applyPicks(state, picks) {
  let next = state;
  for (const pick of picks) {
    next = applyContourPick(next, pick);
    if (!next?.picks?.some((p) => p.id === pick.id && p.kind === pick.kind)) {
      return { error: { code: 'pick_failed', message: `Could not select ${pick.kind} ${pick.id}` } };
    }
  }
  return { state: next };
}

export function applySketchDimension(state, args = {}) {
  if (!state) {
    return { error: { code: 'no_sketch', message: 'Contour sketch is not open' } };
  }
  let next = state.params?.contour ? state : promoteContourState(state);
  if (!next?.params?.contour) {
    return { error: { code: 'no_profile', message: next?.gestureNote || 'Draw a sketch profile first' } };
  }
  next = armContourGesture(next, 'dimension');
  const picks = picksFromArgs(next.params.contour, args);
  if (!picks.length) {
    return { error: { code: 'bad_args', message: 'sketch_dimension needs picks (kind + id)' } };
  }
  const picked = applyPicks(next, picks);
  if (picked.error) return picked;
  next = picked.state;
  const built = buildDimensionDraft(next.params.contour, next.picks, args);
  if (built.error) return built;
  const result = saveContourDimension(next, built.draft);
  if (result.error) {
    return { error: { code: 'dimension_failed', message: String(result.error) } };
  }
  const dim = (result.state?.params?.contour?.dimensions || []).slice(-1)[0];
  return {
    state: {
      ...result.state,
      gesture: null,
      picks: [],
      dimensionEdit: null,
      dimensionLive: null,
    },
    dimensionId: dim?.id || null,
    kind: built.draft.kind,
  };
}

export function applySketchConstrain(state, args = {}) {
  if (!state) {
    return { error: { code: 'no_sketch', message: 'Contour sketch is not open' } };
  }
  let next = state.params?.contour ? state : promoteContourState(state);
  if (!next?.params?.contour) {
    return { error: { code: 'no_profile', message: next?.gestureNote || 'Draw a sketch profile first' } };
  }
  next = armContourGesture(next, 'constraints');
  const picks = picksFromArgs(next.params.contour, args);
  if (!picks.length) {
    return { error: { code: 'bad_args', message: 'sketch_constrain needs picks (kind + id)' } };
  }
  const picked = applyPicks(next, picks);
  if (picked.error) return picked;
  next = picked.state;
  const built = buildConstraintDraft(next.params.contour, next.picks, args);
  if (built.error) return built;
  const result = saveContourConstraint(next, built.draft);
  if (result.error) {
    return { error: { code: 'constraint_failed', message: String(result.error) } };
  }
  const con = (result.state?.params?.contour?.constraints || []).slice(-1)[0];
  return {
    state: {
      ...result.state,
      gesture: null,
      picks: [],
      constraintEdit: null,
    },
    constraintId: con?.id || null,
    kind: built.draft.kind,
  };
}

/** Prove entity/dim ids survive a solve round-trip (agent targeting contract). */
export function contourIdsStableAcrossSolve(spec) {
  const solved = solveContour(spec);
  const back = specFromSolved(solved);
  const sameIds = (a, b) => {
    const idsA = (a || []).map((row) => row.id).sort().join(',');
    const idsB = (b || []).map((row) => row.id).sort().join(',');
    return idsA === idsB;
  };
  return (
    sameIds(spec.points, back.points)
    && sameIds(spec.lines, back.lines)
    && sameIds(spec.arcs, back.arcs)
    && sameIds(spec.dimensions, back.dimensions)
    && sameIds(spec.constraints, back.constraints)
  );
}
