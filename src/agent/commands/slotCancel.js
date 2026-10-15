export const slotCancelCommand = Object.freeze({
  name: 'slot_cancel',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {},
  }),
  example: Object.freeze({}),
  uiEntry: 'data-feature-slot-card',
  run(ctx) {
    const cancel = ctx.slotCancel;
    if (typeof cancel !== 'function') {
      return { error: { code: 'internal', message: 'slotCancel handler is missing' } };
    }
    const out = cancel();
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? { ok: true } };
  },
});
