/**
 * Coarse then refined wall field. The worker and the tests both call this.
 * The viewport paints `onCoarse` immediately and replaces it with the return
 * value. A coarse error skips the refined pass.
 */

import { analyzeWallOnly } from './pullDirection.js';

export function computeWallField(input, { onCoarse } = {}) {
  const mesh = {
    positions: input?.positions,
    indices: input?.indices,
    stamped: input?.stamped || null,
  };
  const coarse = analyzeWallOnly({ ...mesh, wallPass: 'centroid' });
  if (coarse?.error) return coarse;
  if (typeof onCoarse === 'function') onCoarse(coarse);
  return analyzeWallOnly({
    ...mesh,
    wallPass: 'refine',
    nominalHint: coarse.wall?.nominal ?? null,
  });
}
