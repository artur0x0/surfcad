/**
 * Move mode — double-click a body, then set a translation.
 * Confirm writes one move() and replaces a previous Move block, the way
 * Shell, Draft, and Cut replace their previous block.
 *
 * move() is Manifold.translate of the named body. The body is the same
 * { at } centroid cut() already uses. There is no second kernel and no
 * viewport gizmo.
 *
 * XYZ deltas, or one distance along the previous cut's normal, or one
 * distance along a picked face normal. All three confirm as one
 * move(part, [dx, dy, dz], { bodies: [{ at }] }).
 */

import { MOVE_BEGIN, MOVE_END } from './helperPaletteSnippets.js';
import { placeBlockBeforeReturn } from './scriptReturn.js';
import { parseFeatureMarkers } from './featureMarkers.js';

export const MOVE_ENTRY_ID = 'move';

export const MOVE_MODE_NEED_BODY = 'Double-click a body to move.';
export const MOVE_MODE_NEED_DELTA = 'X, Y, and Z must be numbers.';
export const MOVE_MODE_NEED_DISTANCE = 'Distance must be a number.';
export const MOVE_MODE_NEED_CUT = 'The previous operation is not a cut.';
export const MOVE_MODE_NEED_FACE = 'Click a face to move along its normal.';

function formatNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || Object.is(v, -0)) return '0';
  const r = Math.round(v * 1e4) / 1e4;
  if (r === 0) return '0';
  return String(r);
}

function formatVec(arr) {
  const a = Array.isArray(arr) ? arr : [0, 0, 0];
  return `[${formatNum(a[0])}, ${formatNum(a[1])}, ${formatNum(a[2])}]`;
}

function dist2(a, b) {
  const dx = Number(a[0]) - Number(b[0]);
  const dy = Number(a[1]) - Number(b[1]);
  const dz = Number(a[2]) - Number(b[2]);
  return dx * dx + dy * dy + dz * dz;
}

function unit3(v) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const x = Number(v[0]);
  const y = Number(v[1]);
  const z = Number(v[2]);
  const len = Math.hypot(x, y, z);
  if (!(len > 1e-12) || !Number.isFinite(len)) return null;
  return [x / len, y / len, z / len];
}

export function emptyMoveState() {
  return {
    entry: MOVE_ENTRY_ID,
    body: 'part',
    target: null,
    /** 'xyz' | 'cut' | 'face' */
    direction: 'xyz',
    dx: 0,
    dy: 0,
    dz: 0,
    distance: 0,
    faceNormal: null,
    cutNormal: null,
  };
}

export function clearMoveTarget(state) {
  if (!state) return emptyMoveState();
  return { ...state, target: null };
}

export function moveTargetLabel(target) {
  if (!target || !Array.isArray(target.at)) return 'Double-click a body';
  return `Body at ${formatVec(target.at)}`;
}

/**
 * Normal of the last feature when that feature is a cut. Null otherwise.
 * The move block is ignored so a second confirm still sees the cut under it.
 */
export function cutNormalFromScript(buffer) {
  const text = stripMoveBlock(String(buffer || ''));
  const blocks = parseFeatureMarkers(text);
  let last = null;
  for (const block of blocks) {
    if (block.kind === 'move') continue;
    last = block;
  }
  if (!last || last.kind !== 'cut') return null;
  const chunk = text.slice(last.startOffset, last.endOffset);
  const m = chunk.match(/normal:\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*,\s*([^\]]+)\s*\]/);
  if (!m) return null;
  return unit3([m[1], m[2], m[3]]);
}

/** Last marked move(), so a replaced block still names the pre-move body. */
export function parseLastMove(buffer) {
  const text = String(buffer || '');
  const i = text.lastIndexOf(MOVE_BEGIN);
  if (i < 0) return null;
  const j = text.indexOf(MOVE_END, i);
  if (j < 0) return null;
  const chunk = text.slice(i, j);
  const m = chunk.match(
    /move\(\s*\w+\s*,\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*,\s*([^\]]+)\s*\]\s*,\s*\{\s*bodies:\s*\[\s*\{\s*at:\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*,\s*([^\]]+)\s*\]/,
  );
  if (!m) return null;
  const nums = m.slice(1, 7).map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return { delta: nums.slice(0, 3), at: nums.slice(3, 6) };
}

/**
 * Viewport components and decompose().getMesh() do not share a vertex set.
 * On a filleted shell after a cut those averages differ by ~0.04. Snap to
 * the kernel centroid when one body is clearly nearer than the others.
 * The next run can still shift that average by a few hundredths, because a
 * fillet does not retessellate the same way. move() names the nearest body
 * within 1% of its radius (at least 0.05) in that case. A point that is not
 * near a centroid still throws. A previous move is stripped on confirm, so
 * a body that already moved keeps the pre-move { at }.
 */
export function resolveMoveBodyAt(viewportAt, kernelCentroids, buffer) {
  const view = Array.isArray(viewportAt) ? viewportAt.slice(0, 3).map(Number) : [0, 0, 0];
  const snapped = snapMoveBodyAt(view, kernelCentroids);
  const prev = parseLastMove(buffer);
  if (!prev) return snapped;
  const shifted = prev.at.map((v, i) => v + prev.delta[i]);
  if (dist2(snapped, shifted) <= 1e-4 || dist2(view, shifted) <= 1e-4) {
    return prev.at.slice();
  }
  return snapped;
}

