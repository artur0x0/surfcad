const FACE_KEY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['at', 'n', 'area'],
  properties: {
    at: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    n: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    area: { type: 'number' },
    src: { type: 'integer' },
    ord: { type: 'integer' },
  },
};

export const selectFacesCommand = Object.freeze({
  name: 'select_faces',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      keys: { type: 'array', items: FACE_KEY_SCHEMA },
      key: FACE_KEY_SCHEMA,
      names: {
        type: 'array',
        items: { type: 'string' },
        description: 'Face names from list_faces rows (feature.role[k], e.g. "boss.top"; a label without [k] takes every piece, * is a glob). Selects the stamped face itself.',
      },
      name: { type: 'string', description: 'One face name; same as names: [name].' },
    },
  },
  example: {
    keys: [{ at: [0, 0, 10], n: [0, 0, 1], area: 1200 }],
  },
  uiEntry: 'data-pick-mode-face',
  immediate: true,
  checkArgs(args) {
    const keys = Array.isArray(args?.keys) ? args.keys : (args?.key ? [args.key] : []);
    const names = Array.isArray(args?.names) ? args.names : (typeof args?.name === 'string' && args.name ? [args.name] : []);
    if (!keys.length && !names.length) return { code: 'bad_args', message: 'select_faces needs keys, key, names, or name' };
    if (names.some((n) => typeof n !== 'string' || !n.trim())) return { code: 'bad_args', message: 'select_faces names must be non-empty strings' };
    return null;
  },
  run(ctx, args) {
    const select = ctx.selectFaces;
    if (typeof select !== 'function') {
      return { error: { code: 'internal', message: 'selectFaces handler is missing' } };
    }
    const keys = Array.isArray(args?.keys) ? args.keys : (args?.key ? [args.key] : []);
    const names = Array.isArray(args?.names) ? args.names : (typeof args?.name === 'string' && args.name ? [args.name] : []);
    const out = select({ keys, names });
    if (out?.error) return { error: out.error };
    const result = { count: out?.count ?? (keys.length + names.length) };
    if (Array.isArray(out?.names) && out.names.length) result.names = out.names;
    return { result };
  },
});
