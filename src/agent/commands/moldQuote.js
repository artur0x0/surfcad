/**
 * Show or hide the mold report. Same compute as mold_dfm, plus cavityCount.
 * The viewport handler reads the active part. `on: false` closes the panel.
 * It does not paint a skin and it does not place an order.
 */

const SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    on: {
      type: 'boolean',
      description: 'true shows the mold report. false closes it. Omit to toggle.',
    },
    quantity: {
      type: 'integer',
      minimum: 1,
      description: 'Parts to amortize tooling over. Omit to keep the current quantity.',
    },
    cavityCount: {
      type: 'integer',
      minimum: 1,
      maximum: 64,
      description: 'Cavities in the mold, from 1 to 64. Omit to keep the current count. Not a cavity layout.',
    },
    grade: {
      type: 'string',
      description: 'Resin grade. Omit to keep the current grade, or the partner’s cheapest active grade when none is set.',
    },
  },
});

export const moldQuoteCommand = Object.freeze({
  name: 'mold_quote',
  uiEntry: 'data-mold-dfm',
  schema: SCHEMA,
  example: { on: true, grade: 'PC/ABS', quantity: 1000 },
  immediate: true,
  run(ctx, args) {
    const show = ctx.moldQuote;
    if (typeof show !== 'function') {
      return { error: { code: 'internal', message: 'moldQuote handler is missing' } };
    }
    const out = show({
      on: args?.on,
      quantity: args?.quantity,
      cavityCount: args?.cavityCount,
      grade: args?.grade,
    });
    const pack = (value) => (value?.error ? { error: value.error } : { result: value });
    if (out && typeof out.then === 'function') return out.then(pack);
    return pack(out);
  },
});
