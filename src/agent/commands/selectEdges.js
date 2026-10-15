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
  example: {
    keys: [{
      faceKeyA: { at: [20, 0, 0], n: [1, 0, 0], area: 600 },
      faceKeyB: { at: [0, 0, 10], n: [0, 0, 1], area: 1200 },
    }],
  },
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
