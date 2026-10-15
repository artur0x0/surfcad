export const slotCommitCommand = Object.freeze({
  name: 'slot_commit',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {},
  }),
  example: Object.freeze({}),
  uiEntry: 'data-feature-slot-card',
  async run(ctx) {
    const prepare = ctx.prepareSlotCommit;
    const commit = ctx.commitContourPayload;
    if (typeof prepare !== 'function') {
      return { error: { code: 'internal', message: 'prepareSlotCommit handler is missing' } };
    }
    if (typeof commit !== 'function') {
      return { error: { code: 'internal', message: 'commitContourPayload handler is missing' } };
    }
    const prepared = prepare();
    if (prepared?.error) return { error: prepared.error };
    const payload = prepared.payload;
    if (!payload) {
      return { error: { code: 'internal', message: 'Slot commit payload missing' } };
    }
    const out = await commit(payload, { fromSlot: prepared.fromSlot === true });
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? { ok: true } };
  },
});
