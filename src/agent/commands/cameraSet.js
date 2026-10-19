const VIEW_NAMES = new Set(['iso', 'front', 'right', 'top', 'back', 'left', 'bottom', 'normal_to_sketch']);

export const cameraSetCommand = Object.freeze({
  name: 'camera_set',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: {
        type: 'string',
        enum: ['iso', 'front', 'right', 'top', 'back', 'left', 'bottom', 'normal_to_sketch'],
      },
      position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      target: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      fov: { type: 'number' },
      up: {
        type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
        description: 'Camera up vector for an explicit pose. Default [0, 0, 1] (Z-up); the view never rolls.',
      },
    },
  },
  example: { view: 'top' },
  uiEntry: Object.freeze([
    'data-view-snap-top',
    'data-view-snap-front',
    'data-view-snap-right',
    'data-view-snap-iso',
    'data-view-snap-toggle',
    'data-normal-to-sketch',
  ]),
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
    if (args?.up != null) {
      const up = Array.isArray(args.up) ? args.up : [];
      const finite = up.length === 3 && up.every((n) => Number.isFinite(Number(n)));
      if (!finite || up.every((n) => Number(n) === 0)) {
        return { code: 'bad_args', message: 'camera_set up must be a non-zero [x, y, z]' };
      }
    }
    return null;
  },
  async run(ctx, args) {
    const setCamera = ctx.setCamera;
    if (typeof setCamera !== 'function') {
      return { error: { code: 'internal', message: 'setCamera handler is missing' } };
    }
    const out = await Promise.resolve(setCamera({
      view: args?.view,
      position: args?.position,
      target: args?.target,
      fov: args?.fov,
      up: args?.up,
    }));
    if (out?.error) return { error: out.error };
    if (out?.ok === false) {
      return { error: { code: 'camera_failed', message: 'Camera could not be updated' } };
    }
    return { result: { ok: true } };
  },
});
