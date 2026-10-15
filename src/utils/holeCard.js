/**
 * Hole card values and the sketch that Accept turns into centres.
 *
 * The card is type, size, fit, a raw diameter, through or depth, side, and
 * the two ends. An explicit diameter wins. A blind hole has no far end.
 * The sketch may be a promoted contour or a plain point list. A new hole
 * with no points writes nothing. An open centres contour with no points
 * is still that contour.
 */

import { contourFromPolyline, contourFromRectangle } from './contourSolve.js';
import { isHoleEntry, restoreContourPlane } from './contourMode.js';
import { promoteContourState } from './contourGesture.js';

export const HOLE_SIZE_OPTIONS = ['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10'];
export const HOLE_FIT_OPTIONS = ['close', 'normal', 'loose'];
export const HOLE_END_OPTIONS = [
  { value: 'none', label: 'none' },
  { value: 'cbore', label: 'c-bore' },
  { value: 'csk', label: 'c-sink' },
];

export function holeCardFromSpec(spec) {
  const card = defaultHoleCard();
  if (!spec || typeof spec !== 'object') return card;
  if (spec.dia != null && spec.dia !== '') {
    card.dia = spec.dia;
  } else {
    card.dia = '';
    card.type = spec.type === 'tapDrill' ? 'tapDrill' : 'clearance';
    card.size = spec.size || 'M3';
    if (card.type === 'clearance') card.fit = spec.fit || 'normal';
  }
  card.through = spec.through !== false;
  if (spec.depth != null) card.depth = spec.depth;
  card.side = Number(spec.side) === -1 ? -1 : 1;
  const takeEnd = (side, value) => {
    const kind = value?.kind;
    if (kind === 'cbore' || kind === 'csk') {
      card[`${side}Kind`] = kind;
      card[`${side}Dia`] = value.dia;
      card[`${side}Depth`] = value.depth;
    } else {
      card[`${side}Kind`] = 'none';
    }
  };
  takeEnd('near', spec.near);
  takeEnd('far', spec.far);
  return card;
}

export function defaultHoleCard() {
  return {
    type: 'clearance',
    size: 'M3',
    fit: 'normal',
    dia: '',
    through: true,
    depth: 12,
    side: 1,
    nearKind: 'none',
    nearDia: 6.5,
    nearDepth: 3.5,
    farKind: 'none',
    farDia: 6.5,
    farDepth: 2,
  };
}

function endOf(kind, dia, depth, label) {
  if (kind !== 'cbore' && kind !== 'csk') return { ok: true, end: { kind: 'none' } };
  const d = Number(dia);
  const h = Number(depth);
  if (!(d > 0) || !(h > 0)) {
    return { ok: false, message: `Hole ${label} needs a dia and a depth.` };
  }
  return { ok: true, end: { kind, dia: d, depth: h } };
}

/**
 * @returns {{ ok: true, spec: object } | { ok: false, message: string }}
 */
export function holeSpecFromCard(card) {
  const src = card && typeof card === 'object' ? card : defaultHoleCard();
  const side = Number(src.side) === -1 ? -1 : 1;
  const through = src.through !== false;
  const near = endOf(src.nearKind, src.nearDia, src.nearDepth, 'near');
  if (!near.ok) return near;
  const far = through
    ? endOf(src.farKind, src.farDia, src.farDepth, 'far')
    : { ok: true, end: { kind: 'none' } };
  if (!far.ok) return far;

  const diaText = src.dia === '' || src.dia == null ? '' : String(src.dia).trim();
  const spec = { through, side, near: near.end, far: far.end };
  if (diaText !== '') {
    const dia = Number(diaText);
    if (!(dia > 0)) return { ok: false, message: 'Hole dia must be > 0.' };
    for (const end of [near.end, far.end]) {
      if (end.kind !== 'none' && !(end.dia > dia)) {
        return { ok: false, message: 'Hole end dia must be greater than the hole dia.' };
      }
    }
    spec.dia = dia;
  } else {
    spec.type = src.type === 'tapDrill' ? 'tapDrill' : 'clearance';
    spec.size = src.size || 'M3';
    if (spec.type === 'clearance') spec.fit = src.fit || 'normal';
  }
  if (!through) {
    const depth = Number(src.depth);
    if (!(depth > 0)) return { ok: false, message: 'Hole depth must be > 0.' };
    spec.through = false;
    spec.depth = depth;
  } else {
    spec.through = true;
  }
  return { ok: true, spec };
}

