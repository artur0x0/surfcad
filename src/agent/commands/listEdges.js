export const listEdgesCommand = Object.freeze({
  name: 'list_edges',
  schema: {
    type: 'object',
    additionalProperties: true,
    properties: {
      part_id: { type: 'string' },
    },
  },
  example: {},
  immediate: true,
  run(ctx, args) {
    const list = ctx.listEdges;
    if (typeof list !== 'function') {
      return { error: { code: 'internal', message: 'listEdges handler is missing' } };
    }
    const out = list({ partId: args?.part_id });
    if (out?.error) return { error: out.error };
    return { result: out };
  },
});
