/**
 * Show or hide signed mold draft. The viewport
 * handler paints the active part. `on: false` removes the skin so face
 * paint and the part colour show again. This is not CAD draft mode.
 *
 * Positive draft means the face normal points along the pull; negative
 * means it points against it (asin(n · pull)). A planar stamped face gets
 * one angle; a wall drafted at exactly the threshold passes.
 * Positive ≥ T uses the cavity colour. Negative ≥ T uses the core colour.
 * |draft| below T is the needs-work hatch, and that class still reports
 * its sign. A wall at 0° is Below T and its sign stays positive.
 * There is no zero-draft flag.
 */
import { packMoldOutcome } from './moldJob.js';

const SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    on: {
      type: 'boolean',
      description: 'true shows signed mold draft. false restores paint and the part colour. Omit to toggle. Pass threshold without on to show at that threshold.',
    },
    threshold: {
      type: 'number',
      description: 'Draft threshold in degrees, greater than 0 and at most 90. The pane offers 0.5, 1, 2, 3, and 5. Default is 1. At or above this angle, positive draft is Positive ≥ T and negative draft is Negative ≥ T. Absolute draft below this angle is Below T, and the sign is still reported. Omit to keep the current threshold. A change rebuckets the stored field and does not measure the mesh again.',
    },
  },
});

export const moldDraftCommand = Object.freeze({
  name: 'mold_draft',
  uiEntry: ['data-mold-draft', 'data-mold-draft-threshold'],
  schema: SCHEMA,
  example: { on: true, threshold: 1 },
  immediate: true,
  run(ctx, args) {
    const show = ctx.moldDraft;
    if (typeof show !== 'function') {
      return { error: { code: 'internal', message: 'moldDraft handler is missing' } };
    }
    const out = show({ on: args?.on, threshold: args?.threshold });
    // A long analysis answers a heartbeat (status running) and is finished
    // by mold_status; a quick one answers its result here (moldJob.js).
    return packMoldOutcome('mold_draft', out, ctx);
  },
});
