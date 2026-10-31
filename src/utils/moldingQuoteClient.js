/**
 * POST /api/molding/quote. The browser sends measurements. The server
 * prices them from the catalog. This file does not call the print quote API.
 */

import { footprintFromBox, toolingCounts } from '../molding/toolingEstimate.js';
import { solidVolumeCm3 } from '../molding/solidVolume.js';

function coordsOf(position) {
  if (!position) return null;
  if (ArrayBuffer.isView(position) || Array.isArray(position)) return position;
  if (ArrayBuffer.isView(position.array) || Array.isArray(position.array)) return position.array;
  return null;
}

export function boundsFromPositions(positions) {
  const pos = coordsOf(positions);
  if (!pos || pos.length < 3) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const n = pos[i + axis];
      if (!Number.isFinite(n)) return null;
      if (n < min[axis]) min[axis] = n;
      if (n > max[axis]) max[axis] = n;
    }
  }
  return { min, max };
}

/**
 * Measurements for one quote. `flowLengthMm` stays null: there is no
 * flow-length measurement, and the hot runner stays off.
 */
export function quoteBodyFromAnalysis(geometry, analysis, opts = {}) {
  const counts = toolingCounts(analysis);
  if (!counts || !(counts.maxWallMm > 0)) {
    return { error: { code: 'bad_args', message: 'maxWallMm must be greater than 0' } };
  }
  const coords = coordsOf(geometry?.attributes?.position);
  if (!coords) return { error: { code: 'no_mesh', message: 'No mesh for that part' } };
  const footprint = footprintFromBox(boundsFromPositions(coords), analysis?.pull);
  if (!footprint) {
    return { error: { code: 'bad_args', message: 'footprint length, width, and height must be greater than 0' } };
  }
  const volumeCm3 = solidVolumeCm3(coords, geometry?.index ?? null);
  if (volumeCm3 == null) {
    return { error: { code: 'bad_args', message: 'volumeCm3 must be greater than 0' } };
  }
  const body = {
    quantity: opts.quantity == null ? 1 : opts.quantity,
    cavityCount: opts.cavityCount == null ? 1 : opts.cavityCount,
    part: {
      footprint,
      volumeCm3,
      maxWallMm: counts.maxWallMm,
      partingLengthMm: counts.partingLengthMm,
      slideCount: counts.slideCount,
      lifterCount: counts.lifterCount,
      pinCount: counts.pinCount,
      sleeveCount: counts.sleeveCount,
      flowLengthMm: null,
    },
  };
  if (typeof opts.grade === 'string' && opts.grade) body.grade = opts.grade;
  return body;
}

export async function postMoldingQuote(body, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl('/api/molding/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch {
    return { error: { code: 'quote_failed', message: 'The quote service did not answer.' } };
  }
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (res.status === 429) {
    const message = typeof parsed?.error === 'string'
      ? parsed.error
      : 'Too many molding quotes. Try again in a few minutes.';
    return { error: { code: 'rate_limited', message } };
  }
  if (!res.ok) {
    if (parsed?.error?.code) return parsed;
    return { error: { code: 'quote_failed', message: 'The quote service did not answer.' } };
  }
  return parsed;
}
