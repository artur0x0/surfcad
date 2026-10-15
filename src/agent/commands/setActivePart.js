export const setActivePartCommand = Object.freeze({
  name: 'set_active_part',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['part_id'],
    properties: {
      part_id: { type: 'string' },
    },
  },
  example: { part_id: 'local:part1' },
  immediate: true,
  checkArgs(args) {
    if (typeof args?.part_id !== 'string' || !args.part_id) {
      return { code: 'bad_args', message: 'set_active_part part_id must be a non-empty string' };
    }
    return null;
  },
  run(ctx, args) {
    const setActive = ctx.setActivePart;
    if (typeof setActive !== 'function') {
      return { error: { code: 'internal', message: 'setActivePart handler is missing' } };
    }
    const out = setActive(args.part_id);
    if (out?.error) return { error: out.error };
    return { result: { partId: args.part_id } };
  },
});
