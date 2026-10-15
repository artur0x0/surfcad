export const selectPartsCommand = Object.freeze({
  name: 'select_parts',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      part_ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
      part_id: { type: 'string' },
    },
  },
  example: { part_ids: ['local:part1'] },
  immediate: true,
  checkArgs(args) {
    const ids = Array.isArray(args?.part_ids)
      ? args.part_ids
      : (typeof args?.part_id === 'string' && args.part_id ? [args.part_id] : []);
    if (!ids.length) return { code: 'bad_args', message: 'select_parts needs part_id or part_ids' };
    return null;
  },
  run(ctx, args) {
    const select = ctx.selectParts;
    if (typeof select !== 'function') {
      return { error: { code: 'internal', message: 'selectParts handler is missing' } };
    }
    const partIds = Array.isArray(args?.part_ids)
      ? args.part_ids
      : [args.part_id];
    const out = select({ partIds });
    if (out?.error) return { error: out.error };
    return { result: { partIds: out?.partIds ?? partIds } };
  },
});
