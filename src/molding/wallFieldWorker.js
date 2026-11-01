/**
 * Module worker for the wall heatmap and the mold analysis. One mesh
 * message is one job. Jobs run one at a time. A `{ cancel: id }` message
 * drops that job at the next yield. The main thread keeps this worker.
 */

import { runAnalysisJob, runWallJob } from './wallFieldJob.js';

const cancelled = new Set();
let chain = Promise.resolve();

globalThis.onmessage = (event) => {
  const data = event?.data || {};
  if (data.cancel != null) {
    cancelled.add(data.cancel);
    return;
  }
  const id = data.id;
  const run = data.kind === 'analysis' ? runAnalysisJob : runWallJob;
  chain = chain.then(() => run(data, {
    cancelled: () => cancelled.has(id),
    post: (message) => {
      globalThis.postMessage({ id, ...message });
    },
  }).catch((err) => {
    globalThis.postMessage({
      id,
      phase: 'error',
      error: { code: 'internal', message: String(err?.message || err || 'Mold analysis failed') },
    });
  })).finally(() => {
    cancelled.delete(id);
  });
};
