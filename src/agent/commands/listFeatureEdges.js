export const listFeatureEdgesCommand = Object.freeze({
  name: 'list_feature_edges',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      part_id: { type: 'string' },
    },
  },
  example: {},
  immediate: true,
  run(ctx, args) {
    const list = ctx.listFeatureEdges;
    if (typeof list !== 'function') {
      return { error: { code: 'internal', message: 'listFeatureEdges handler is missing' } };
    }
    const out = list({ partId: args?.part_id });
    if (out?.error) return { error: out.error };
    return { result: out };
  },
});
