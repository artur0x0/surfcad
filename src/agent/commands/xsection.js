import { NO_ARGS_SCHEMA } from '../schemas/common.js';

function hostCall(ctx, name, args) {
  const fn = ctx[name];
  if (typeof fn !== 'function') {
    return { error: { code: 'internal', message: `${name} handler is missing` } };
  }
  const out = fn(args);
  if (out?.error) return { error: out.error };
  if (out && typeof out.then === 'function') {
    return out.then((resolved) => {
      if (resolved?.error) return { error: resolved.error };
      return { result: resolved?.result ?? resolved };
    });
  }
  return { result: out?.result ?? out };
}

export const crossSectionToggleCommand = Object.freeze({
  name: 'cross_section_toggle',
  uiEntry: 'data-cross-section-toggle',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean', description: 'Turn cross-section on or off; omit to flip' },
    },
  }),
  example: { enabled: true },
  run(ctx, args) {
    return hostCall(ctx, 'crossSectionToggle', args);
  },
});

export const crossSectionExpandCommand = Object.freeze({
  name: 'cross_section_expand',
  uiEntry: 'data-cross-section-expand',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['open'],
    properties: {
      open: { type: 'boolean', description: 'Open or close the cross-section options popup' },
    },
  }),
  example: { open: true },
  run(ctx, args) {
    return hostCall(ctx, 'crossSectionExpand', args);
  },
});

export const crossSectionPlaneCommand = Object.freeze({
  name: 'cross_section_plane',
  uiEntry: 'data-cross-section-plane',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['plane'],
    properties: {
      plane: { type: 'string', enum: ['XY', 'XZ', 'YZ'], description: 'Preset cutting plane' },
    },
  }),
  example: { plane: 'XY' },
  run(ctx, args) {
    return hostCall(ctx, 'crossSectionPlane', args);
  },
});

export const crossSectionOffsetCommand = Object.freeze({
  name: 'cross_section_offset',
  uiEntry: 'data-section-offset',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['offset'],
    properties: {
      offset: { type: 'number', description: 'Section position along the plane normal (model units)' },
    },
  }),
  example: { offset: 0 },
  run(ctx, args) {
    return hostCall(ctx, 'crossSectionOffset', args);
  },
});

export const crossSectionStateCommand = Object.freeze({
  name: 'cross_section_state',
  uiEntry: 'data-cross-section-toggle',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'crossSectionState');
  },
});
