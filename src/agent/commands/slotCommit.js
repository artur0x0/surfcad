import { runContourCommitMutate } from './contourCommitMutate.js';

export const slotCommitCommand = Object.freeze({
  name: 'slot_commit',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {},
  }),
  example: Object.freeze({}),
  uiEntry: 'data-feature-slot-card',
  async run(ctx) {
    const prepare = ctx.prepareSlotCommit;
    if (typeof prepare !== 'function') {
      return { error: { code: 'internal', message: 'prepareSlotCommit handler is missing' } };
    }
    return runContourCommitMutate(ctx, { prepare, fromSlot: true });
  },
});
