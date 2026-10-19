/**
 * Hard limit on positions, offsets, and translations, in mm.
 *
 * The block pose fields were capped at ±500 mm and move deltas at ±1000 mm,
 * which blocked parts bigger than about a metre (the Hubless Bike frame).
 * Artur, 2026-10-19: raise it to one million mm; a limit stays so a typo
 * cannot overflow the kernel. NaN and Infinity are still rejected
 * everywhere a number is read.
 */
export const POSITION_LIMIT_MM = 1_000_000;

/** True for a finite number within ±POSITION_LIMIT_MM. */
export function withinPositionLimit(value) {
  if (value == null || value === '' || typeof value === 'boolean') return false;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= POSITION_LIMIT_MM;
}

/** [x, y, z] of finite numbers within the limit, else null. */
export function positionWithinLimit(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const t = [Number(value[0]), Number(value[1]), Number(value[2])];
  return t.every(withinPositionLimit) ? t : null;
}

export function positionLimitMessage(what = 'position') {
  return `${what} must be [x, y, z] finite numbers in mm, each within ±${POSITION_LIMIT_MM}`;
}
