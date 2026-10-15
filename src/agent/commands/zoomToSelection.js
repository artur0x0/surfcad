export const zoomToSelectionCommand = Object.freeze({
  name: 'zoom_to_selection',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  example: {},
  immediate: true,
  run(ctx) {
    const zoom = ctx.zoomToSelection;
    if (typeof zoom !== 'function') {
      return { error: { code: 'internal', message: 'zoomToSelection handler is missing' } };
    }
    const out = zoom();
    if (out?.error) return { error: out.error };
    if (out?.ok === false) {
      return { error: { code: 'no_selection', message: 'No face or edge selection to frame' } };
    }
    return { result: { ok: true } };
  },
});
