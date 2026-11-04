/**
 * Measurements for the molding tools drawer: part volume, projected area
 * along the pull, and extents, in inches or centimetres.
 *
 * The numbers come from the same mesh and the same functions the mold
 * report uses (`solidVolumeCm3`, `projectedAreaMm2`), in the part local
 * frame. Extents are the axis-aligned bounding box of the mesh in that
 * frame. The display unit is inches by default and is remembered per
 * browser under `MEASURE_UNIT_KEY`. Nothing here edits CAD.
 */

import { solidVolumeCm3 } from './solidVolume.js';
import { projectedAreaMm2 } from './moldReport.js';
import { boundsFromPositions } from '../utils/moldingQuoteClient.js';
import { formatDisplayNumber, MM_PER_IN } from '../utils/displayUnit.js';

export const MEASURE_UNITS = Object.freeze(['in', 'cm']);
export const DEFAULT_MEASURE_UNIT = 'in';
export const MEASURE_UNIT_KEY = 'surfcad.moldMeasureUnit';
/** Fallback pull when no shared pull reference is set: the part's +Z. */
export const MEASURE_DEFAULT_PULL = Object.freeze([0, 0, 1]);

const CM3_PER_IN3 = (MM_PER_IN / 10) ** 3;
const MM2_PER_IN2 = MM_PER_IN * MM_PER_IN;

export function normalizeMeasureUnit(unit) {
  return unit === 'cm' ? 'cm' : DEFAULT_MEASURE_UNIT;
}

function storageOf(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadMeasureUnit(storage = null) {
  try {
    const store = storageOf(storage);
    const raw = store ? store.getItem(MEASURE_UNIT_KEY) : null;
    return raw == null ? DEFAULT_MEASURE_UNIT : normalizeMeasureUnit(raw);
  } catch {
    return DEFAULT_MEASURE_UNIT;
  }
}

export function saveMeasureUnit(unit, storage = null) {
  const next = normalizeMeasureUnit(unit);
  try {
    const store = storageOf(storage);
    if (store) store.setItem(MEASURE_UNIT_KEY, next);
  } catch {
    /* storage may be blocked; the unit still applies for this session */
  }
  return next;
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Measure one mesh. `positions` is a flat xyz array (or an attribute with
 * `.array`), `indices` the triangle index list or null. Returns null for no
 * mesh. `pull` is the projection axis; null falls back to +Z.
 */
export function measurePart({ positions, indices = null } = {}, pull = null) {
  const bounds = boundsFromPositions(positions);
  if (!bounds) return null;
  const axis = Array.isArray(pull) && pull.length === 3 && pull.some((n) => n !== 0) ? pull : MEASURE_DEFAULT_PULL;
  const volumeCm3 = solidVolumeCm3(positions, indices);
  const projectedAreaMm2Value = projectedAreaMm2(positions, indices, axis);
  const extentsMm = [0, 1, 2].map((k) => round6(bounds.max[k] - bounds.min[k]));
  return {
    volumeCm3: Number.isFinite(volumeCm3) ? round6(volumeCm3) : null,
    projectedAreaMm2: Number.isFinite(projectedAreaMm2Value) ? round6(projectedAreaMm2Value) : null,
    extentsMm,
    pull: [axis[0], axis[1], axis[2]],
    boundsMm: { min: bounds.min.slice(), max: bounds.max.slice() },
  };
}

/** Volume in the display unit (in³ or cm³). */
export function volumeToDisplay(volumeCm3, unit) {
  if (!Number.isFinite(volumeCm3)) return null;
  return normalizeMeasureUnit(unit) === 'in' ? volumeCm3 / CM3_PER_IN3 : volumeCm3;
}

/** Area in the display unit (in² or cm²). */
export function areaToDisplay(areaMm2, unit) {
  if (!Number.isFinite(areaMm2)) return null;
  return normalizeMeasureUnit(unit) === 'in' ? areaMm2 / MM2_PER_IN2 : areaMm2 / 100;
}

/** Length in the display unit (in or cm). */
export function lengthToMeasureDisplay(mm, unit) {
  if (!Number.isFinite(mm)) return null;
  return normalizeMeasureUnit(unit) === 'in' ? mm / MM_PER_IN : mm / 10;
}

function label(value, suffix) {
  if (value == null || !Number.isFinite(value)) return null;
  const text = formatDisplayNumber(value);
  return text ? `${text} ${suffix}` : null;
}

export function pullLabel(pull) {
  if (!Array.isArray(pull) || pull.length !== 3) return '';
  const names = ['X', 'Y', 'Z'];
  let best = 0;
  for (let k = 1; k < 3; k++) if (Math.abs(pull[k]) > Math.abs(pull[best])) best = k;
  const aligned = Math.abs(pull[best]) >= 0.999 * Math.hypot(pull[0], pull[1], pull[2]);
  if (aligned) return `${pull[best] < 0 ? '−' : '+'}${names[best]}`;
  return `[${pull.map((n) => formatDisplayNumber(n)).join(', ')}]`;
}

/**
 * Pane model: labels in the chosen unit. `volume`, `area`, and `extents`
 * are strings ready to show; `null` means not measurable.
 */
export function measureLegendModel(measure, unit = DEFAULT_MEASURE_UNIT) {
  if (!measure) return null;
  const u = normalizeMeasureUnit(unit);
  const extents = Array.isArray(measure.extentsMm) ? measure.extentsMm.map((mm) => lengthToMeasureDisplay(mm, u)) : null;
  return {
    unit: u,
    units: MEASURE_UNITS,
    volume: label(volumeToDisplay(measure.volumeCm3, u), u === 'in' ? 'in³' : 'cm³'),
    area: label(areaToDisplay(measure.projectedAreaMm2, u), u === 'in' ? 'in²' : 'cm²'),
    extents: extents && extents.every((n) => Number.isFinite(n))
      ? `${extents.map((n) => formatDisplayNumber(n)).join(' × ')} ${u}`
      : null,
    pull: pullLabel(measure.pull),
  };
}

/** Agent result: the mm numbers plus the display strings. */
export function measurePayload(measure, unit = DEFAULT_MEASURE_UNIT) {
  const model = measureLegendModel(measure, unit);
  if (!model) return { on: false };
  return {
    on: true,
    unit: model.unit,
    volumeCm3: measure.volumeCm3,
    projectedAreaMm2: measure.projectedAreaMm2,
    extentsMm: measure.extentsMm,
    pull: measure.pull,
    display: { volume: model.volume, area: model.area, extents: model.extents },
  };
}
