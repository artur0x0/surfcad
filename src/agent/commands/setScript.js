import { rejectPartId } from '../state/identity.js';

/** Write the editor, run it, and record one undo step when the text changes. */
export const setScriptCommand = Object.freeze({
  name: 'set_script',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['part_id', 'source'],
    properties: {
      part_id: {
        type: 'string',
        description: 'Part id to write. Must match the active part. Not a vault path.',
      },
      source: {
        type: 'string',
        description: 'Script text written into the editor and run.',
      },
    },
  }),
  example: {
    part_id: '2026-10-07-20-56-31-0423-a3f9',
    source: 'let part = Manifold.cube([20, 20, 20], true);\nreturn part;\n',
  },
  checkArgs(args) {
    const bad = rejectPartId(args?.part_id);
    if (bad) return bad;
    if (typeof args.source !== 'string') {
      return { code: 'bad_args', message: 'set_script source must be a string' };
    }
    return null;
  },
  async run(ctx, args) {
    const badId = rejectPartId(args?.part_id);
    if (badId) return { error: badId };
    const listed = typeof ctx.readParts === 'function' ? ctx.readParts() : null;
    const activeId = listed?.activeId ?? null;
    if (!activeId) {
      return { error: { code: 'no_assembly', message: 'No open document' } };
    }
    if (args.part_id !== activeId) {
      return {
        error: {
          code: 'part_mismatch',
          message: `set_script part_id ${args.part_id} is not the active part ${activeId}`,
        },
      };
    }
    return { result: await ctx.mutate(args.source, 'Agent script') };
  },
});