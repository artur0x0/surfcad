/** Write the editor, run it, and record one undo step when the text changes. */
export const setScriptCommand = Object.freeze({
  name: 'set_script',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
    required: ['source'],
    properties: {
      source: {
        type: 'string',
        description: 'Script text written into the editor and run.',
      },
    },
  }),
  example: {
    source: 'let part = Manifold.cube([20, 20, 20], true);\nreturn part;\n',
  },
  checkArgs(args) {
    if (typeof args.source !== 'string') {
      return { code: 'bad_args', message: 'set_script source must be a string' };
    }
    return null;
  },
  async run(ctx, args) {
    return { result: await ctx.mutate(args.source, 'Agent script') };
  },
});
