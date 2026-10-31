/**
 * Show or hide the side-action colours. The viewport handler paints the
 * active part and returns the slide and lifter counts. `on: false` removes
 * the skin so face paint and the part colour show again.
 */

const SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    on: {
      type: 'boolean',
      description: 'true shows side-action groups. false restores paint and the part colour. Omit to toggle.',
    },
  },
});

export const moldSideActionsCommand = Object.freeze({
  name: 'mold_side_actions',
  uiEntry: 'data-mold-side-actions',
  schema: SCHEMA,
  example: { on: true },
  immediate: true,
  run(ctx, args) {
    const show = ctx.moldSideActions;
    if (typeof show !== 'function') {
      return { error: { code: 'internal', message: 'moldSideActions handler is missing' } };
    }
    const out = show({ on: args?.on });
    if (out?.error) return { error: out.error };
    return { result: out };
  },
});
