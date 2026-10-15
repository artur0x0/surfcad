export const cameraFitCommand = Object.freeze({
  name: 'camera_fit',
  schema: {
    type: 'object',
    additionalProperties: true,
    properties: {},
  },
  example: {},
  uiEntry: 'data-zoom-to-fit',
  immediate: true,
  run(ctx) {
    const fit = ctx.fitCamera;
    if (typeof fit !== 'function') {
      return { error: { code: 'internal', message: 'fitCamera handler is missing' } };
    }
    if (!fit()) {
      return { error: { code: 'camera_failed', message: 'Nothing to frame' } };
    }
    return { result: { ok: true } };
  },
});
