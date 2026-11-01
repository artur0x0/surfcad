/**
 * Show or hide mold-draft colours and the ejector counts. The viewport
 * handler paints the active part. `on: false` removes the skin so face
 * paint and the part colour show again. This is not CAD draft mode.
 */

const SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    on: {
      type: 'boolean',
      description: 'true shows mold-draft violations and ejector counts. false restores paint and the part colour. Omit to toggle.',
    },
  },
});

export const moldDraftCommand = Object.freeze({
  name: 'mold_draft',
  uiEntry: 'data-mold-draft',
  schema: SCHEMA,
  example: { on: true },
  immediate: true,
  run(ctx, args) {
    const show = ctx.moldDraft;
    if (typeof show !== 'function') {
      return { error: { code: 'internal', message: 'moldDraft handler is missing' } };
    }
    const out = show({ on: args?.on });
    const pack = (value) => (value?.error ? { error: value.error } : { result: value });
    if (out && typeof out.then === 'function') return out.then(pack);
    return pack(out);
  },
});
