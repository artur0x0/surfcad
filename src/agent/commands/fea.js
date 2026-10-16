import { NO_ARGS_SCHEMA, FACE_KEY_SCHEMA } from '../schemas/common.js';

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

const FACE_PICK_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    part_id: { type: 'string', description: 'Part id when the study scope includes multiple parts' },
    face_id: { type: 'integer', minimum: 0, description: 'Manifold face id on the mesh' },
    keys: { type: 'array', items: FACE_KEY_SCHEMA },
    face_keys: { type: 'array', items: FACE_KEY_SCHEMA },
    key: FACE_KEY_SCHEMA,
  },
});

const SI_NOTE = 'SI units: force in newtons (N), pressure in megapascals (MPa), regardless of the UI display-unit toggle.';

export const feaOpenCommand = Object.freeze({
  name: 'fea_open',
  uiEntry: 'data-analyze-chip',
  schema: NO_ARGS_SCHEMA,
  example: {},
  async run(ctx) {
    return hostCall(ctx, 'feaOpen');
  },
});

export const feaCloseCommand = Object.freeze({
  name: 'fea_close',
  uiEntry: 'data-analyze-chip',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'feaClose');
  },
});

export const feaSetMaterialCommand = Object.freeze({
  name: 'fea_set_material',
  uiEntry: 'data-fea-material',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'Material catalog id (e.g. al-6061-t6, pla)' },
    },
  }),
  example: { id: 'pla' },
  run(ctx, args) {
    return hostCall(ctx, 'feaSetMaterial', args);
  },
});

export const feaSetTargetCommand = Object.freeze({
  name: 'fea_set_target',
  uiEntry: 'data-fea-target',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['target'],
    properties: {
      target: { type: 'string', enum: ['fixture', 'force', 'pressure'] },
    },
  }),
  example: { target: 'fixture' },
  run(ctx, args) {
    return hostCall(ctx, 'feaSetTarget', args);
  },
});

export const feaSetFixtureCommand = Object.freeze({
  name: 'fea_set_fixture',
  description: `Apply a fixed support on a face. ${SI_NOTE}`,
  schema: FACE_PICK_SCHEMA,
  example: { keys: [{ at: [0, 0, -5], n: [0, 0, -1], area: 400 }] },
  checkArgs(args) {
    const has = args?.face_id != null
      || (Array.isArray(args?.keys) && args.keys.length)
      || (Array.isArray(args?.face_keys) && args.face_keys.length)
      || args?.key;
    if (!has) return { code: 'bad_args', message: 'fea_set_fixture needs face_id or keys' };
    return null;
  },
  run(ctx, args) {
    return hostCall(ctx, 'feaSetFixture', args);
  },
});

export const feaFixCommand = Object.freeze({
  name: 'fea_fix',
  description: 'Alias for fea_set_fixture.',
  schema: FACE_PICK_SCHEMA,
  example: { face_id: 0 },
  run(ctx, args) {
    return hostCall(ctx, 'feaSetFixture', args);
  },
});

export const feaSetForceCommand = Object.freeze({
  name: 'fea_set_force',
  description: `Set force magnitude/direction (commits to the study) and optionally pick a face. ${SI_NOTE}`,
  uiEntry: 'data-fea-target',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      ...FACE_PICK_SCHEMA.properties,
      magnitude: { type: 'number', description: 'Force magnitude in newtons (N)' },
      magnitudeN: { type: 'number', description: 'Alias for magnitude (N)' },
      direction: {
        oneOf: [
          { type: 'string', enum: ['normal', '-normal', '+x', '-x', '+y', '-y', '+z', '-z', 'custom'] },
          { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        ],
      },
    },
  }),
  example: { magnitudeN: 200, direction: '+y', keys: [{ at: [0, 0, 5], n: [0, 0, 1], area: 400 }] },
  run(ctx, args) {
    return hostCall(ctx, 'feaSetForce', args);
  },
});

