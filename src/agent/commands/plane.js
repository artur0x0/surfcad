function hostCall(ctx, name, args) {
  const fn = ctx[name];
  if (typeof fn !== 'function') {
    return { error: { code: 'internal', message: `${name} handler is missing` } };
  }
  const out = fn(args);
  if (out?.error) return { error: out.error };
  return { result: out?.result ?? out };
}

export const planeSetCommand = Object.freeze({
  name: 'plane_set',
  uiEntry: 'data-contour-mode-chip',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {
      preset: { type: 'string', enum: ['x', 'y', 'z'] },
      offset: { type: 'number' },
      angles: {
        type: 'object',
        additionalProperties: true,
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          z: { type: 'number' },
        },
      },
    },
  }),
  example: { preset: 'z', offset: 5 },
  checkArgs(args) {
    if (args.preset == null && args.offset == null && args.angles == null) {
      return { code: 'bad_args', message: 'plane_set needs preset, offset, or angles' };
    }
    return null;
  },
  run(ctx, args) {
    return hostCall(ctx, 'planeSet', args || {});
  },
});

export const workplaneSelectCommand = Object.freeze({
  name: 'workplane_select',
  uiEntry: 'data-contour-mode-chip',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {
      plane_id: { type: 'string', description: 'Construction plane id from the plane card list' },
    },
  }),
  example: { plane_id: 'wp1' },
  checkArgs(args) {
    if (!args?.plane_id) return { code: 'bad_args', message: 'workplane_select needs plane_id' };
    return null;
  },
  run(ctx, args) {
    return hostCall(ctx, 'workplaneSelect', args);
  },
});

export const setActiveWorkplaneCommand = Object.freeze({
  name: 'set_active_workplane',
  uiEntry: 'data-overlay-toggle-plane',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {
      plane_id: { type: 'string', description: 'Construction plane id, or null to clear' },
      clear: { type: 'boolean' },
    },
  }),
  example: { plane_id: 'wp1' },
  run(ctx, args) {
    return hostCall(ctx, 'setActiveWorkplane', args || {});
  },
});
