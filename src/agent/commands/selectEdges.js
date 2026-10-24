import { EDGE_KEY_SCHEMA } from '../schemas/common.js';

export const selectEdgesCommand = Object.freeze({
  name: 'select_edges',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      keys: { type: 'array', items: EDGE_KEY_SCHEMA },
      key: EDGE_KEY_SCHEMA,
      names: {
        type: 'array',
        items: { type: 'string' },
        description: 'Edge names: the two face names joined by ~ ("plate.top~boss.side", either order; [k] picks one chain, * is a glob). From list_edges rows (faceNameA / faceNameB) or the faceTable.',
      },
      name: { type: 'string', description: 'One edge name; same as names: [name].' },
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
    const names = Array.isArray(args?.names) ? args.names : (typeof args?.name === 'string' && args.name ? [args.name] : []);
    if (!keys.length && !names.length) return { code: 'bad_args', message: 'select_edges needs keys, key, names, or name' };
    if (names.some((n) => typeof n !== 'string' || !n.trim())) return { code: 'bad_args', message: 'select_edges names must be non-empty strings' };
    return null;
  },
  run(ctx, args) {
    const select = ctx.selectEdges;
    if (typeof select !== 'function') {
      return { error: { code: 'internal', message: 'selectEdges handler is missing' } };
    }
    const keys = Array.isArray(args?.keys) ? args.keys : (args?.key != null ? [args.key] : []);
    const names = Array.isArray(args?.names) ? args.names : (typeof args?.name === 'string' && args.name ? [args.name] : []);
    const out = select({ keys, names });
    if (out?.error) return { error: out.error };
    const result = { count: out?.count ?? (keys.length + names.length) };
    if (Array.isArray(out?.names) && out.names.length) result.names = out.names;
    return { result };
  },
});
