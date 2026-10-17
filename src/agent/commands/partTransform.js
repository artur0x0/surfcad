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
    required: ['part'],
    properties: {
      part: { type: 'string', description: 'Stable part id or vault path.' },
    },
  }),
  example: { part: 'local:part1' },
  immediate: true,
  checkArgs(args) {
    if (typeof args?.part !== 'string' || !args.part) {
      return { code: 'bad_args', message: 'part_get_transform part must be a non-empty string' };
    }
    return null;
  },
  run(ctx, args) {
    return hostCall(ctx, 'agentGetPartTransform', { partId: args.part });
  },
});

export const partSetTransformCommand = Object.freeze({
  name: 'part_set_transform',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['part'],
    properties: {
      part: { type: 'string', description: 'Stable part id or vault path to move.' },
      position: {
        ...VEC3,
        description: 'Translation [x, y, z] in mm. Omitted keeps the current translation.',
      },
      rotation: {
        ...VEC3,
        description:
          'Intrinsic XYZ Euler rotation in degrees (same order as three.js Euler XYZ). Omitted keeps the current rotation.',
      },
    },
  }),
  example: { part: 'local:part1', position: [10, 0, 0] },
  checkArgs(args) {
    if (typeof args?.part !== 'string' || !args.part) {
      return { code: 'bad_args', message: 'part_set_transform part must be a non-empty string' };
    }
    if (args.position == null && args.rotation == null) {
      return { code: 'bad_args', message: 'part_set_transform needs position or rotation' };
    }
    return null;
  },
  async run(ctx, args) {
    return hostCall(ctx, 'agentSetPartTransform', {
      partId: args.part,
      position: args.position,
      rotation: args.rotation,
    });
  },
});
