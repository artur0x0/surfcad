import { NO_ARGS_SCHEMA } from '../registry.js';

/**
 * Debug status of the geometry workers: the cap for this device, the
 * primary worker, and the pool that builds the other parts. Immediate read.
 */
export const geometryWorkersCommand = Object.freeze({
  name: 'geometry_workers',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const read = ctx.readGeometryWorkers;
    const out = typeof read === 'function' ? read() : null;
    return {
      result: out && typeof out === 'object' ? out : {
        cap: 1,
        live: 0,
        busy: 0,
        queued: 0,
        peakBusy: 0,
        crashes: 0,
        primary: null,
        pool: null,
      },
    };
  },
});
