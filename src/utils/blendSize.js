/**
 * Fillet and chamfer size. One number for both, in every display unit.
 *
 * The stored length is millimetres. The default is 2 mm, so inches show
 * 0.0787 through `formatDisplayNumber`. Edge length and the part box do
 * not change it.
 *
 * The slider runs from 0.5 mm to 25 mm (the same physical range in inches)
 * on a log map: equal thumb travel is a constant ratio, so the low end has
 * finer steps. A typed size outside that range is kept; the thumb sits on
 * the nearer end and does not pull the value back.
 */
import { normalizeDisplayUnit } from './displayUnit.js';

export const BLEND_SIZE_MIN_MM = 0.5;
export const BLEND_SIZE_MAX_MM = 25;
export const BLEND_DEFAULT_MM = 2;

/** Untouched fillet or chamfer size, in millimetres. The unit does not change it. */
export function defaultBlendSizeMm() {
  return BLEND_DEFAULT_MM;
}

/**
 * Thumb detent in the display unit. Finer at the small end.
 * The slider ends are exact and are not run through this.
 * @param {number} value display-unit length
 * @param {'mm'|'in'|string} [unit]
 */
export function blendSnapStep(value, unit = 'mm') {
  const v = Math.abs(Number(value));
  if (normalizeDisplayUnit(unit) === 'in') {
    if (!(v > 0) || v < 0.05) return 0.001;
    if (v < 0.25) return 0.005;
    if (v < 0.5) return 0.01;
    return 0.02;
  }
  if (!(v > 0) || v < 1) return 0.05;
  if (v < 5) return 0.1;
  if (v < 10) return 0.5;
  return 1;
}
