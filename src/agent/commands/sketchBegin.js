export const sketchBeginCommand = Object.freeze({
  name: 'sketch_begin',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      entry: {
        type: 'string',
        description: 'crossSection (profile sketch) or workplane',
        enum: ['crossSection', 'workplane'],
      },
      offset: { type: 'number', description: 'Plane offset mm along the normal' },
      accept_plane: {
        type: 'boolean',
        description: 'When true (default), leave the plane card and start drawing',
      },
      plane: {
        type: 'string',
        description: 'Construction plane preset x/y/z when no face is selected',
        enum: ['x', 'y', 'z', 'face'],
      },
    },
  }),
  example: Object.freeze({ entry: 'crossSection', accept_plane: true }),
  uiEntry: 'data-contour-mode-chip',
  run(ctx, args) {
    const begin = ctx.sketchBegin;
    if (typeof begin !== 'function') {
      return { error: { code: 'internal', message: 'sketchBegin handler is missing' } };
    }
    const out = begin(args || {});
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? { ok: true } };
  },
});
