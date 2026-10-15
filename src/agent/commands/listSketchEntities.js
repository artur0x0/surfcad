export const listSketchEntitiesCommand = Object.freeze({
  name: 'list_sketch_entities',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {},
  }),
  example: {},
  immediate: true,
  run(ctx) {
    const fn = ctx.listSketchEntities;
    if (typeof fn !== 'function') {
      return { error: { code: 'internal', message: 'listSketchEntities handler is missing' } };
    }
    const out = fn();
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? out };
  },
});
