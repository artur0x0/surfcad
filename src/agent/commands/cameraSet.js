const VIEW_NAMES = new Set(['iso', 'front', 'right', 'top', 'back', 'left', 'bottom']);

export const cameraSetCommand = Object.freeze({
  name: 'camera_set',
  schema: {
    type: 'object',
    additionalProperties: true,
    properties: {
      view: { type: 'string', enum: ['iso', 'front', 'right', 'top', 'back', 'left', 'bottom'] },
      position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      target: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      fov: { type: 'number' },
    },
  },
  example: { view: 'top' },
  uiEntry: 'data-view-snap-top',
  immediate: true,
  checkArgs(args) {
    const hasView = typeof args?.view === 'string' && VIEW_NAMES.has(args.view);
    const pos = Array.isArray(args?.position) && args.position.length === 3;
    const target = Array.isArray(args?.target) && args.target.length === 3;
    const fov = Number.isFinite(Number(args?.fov));
    if (args?.view != null && !hasView) {
      return { code: 'bad_view', message: `Unknown view: ${String(args.view)}` };
    }
    if (!hasView && !pos && !target && !fov) {
      return { code: 'bad_args', message: 'camera_set needs view, position, target, or fov' };
    }
    return null;
  },
  run(ctx, args) {
    const setCamera = ctx.setCamera;
    if (typeof setCamera !== 'function') {
      return { error: { code: 'internal', message: 'setCamera handler is missing' } };
    }
    const out = setCamera({
      view: args?.view,
      position: args?.position,
      target: args?.target,
      fov: args?.fov,
    });
    if (out?.error) return { error: out.error };
    if (out?.ok === false) {
      return { error: { code: 'camera_failed', message: 'Camera could not be updated' } };
    }
    return { result: { ok: true } };
  },
});
