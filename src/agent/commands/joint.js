import { NO_ARGS_SCHEMA, FACE_KEY_SCHEMA, JOINT_TYPES } from '../schemas/common.js';
import { jointParamsFromArgs, normalizeJointType } from '../jointAgent.js';
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

const JOINT_PICK_KINDS = Object.freeze(['face', 'axis', 'edge', 'part']);

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
      description: 'Pick kind when key is explicit (concentric uses axis picks). part picks the whole part, for a fixed joint; it needs no face_id or key.',
    },
  },
});

function hasFaceId(row) {
  return row?.face_id != null && row.face_id !== '';
}

function jointPickRows(args) {
  if (Array.isArray(args?.picks)) return args.picks;
  // part_id alone picks the whole part (a fixed joint target).
  if (!args?.part_id) return [];
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
      return { code: 'bad_args', message: 'joint_pick needs part_id (alone for a whole-part pick, or with face_id or key), or picks[]' };
    }
    for (const row of rows) {
      if (!row?.part_id) {
        return { code: 'bad_args', message: 'each joint pick needs part_id, with face_id or key unless it picks the whole part' };
      }
      if (row.kind === 'part' && (row.key || hasFaceId(row))) {
        return { code: 'bad_args', message: 'a part pick takes no face_id or key' };
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
      joint_id: { type: 'string', description: 'Joint id from the assembly strip; opens that joint for editing (no joint_select needed). Omit to patch the joint already open.' },
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

const JOINT_CREATE_HINT = 'joint_create takes type (coincident, parallel, perpendicular, distance, angle, concentric, symmetric, fixed; planar is coincident) and picks: [{ part_id, face_id?, key?, kind? }] from list_faces (a face_id with its key; a cylindrical face is an axis pick; { part_id } alone is a whole-part pick for fixed), plus name, value_mm, sense and opposed as on joint_set_params.';

function closeJointCard(ctx) {
  try { ctx.jointCancel?.(); } catch { /* nothing to close */ }
}

function partIdsOf(picks) {
  const ids = [];
  for (const row of picks) if (row?.part_id && !ids.includes(row.part_id)) ids.push(row.part_id);
  return ids;
}

/**
 * joint_create: open → pick → set params → commit in one call, so an agent
 * places a part with a joint instead of hand-computed part_set_transform
 * numbers. Any failure closes the joint card so nothing is left open.
 */
export const jointCreateCommand = Object.freeze({
  name: 'joint_create',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['type', 'picks'],
    properties: {
      ...JOINT_PARAM_PROPERTIES,
      picks: {
        type: 'array',
        minItems: 1,
        items: JOINT_PICK_ROW_SCHEMA,
        description: 'One row per reference: fixed takes one (a whole part, a face or an edge), every other type takes two, one per part.',
      },
    },
  }),
  example: {
    type: 'coincident',
    picks: [
      { part_id: 'local:base', face_id: 'f4', key: { at: [0, 0, 5], n: [0, 0, 1], area: 400 } },
      { part_id: 'local:pin', face_id: 'f2', key: { at: [0, 0, 0], n: [0, 0, 1], area: 50.27 } },
    ],
  },
  checkArgs(args) {
    if (args?.type == null) return { code: 'bad_args', message: `joint_create needs type. ${JOINT_CREATE_HINT}` };
    const built = jointParamsFromArgs(args);
    if (built.error) return built.error;
    const rows = Array.isArray(args?.picks) ? args.picks : [];
    if (!rows.length) return { code: 'bad_args', message: `joint_create needs picks. ${JOINT_CREATE_HINT}` };
    for (const row of rows) {
      if (!row?.part_id) return { code: 'bad_args', message: 'each joint_create pick needs part_id, with face_id or key unless it picks the whole part' };
      if (row.kind === 'part' && (row.key || hasFaceId(row))) return { code: 'bad_args', message: 'a part pick takes no face_id or key' };
    }
    const type = normalizeJointType(args.type);
    if (type === 'fixed' && rows.length !== 1) {
      return { code: 'bad_args', message: 'fixed takes exactly one pick: a whole part, a face or an edge' };
    }
    if (type !== 'fixed' && rows.length !== 2) {
      return { code: 'bad_args', message: `${type} takes exactly two picks, one per part` };
    }
    return null;
  },
  async run(ctx, args) {
    const built = jointParamsFromArgs(args);
    if (built.error) return { error: built.error };
    const picks = args.picks;
    const opened = hostCall(ctx, 'jointOpen');
    if (opened.error) return opened;
    if (opened.result?.open !== true) {
      return { error: { code: 'joints_unavailable', message: 'The joint card could not open (another card or session is open); close it and call joint_create again' } };
    }
    const picked = hostCall(ctx, 'jointApplyPicks', { picks });
    if (picked.error) {
      closeJointCard(ctx);
      return { error: { ...picked.error, message: `${picked.error.message || 'Joint pick failed'} ${JOINT_CREATE_HINT}` } };
    }
    const params = hostCall(ctx, 'jointSetParams', { patch: built.patch });
    if (params.error) {
      closeJointCard(ctx);
      return params;
    }
    const committed = await runJointCommit(ctx);
    if (committed.error) {
      closeJointCard(ctx);
      const refused = committed.error.code === 'commit_failed';
      const candidates = committed.error.details?.candidates;
      return {
        error: {
          ...committed.error,
          code: refused ? 'joint_unsolvable' : committed.error.code,
          // details survives the bridge envelope (code, message, details).
          ...(refused ? {
            details: {
              reason: committed.error.message,
              ...(Array.isArray(candidates) && candidates.length ? { candidates } : {}),
            },
          } : {}),
          message: refused
            ? `The ${params.result?.type || built.patch.type} joint could not be solved from those picks: ${committed.error.message}. Nothing was written. ${JOINT_CREATE_HINT}`
            : committed.error.message,
        },
      };
    }
    const placements = [];
    for (const partId of partIdsOf(picks)) {
      const fn = ctx.agentGetPartTransform;
      if (typeof fn !== 'function') break;
      let out = fn({ partId });
      if (out && typeof out.then === 'function') out = await out;
      const row = out?.result ?? out;
      if (!out?.error && row) {
        placements.push({ part_id: partId, position: row.position ?? null, rotation: row.rotation ?? null });
      }
    }
    return {
      result: {
        ok: true,
        jointId: committed.result?.jointId ?? null,
        jointCount: committed.result?.jointCount ?? null,
        unchanged: committed.result?.unchanged === true,
        type: params.result?.type ?? built.patch.type ?? null,
        name: params.result?.name ?? null,
        valueMm: params.result?.valueMm ?? null,
        sense: params.result?.sense ?? 1,
        opposed: params.result?.opposed !== false,
        pickCount: picked.result?.count ?? picks.length,
        placements,
        usedSelection: false,
        // Joints the solve left failing that were not failing before this call.
        ...(committed.result?.warning ? { warning: committed.result.warning } : {}),
      },
    };
  },
});

