export const sketchDeleteEntityCommand = Object.freeze({
  name: 'sketch_delete_entity',
  uiEntry: 'data-contour-entity-card',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'Sketch entity id from list_sketch_entities' },
    },
  }),
  example: { id: 'l0' },
  run(ctx, args) {
    const id = args?.id != null ? String(args.id) : '';
    if (!id) {
      return { error: { code: 'bad_args', message: 'sketch_delete_entity needs id' } };
    }
    const fn = ctx.sketchDeleteEntity;
    if (typeof fn !== 'function') {
      return { error: { code: 'internal', message: 'sketchDeleteEntity handler is missing' } };
    }
    const out = fn({ id });
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? out };
  },
});
