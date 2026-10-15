export const sketchCancelCommand = Object.freeze({
  name: 'sketch_cancel',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {},
  }),
  example: Object.freeze({}),
  uiEntry: 'data-contour-exit',
  run(ctx) {
    const cancel = ctx.sketchCancel;
    if (typeof cancel !== 'function') {
      return { error: { code: 'internal', message: 'sketchCancel handler is missing' } };
    }
    const out = cancel();
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? { ok: true } };
  },
});
