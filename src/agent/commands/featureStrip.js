import { NO_ARGS_SCHEMA } from '../registry.js';
import { trackFeatureUsed } from '../../utils/analytics.js';
import { normalizeSketchTool } from '../sketchAgent.js';
import { runContourCommitMutate } from './contourCommitMutate.js';

const TARGET_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'Feature id from feature_tree' },
    index: { type: 'number', description: 'Feature index from feature_tree' },
  },
});

/**
 * The agent's open feature session when it is a saved contour that
 * open_feature reopened in the contour sketch: `{ contourId, sketchOpen }`.
 * Null for every other session (sheet, viewport card, hole card) and when
 * the sketch has since been closed.
 */
function openContourSketchSession(ctx) {
  const read = ctx.readFeatureSession;
  if (typeof read !== 'function') return null;
  const session = read();
  if (!session?.contourId || session.sketchOpen !== true) return null;
  return session;
}

/** Profile keys edit_feature forwards to the open contour sketch. */
const CONTOUR_PROFILE_KEYS = Object.freeze([
  'tool', 'points', 'radius', 'segments', 'width', 'height', 'centered', 'centers',
  'polygon_preset', 'polygonPreset', 'params',
]);

const CONTOUR_EDIT_HINT = 'A saved contour takes profile params: points [[u, v], …] (polyline), radius and segments (circle), width, height and centered (rectangle), polygon_preset and radius (polygon), or tool to switch. Extrude, revolve, loft and sweep values belong to the feature that uses the contour.';

/**
 * Map an edit_feature params bag onto the contour sketch the session opened:
 * the tool is explicit, or inferred from the keys, else the current one. Only
 * the keys given are patched, so the saved values stay for the rest. Points
 * replace a solved sketch (its dimensions and constraints no longer describe
 * the new geometry), so `contour: null` drops that spec.
 */
export function contourSketchPatch(bag, currentTool) {
  const src = bag && typeof bag === 'object' && !Array.isArray(bag) ? bag : {};
  const ignored = Object.keys(src).filter((key) => !CONTOUR_PROFILE_KEYS.includes(key));
  let tool = src.tool != null ? normalizeSketchTool(src.tool) : null;
  if (src.tool != null && !tool) {
    return { error: { code: 'bad_args', message: `edit_feature: unknown sketch tool ${String(src.tool)}. ${CONTOUR_EDIT_HINT}` } };
  }
  if (!tool) {
    if (Array.isArray(src.points)) tool = 'polyline';
    else if (src.width != null || src.height != null || src.centered != null || src.centers != null) tool = 'rectangle';
    else if (src.polygon_preset != null || src.polygonPreset != null) tool = 'polygon';
    else if (src.radius != null || src.segments != null) tool = currentTool === 'polygon' ? 'polygon' : 'circle';
    else tool = normalizeSketchTool(currentTool || 'circle') || 'circle';
  }
  const params = {};
  if (tool === 'rectangle') {
    if (src.width != null) params.width = Number(src.width);
    if (src.height != null) params.height = Number(src.height);
    if (src.centered != null) params.centered = !!src.centered;
    if (src.centers != null) params.centers = !!src.centers;
  } else if (tool === 'circle') {
    if (src.radius != null) params.radius = Number(src.radius);
    if (src.segments != null) params.segments = Math.round(Number(src.segments));
  } else if (tool === 'polygon') {
    if (src.polygon_preset != null) params.polygonPreset = String(src.polygon_preset);
    if (src.polygonPreset != null) params.polygonPreset = String(src.polygonPreset);
    if (src.radius != null) params.radius = Number(src.radius);
  } else if (tool === 'polyline' || tool === 'cursor') {
    if (Array.isArray(src.points)) {
      const points = src.points.map((row) => [Number(row?.[0]), Number(row?.[1])]);
      if (points.length < 3 || points.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
        return { error: { code: 'bad_args', message: `edit_feature: points needs at least three [u, v] number pairs. ${CONTOUR_EDIT_HINT}` } };
      }
      params.points = points;
      params.contour = null;
    }
  }
  const extra = src.params;
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(params, extra);
  for (const key of Object.keys(params)) {
    if (key !== 'contour' && key !== 'points' && key !== 'polygonPreset' && typeof params[key] === 'number' && !Number.isFinite(params[key])) {
      return { error: { code: 'bad_args', message: `edit_feature: ${key} must be a number. ${CONTOUR_EDIT_HINT}` } };
    }
  }
  if (!Object.keys(params).length && tool === (normalizeSketchTool(currentTool || '') || tool)) {
    return { error: { code: 'bad_args', message: `edit_feature: nothing to change on the contour. ${CONTOUR_EDIT_HINT}` } };
  }
  return { tool, params, ignored };
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

export const openFeatureCommand = Object.freeze({
  name: 'open_feature',
  uiEntry: Object.freeze(['data-feature-chip', 'data-feature-sheet-pick']),
  schema: TARGET_SCHEMA,
  example: { index: 0 },
  checkArgs(args) {
    if (args?.id == null && args?.index == null) {
      return { code: 'bad_args', message: 'open_feature needs id or index' };
    }
    return null;
  },
  run(ctx, args) {
    return hostCall(ctx, 'openFeature', args);
  },
});

export const activateFeatureCommand = Object.freeze({
  name: 'activate_feature',
  uiEntry: 'data-sketch-chip',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      ...TARGET_SCHEMA.properties,
      clear: { type: 'boolean', description: 'Clear the active chip highlight' },
    },
  }),
  example: { id: 'cube1' },
  run(ctx, args) {
    return hostCall(ctx, 'activateFeature', args);
  },
});

