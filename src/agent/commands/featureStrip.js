import { NO_ARGS_SCHEMA } from '../registry.js';

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
  uiEntry: 'data-feature-chip',
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
        additionalProperties: false,
        description: 'Feature sheet / edit-card fields to merge before confirm',
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
    return hostCall(ctx, 'editFeature', args);
  },
});

export const confirmFeatureCommand = Object.freeze({
  name: 'confirm_feature',
  uiEntry: 'data-feature-sheet-accept',
  schema: NO_ARGS_SCHEMA,
  example: {},
  async run(ctx) {
    const prepare = ctx.prepareFeatureConfirm;
    if (typeof prepare !== 'function') {
      return { error: { code: 'internal', message: 'prepareFeatureConfirm handler is missing' } };
    }
    const prep = prepare();
    if (prep?.error) return { error: prep.error };
    let outcome = { ok: true, errors: [], status: ctx.readStatus?.() };
    if (prep.changed) {
      outcome = await ctx.mutate(prep.source, prep.message);
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
    return hostCall(ctx, 'cancelFeature', {});
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
    },
  }),
  example: { index: 1 },
  run(ctx, args) {
    return hostCall(ctx, 'deleteFeature', args);
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
