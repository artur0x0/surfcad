import { rejectPartId } from '../state/identity.js';
import { withPlacementWarning } from '../state/unjointedParts.js';
import { positionLimitMessage, positionWithinLimit } from '../../utils/positionLimit.js';

const VEC3 = Object.freeze({
  type: 'array',
  items: { type: 'number' },
  minItems: 3,
  maxItems: 3,
});

function hostCall(ctx, name, args) {
  const fn = ctx[name];
  if (typeof fn !== 'function') {
    return { error: { code: 'internal', message: `${name} handler is missing` } };
  }
  const out = fn(args);
  if (out?.then) {
    return out.then((resolved) => {
      if (resolved?.error) return { error: resolved.error };
      return { result: resolved?.result ?? resolved };
    });
  }
  if (out?.error) return { error: out.error };
  return { result: out?.result ?? out };
}

export const partGetTransformCommand = Object.freeze({
  name: 'part_get_transform',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['part_id'],
    properties: {
      part_id: { type: 'string', description: 'Part id from parts. Not a vault path.' },
    },
  }),
  example: { part_id: '2026-10-07-20-56-31-0423-a3f9' },
  immediate: true,
  checkArgs(args) {
    return rejectPartId(args?.part_id);
  },
  run(ctx, args) {
    return hostCall(ctx, 'agentGetPartTransform', { partId: args.part_id });
  },
});

export const partSetTransformCommand = Object.freeze({
  name: 'part_set_transform',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['part_id'],
    properties: {
      part_id: { type: 'string', description: 'Part id from parts. Not a vault path.' },
      position: {
        ...VEC3,
        description: 'Translation [x, y, z] in mm. Omitted keeps the current translation. A rough block-out for a part that touches nothing; joint_create places a part that touches another. Block-out positions are rough; joints set final positions.',
      },
      rotation: {
        ...VEC3,
        description:
          'Intrinsic XYZ Euler rotation in degrees (same order as three.js Euler XYZ). Omitted keeps the current rotation.',
      },
    },
  }),
  example: { part_id: '2026-10-07-20-56-31-0423-a3f9', position: [10, 0, 0] },
  checkArgs(args) {
    const bad = rejectPartId(args?.part_id);
    if (bad) return bad;
    if (args.position == null && args.rotation == null) {
      return { code: 'bad_args', message: 'part_set_transform needs position or rotation' };
    }
    if (args.position != null && !positionWithinLimit(args.position)) {
      return { code: 'bad_args', message: `part_set_transform ${positionLimitMessage('position')}` };
    }
    return null;
  },
  async run(ctx, args) {
    const hosted = await hostCall(ctx, 'agentSetPartTransform', {
      partId: args.part_id,
      position: args.position,
      rotation: args.rotation,
    });
    return withPlacementWarning(ctx, hosted, args.part_id, true);
  },
});