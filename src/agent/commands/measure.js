import { NO_ARGS_SCHEMA, FACE_KEY_SCHEMA, EDGE_KEY_SCHEMA } from '../schemas/common.js';

function hostCall(ctx, name, args) {
  const fn = ctx[name];
  if (typeof fn !== 'function') {
    return { error: { code: 'internal', message: `${name} handler is missing` } };
  }
  const out = fn(args);
  if (out?.error) return { error: out.error };
  return { result: out?.result ?? out };
}

export const measureOpenCommand = Object.freeze({
  name: 'measure_open',
  uiEntry: 'data-measure-toggle',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'measureOpen');
  },
});

export const measureCloseCommand = Object.freeze({
  name: 'measure_close',
  uiEntry: 'data-measure-mode-chip',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'measureClose');
  },
});

export const measureSetUnitCommand = Object.freeze({
  name: 'measure_set_unit',
  uiEntry: 'data-measure-unit-choice',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['unit'],
    properties: {
      unit: { type: 'string', enum: ['mm', 'in'] },
    },
  }),
  example: { unit: 'mm' },
  run(ctx, args) {
    return hostCall(ctx, 'measureSetUnit', args);
  },
});

export const measurePickCommand = Object.freeze({
  name: 'measure_pick',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      keys: { type: 'array', items: FACE_KEY_SCHEMA },
      face_keys: { type: 'array', items: FACE_KEY_SCHEMA },
      face_key: FACE_KEY_SCHEMA,
      edge_keys: { type: 'array', items: EDGE_KEY_SCHEMA },
      edge_key: EDGE_KEY_SCHEMA,
      point: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    },
  }),
  example: { face_keys: [{ at: [0, 0, 10], n: [0, 0, 1], area: 400 }] },
  checkArgs(args) {
    const hasFace = (Array.isArray(args?.keys) && args.keys.length)
      || (Array.isArray(args?.face_keys) && args.face_keys.length)
      || args?.face_key;
    const hasEdge = (Array.isArray(args?.edge_keys) && args.edge_keys.length) || args?.edge_key;
    const hasPoint = Array.isArray(args?.point) && args.point.length >= 3;
    if (!hasFace && !hasEdge && !hasPoint) {
      return { code: 'bad_args', message: 'measure_pick needs face_keys, edge_keys, or point' };
    }
    return null;
  },
  run(ctx, args) {
    return hostCall(ctx, 'measurePick', args);
  },
});

export const measureClearCommand = Object.freeze({
  name: 'measure_clear',
  uiEntry: 'data-measure-clear',
  schema: NO_ARGS_SCHEMA,
  example: {},
  run(ctx) {
    return hostCall(ctx, 'measureClear');
  },
});

export const measureStateCommand = Object.freeze({
  name: 'measure_state',
  uiEntry: 'data-measure-mode-chip',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'measureState');
  },
});
