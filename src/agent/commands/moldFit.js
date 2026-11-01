/**
 * Read-only moldability fit. The viewport handler scores the part mesh
 * (`moldFitFromGeometry`); this command only checks args and forwards them.
 */

function pullError(pull) {
  if (!Array.isArray(pull) || pull.length !== 3 || pull.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return { code: 'bad_args', message: 'pull must be [x, y, z]' };
  }
  if (pull[0] === 0 && pull[1] === 0 && pull[2] === 0) {
    return { code: 'bad_args', message: 'pull must be a non-zero [x, y, z] vector' };
  }
  return null;
}

export const moldFitCommand = Object.freeze({
  name: 'mold_fit',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      part_id: {
        type: 'string',
        description: 'Opaque surf id of the part to score. Omit for the active part.',
      },
      pull: {
        type: 'array',
        items: { type: 'number' },
        minItems: 3,
        maxItems: 3,
        description: 'Override pull direction [x, y, z] in the part local frame. The vector is normalized and its sign is kept. Omit to search.',
      },
    },
  }),
  example: { pull: [0, 0, 1] },
  immediate: true,
  checkArgs(args) {
    if (args?.pull == null) return null;
    return pullError(args.pull);
  },
  run(ctx, args) {
    const score = ctx.moldFit;
    if (typeof score !== 'function') {
      return { error: { code: 'internal', message: 'moldFit handler is missing' } };
    }
    const out = score({ partId: args?.part_id, pull: args?.pull });
    const pack = (value) => (value?.error ? { error: value.error } : { result: value });
    if (out && typeof out.then === 'function') return out.then(pack);
    return pack(out);
  },
});
