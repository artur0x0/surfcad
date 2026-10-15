const FACE_KEY_SCHEMA = {
  type: 'object',
  additionalProperties: true,
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
    additionalProperties: true,
    properties: {
      keys: { type: 'array', items: FACE_KEY_SCHEMA },
      key: FACE_KEY_SCHEMA,
    },
  },
  example: {
    keys: [{ at: [0, 0, 10], n: [0, 0, 1], area: 1200 }],
  },
  uiEntry: 'data-pick-mode-face',
  immediate: true,
  checkArgs(args) {
    const keys = Array.isArray(args?.keys) ? args.keys : (args?.key ? [args.key] : []);
    if (!keys.length) return { code: 'bad_args', message: 'select_faces needs keys or key' };
    return null;
  },
  run(ctx, args) {
    const select = ctx.selectFaces;
    if (typeof select !== 'function') {
      return { error: { code: 'internal', message: 'selectFaces handler is missing' } };
    }
    const keys = Array.isArray(args?.keys) ? args.keys : [args.key];
    const out = select({ keys });
    if (out?.error) return { error: out.error };
    return { result: { count: out?.count ?? keys.length } };
  },
});
