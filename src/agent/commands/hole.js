import { holeParamsFromArgs } from '../holeAgent.js';
import { runHoleMutate } from './runHoleMutate.js';

function hostCall(ctx, name, args) {
  const fn = ctx[name];
  if (typeof fn !== 'function') {
    return { error: { code: 'internal', message: `${name} handler is missing` } };
  }
  const out = fn(args);
  if (out?.error) return { error: out.error };
  return { result: out?.result ?? out };
}

export const holeOpenCommand = Object.freeze({
  name: 'hole_open',
  uiEntry: 'hole',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {},
  }),
  example: {},
  run(ctx) {
    return hostCall(ctx, 'holeOpen');
  },
});

export const holeSetParamsCommand = Object.freeze({
  name: 'hole_set_params',
  uiEntry: 'data-hole-card',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {
      params: { type: 'object', additionalProperties: true },
      type: { type: 'string' },
      size: { type: 'string' },
      fit: { type: 'string' },
      dia: {},
      through: { type: 'boolean' },
      depth: { type: 'number' },
      side: { type: 'number' },
    },
  }),
  example: { size: 'M4', fit: 'normal', through: true },
  checkArgs(args) {
    const built = holeParamsFromArgs(args);
    return built.error ? built.error : null;
  },
  run(ctx, args) {
    const built = holeParamsFromArgs(args);
    if (built.error) return { error: built.error };
    return hostCall(ctx, 'holeSetParams', { patch: built.patch });
  },
});

export const holeBeginCentresCommand = Object.freeze({
  name: 'hole_begin_centres',
  uiEntry: 'data-hole-card',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {},
  }),
  example: {},
  run(ctx) {
    return hostCall(ctx, 'holeBeginCentres');
  },
});

export const holeCommitCommand = Object.freeze({
  name: 'hole_commit',
  uiEntry: 'data-contour-confirm',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {},
  }),
  example: {},
  async run(ctx) {
    const prepare = ctx.prepareHoleCommit;
    if (typeof prepare !== 'function') {
      return { error: { code: 'internal', message: 'prepareHoleCommit handler is missing' } };
    }
    return runHoleMutate(ctx, { prepare, label: 'Hole' });
  },
});

export const holeCancelCommand = Object.freeze({
  name: 'hole_cancel',
  uiEntry: 'data-hole-card',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    properties: {},
  }),
  example: {},
  run(ctx) {
    return hostCall(ctx, 'holeCancel');
  },
});
