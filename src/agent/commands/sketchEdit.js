/**
 * sketch_edit: one call edits a saved contour. It reopens the contour in the
 * sketch (the same path as open_feature on its chip), applies the ops in
 * order through the sketch handlers the UI uses, saves and closes the sketch
 * (the rail checkmark: the @contour statement is rewritten by id and every
 * feature that names it rebuilds, one undo step), and returns the entities
 * the contour now has. An op that cannot be applied closes the sketch
 * without saving and says which op and what to send instead. No sketch is
 * ever left open behind the agent.
 */
import { normalizeSketchTool, sketchParamsFromArgs } from '../sketchAgent.js';
import {
  closeOpenContourSketch,
  commitOpenContourSketch,
  CONTOUR_EDIT_HINT,
  CONTOUR_PROFILE_KEYS,
  openContourSketchSession,
  patchOpenContourSketch,
} from './contourSession.js';
import { runContourGestureMutate } from './contourGestureMutate.js';

const OP_KINDS = Object.freeze(['profile', 'add', 'constrain', 'dimension', 'delete', 'undo']);

const PICK_SCHEMA = Object.freeze({
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['point', 'line', 'arc', 'ref'] },
      id: { type: 'string' },
    },
  },
});

const OP_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['op'],
  properties: {
    op: {
      type: 'string',
      enum: OP_KINDS.slice(),
      description: 'profile: patch the profile (points, width/height/centered, radius/segments, polygon_preset, tool). add: the sketch_add fields (tool, width, height, radius, segments, points, polygon_preset, params). constrain: the sketch_constrain fields (kind, picks or a/b/line/point, side). dimension: the sketch_dimension fields (kind, value, picks or edge/line/arc/a/b, name). delete: id from list_sketch_entities. undo: one sketch step back.',
    },
    // profile / add
    tool: { type: 'string' },
    points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } },
    width: { type: 'number' },
    height: { type: 'number' },
    centered: { type: 'boolean' },
    centers: { type: 'boolean' },
    radius: { type: 'number' },
    segments: { type: 'number' },
    polygon_preset: { type: 'string' },
    polygonPreset: { type: 'string' },
    params: { type: 'object', additionalProperties: true },
    // constrain / dimension
    kind: { type: 'string' },
    picks: PICK_SCHEMA,
    targets: PICK_SCHEMA,
    a: { type: 'string' },
    b: { type: 'string' },
    line: { type: 'string' },
    point: { type: 'string' },
    arc: { type: 'string' },
    edge: { type: 'string' },
    side: { type: 'number' },
    sense: { type: 'number' },
    value: { type: 'number' },
    value_mm: { type: 'number' },
    name: { type: 'string' },
    constraint_id: { type: 'string' },
    dimension_id: { type: 'string' },
    // delete
    id: { type: 'string' },
  },
});

const SKETCH_EDIT_HINT = `sketch_edit takes contour_id (or id "contour:<id>") and ops: [{ op: "profile" | "add" | "constrain" | "dimension" | "delete" | "undo", … }]. ${CONTOUR_EDIT_HINT}`;

function contourChipId(args) {
  const raw = args?.contour_id != null ? String(args.contour_id).trim() : '';
  if (raw) return raw.startsWith('contour:') ? raw : `contour:${raw}`;
  // id is a feature_tree chip id as given (contour:<id>); another chip is
  // answered with not_a_contour rather than guessed at.
  return args?.id != null ? String(args.id).trim() : '';
}

function stripOp(op) {
  const { op: _kind, ...rest } = op;
  return rest;
}

function hostCall(ctx, name, args) {
  const fn = ctx[name];
  if (typeof fn !== 'function') {
    return { error: { code: 'internal', message: `${name} handler is missing` } };
  }
  const out = fn(args);
  if (out?.error) return { error: out.error };
  if (out && Object.prototype.hasOwnProperty.call(out, 'result')) return out;
  return { result: out };
}

/** Apply one op to the open sketch. Returns `{ result }` or `{ error }`. */
async function applyOp(ctx, sketch, op) {
  const kind = op.op;
  if (kind === 'profile') {
    const bag = stripOp(op);
    const unknown = Object.keys(bag).filter((k) => !CONTOUR_PROFILE_KEYS.includes(k));
    if (unknown.length) {
      return { error: { code: 'bad_args', message: `sketch_edit profile op does not take ${unknown.join(', ')}. ${CONTOUR_EDIT_HINT}` } };
    }
    return patchOpenContourSketch(ctx, sketch, bag, 'sketch_edit');
  }
  if (kind === 'add') {
    const tool = normalizeSketchTool(op.tool || sketch?.tool || 'rectangle');
    if (!tool) return { error: { code: 'bad_args', message: `sketch_edit add: unknown sketch tool ${String(op.tool)}` } };
    const params = sketchParamsFromArgs(tool, op);
    if (op.params && typeof op.params === 'object' && !Array.isArray(op.params)) Object.assign(params, op.params);
    const add = ctx.sketchAdd;
    if (typeof add !== 'function') return { error: { code: 'internal', message: 'sketchAdd handler is missing' } };
    const out = add({ tool, params });
    if (out?.error) return { error: out.error };
    return { result: { sketch: { tool, params }, ...(out?.result || {}) } };
  }
  if (kind === 'constrain') {
    const prepare = ctx.prepareSketchConstrain;
    if (typeof prepare !== 'function') return { error: { code: 'internal', message: 'prepareSketchConstrain handler is missing' } };
    return runContourGestureMutate(ctx, { label: 'Contour constraint', prepare: () => prepare(stripOp(op)) });
  }
  if (kind === 'dimension') {
    const prepare = ctx.prepareSketchDimension;
    if (typeof prepare !== 'function') return { error: { code: 'internal', message: 'prepareSketchDimension handler is missing' } };
    return runContourGestureMutate(ctx, { label: 'Contour dimension', prepare: () => prepare(stripOp(op)) });
  }
  if (kind === 'delete') {
    const id = op.id != null ? String(op.id) : '';
    if (!id) return { error: { code: 'bad_args', message: 'sketch_edit delete op needs id (from list_sketch_entities)' } };
    return hostCall(ctx, 'sketchDeleteEntity', { id });
  }
  if (kind === 'undo') {
    const undo = ctx.agentSketchUndo;
    if (typeof undo !== 'function') return { error: { code: 'internal', message: 'agentSketchUndo handler is missing' } };
    const out = undo();
    if (!out?.ok) return { error: { code: 'nothing_to_undo', message: 'Nothing to undo in the open sketch' } };
    return { result: out };
  }
  return { error: { code: 'bad_args', message: `sketch_edit: unknown op ${String(kind)}. ${SKETCH_EDIT_HINT}` } };
}

