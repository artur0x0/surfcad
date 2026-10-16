import { NO_ARGS_SCHEMA, FACE_KEY_SCHEMA } from '../schemas/common.js';

function hostCall(ctx, name, args) {
  const fn = ctx[name];
  if (typeof fn !== 'function') {
    return { error: { code: 'internal', message: `${name} handler is missing` } };
  }
  const out = fn(args);
  if (out?.error) return { error: out.error };
  return { result: out?.result ?? out };
}

export const paintOpenCommand = Object.freeze({
  name: 'paint_open',
  uiEntry: 'data-paint-chip',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'paintOpen');
  },
});

export const paintCloseCommand = Object.freeze({
  name: 'paint_close',
  uiEntry: 'data-paint-chip',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'paintClose');
  },
});

export const paintSetColorCommand = Object.freeze({
  name: 'paint_set_color',
  uiEntry: 'data-paint-swatch',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      color: { type: 'string', description: '#RRGGBB' },
      hex: { type: 'string', description: 'Alias for color' },
    },
  }),
  example: { color: '#3b82f6' },
  checkArgs(args) {
    if (!args?.color && !args?.hex) {
      return { code: 'bad_args', message: 'paint_set_color needs color' };
    }
    return null;
  },
  run(ctx, args) {
    return hostCall(ctx, 'paintSetColor', args);
  },
});

export const paintFacesCommand = Object.freeze({
  name: 'paint_faces',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      keys: { type: 'array', items: FACE_KEY_SCHEMA },
    },
  }),
  example: { keys: [{ at: [0, 0, 10], n: [0, 0, 1], area: 400 }] },
  checkArgs(args) {
    if (!Array.isArray(args?.keys) || !args.keys.length) {
      return { code: 'bad_args', message: 'paint_faces needs keys' };
    }
    return null;
  },
  run(ctx, args) {
    return hostCall(ctx, 'paintFaces', args);
  },
});

export const paintPartCommand = Object.freeze({
  name: 'paint_part',
  uiEntry: 'data-paint-part',
  schema: NO_ARGS_SCHEMA,
  example: {},
  run(ctx) {
    return hostCall(ctx, 'paintPart');
  },
});

export const paintUndoCommand = Object.freeze({
  name: 'paint_undo',
  uiEntry: 'data-paint-undo',
  schema: NO_ARGS_SCHEMA,
  example: {},
  run(ctx) {
    return hostCall(ctx, 'paintUndo');
  },
});

export const paintClearCommand = Object.freeze({
  name: 'paint_clear',
  uiEntry: 'data-paint-clear',
  schema: NO_ARGS_SCHEMA,
  example: {},
  run(ctx) {
    return hostCall(ctx, 'paintClear');
  },
});

export const paintConfirmCommand = Object.freeze({
  name: 'paint_confirm',
  uiEntry: 'data-paint-mode-chip',
  schema: NO_ARGS_SCHEMA,
  example: {},
  run(ctx) {
    return hostCall(ctx, 'paintConfirm');
  },
});

export const paintCancelCommand = Object.freeze({
  name: 'paint_cancel',
  uiEntry: 'data-paint-mode-chip',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'paintCancel');
  },
});

export const paintStateCommand = Object.freeze({
  name: 'paint_state',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'paintState');
  },
});