/**
 * list_joints: every assembly joint with its solve state. The strip has
 * shown red chips for a broken or conflicting joint since joints landed;
 * this is the same list for an agent, with the reason the chip tooltip
 * shows. Immediate read.
 */
export const listJointsCommand = Object.freeze({
  name: 'list_joints',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const read = ctx.readJointHealth;
    const health = typeof read === 'function' ? read() : null;
    const joints = Array.isArray(health?.joints) ? health.joints : [];
    const ids = Array.isArray(health?.failed?.ids) ? health.failed.ids.map(String) : [];
    return {
      result: {
        joints,
        total: joints.length,
        failed: { count: ids.length, ids },
      },
    };
  },
});

export const jointDeleteCommand = Object.freeze({
  name: 'joint_delete',
  uiEntry: 'data-joint-card',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['joint_id'],
    properties: {
      joint_id: { type: 'string', description: 'Joint id from a joint_create or joint_commit result' },
    },
  }),
  example: { joint_id: 'j1' },
  checkArgs(args) {
    if (args?.joint_id == null || args.joint_id === '') {
      return { code: 'bad_args', message: 'joint_delete needs joint_id' };
    }
    return null;
  },
  run(ctx, args) {
    return hostCall(ctx, 'jointDelete', { joint_id: String(args.joint_id) });
  },
});
