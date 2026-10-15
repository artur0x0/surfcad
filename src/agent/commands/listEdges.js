export const listEdgesCommand = Object.freeze({
  name: 'list_edges',
  schema: {
    type: 'object',
    additionalProperties: true,
    properties: {
      part_id: { type: 'string' },
      raw: {
        type: 'boolean',
        description: 'When true (default), return tessellated mesh feature edges. When false, same as list_feature_edges.',
      },
      grouped: {
        type: 'boolean',
        description: 'Alias for raw:false — topology-stable boundary edges.',
      },
    },
  },
  example: { raw: true },
  immediate: true,
  run(ctx, args) {
    const wantRaw = args?.grouped === true ? false : (args?.raw !== false);
    if (!wantRaw) {
      const listGrouped = ctx.listFeatureEdges;
      if (typeof listGrouped !== 'function') {
        return { error: { code: 'internal', message: 'listFeatureEdges handler is missing' } };
      }
      const out = listGrouped({ partId: args?.part_id });
      if (out?.error) return { error: out.error };
      return { result: out };
    }
    const list = ctx.listEdges;
    if (typeof list !== 'function') {
      return { error: { code: 'internal', message: 'listEdges handler is missing' } };
    }
    const out = list({ partId: args?.part_id, raw: true });
    if (out?.error) return { error: out.error };
    return { result: out };
  },
});
