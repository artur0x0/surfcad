import { isRepoPath, unknownPartError } from '../state/partVisible.js';

/**
 * Hide or show one part. Working copy only — the host must not write git.
 * `part_id` is an opaque id: a vault path is `unknown_part`, and there is
 * no fallback to the active part.
 */
export const setPartVisibleCommand = Object.freeze({
  name: 'set_part_visible',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['part_id', 'visible'],
    properties: {
      part_id: {
        type: 'string',
        description: 'Opaque part id from parts. Not a vault path. Does not fall back to the active part.',
      },
      visible: {
        type: 'boolean',
        description: 'true shows the part, false hides it.',
      },
    },
  }),
  example: { part_id: 'local:part1', visible: false },
  checkArgs(args) {
    if (typeof args?.part_id !== 'string' || !args.part_id) {
      return { code: 'bad_args', message: 'set_part_visible part_id must be a non-empty string' };
    }
    if (typeof args.visible !== 'boolean') {
      return { code: 'bad_args', message: 'set_part_visible visible must be a boolean' };
    }
    if (isRepoPath(args.part_id)) return unknownPartError(args.part_id);
    return null;
  },
  async run(ctx, args) {
    const setVisible = ctx.setPartVisible;
    if (typeof setVisible !== 'function') {
      return { error: { code: 'internal', message: 'setPartVisible handler is missing' } };
    }
    const out = await setVisible({ partId: args.part_id, visible: args.visible });
    if (out?.error) return { error: out.error };
    const result = out?.result ?? out;
    if (!result || typeof result.partId !== 'string') {
      return { error: { code: 'internal', message: 'setPartVisible did not return a part id' } };
    }
    return { result: { partId: result.partId, visible: result.visible === true } };
  },
});
