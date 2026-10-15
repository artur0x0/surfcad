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
    const commit = ctx.commitContourPayload;
    if (typeof prepare !== 'function') {
      return { error: { code: 'internal', message: 'prepareSketchCommit handler is missing' } };
    }
    if (typeof commit !== 'function') {
      return { error: { code: 'internal', message: 'commitContourPayload handler is missing' } };
    }
    const prepared = prepare();
    if (prepared?.error) return { error: prepared.error };
    const payload = prepared.payload;
    if (!payload) {
      return { error: { code: 'internal', message: 'Sketch commit payload missing' } };
    }
    const out = await commit(payload);
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? { ok: true } };
  },
});