export const editFeatureCommand = Object.freeze({
  name: 'edit_feature',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      params: {
        type: 'object',
        // The host merges every key into the open edit (App editFeature,
        // Viewport agentPatchFeatureEdit, agentPatchHoleCard); which keys are
        // read depends on the feature kind (featureEdit.js rewriteBlock).
        additionalProperties: true,
        description: 'Feature sheet / edit-card fields to merge before confirm. Keys depend on the feature kind (e.g. height, radius, distance). For a move: dx, dy, dz, and at. For a saved contour (a contour:<id> chip): points [[u, v], …], radius, segments, width, height, centered, polygon_preset, or tool; they patch the reopened sketch, and confirm_feature saves and closes it.',
        properties: {
          points: {
            type: 'array',
            items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
            description: 'Contour only: new polyline points in the sketch plane UV, mm; replaces the profile',
          },
          tool: { type: 'string', description: 'Contour only: circle | rectangle | polygon | polyline; inferred from the other keys when omitted' },
          at: {
            type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
            description: 'Move only: new body centroid [x, y, z] mm from list_bodies; re-points the move',
          },
          dx: { type: 'number', description: 'Move only: offset x mm' },
          dy: { type: 'number', description: 'Move only: offset y mm' },
          dz: { type: 'number', description: 'Move only: offset z mm' },
        },
      },
    },
  }),
  example: { params: { height: 12 } },
  checkArgs(args) {
    if (args?.params != null && (typeof args.params !== 'object' || Array.isArray(args.params))) {
      return { code: 'bad_args', message: 'edit_feature params must be an object' };
    }
    return null;
  },
  run(ctx, args) {
    const sketch = openContourSketchSession(ctx);
    if (sketch) {
      // A saved contour has no edit card: open_feature reopened it in the
      // contour sketch. Patch that sketch; confirm_feature saves and closes it.
      const patch = contourSketchPatch(args?.params, sketch.tool);
      if (patch.error) return { error: patch.error };
      const add = ctx.sketchAdd;
      if (typeof add !== 'function') {
        return { error: { code: 'internal', message: 'sketchAdd handler is missing' } };
      }
      const out = add({ tool: patch.tool, params: patch.params });
      if (out?.error) return { error: out.error };
      const echo = hostCall(ctx, 'editFeature', args);
      if (echo?.error) return echo;
      return {
        result: {
          ...(echo.result || {}),
          contourId: sketch.contourId,
          sketch: { tool: patch.tool, params: patch.params },
          ...(patch.ignored.length ? { ignored: patch.ignored, hint: CONTOUR_EDIT_HINT } : {}),
        },
      };
    }
    return hostCall(ctx, 'editFeature', args);
  },
});

