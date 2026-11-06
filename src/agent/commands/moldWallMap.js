/**
 * Show or hide the wall-thickness heatmap. The viewport handler paints the
 * active part mesh and returns the legend numbers. The field is computed in
 * a worker, so the handler may return a promise. `on: false` removes the
 * skin so face paint and the part colour show again.
 */
import { packMoldOutcome } from './moldJob.js';

const SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    on: {
      type: 'boolean',
      description: 'true shows the thickness heatmap. false restores paint and the part colour. Omit to toggle.',
    },
  },
});

export const moldWallMapCommand = Object.freeze({
  name: 'mold_wall_map',
  uiEntry: 'data-wall-heatmap',
  schema: SCHEMA,
  example: { on: true },
  immediate: true,
  run(ctx, args) {
    const show = ctx.moldWallMap;
    if (typeof show !== 'function') {
      return { error: { code: 'internal', message: 'moldWallMap handler is missing' } };
    }
    // A long field computation answers a heartbeat (status running) and is
    // finished by mold_status; a quick one answers its result here (moldJob.js).
    return packMoldOutcome('mold_wall_map', show({ on: args?.on }), ctx);
  },
});
