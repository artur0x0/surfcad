export const selectEdgesCommand = Object.freeze({
  name: 'select_edges',
  schema: {
    type: 'object',
    additionalProperties: true,
    properties: {
      keys: { type: 'array' },
      key: {},
    },
  },
  example: { keys: ['12-34'] },
  uiEntry: 'data-pick-mode-edge',
  immediate: true,
  checkArgs(args) {
    const keys = Array.isArray(args?.keys) ? args.keys : (args?.key != null ? [args.key] : []);
    if (!keys.length) return { code: 'bad_args', message: 'select_edges needs keys or key' };
    return null;
  },
  run(ctx, args) {
    const select = ctx.selectEdges;
    if (typeof select !== 'function') {
      return { error: { code: 'internal', message: 'selectEdges handler is missing' } };
    }
    const keys = Array.isArray(args?.keys) ? args.keys : [args.key];
    const out = select({ keys });
    if (out?.error) return { error: out.error };
    return { result: { count: out?.count ?? keys.length } };
  },
});
