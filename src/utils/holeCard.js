/**
 * Hole card values and the sketch that Accept turns into centres.
 *
 * The card is type, size, fit, a raw diameter, through or depth, side, and
 * the two ends. An explicit diameter wins. A blind hole has no far end.
 * The sketch may be a promoted contour or a plain point list. No points is
 * not a contour: a new hole then writes nothing.
 */

import { contourFromPolyline } from './contourSolve.js';

export const HOLE_SIZE_OPTIONS = ['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10'];
export const HOLE_FIT_OPTIONS = ['close', 'normal', 'loose'];
export const HOLE_END_OPTIONS = [
  { value: 'none', label: 'none' },
  { value: 'cbore', label: 'c-bore' },
  { value: 'csk', label: 'c-sink' },
];

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

/**
 * Centres for Accept. A promoted contour wins. Otherwise each tapped point
 * is a centre and the segments between them are lines. Nothing drawn is null.
 */
export function holeSketchContour(state) {
  const contour = state?.params?.contour;
  if (contour?.points?.length) {
    return {
      points: contour.points,
      lines: contour.lines || [],
      arcs: contour.arcs || [],
      dimensions: contour.dimensions || [],
      constraints: contour.constraints || [],
      refs: contour.refs || [],
    };
  }
  const raw = state?.params?.points;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  try {
    return contourFromPolyline(raw);
  } catch {
    return null;
  }
}
