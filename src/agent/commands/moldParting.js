/**
 * Show or hide the core / cavity coloring. The viewport handler paints the
 * active part and returns the face counts. `on: false` removes the skin so
 * face paint and the part colour show again.
 */

const SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    on: {
      type: 'boolean',
      description: 'true shows core and cavity colours and the outer parting line. false restores paint and the part colour. Omit to toggle.',
    },
  },
});

export const moldPartingCommand = Object.freeze({
  name: 'mold_parting',
  uiEntry: 'data-mold-parting',
  schema: SCHEMA,
  example: { on: true },
  immediate: true,
  run(ctx, args) {
    const show = ctx.moldParting;
    if (typeof show !== 'function') {
      return { error: { code: 'internal', message: 'moldParting handler is missing' } };
    }
    const out = show({ on: args?.on });
    const pack = (value) => (value?.error ? { error: value.error } : { result: value });
    if (out && typeof out.then === 'function') return out.then(pack);
    return pack(out);
  },
});
