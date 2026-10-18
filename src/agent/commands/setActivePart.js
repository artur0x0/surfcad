import { rejectPartId } from '../state/identity.js';

export const setActivePartCommand = Object.freeze({
  name: 'set_active_part',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['part_id'],
    properties: {
      part_id: { type: 'string', description: 'Part id from parts. Not a vault path.' },
    },
  },
  example: { part_id: '2026-10-07-20-56-31-0423-a3f9' },
  immediate: true,
  checkArgs(args) {
    return rejectPartId(args?.part_id);
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
