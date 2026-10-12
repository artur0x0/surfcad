/**
 * Which sketch chip is lit, and what a chip tap does to the session.
 *
 * A dimension or constraint card stays the active chip even when its
 * picks name several endpoints. A dimension or constraint gesture with
 * any other count lights nothing. One line, arc, or reference pick
 * lights that chip. An unpromoted shape is the selection until a gesture
 * starts.
 */

import { beginConstraintEdit, beginDimensionEdit, revertLiveDimension } from './contourGesture.js';
import { contourChips } from './contourStrip.js';

function buildingGesture(state) {
  return state?.gesture === 'dimension' || state?.gesture === 'constraints';
}

/** Chip id to press, or null when the sketch has no single selection. */
export function sketchActiveId(state) {
  if (!state) return null;
  if (state.dimensionEdit) return state.dimensionEdit;
  if (state.constraintEdit) return state.constraintEdit;
  const picks = Array.isArray(state.picks) ? state.picks : [];
  if (buildingGesture(state) && picks.length !== 1) return null;
  if (!state.gesture && state.entityCard === 'polyline') {
    return contourChips(state).some((chip) => chip.id === 'polyline') ? 'polyline' : null;
  }
  if (picks.length === 1) {
    const pick = picks[0];
    if (!pick?.id || pick.kind === 'point') return null;
    return contourChips(state).some((chip) => chip.id === pick.id) ? pick.id : null;
  }
  if (!state.gesture && !state.params?.contour) {
    const chips = contourChips(state);
    if (chips.length === 1 && chips[0].id === 'shape') return 'shape';
  }
  return null;
}

/**
 * Picks the canvas painter should amber. Arc picks stay on their own
 * path. A selection with no gesture uses the same highlight as a
 * dimension pick.
 */
export function sketchHighlightPicks(state) {
  const picks = state?.picks;
  if (!Array.isArray(picks) || picks.length === 0) return null;
  if (state.gesture === 'dimension' || state.gesture === 'constraints' || !state.gesture) {
    return picks;
  }
  return null;
}

function geometryKind(kind) {
  if (kind === 'circle') return 'arc';
  if (kind === 'line' || kind === 'arc' || kind === 'ref') return kind;
  return null;
}

/**
 * Geometry or reference chip whose short Delete card is open.
 * A dimension or constraint gesture hides it. The card is not implied
 * by the chip highlight: it opens only after that chip is selected.
 */
export function entityDeleteChip(state) {
  if (!state?.entityCard || state.gesture || state.dimensionEdit || state.constraintEdit) return null;
  if (sketchActiveId(state) !== state.entityCard) return null;
  const chip = contourChips(state).find((item) => item.id === state.entityCard);
  if (!chip || chip.kind === 'dimension' || chip.kind === 'constraint') return null;
  return chip;
}

/** Chip tap. A dimension or constraint opens its card. Anything else replaces the pick. */
export function selectSketchChip(state, chip) {
  if (!state || !chip?.id) return state;
  if (chip.kind === 'dimension' || chip.kind === 'constraint') {
    const next = chip.kind === 'dimension'
      ? beginDimensionEdit(state, chip.id)
      : beginConstraintEdit(state, chip.id);
    if (!next || next === state) return state;
    return { ...next, entityCard: null };
  }
  const base = revertLiveDimension(state);
  const cleared = {
    ...base,
    gesture: null,
    tagId: null,
    dimensionEdit: null,
    constraintEdit: null,
    dimensionLive: null,
    gestureNote: null,
  };
  if (chip.id === 'polyline') {
    const lines = (state.params?.contour?.lines || []).filter((line) => line && !line.guide);
    const picks = lines.map((line) => ({ kind: 'line', id: line.id, label: line.id }));
    return { ...cleared, picks, entityCard: 'polyline' };
  }
  const kind = geometryKind(chip.kind);
  if (!kind || chip.id === 'shape') {
    return { ...cleared, picks: [], entityCard: chip.id === 'shape' ? 'shape' : null };
  }
  const pick = { kind, id: chip.id, label: chip.label || chip.id };
  if (chip.geomKind) pick.geomKind = chip.geomKind;
  return { ...cleared, picks: [pick], entityCard: chip.id };
}
