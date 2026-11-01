export const slotAssignContourCommand = Object.freeze({
  name: 'slot_assign_contour',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['contour_id'],
    properties: {
      contour_id: { type: 'string', description: '@contour id or binding name' },
      role: {
        type: 'string',
        enum: ['profile', 'path', 'station'],
        description: 'profile (default), path (sweep), or loft station',
      },
      index: { type: 'integer', minimum: 0, description: 'Loft station index when role is station' },
      loop_role: {
        type: 'string',
        enum: ['auto', 'outer', 'hole'],
        description: 'Extrude profile only. auto classifies a nested loop as a hole. outer or hole overrides that test.',
      },
      remove: {
        type: 'boolean',
        description: 'Extrude profile only. Drop this contour from the slot instead of adding it.',
      },
    },
  }),
  example: Object.freeze({ contour_id: 'c1', role: 'profile' }),
  uiEntry: 'data-feature-slot-card',
  checkArgs(args) {
    if (typeof args?.contour_id !== 'string' || !args.contour_id) {
      return { code: 'bad_args', message: 'slot_assign_contour needs contour_id' };
    }
    if (args.loop_role != null && !['auto', 'outer', 'hole'].includes(args.loop_role)) {
      return { code: 'bad_args', message: 'loop_role must be auto, outer, or hole' };
    }
    return null;
  },
  run(ctx, args) {
    const assign = ctx.slotAssignContour;
    if (typeof assign !== 'function') {
      return { error: { code: 'internal', message: 'slotAssignContour handler is missing' } };
    }
    const out = assign(args);
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? { contour_id: args.contour_id } };
  },
});
