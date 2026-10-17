import { NO_ARGS_SCHEMA, FACE_KEY_SCHEMA, JOINT_TYPES } from '../schemas/common.js';
import { jointParamsFromArgs } from '../jointAgent.js';
import { runJointCommit } from './runJointCommit.js';

function hostCall(ctx, name, args) {
  const fn = ctx[name];
  if (typeof fn !== 'function') {
    return { error: { code: 'internal', message: `${name} handler is missing` } };
  }
  const out = fn(args);
  if (out?.error) return { error: out.error };
  return { result: out?.result ?? out };
}

/** `planar` is accepted in args and normalized to `coincident` in `jointParamsFromArgs`. */
const JOINT_TYPE_SCHEMA = Object.freeze({
  type: 'string',
  enum: [...JOINT_TYPES, 'planar'],
});

const JOINT_PARAM_PROPERTIES = Object.freeze({
  type: JOINT_TYPE_SCHEMA,
  name: { type: 'string' },
  value_mm: { type: 'number' },
  value: { type: 'number' },
  sense: { type: 'number' },
  opposed: { type: 'boolean' },
});

const JOINT_PICK_KINDS = Object.freeze(['face', 'axis', 'edge']);

const FACE_ID_SCHEMA = Object.freeze({
  type: 'string',
  pattern: '^f[0-9]+$',
  description: 'Face id from list_faces on that part (e.g. f7). Valid only until the next remesh; pass the key from the same list_faces row with the id.',
});

const JOINT_PICK_ROW_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['part_id'],
  properties: {
    part_id: { type: 'string' },
    face_id: FACE_ID_SCHEMA,
    key: FACE_KEY_SCHEMA,
    kind: {
      type: 'string',
      enum: JOINT_PICK_KINDS.slice(),
      description: 'Pick kind when key is explicit (concentric uses axis picks)',
    },
  },
});

function hasFaceId(row) {
  return row?.face_id != null && row.face_id !== '';
}

function jointPickRows(args) {
  if (Array.isArray(args?.picks)) return args.picks;
  if (!args?.part_id || (!args?.key && !hasFaceId(args))) return [];
  const row = { part_id: args.part_id };
  if (hasFaceId(args)) row.face_id = args.face_id;
  if (args.key) row.key = args.key;
  if (args.kind) row.kind = args.kind;
  return [row];
}

export const jointOpenCommand = Object.freeze({
  name: 'joint_open',
  uiEntry: 'data-joints-button',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'jointOpen');
  },
});

export const jointSetParamsCommand = Object.freeze({
  name: 'joint_set_params',
  uiEntry: 'data-joint-card',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: JOINT_PARAM_PROPERTIES,
  }),
  example: { type: 'coincident' },
  checkArgs(args) {
    const built = jointParamsFromArgs(args);
    return built.error ? built.error : null;
  },
  run(ctx, args) {
    const built = jointParamsFromArgs(args);
    if (built.error) return { error: built.error };
    return hostCall(ctx, 'jointSetParams', { patch: built.patch });
  },
});

export const jointPickCommand = Object.freeze({
  name: 'joint_pick',
  uiEntry: 'data-joint-card',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      part_id: { type: 'string' },
      face_id: FACE_ID_SCHEMA,
      key: FACE_KEY_SCHEMA,
      kind: { type: 'string', enum: JOINT_PICK_KINDS.slice() },
      picks: {
        type: 'array',
        items: JOINT_PICK_ROW_SCHEMA,
      },
    },
  }),
  example: {
    picks: [
      { part_id: 'local:base', face_id: 'f4', key: { at: [0, 0, 5], n: [0, 0, 1], area: 400 } },
      { part_id: 'local:pin', face_id: 'f2', key: { at: [0, 0, 0], n: [0, 0, 1], area: 50.27 } },
    ],
  },
  checkArgs(args) {
    const rows = jointPickRows(args);
    if (!rows.length) {
      return { code: 'bad_args', message: 'joint_pick needs part_id with face_id or key, or picks[]' };
    }
    for (const row of rows) {
      if (!row?.part_id || (!row?.key && !hasFaceId(row))) {
        return { code: 'bad_args', message: 'each joint pick needs part_id and face_id (or key)' };
      }
    }
    return null;
  },
  run(ctx, args) {
    return hostCall(ctx, 'jointApplyPicks', { picks: jointPickRows(args) });
  },
});

export const jointCommitCommand = Object.freeze({
  name: 'joint_commit',
  uiEntry: 'data-joint-card',
  schema: NO_ARGS_SCHEMA,
  example: {},
  async run(ctx) {
    return runJointCommit(ctx);
  },
});

export const jointCancelCommand = Object.freeze({
  name: 'joint_cancel',
  uiEntry: 'data-joint-card',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'jointCancel');
  },
});

export const jointSelectCommand = Object.freeze({
  name: 'joint_select',
  uiEntry: 'data-joint-chip',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['joint_id'],
    properties: {
      joint_id: { type: 'string', description: 'Joint id from the assembly strip' },
    },
  }),
  example: { joint_id: 'j1' },
  checkArgs(args) {
    if (args?.joint_id == null || args.joint_id === '') {
      return { code: 'bad_args', message: 'joint_select needs joint_id' };
    }
    return null;
  },
  run(ctx, args) {
    return hostCall(ctx, 'jointSelect', { joint_id: String(args.joint_id) });
  },
});

export const jointEditCommand = Object.freeze({
  name: 'joint_edit',
  uiEntry: 'data-joint-chip',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      joint_id: { type: 'string', description: 'Joint id to edit; omit to edit the open card target' },
      ...JOINT_PARAM_PROPERTIES,
    },
  }),
  example: { joint_id: 'j1', name: 'Pin fit' },
  checkArgs(args) {
    const built = jointParamsFromArgs(args);
    if (built.error) return built.error;
    return null;
  },
  run(ctx, args) {
    const built = jointParamsFromArgs(args);
    if (built.error) return { error: built.error };
    const jointId = args?.joint_id != null ? String(args.joint_id) : undefined;
    return hostCall(ctx, 'jointEdit', { joint_id: jointId, patch: built.patch });
  },
});
