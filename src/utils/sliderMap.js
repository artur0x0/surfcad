/**
 * Length-slider curve and snap.
 *
 * The HTML range is a thumb index `0 … THUMB_COUNT`, not the millimetre
 * ends. `shape` spends the first half of the travel on the first third of
 * the value, then accelerates. Angles, counts, and segments stay linear
 * and do not call this module.
 *
 * The typed box does not snap. Confirm writes the typed number.
 * `lengthSnap` is the thumb detent: 0.1 mm, or 1/16 in when the global
 * display unit is inches. Scripts stay millimetres.
 */
import { getDisplayUnit, MM_PER_IN, normalizeDisplayUnit } from './displayUnit.js';

export const THUMB_COUNT = 1000;

function clamp01(s) {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

/**
 * Value fraction for a thumb fraction `s` in [0, 1].
 * shape(0) = 0, shape(0.5) = 1/3, shape(2/3) = 13/27, shape(1) = 1.
 * Continuous slope 2/3 at the halfway point, slope 2 at the end.
 */
export function shape(s) {
  const u = clamp01(s);
  if (u <= 0.5) return (2 / 3) * u;
  const t = (u - 0.5) / 0.5;
  return (1 / 3) + (1 / 3) * t + (1 / 3) * t * t;
}

/** Inverse of `shape`. `v` is a value fraction in [0, 1]. */
export function unshape(v) {
  const x = clamp01(v);
  if (x <= 1 / 3) return 1.5 * x;
  const t = (-1 + Math.sqrt(Math.max(0, 12 * x - 3))) / 2;
  return 0.5 + 0.5 * t;
}

/** Thumb detent in millimetres for the global display unit. */
export function snapMm(unit = getDisplayUnit()) {
  return normalizeDisplayUnit(unit) === 'in' ? MM_PER_IN / 16 : 0.1;
}

/**
 * Same detent, divided by 10 once when the span holds fewer than four snaps.
 * A 1 mm part in inches would otherwise have a single detent.
 */
export function snapMmForSpan(span, unit = getDisplayUnit()) {
  const base = snapMm(unit);
  const width = Math.abs(Number(span));
  if (Number.isFinite(width) && width > 0 && width < 4 * base) return base / 10;
  return base;
}

/** Thumb snap for a span. Omit `span` for the full detent. */
export function lengthSnap(unit = getDisplayUnit(), span) {
  if (span == null) return snapMm(unit);
  return snapMmForSpan(span, unit);
}

/** Round a millimetre value to a detent. Non-finite input is unchanged. */
export function snapLength(mm, snap) {
  const n = Number(mm);
  const s = Number(snap);
  if (!Number.isFinite(n) || !Number.isFinite(s) || s <= 0) return n;
  const snapped = Math.round(n / s) * s;
  return Object.is(snapped, -0) ? 0 : snapped;
}

function thumbUnit(thumb) {
  const n = Number(thumb);
  if (!Number.isFinite(n)) return 0;
  return clamp01(n / THUMB_COUNT);
}

/**
 * Map a thumb index onto a length in millimetres.
 * One-sided: `min + (max − min) · shape(s)`.
 * Signed: `sign(u) · max · shape(|u|)` with `u` in [−1, 1]. `max` is the
 * positive end R. Pass `snap` from `lengthSnap` to detent the thumb only.
 */
export function lengthFromThumb(thumb, { min = 0, max = 1, signed = false, snap = 0 } = {}) {
  const s = thumbUnit(thumb);
  if (signed) {
    const end = Math.abs(Number(max));
    const R = Number.isFinite(end) ? end : 0;
    const u = s * 2 - 1;
    const mag = R * shape(Math.abs(u));
    let value = u < 0 ? -mag : mag;
    if (snap > 0) value = snapLength(value, snap);
    if (value < -R) value = -R;
    if (value > R) value = R;
    return Object.is(value, -0) ? 0 : value;
  }
  const lo = Number(min);
  const hi = Number(max);
  const a = Number.isFinite(lo) ? lo : 0;
  const b = Number.isFinite(hi) ? hi : a;
  let value = a + (b - a) * shape(s);
  if (snap > 0) value = snapLength(value, snap);
  const lo2 = Math.min(a, b);
  const hi2 = Math.max(a, b);
  if (value < lo2) value = lo2;
  if (value > hi2) value = hi2;
  return value;
}

/** Thumb index for a typed millimetre value. Does not snap. */
export function thumbFromLength(value, { min = 0, max = 1, signed = false } = {}) {
  const n = Number(value);
  if (signed) {
    const end = Math.abs(Number(max));
    const R = Number.isFinite(end) ? end : 0;
    if (!Number.isFinite(n) || !(R > 0)) return THUMB_COUNT / 2;
    const mag = Math.min(Math.abs(n) / R, 1);
    const u = (n < 0 ? -1 : 1) * unshape(mag);
    return ((u + 1) / 2) * THUMB_COUNT;
  }
  if (!Number.isFinite(n)) return 0;
  const a = Number(min);
  const b = Number(max);
  const span = b - a;
  if (!Number.isFinite(span) || span === 0) return 0;
  return unshape(clamp01((n - a) / span)) * THUMB_COUNT;
}

function positiveSpan(min, max) {
  const a = Number(min);
  const b = Number(max);
  const lo = Number.isFinite(a) ? a : 0;
  const hi = Number.isFinite(b) ? b : lo;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

/**
 * Log map from `min` to `max`. Equal thumb travel is a constant ratio, so
 * the low end has finer steps. `min` and `max` must be positive.
 * Thumb 0 is `min` and thumb `THUMB_COUNT` is `max`, before and after snap.
 * `snap` is a millimetre (or display-unit) detent, or a function of the
 * unsnapped value. The inverse does not snap.
 */
export function logLengthFromThumb(thumb, { min = 0.5, max = 25, snap = 0 } = {}) {
  const s = thumbUnit(thumb);
  const { lo, hi } = positiveSpan(min, max);
  if (!(lo > 0) || !(hi > lo)) return lo + (hi - lo) * s;
  if (s <= 0) return lo;
  if (s >= 1) return hi;
  let value = lo * (hi / lo) ** s;
  const step = typeof snap === 'function' ? Number(snap(value)) : Number(snap);
  if (step > 0) value = snapLength(value, step);
  if (value < lo) value = lo;
  if (value > hi) value = hi;
  return value;
}

/**
 * Thumb index for a typed value on the log map. Does not snap and does not
 * change the value: below `min` the thumb sits at the start, above `max`
 * it sits at the end.
 */
export function logThumbFromLength(value, { min = 0.5, max = 25 } = {}) {
  const n = Number(value);
  const { lo, hi } = positiveSpan(min, max);
  if (!Number.isFinite(n) || !(lo > 0) || !(hi > lo)) return 0;
  if (n <= lo) return 0;
  if (n >= hi) return THUMB_COUNT;
  const t = Math.log(n / lo) / Math.log(hi / lo);
  if (!Number.isFinite(t)) return 0;
  return Math.min(1, Math.max(0, t)) * THUMB_COUNT;
}

/**
 * Value-range end R such that two-thirds of the thumb equals `dOff`.
 * R = dOff / shape(2/3) = dOff · 27/13.
 */
export function offscreenRange(dOff) {
  const d = Number(dOff);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return (d * 27) / 13;
}

/** No camera: the off-screen distance is 1.5 L. */
export function fallbackOffscreenDistance(lengthMm) {
  const L = Number(lengthMm);
  if (!Number.isFinite(L) || L <= 0) return 0;
  return 1.5 * L;
}
