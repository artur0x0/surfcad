/**
 * Display units for the Analyze load fields.
 *
 * The study block always stores newtons and megapascals. The toggle only
 * changes what the field shows. `surfcad.displayUnit` (`in`) picks the
 * imperial pair; a local toggle does not write that key.
 *
 * 1 lbf = 4.4482216 N. 1 psi = 0.00689476 MPa.
 */

export const N_PER_LBF = 4.4482216;
export const MPA_PER_PSI = 0.00689476;

const FACTOR = {
  N: 1,
  lb: N_PER_LBF,
  MPa: 1,
  psi: MPA_PER_PSI,
};

/** Decimal places that stay put when the same SI value is formatted again. */
const DIGITS = {
  N: 6,
  lb: 4,
  MPa: 6,
  psi: 2,
};

export function loadUnitForSystem(kind, displayUnit) {
  const imperial = displayUnit === 'in';
  if (kind === 'pressure') return imperial ? 'psi' : 'MPa';
  return imperial ? 'lb' : 'N';
}

/** Stored newtons or megapascals → the number in `unit`. */
export function toDisplayLoad(si, unit) {
  const factor = FACTOR[unit];
  const n = Number(si);
  if (!factor || !Number.isFinite(n)) return n;
  return n / factor;
}

/** A typed display number → stored newtons or megapascals. */
export function fromDisplayLoad(display, unit) {
  const factor = FACTOR[unit];
  if (!factor) return NaN;
  if (display == null || String(display).trim() === '') return NaN;
  const n = Number(display);
  if (!Number.isFinite(n)) return n;
  return n * factor;
}

/**
 * The string the magnitude box shows. Rounding is stable: formatting the
 * value you get back from `fromDisplayLoad` yields the same string, so
 * toggling or re-typing the displayed number does not walk.
 */
export function formatLoadDisplay(si, unit) {
  const n = toDisplayLoad(si, unit);
  if (!Number.isFinite(n)) return '';
  const digits = DIGITS[unit] ?? 4;
  const rounded = Number(n.toFixed(digits));
  if (rounded === 0) return '0';
  return String(rounded);
}