export const confirmFeatureCommand = Object.freeze({
  name: 'confirm_feature',
  uiEntry: 'data-feature-sheet-accept',
  schema: NO_ARGS_SCHEMA,
  example: {},
  async run(ctx) {
    const sketch = openContourSketchSession(ctx);
    if (sketch) {
      // Save and close the contour sketch open_feature reopened: the same
      // commit as the rail checkmark / sketch_commit, which rewrites the
      // @contour statement by id and runs the part. Whatever happens, the
      // sketch does not stay open behind the agent.
      const prepareSketch = ctx.prepareSketchCommit;
      if (typeof prepareSketch !== 'function') {
        return { error: { code: 'internal', message: 'prepareSketchCommit handler is missing' } };
      }
      const committed = await runContourCommitMutate(ctx, { prepare: prepareSketch, fromSlot: false });
      if (committed.error) {
        ctx.sketchCancel?.();
        ctx.dismissFeatureConfirmSession?.();
        const message = committed.error.message || 'Contour edit could not be saved';
        return {
          error: {
            ...committed.error,
            message: `${message} The contour sketch was closed without saving. ${CONTOUR_EDIT_HINT}`,
          },
        };
      }
      ctx.dismissFeatureConfirmSession?.();
      const res = committed.result || {};
      if (res.written) trackFeatureUsed('contour');
      return {
        result: {
          ok: res.ok === true,
          id: `contour:${sketch.contourId}`,
          errors: res.errors || [],
          status: res.status,
          unchanged: res.unchanged === true,
          sketchClosed: true,
        },
      };
    }
    const prepare = ctx.prepareFeatureConfirm;
    if (typeof prepare !== 'function') {
      return { error: { code: 'internal', message: 'prepareFeatureConfirm handler is missing' } };
    }
    const prep = prepare();
    if (prep?.error) return { error: prep.error };
    // An unchanged confirm writes nothing, but the part can still be failed
    // from the last run: say so instead of ok: true.
    const current = ctx.readStatus?.();
    const stillFailed = current?.runState === 'failed';
    let outcome = {
      ok: !stillFailed,
      errors: stillFailed ? (ctx.readErrors?.() || []) : [],
      status: current,
    };
    if (prep.changed) {
      outcome = await ctx.mutate(prep.source, prep.message);
      if (prep.kind) trackFeatureUsed(prep.kind);
    }
    ctx.dismissFeatureConfirmSession?.();
    return {
      result: {
        ok: outcome.ok === true,
        id: prep.featureId,
        errors: outcome.errors || [],
        status: outcome.status,
        unchanged: !prep.changed,
      },
    };
  },
});

export const cancelFeatureCommand = Object.freeze({
  name: 'cancel_feature',
  schema: NO_ARGS_SCHEMA,
  example: {},
  run(ctx) {
    const sketch = openContourSketchSession(ctx);
    // A reopened contour closes its sketch too, so cancel never leaves
    // contour mode behind.
    if (sketch) ctx.sketchCancel?.();
    const out = hostCall(ctx, 'cancelFeature', {});
    if (out?.error) return out;
    return sketch ? { result: { ...(out.result || {}), sketchClosed: true } } : out;
  },
});

export const deleteFeatureCommand = Object.freeze({
  name: 'delete_feature',
  uiEntry: 'data-feature-sheet-delete',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      ...TARGET_SCHEMA.properties,
      confirm: {
        type: 'boolean',
        description: 'Required true to delete the feature that declares part while later code still uses it',
      },
    },
  }),
  example: { index: 1 },
  /**
   * Host resolves the block and refuses (`confirm_required`) when it declares
   * `part` and later code still uses it. The write then goes through the same
   * `mutate` path as confirm_feature, so `status` and `errors` are current
   * when this resolves and undo once restores the block.
   */
  async run(ctx, args) {
    const prepare = ctx.prepareFeatureDelete;
    if (typeof prepare !== 'function') {
      return { error: { code: 'internal', message: 'prepareFeatureDelete handler is missing' } };
    }
    const prep = prepare(args || {});
    if (prep?.error) return { error: prep.error };
    const outcome = await ctx.mutate(prep.source, prep.message);
    const result = {
      deletedId: prep.featureId,
      ok: outcome.ok === true,
      errors: outcome.errors || [],
      failures: outcome.failures || [],
      status: outcome.status,
    };
    if (prep.warning) result.warning = prep.warning;
    return { result };
  },
});

export const rollbackToCommand = Object.freeze({
  name: 'rollback_to',
  uiEntry: 'data-rollback-bar',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', description: 'Feature id the bar sits after' },
      index: { type: 'number', description: 'Gap index: 0 before all, length after last' },
      clear: { type: 'boolean', description: 'Remove stored anchor (bar after last feature)' },
      start: { type: 'boolean', description: 'Anchor before every feature (anchor null)' },
    },
  }),
  example: { id: 'cube1' },
  run(ctx, args) {
    return hostCall(ctx, 'rollbackTo', args);
  },
});
