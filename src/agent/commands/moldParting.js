/**
 * Show or hide the core / cavity coloring, including side actions. The
 * viewport handler paints the active part and returns the face counts plus
 * the slide and lifter groups. `on: false` removes the skin so face paint
 * and the part colour show again. `group` highlights one side action.
 */

const SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    on: {
      type: 'boolean',
      description: 'true shows core, cavity, and side-action colours and the outer parting line. false restores paint and the part colour. Omit to toggle.',
    },
    group: {
      type: ['integer', 'null'],
      description: 'Side-action group id to highlight. The same id again, or null, clears the highlight. Omit to leave the selection.',
    },
  },
});

export const moldPartingCommand = Object.freeze({
  name: 'mold_parting',
  uiEntry: Object.freeze(['data-mold-parting', 'data-mold-side-action-group']),
  schema: SCHEMA,
  example: { on: true },
  immediate: true,
  run(ctx, args) {
    const show = ctx.moldParting;
    if (typeof show !== 'function') {
      return { error: { code: 'internal', message: 'moldParting handler is missing' } };
    }
    const out = show({ on: args?.on, group: args?.group });
    const pack = (value) => (value?.error ? { error: value.error } : { result: value });
    if (out && typeof out.then === 'function') return out.then(pack);
    return pack(out);
  },
});