function withConstruction(contour) {
  return {
    points: contour.points || [],
    lines: (contour.lines || []).map((line) => ({ ...line, construction: line.construction !== false })),
    arcs: contour.arcs || [],
    dimensions: contour.dimensions || [],
    constraints: contour.constraints || [],
    refs: contour.refs || [],
  };
}

/**
 * Centres for Accept. A promoted contour wins, including one with no points.
 * A rectangle is that tool's four corners, with its dimensions and constraints.
 * Otherwise each tapped point is a centre and the segments between them are
 * lines. Nothing drawn, and no contour object, is null.
 */
/**
 * Hole rectangle tool: promote to a centres contour (four corners, construction edges).
 */
export function materializeHoleRectangleCenters(state) {
  if (!state || !isHoleEntry(state.entry) || state.tool !== 'rectangle') return state;
  const promoted = promoteContourState(state);
  const contour = promoted.params?.contour;
  if (!contour?.points?.length) return promoted;
  return {
    ...promoted,
    params: {
      ...promoted.params,
      centers: true,
      contour: {
        ...contour,
        centers: true,
        lines: (contour.lines || []).map((line) => ({ ...line, construction: line.construction !== false })),
      },
    },
  };
}

export function holeSketchContour(state) {
  const params = state?.params || {};
  const contour = params.contour;
  if (contour && contour.centers === true && Array.isArray(contour.points)) {
    const uv = contour.points
      .map((point) => (Array.isArray(point?.at) ? [Number(point.at[0]), Number(point.at[1])] : null))
      .filter((row) => row && Number.isFinite(row[0]) && Number.isFinite(row[1]));
    if (uv.length > 0) {
      try {
        return withConstruction(contourFromPolyline(uv));
      } catch {
        return null;
      }
    }
  }
  if (contour && Array.isArray(contour.points)) return withConstruction(contour);
  const raw = params.points;
  if (Array.isArray(raw) && raw.length > 0) {
    try {
      return withConstruction(contourFromPolyline(raw));
    } catch {
      return null;
    }
  }
  if (params.width != null && params.height != null) {
    try {
      return withConstruction(contourFromRectangle(params.width, params.height, params.centered !== false));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Reopen a centres contour on the hole rail. The plane card stays closed.
 * The baked frame is the sketch plane. Lines stay construction.
 */
export function holeCentresSketch(state, saved) {
  const contour = saved?.contour || {};
  const points = (contour.points || []).map((point) => (
    Array.isArray(point?.at) ? [Number(point.at[0]), Number(point.at[1])] : null
  )).filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  const frame = saved?.frame;
  let next = {
    ...state,
    entry: 'hole',
    tool: points.length ? 'polyline' : 'cursor',
    params: {
      points,
      contour: {
        points: contour.points || [],
        lines: (contour.lines || []).map((line) => ({ ...line, construction: line.construction !== false })),
        arcs: contour.arcs || [],
        dimensions: contour.dimensions || [],
        constraints: contour.constraints || [],
        refs: contour.refs || [],
        centers: true,
      },
    },
    contourId: saved?.id || state?.contourId || null,
    contourName: saved?.name || state?.contourName || null,
  };
  if (frame?.center && frame?.normal && frame?.x && frame?.y) {
    next = restoreContourPlane(next, frame, saved?.planeOffset);
  } else if (state?.planeFace) {
    next.planeFace = state.planeFace;
  }
  return next;
}
