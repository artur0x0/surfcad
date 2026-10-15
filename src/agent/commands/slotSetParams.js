export const slotSetParamsCommand = Object.freeze({
  name: 'slot_set_params',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      distance: { type: 'number', description: 'Extrude distance mm' },
      sense: { type: 'string', enum: ['positive', 'negative', 'both'] },
      direction: { type: 'string', enum: ['normal', 'x', 'y', 'z'] },
      angle: { type: 'number', description: 'Revolve angle degrees' },
      axis: { type: 'string' },
      segments: { type: 'number' },
      reverse: { type: 'boolean', description: 'Sweep path reverse' },
      closed: { type: 'boolean', description: 'Sweep path closed' },
      combine: { type: 'string', enum: ['add', 'subtract'] },
      merge: { type: 'boolean' },
      station_index: { type: 'integer', minimum: 0 },
      station_offset: { type: 'number' },
    },
  }),
  example: Object.freeze({ distance: 10 }),
  uiEntry: 'data-feature-slot-card',
  run(ctx, args) {
    const set = ctx.slotSetParams;
    if (typeof set !== 'function') {
      return { error: { code: 'internal', message: 'slotSetParams handler is missing' } };
    }
    const out = set(args || {});
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? { ok: true } };
  },
});
