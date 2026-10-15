export const sketchAcceptPlaneCommand = Object.freeze({
  name: 'sketch_accept_plane',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {
      offset: { type: 'number', description: 'Optional plane offset before accepting' },
    },
  }),
  example: Object.freeze({}),
  uiEntry: 'data-contour-confirm',
  run(ctx, args) {
    const accept = ctx.sketchAcceptPlane;
    if (typeof accept !== 'function') {
      return { error: { code: 'internal', message: 'sketchAcceptPlane handler is missing' } };
    }
    const out = accept(args || {});
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? { ok: true } };
  },
});
