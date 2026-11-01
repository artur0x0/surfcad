/**
 * Show or hide the budgetary DFM report. The viewport handler reads the
 * active part. `on: false` closes the panel. It does not paint a skin
 * and it does not price the part.
 */

const SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    on: {
      type: 'boolean',
      description: 'true shows the budgetary DFM report. false closes it. Omit to toggle.',
    },
  },
});

export const moldDfmCommand = Object.freeze({
  name: 'mold_dfm',
  uiEntry: 'data-mold-dfm',
  schema: SCHEMA,
  example: { on: true },
  immediate: true,
  run(ctx, args) {
    const show = ctx.moldDfm;
    if (typeof show !== 'function') {
      return { error: { code: 'internal', message: 'moldDfm handler is missing' } };
    }
    const out = show({ on: args?.on });
    const pack = (value) => (value?.error ? { error: value.error } : { result: value });
    if (out && typeof out.then === 'function') return out.then(pack);
    return pack(out);
  },
});
