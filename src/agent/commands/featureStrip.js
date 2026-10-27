import { NO_ARGS_SCHEMA } from '../registry.js';
import { trackFeatureUsed } from '../../utils/analytics.js';
import { featureEditParamError } from '../featureEditParams.js';
import {
  commitOpenContourSketch,
  contourSketchPatch,
  CONTOUR_EDIT_HINT,
  openContourSketchSession,
  patchOpenContourSketch,
} from './contourSession.js';

// Tests and sketch_edit import the patch mapper from here as before.
export { contourSketchPatch, CONTOUR_EDIT_HINT };

const TARGET_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'Feature id from feature_tree' },
    index: { type: 'number', description: 'Feature index from feature_tree' },
  },
});

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
        // Open on purpose. A nested `properties` map made strict MCP clients
        // collapse this to additionalProperties: false with an empty
        // properties object, so { params: { at } } and { params: { height } }
        // never left the client. Which keys apply is checked per feature
        // kind at runtime (featureEditParams.js); an unknown key is bad_args.
        additionalProperties: true,
        description: 'Feature parameters to merge into the open edit. An open object: height, radius, distance, dx, dy, dz, at, and the contour profile keys are all accepted here. The open feature decides which keys it can write; a key it does not use is bad_args and is not stored. For a move: dx, dy, dz, and at. For a saved contour (a contour:<id> chip): points [[u, v], …], radius, segments, width, height, centered, polygon_preset, or tool; they patch the reopened sketch, and confirm_feature saves and closes it.',
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
      const patched = patchOpenContourSketch(ctx, sketch, args?.params);
      if (patched.error) return { error: patched.error };
      const echo = hostCall(ctx, 'editFeature', args);
      if (echo?.error) return echo;
      return {
        result: {
          ...(echo.result || {}),
          contourId: sketch.contourId,
          ...patched.result,
        },
      };
    }
    // No session: do not report success. The host used to merge a draft and
    // return ok even when open_feature had not stored a session.
    if (typeof ctx.readFeatureSession === 'function') {
      const session = ctx.readFeatureSession();
      if (!session?.open) {
        return { error: { code: 'no_feature_edit', message: 'No feature edit session is open' } };
      }
      const bad = featureEditParamError(session.kind, args?.params);
      if (bad) return { error: bad };
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
      // Save and close the contour sketch open_feature reopened (the same
      // commit as the rail checkmark); no sketch stays open behind the agent.
      return commitOpenContourSketch(ctx, sketch);
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
    // Only the sketch: cancelFeature itself ends the feature session.
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
      part_id: {
        type: 'string',
        description: 'Opaque surf id of the part whose feature is deleted. Omit to use the active part. A face pick does not change the target. A path or display name is unknown_part.',
      },
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
    // The block is gone once mutate returns; `ok` is the run after it (a
    // later feature can fail on the new solid). Follow-up 8: a failed run
    // read as "not deleted", and the agent deleted again.
    const result = {
      deletedId: prep.featureId,
      deleted: true,
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
  async run(ctx, args) {
    const fn = ctx.rollbackTo;
    if (typeof fn !== 'function') {
      return { error: { code: 'internal', message: 'rollbackTo handler is missing' } };
    }
    const out = await fn(args);
    if (out?.error) return { error: out.error };
    const hosted = out?.result ?? out ?? {};
    const { run, script, ...rest } = hosted;
    if (!run || typeof ctx.remember !== 'function') return { result: rest };
    // The bar move ran the rolled-back evaluation; record it as the last run
    // so status, errors and the result describe the solid that is shown.
    const remembered = ctx.remember(run, typeof script === 'string' ? script : ctx.getScript());
    return {
      result: {
        ...rest,
        ok: remembered.ok,
        errors: remembered.errors,
        failures: remembered.failures,
        status: remembered.status,
        ...(remembered.crash ? { crash: remembered.crash } : {}),
      },
    };
  },
});