export function sketchEditOps(args) {
  const ops = [];
  if (args?.params && typeof args.params === 'object' && !Array.isArray(args.params)) {
    ops.push({ op: 'profile', ...args.params });
  }
  if (Array.isArray(args?.ops)) ops.push(...args.ops);
  return ops;
}

export const sketchEditCommand = Object.freeze({
  name: 'sketch_edit',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      contour_id: { type: 'string', description: 'Saved contour id (the @contour id, or its feature_tree chip id contour:<id>)' },
      id: { type: 'string', description: 'Alias for contour_id: the feature_tree chip id contour:<id>' },
      ops: {
        type: 'array',
        items: OP_SCHEMA,
        description: 'Applied in order to the reopened sketch, then saved in one commit.',
      },
      params: {
        type: 'object',
        additionalProperties: true,
        description: 'Shorthand for one leading profile op (the edit_feature contour params: points, width, height, radius, …).',
      },
    },
  }),
  example: {
    contour_id: 'c1',
    ops: [
      { op: 'profile', width: 44, height: 20 },
      { op: 'dimension', kind: 'length', edge: 'e0', value: 44 },
      { op: 'constrain', kind: 'horizontal', picks: [{ kind: 'line', id: 'e0' }] },
    ],
  },
  checkArgs(args) {
    if (!contourChipId(args)) {
      return { code: 'bad_args', message: `sketch_edit needs contour_id. ${SKETCH_EDIT_HINT}` };
    }
    const ops = sketchEditOps(args);
    if (!ops.length) {
      return { code: 'bad_args', message: `sketch_edit needs at least one op. ${SKETCH_EDIT_HINT}` };
    }
    for (let i = 0; i < ops.length; i += 1) {
      const op = ops[i];
      if (!op || typeof op !== 'object' || Array.isArray(op) || !OP_KINDS.includes(op.op)) {
        return { code: 'bad_args', message: `sketch_edit ops[${i}] needs op: ${OP_KINDS.join(' | ')}` };
      }
    }
    return null;
  },
  async run(ctx, args) {
    const chipId = contourChipId(args);
    const ops = sketchEditOps(args);
    if (openContourSketchSession(ctx)) {
      // A sketch another call left open would be edited by mistake.
      closeOpenContourSketch(ctx);
    }
    const opened = hostCall(ctx, 'openFeature', { id: chipId });
    if (opened.error) {
      const code = opened.error.code === 'unknown_feature' || opened.error.code === 'bad_index' ? 'unknown_contour' : opened.error.code;
      return { error: { ...opened.error, code, message: `${opened.error.message || 'Could not open the contour'} ${SKETCH_EDIT_HINT}` } };
    }
    if (opened.result?.sketchOpen !== true || !opened.result?.contourId) {
      // Not a contour: a card opened instead. Close it and say so.
      ctx.cancelFeature?.();
      return {
        error: {
          code: 'not_a_contour',
          message: `${chipId} is a ${opened.result?.kind || 'feature'} chip, not a saved contour; use open_feature / edit_feature / confirm_feature for it. ${SKETCH_EDIT_HINT}`,
        },
      };
    }
    const contourId = opened.result.contourId;
    const applied = [];
    for (let i = 0; i < ops.length; i += 1) {
      const sketch = openContourSketchSession(ctx) || { contourId, tool: null };
      let out;
      try {
        out = await applyOp(ctx, sketch, ops[i]);
      } catch (err) {
        out = { error: { code: 'edit_failed', message: err?.message || String(err) } };
      }
      if (out?.error) {
        closeOpenContourSketch(ctx);
        return {
          error: {
            ...out.error,
            // details survives the bridge envelope (code, message, details).
            details: { ...(out.error.details || {}), op: i, kind: ops[i].op },
            message: `sketch_edit ops[${i}] (${ops[i].op}): ${out.error.message || 'failed'} The contour sketch was closed without saving. ${SKETCH_EDIT_HINT}`,
          },
        };
      }
      applied.push({ op: ops[i].op, ...(out.result?.sketch ? { sketch: out.result.sketch } : {}), ...(out.result?.ignored ? { ignored: out.result.ignored } : {}) });
    }
    const listed = typeof ctx.listSketchEntities === 'function' ? ctx.listSketchEntities() : null;
    const entities = listed && !listed.error ? (listed.result ?? listed) : null;
    const sketch = openContourSketchSession(ctx) || { contourId };
    const committed = await commitOpenContourSketch(ctx, sketch);
    if (committed.error) return committed;
    return {
      result: {
        ...committed.result,
        contourId,
        applied,
        ...(entities ? { entities } : {}),
      },
    };
  },
});
