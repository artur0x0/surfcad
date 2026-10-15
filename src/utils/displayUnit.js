/**
 * Global display unit (the L2 seed).
 *
 * Scripts and the kernel stay millimetres. This module never writes a
 * script and never changes a stored length. It only converts for display,
 * and turns a typed display number back into millimetres before a later
 * field writes. Length captions carry the unit suffix (`Distance mm`).
 * Angles stay degrees.
 *
 * `formatDisplayNumber` is the one display formatter: at most four decimal
 * places, trailing zeros removed. Putting that string in a field is not an
 * edit. `commitDisplayLength` / `commitDisplayNumber` keep the stored value
 * when the field still shows that string.
 *
 * Persisted at `surfcad.displayUnit`. Measure, the joint distance field,
 * the contour loft offset, and sheet metal read it. `lengthSnap`
 * (`sliderMap.js`) reads it for the length-slider detent. A leftover
 * `surfcad.sheetMetal.displayUnit` does not override this key. Gauge
 * numbers stay on the sheet-metal picker.
 */
export const DISPLAY_UNIT_KEY = 'surfcad.displayUnit';
export const MM_PER_IN = 25.4;

const listeners = new Set();
let cached = null;

export function normalizeDisplayUnit(unit) {
  return unit === 'in' ? 'in' : 'mm';
}

function storageOf(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadDisplayUnit(storage) {
  try {
    return normalizeDisplayUnit(storageOf(storage)?.getItem?.(DISPLAY_UNIT_KEY));
  } catch {
    return 'mm';
  }
}

export function saveDisplayUnit(unit, storage) {
  const next = normalizeDisplayUnit(unit);
  try {
    storageOf(storage)?.setItem?.(DISPLAY_UNIT_KEY, next);
  } catch {
    /* private mode / no storage */
  }
  return next;
}

export function getDisplayUnit() {
  if (cached == null) cached = loadDisplayUnit();
  return cached;
}

export function setDisplayUnit(unit, storage) {
  cached = saveDisplayUnit(unit, storage);
  for (const fn of listeners) fn(cached);
  return cached;
}

export function subscribeDisplayUnit(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Stored millimetres → the number a caption or field shows. */
export function lengthToDisplay(mm, unit) {
  const n = Number(mm);
  if (!Number.isFinite(n)) return n;
  return normalizeDisplayUnit(unit) === 'in' ? n / MM_PER_IN : n;
}

/** Calculated numbers show at most this many decimal places. */
export const DISPLAY_NUMBER_DIGITS = 4;

/** In-progress typed number in a field (`''` is cleared, not zero). */
export function isPartialNumberEntry(value) {
  return value === '' || value === '-' || value === '.';
}

/** Finite stored number, or NaN when the box is partial / non-numeric. */
export function finiteStoredNumber(value) {
  if (isPartialNumberEntry(value)) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * The string a numeric input or readout shows.
 * At most four decimal places, trailing zeros removed.
 * Non-finite input is `''`. A rounded zero is `0`, never `-0`.
 * Full precision stays in the stored value; this string is display only.
 */
export function formatDisplayNumber(value) {
  if (value == null || String(value).trim() === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const rounded = Number(n.toFixed(DISPLAY_NUMBER_DIGITS));
  if (rounded === 0) return '0';
  let text = rounded.toFixed(DISPLAY_NUMBER_DIGITS);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  if (text === '-0') return '0';
  return text;
}

/**
 * A typed display number versus the number already stored.
 * The same formatted text is not an edit: `stored` comes back unchanged.
 * A different finite number is what the user typed. `''`, `'-'`, and `'.'`
 * pass through so a cleared box can stay cleared.
 */
/** True when `raw` is only the formatted view of `stored` (not a partial edit). */
export function isFormattedDisplayEcho(stored, raw) {
  const n = finiteStoredNumber(stored);
  if (!Number.isFinite(n)) return false;
  return String(raw).trim() === formatDisplayNumber(stored);
}

export function commitDisplayNumber(typed, stored) {
  if (isPartialNumberEntry(typed)) return typed;
  const raw = String(typed).trim();
  if (isPartialNumberEntry(raw)) return typed;
  if (isFormattedDisplayEcho(stored, raw)) return stored;
  const n = Number(raw);
  return Number.isFinite(n) ? n : stored;
}

/**
 * A typed length in the display unit versus millimetres already stored.
 * Echoing the formatted field keeps `storedMm` (full precision).
 * A new typed number converts to millimetres.
 */
export function commitDisplayLength(typed, storedMm, unit) {
  if (isPartialNumberEntry(typed)) return typed;
  const raw = String(typed).trim();
  if (isPartialNumberEntry(raw)) return typed;
  const stored = finiteStoredNumber(storedMm);
  if (Number.isFinite(stored)) {
    const display = lengthToDisplay(stored, unit);
    if (isFormattedDisplayEcho(display, raw)) return storedMm;
  }
  const mm = displayToMm(raw, unit);
  return Number.isFinite(mm) ? mm : storedMm;
}

/**
 * A typed display number → millimetres. Non-finite input stays non-finite.
 * Call this before a length is written. Do not parse a formatted caption.
 */
export function displayToMm(value, unit) {
  if (value == null || String(value).trim() === '') return NaN;
  const n = Number(value);
  if (!Number.isFinite(n)) return n;
  return normalizeDisplayUnit(unit) === 'in' ? n * MM_PER_IN : n;
}

/** `Distance mm` or `Radius in`. A caption that already ends with the unit stays. */
export function lengthCaption(label, unit) {
  const text = label == null ? '' : String(label).trim();
  const suffix = normalizeDisplayUnit(unit);
  if (text === '') return suffix;
  if (text.endsWith(` ${suffix}`)) return text;
  return `${text} ${suffix}`;
}

/** `30 mm` or `1.1811 in`. Lengths only — angles stay degrees. */
export function formatDisplayLength(mm, unit) {
  const u = normalizeDisplayUnit(unit);
  const text = formatDisplayNumber(lengthToDisplay(mm, u));
  if (text === '') return '';
  return `${text} ${u}`;
}

/** Signed length. A zero rounds to `0 mm`, not `-0`. */
export function formatDisplayDelta(mm, unit) {
  const u = normalizeDisplayUnit(unit);
  const text = formatDisplayNumber(lengthToDisplay(mm, u));
  if (text === '') return '';
  if (text === '0') return `0 ${u}`;
  const body = text.startsWith('-') ? text : `+${text}`;
  return `${body} ${u}`;
}

export function formatDisplayAngle(deg) {
  const text = formatDisplayNumber(deg);
  if (text === '') return '';
  return `${text}°`;
}