export function snapMoveBodyAt(viewportAt, kernelCentroids) {
  const view = Array.isArray(viewportAt) ? viewportAt.slice(0, 3).map(Number) : [0, 0, 0];
  const list = Array.isArray(kernelCentroids) ? kernelCentroids : [];
  let best = null;
  let bestD = Infinity;
  let second = Infinity;
  for (const c of list) {
    if (!Array.isArray(c) || c.length < 3) continue;
    const d = dist2(view, c);
    if (d < bestD) {
      second = bestD;
      bestD = d;
      best = c;
    } else if (d < second) {
      second = d;
    }
  }
  if (!best) return view;
  if (bestD <= 1e-4) return best.slice(0, 3).map(Number);
  // Unambiguous same body: within 1 unit, and at least 4× closer than the next.
  if (bestD <= 1 && second >= bestD * 4) return best.slice(0, 3).map(Number);
  return view;
}

function directionVector(state) {
  const which = state?.direction || 'xyz';
  if (which === 'xyz') {
    return [Number(state?.dx), Number(state?.dy), Number(state?.dz)];
  }
  const normal = unit3(which === 'cut' ? state?.cutNormal : state?.faceNormal);
  const distance = Number(state?.distance);
  if (!normal || !Number.isFinite(distance)) return null;
  return [normal[0] * distance, normal[1] * distance, normal[2] * distance];
}

export function validateMoveAccept(state) {
  const at = state?.target?.at;
  if (!Array.isArray(at) || at.length < 3 || at.slice(0, 3).some((v) => !Number.isFinite(Number(v)))) {
    return { ok: false, message: MOVE_MODE_NEED_BODY };
  }
  const which = state?.direction || 'xyz';
  if (which === 'cut' && !unit3(state?.cutNormal)) {
    return { ok: false, message: MOVE_MODE_NEED_CUT };
  }
  if (which === 'face' && !unit3(state?.faceNormal)) {
    return { ok: false, message: MOVE_MODE_NEED_FACE };
  }
  if (which !== 'xyz' && !Number.isFinite(Number(state?.distance))) {
    return { ok: false, message: MOVE_MODE_NEED_DISTANCE };
  }
  const delta = directionVector(state);
  if (!delta || delta.some((v) => !Number.isFinite(v))) {
    return { ok: false, message: which === 'xyz' ? MOVE_MODE_NEED_DELTA : MOVE_MODE_NEED_DISTANCE };
  }
  return {
    ok: true,
    dx: delta[0],
    dy: delta[1],
    dz: delta[2],
    at: at.slice(0, 3).map(Number),
  };
}

/**
 * Ghost offset while the sliders move. A replaced move is absolute from the
 * pre-move solid, so the body that already moved only shifts by the difference.
 */
export function movePreviewOffset(state, buffer) {
  const gate = validateMoveAccept(state);
  if (!gate.ok) return null;
  const next = [gate.dx, gate.dy, gate.dz];
  const prev = parseLastMove(buffer);
  if (prev && dist2(gate.at, prev.at) <= 1e-4) {
    return next.map((v, i) => v - prev.delta[i]);
  }
  return next;
}

export function stripMoveBlock(buffer) {
  const text = String(buffer || '');
  const i = text.lastIndexOf(MOVE_BEGIN);
  if (i < 0) return text;
  const j = text.indexOf(MOVE_END, i);
  if (j < 0) return text;
  const after = text.slice(j + MOVE_END.length).replace(/^\r?\n/, '');
  const before = text.slice(0, i).replace(/\s+$/, '');
  if (before && after) return `${before}\n${after}`;
  return before || after;
}

/**
 * Confirm → one move() wrapped in Move markers.
 * Always names the body. Always replaces the last marked Move block.
 * Leaving without confirm does not call this.
 */
export function composeMoveCommit(buffer, state) {
  const ready = state?.direction === 'cut'
    ? { ...state, cutNormal: unit3(state.cutNormal) || cutNormalFromScript(buffer) }
    : state;
  const gate = validateMoveAccept(ready);
  if (!gate.ok) return gate;
  const bodyName = state?.body || 'part';
  const call = `${bodyName} = move(${bodyName}, [${formatNum(gate.dx)}, ${formatNum(gate.dy)}, ${formatNum(gate.dz)}], { bodies: [{ at: ${formatVec(gate.at)} }] });`;
  const block = [MOVE_BEGIN, call, MOVE_END].join('\n');
  const composed = placeBlockBeforeReturn(stripMoveBlock(String(buffer || '')), block);
  const ownedStart = composed.lastIndexOf(MOVE_BEGIN);
  const ownedEnd = composed.indexOf(MOVE_END, ownedStart);
  const owned = composed.slice(ownedStart, ownedEnd + MOVE_END.length);
  if ((owned.match(/\bmove\s*\(/g) || []).length !== 1) {
    return { ok: false, message: 'composeMoveCommit: Move must emit exactly one move().' };
  }
  return { ok: true, buffer: composed, run: true };
}