export const feaSetPressureCommand = Object.freeze({
  name: 'fea_set_pressure',
  description: `Set pressure (commits to the study) and optionally pick a face. ${SI_NOTE}`,
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      ...FACE_PICK_SCHEMA.properties,
      pressure: { type: 'number', description: 'Pressure in MPa' },
      pressureMPa: { type: 'number', description: 'Alias for pressure (MPa)' },
    },
  }),
  example: { pressureMPa: 0.5, keys: [{ at: [0, 0, 5], n: [0, 0, 1], area: 400 }] },
  run(ctx, args) {
    return hostCall(ctx, 'feaSetPressureLoad', args);
  },
});

export const feaRemoveFixtureCommand = Object.freeze({
  name: 'fea_remove_fixture',
  uiEntry: 'data-fea-remove',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['index'],
    properties: {
      index: { type: 'integer', minimum: 0 },
    },
  }),
  example: { index: 0 },
  run(ctx, args) {
    return hostCall(ctx, 'feaRemoveFixture', args);
  },
});

export const feaRemoveLoadCommand = Object.freeze({
  name: 'fea_remove_load',
  uiEntry: 'data-fea-remove',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['index'],
    properties: {
      index: { type: 'integer', minimum: 0 },
    },
  }),
  example: { index: 0 },
  run(ctx, args) {
    return hostCall(ctx, 'feaRemoveLoad', args);
  },
});

export const feaRunCommand = Object.freeze({
  name: 'fea_run',
  uiEntry: 'data-fea-run',
  description: 'Run the study; resolves when the solver finishes or errors.',
  schema: NO_ARGS_SCHEMA,
  example: {},
  async run(ctx) {
    return hostCall(ctx, 'feaRun');
  },
});

export const feaCancelCommand = Object.freeze({
  name: 'fea_cancel',
  uiEntry: 'data-fea-cancel',
  schema: NO_ARGS_SCHEMA,
  example: {},
  run(ctx) {
    return hostCall(ctx, 'feaCancel');
  },
});

export const feaBackToSetupCommand = Object.freeze({
  name: 'fea_back_to_setup',
  uiEntry: 'data-fea-back',
  schema: NO_ARGS_SCHEMA,
  example: {},
  run(ctx) {
    return hostCall(ctx, 'feaBackToSetup');
  },
});

export const feaStateCommand = Object.freeze({
  name: 'fea_state',
  uiEntry: 'data-fea-sheet',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      include: {
        type: 'array',
        items: { type: 'string', enum: ['summary', 'results', 'probes'] },
      },
    },
  }),
  example: { include: ['summary'] },
  immediate: true,
  run(ctx, args) {
    return hostCall(ctx, 'feaState', args);
  },
});

export const feaResultsCommand = Object.freeze({
  name: 'fea_results',
  uiEntry: 'data-fea-summary',
  description: 'Read compact von Mises / displacement / safety / modal / contact summary (no mesh arrays).',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      include: {
        type: 'array',
        items: { type: 'string', enum: ['probes'] },
      },
    },
  }),
  example: {},
  immediate: true,
  run(ctx, args) {
    return hostCall(ctx, 'feaResults', args);
  },
});

export const feaPickCommand = Object.freeze({
  name: 'fea_pick',
  description: 'Apply the current target (fixture/force/pressure) on a face by part_id + face_id or keys.',
  schema: FACE_PICK_SCHEMA,
  example: { face_id: 2 },
  checkArgs(args) {
    const has = args?.face_id != null
      || (Array.isArray(args?.keys) && args.keys.length)
      || (Array.isArray(args?.face_keys) && args.face_keys.length)
      || args?.key;
    if (!has) return { code: 'bad_args', message: 'fea_pick needs face_id or keys' };
    return null;
  },
  run(ctx, args) {
    return hostCall(ctx, 'feaPick', args);
  },
});
