import { NO_ARGS_SCHEMA, FACE_KEY_SCHEMA } from '../schemas/common.js';
import { rejectPartId } from '../state/identity.js';

function hostCall(ctx, name, args) {
  const fn = ctx[name];
  if (typeof fn !== 'function') {
    return { error: { code: 'internal', message: `${name} handler is missing` } };
  }
  const out = fn(args);
  if (out?.error) return { error: out.error };
  return { result: out?.result ?? out };
}

/** Same as hostCall for a handler that may wait (paint_open). */
async function hostCallAsync(ctx, name, args) {
  const fn = ctx[name];
  if (typeof fn !== 'function') {
    return { error: { code: 'internal', message: `${name} handler is missing` } };
  }
  const out = await fn(args);
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
    return hostCallAsync(ctx, 'paintOpen');
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

/**
 * One-call paint (MCP improvements #5): open → set colour → paint the part or
 * the given faces → confirm, through the same host handlers the step tools
 * use, so a whole part is one round trip instead of four. On a failure after
 * paint mode opened, the session is cancelled so no mode is left open.
 */
export const paintCommand = Object.freeze({
  name: 'paint',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['color'],
    properties: {
      color: { type: 'string', description: '#RRGGBB' },
      keys: {
        type: 'array',
        items: FACE_KEY_SCHEMA,
        description: 'Face keys from list_faces to paint; omit to paint the whole part',
      },
      part_id: {
        type: 'string',
        description: 'Part to paint (an opaque surf id from parts). Omit for the active part; another id is made active first, as set_active_part does.',
      },
    },
  }),
  example: { color: '#3b82f6' },
  checkArgs(args) {
    if (typeof args?.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(args.color.trim())) {
      return { code: 'bad_args', message: 'paint needs color as #RRGGBB' };
    }
    if (args.keys != null && (!Array.isArray(args.keys) || !args.keys.length)) {
      return { code: 'bad_args', message: 'paint keys must be a non-empty list of face keys; omit it to paint the whole part' };
    }
    if (args.part_id != null) return rejectPartId(args.part_id);
    return null;
  },
  async run(ctx, args) {
    const color = args.color.trim();
    if (args.part_id != null) {
      const active = ctx.readStatus?.()?.partId;
      if (String(active) !== String(args.part_id)) {
        if (typeof ctx.setActivePart !== 'function') {
          return { error: { code: 'internal', message: 'setActivePart handler is missing' } };
        }
        const switched = ctx.setActivePart(args.part_id);
        if (switched?.error) return { error: switched.error };
      }
    }
    const opened = await hostCallAsync(ctx, 'paintOpen');
    if (opened.error) return opened;
    const steps = args.keys
      ? [['paintSetColor', { color }], ['paintFaces', { keys: args.keys }], ['paintConfirm', undefined]]
      : [['paintSetColor', { color }], ['paintPart', undefined], ['paintConfirm', undefined]];
    for (const [name, stepArgs] of steps) {
      const out = hostCall(ctx, name, stepArgs);
      if (out.error) {
        // Leave no paint session behind the error.
        try { ctx.paintCancel?.(); } catch { /* already closed */ }
        return {
          error: {
            ...out.error,
            hint: out.error.hint || `paint failed at ${name}; the paint session was cancelled. The step tools (paint_open, paint_set_color, paint_faces / paint_part, paint_confirm) run the same sequence one call at a time.`,
          },
        };
      }
    }
    return {
      result: {
        ok: true,
        color,
        painted: args.keys ? 'faces' : 'part',
        count: args.keys ? args.keys.length : 1,
        ...(args.part_id != null ? { partId: args.part_id } : {}),
      },
    };
  },
});
