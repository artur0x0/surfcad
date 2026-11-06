/**
 * Show or hide the mold report. The viewport handler reads the active part
 * and `buildMoldReport`. `grade` and `quantity` select the resin and the
 * lot. `on: false` closes the panel. It does not paint a skin.
 */
import { packMoldOutcome } from './moldJob.js';

const SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    on: {
      type: 'boolean',
      description: 'true shows the mold report. false closes it. Omit to toggle.',
    },
    grade: {
      type: 'string',
      description: 'Resin grade from the public library. Omit to keep the current grade. The default is PC/ABS.',
    },
    quantity: {
      type: 'integer',
      minimum: 1,
      description: 'Parts to price. Omit to keep the current quantity. The default is 1000.',
    },
  },
});

export const moldDfmCommand = Object.freeze({
  name: 'mold_dfm',
  uiEntry: 'data-mold-dfm',
  schema: SCHEMA,
  example: { on: true, grade: 'PC/ABS', quantity: 1000 },
  immediate: true,
  run(ctx, args) {
    const show = ctx.moldDfm;
    if (typeof show !== 'function') {
      return { error: { code: 'internal', message: 'moldDfm handler is missing' } };
    }
    const out = show({
      on: args?.on,
      grade: args?.grade,
      quantity: args?.quantity,
    });
    // A long analysis answers a heartbeat (status running) and is finished
    // by mold_status; a quick one answers its result here (moldJob.js).
    return packMoldOutcome('mold_dfm', out, ctx);
  },
});
