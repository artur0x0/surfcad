/**
 * Shared pull reference. Auto searches. Plane uses Top (+Z), Front (+Y),
 * or Right (+X). Face uses a normal in the part local frame. Core/cavity,
 * side actions, and mold draft all recompute from that pull.
 */

import { MOLD_PULL_PLANES, unitPull } from '../../molding/pullReference.js';

const SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['mode'],
  properties: {
    mode: {
      type: 'string',
      enum: ['auto', 'plane', 'face'],
      description: 'auto searches. plane uses an origin plane. face uses normal.',
    },
    plane: {
      type: 'string',
      enum: ['top', 'front', 'right'],
      description: 'Origin plane when mode is plane. Top is +Z, Front is +Y, Right is +X.',
    },
    normal: {
      type: 'array',
      items: { type: 'number' },
      minItems: 3,
      maxItems: 3,
      description: 'Face normal [x, y, z] in the part local frame when mode is face. The sign is kept.',
    },
  },
});

function checkArgs(args) {
  const mode = args?.mode;
  if (mode !== 'auto' && mode !== 'plane' && mode !== 'face') {
    return { code: 'bad_args', message: 'mode must be auto, plane, or face' };
  }
  if (mode === 'plane' && !MOLD_PULL_PLANES[args?.plane]) {
    return { code: 'bad_args', message: 'plane must be top, front, or right' };
  }
  if (mode === 'face' && !unitPull(args?.normal)) {
    return { code: 'bad_args', message: 'normal must be a non-zero [x, y, z] vector' };
  }
  return null;
}

export const moldPullCommand = Object.freeze({
  name: 'mold_pull',
  uiEntry: Object.freeze([
    'data-mold-pull-auto',
    'data-mold-pull-plane',
    'data-mold-pull-face',
    'data-mold-pull-top',
    'data-mold-pull-front',
    'data-mold-pull-right',
  ]),
  schema: SCHEMA,
  example: { mode: 'plane', plane: 'top' },
  immediate: true,
  checkArgs,
  run(ctx, args) {
    const bad = checkArgs(args);
    if (bad) return { error: bad };
    const set = ctx.moldPull;
    if (typeof set !== 'function') {
      return { error: { code: 'internal', message: 'moldPull handler is missing' } };
    }
    const out = set({
      mode: args.mode,
      plane: args.plane,
      pull: args.mode === 'face' ? args.normal : null,
    });
    const pack = (value) => (value?.error ? { error: value.error } : { result: value });
    if (out && typeof out.then === 'function') return out.then(pack);
    return pack(out);
  },
});
