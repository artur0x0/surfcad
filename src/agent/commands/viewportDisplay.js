export const setSketchOverlayCommand = Object.freeze({
  name: 'set_sketch_overlay',
  uiEntry: 'data-overlay-toggle-contour',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean', description: 'Show saved sketch overlays on the model' },
    },
  }),
  example: Object.freeze({ enabled: true }),
  run(ctx, args) {
    const apply = ctx.setSketchOverlayVisible;
    if (typeof apply !== 'function') {
      return { error: { code: 'internal', message: 'setSketchOverlayVisible handler is missing' } };
    }
    const out = apply(args || {});
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? out };
  },
});
