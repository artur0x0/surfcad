import { runContourCommitMutate } from './contourCommitMutate.js';

export const sketchCommitCommand = Object.freeze({
  name: 'sketch_commit',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {},
  }),
  example: Object.freeze({}),
  uiEntry: 'data-contour-confirm',
  async run(ctx) {
    const prepare = ctx.prepareSketchCommit;
    if (typeof prepare !== 'function') {
      return { error: { code: 'internal', message: 'prepareSketchCommit handler is missing' } };
    }
    return runContourCommitMutate(ctx, { prepare, fromSlot: false });
  },
});
