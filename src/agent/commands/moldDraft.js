/**
 * Show or hide signed mold draft and the ejector counts. The viewport
 * handler paints the active part. `on: false` removes the skin so face
 * paint and the part colour show again. This is not CAD draft mode.
 *
 * Positive draft opens along the pull. Negative draft closes along the pull.
 * Positive ≥ T uses the cavity colour. Negative ≥ T uses the core colour.
 * |draft| below T is the needs-work hatch, and that class still reports
 * its sign. A wall at 0° is Below T and its sign stays positive.
 * There is no zero-draft flag.
 */

const SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    on: {
      type: 'boolean',
      description: 'true shows signed mold draft and ejector counts. false restores paint and the part colour. Omit to toggle. Pass threshold without on to show at that threshold.',
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
    const pack = (value) => (value?.error ? { error: value.error } : { result: value });
    if (out && typeof out.then === 'function') return out.then(pack);
    return pack(out);
  },
});
