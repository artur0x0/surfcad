import { NO_ARGS_SCHEMA } from '../registry.js';
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

const FACE_KEY_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  required: ['at', 'n', 'area'],
  properties: {
    at: { type: 'array', items: { type: 'number' } },
    n: { type: 'array', items: { type: 'number' } },
    area: { type: 'number' },
  },
};

const JOINT_PARAM_PROPERTIES = Object.freeze({
  type: { type: 'string' },
  name: { type: 'string' },
  value_mm: { type: 'number' },
  value: { type: 'number' },
  sense: { type: 'number' },
  opposed: { type: 'boolean' },
});

const JOINT_PICK_ROW_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: true,
  required: ['part_id', 'key'],
  properties: {
    part_id: { type: 'string' },
    key: FACE_KEY_SCHEMA,
    kind: { type: 'string', description: 'face | axis | edge when key is explicit' },
  },
});

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
    additionalProperties: true,
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
    additionalProperties: true,
    properties: {
      part_id: { type: 'string' },
      key: FACE_KEY_SCHEMA,
      kind: { type: 'string' },
      picks: {
        type: 'array',
        items: JOINT_PICK_ROW_SCHEMA,
      },
    },
  }),
  example: {
    picks: [
      { part_id: 'local:base', key: { at: [0, 0, 10], n: [0, 0, 1], area: 2000 } },
      { part_id: 'local:pin', key: { at: [0, 0, 10], n: [0, 0, -1], area: 200 } },
    ],
  },
  checkArgs(args) {
    const rows = Array.isArray(args?.picks)
      ? args.picks
      : (args?.part_id && args?.key ? [{ part_id: args.part_id, key: args.key }] : []);
    if (!rows.length) {
      return { code: 'bad_args', message: 'joint_pick needs part_id+key or picks[]' };
    }
    for (const row of rows) {
      if (!row?.part_id || !row?.key) {
        return { code: 'bad_args', message: 'each joint pick needs part_id and key' };
      }
    }
    return null;
  },
  run(ctx, args) {
    const rows = Array.isArray(args?.picks)
      ? args.picks
      : [{ part_id: args.part_id, key: args.key }];
    return hostCall(ctx, 'jointApplyPicks', { picks: rows });
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
    additionalProperties: true,
    required: ['joint_id'],
    properties: {
      joint_id: { type: 'string' },
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
    additionalProperties: true,
    properties: {
      joint_id: { type: 'string' },
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
