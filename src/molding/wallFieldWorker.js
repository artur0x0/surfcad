/**
 * Module worker for the wall-thickness heatmap. One message is one mesh:
 * a coarse centroid field, then the refined field. The main thread keeps
 * this worker for the next request.
 */

import { computeWallField } from './wallFieldJob.js';

globalThis.onmessage = (event) => {
  const data = event?.data || {};
  const id = data.id;
  try {
    const result = computeWallField(
      { positions: data.positions, indices: data.indices, stamped: data.stamped },
      {
        onCoarse(coarse) {
          globalThis.postMessage({ id, phase: 'coarse', result: coarse });
        },
      },
    );
    if (result?.error) {
      globalThis.postMessage({ id, phase: 'error', error: result.error });
      return;
    }
    globalThis.postMessage({ id, phase: 'done', result });
  } catch (err) {
    globalThis.postMessage({
      id,
      phase: 'error',
      error: { code: 'internal', message: String(err?.message || err || 'Wall field failed') },
    });
  }
};
