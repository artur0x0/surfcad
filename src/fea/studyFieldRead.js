// Read-only views of a study field that is already in memory.
// These functions do not solve, mesh, or write the fields they are given.

import { fieldRange } from './stressSample.js';
import { stressAt } from './stressMap.js';

/** A corner at least this fraction of the nodal peak counts as a hot spot. */
export const HOT_SPOT_FRACTION = 0.8;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Peak, p95, and min of a bound field. Stress values are MPa. A displacement
 * field bound the same way stores a magnitude in millimetres. Vector corners
 * contribute their length. The field's maps are not changed.
 */
export function summarizeBoundField(field) {
  if (!field?.byFace || typeof field.byFace.values !== 'function') return null;
  const values = [];
  for (const bucket of field.byFace.values()) {
    if (!bucket || typeof bucket.values !== 'function') continue;
    for (const value of bucket.values()) {
      const n = Array.isArray(value) ? Math.hypot(value[0], value[1], value[2]) : finite(value);
      if (n != null) values.push(n);
    }
  }
  if (!values.length) return null;
  const range = fieldRange(values);
  return {
    min: range.min,
    peak: range.max,
    p95: range.p95,
    count: values.length,
  };
}

/** The von Mises field, from the nodal accessor or from a stress map that is actually stress. */
export function readVonMisesField(session) {
  const direct = typeof session?.nodalStress === 'function' ? session.nodalStress() : null;
  if (direct?.byFace) return direct;
  const map = typeof session?.stressMap === 'function' ? session.stressMap() : null;
  if (map?.field?.byFace && map.ramp !== 'displacement' && map.contactOverlay !== true) {
    return map.field;
  }
  return null;
}

/** Displacement magnitude field. A displacement plot on the stress map is not used here. */
export function readDisplacementField(session) {
  const direct = typeof session?.displacementField === 'function' ? session.displacementField() : null;
  if (direct?.byFace) return direct;
  return null;
}

/**
 * True when a thin-wall triangle has a corner at or above the hot-spot
 * fraction of the nodal peak. A different geometry object does not match.
 */
export function thinWallHotSpot({ geometry, wall, stressField } = {}) {
  const summary = summarizeBoundField(stressField);
  if (!summary || !(summary.peak > 0)) return false;
  if (stressField.geometry && geometry && stressField.geometry !== geometry) return false;
  const flags = Array.isArray(wall?.field) ? wall.field : [];
  const index = geometry?.index?.array || geometry?.index;
  const faceIDs = geometry?.attributes?.faceID?.array || geometry?.getAttribute?.('faceID')?.array;
  if (!index?.length || !faceIDs?.length) return false;
  const hot = summary.peak * HOT_SPOT_FRACTION;
  const triangles = Math.floor(Math.min(index.length, faceIDs.length * 3) / 3);
  for (let t = 0; t < triangles; t += 1) {
    if (flags[t]?.flag !== 'thin') continue;
    for (let k = 0; k < 3; k += 1) {
      const stress = stressAt(stressField, faceIDs[t], index[t * 3 + k]);
      if (Number.isFinite(stress) && stress >= hot) return true;
    }
  }
  return false;
}
