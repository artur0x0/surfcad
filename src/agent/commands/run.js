import { NO_ARGS_SCHEMA } from '../registry.js';

/**
 * Run the current editor buffer. One undo step when that buffer is not
 * already the head. The toolbar Run button is `data-cad-run`. Visible mode
 * is not wired: this command calls the host mutate path, which is the v1
 * contract, and the button's handler is also on the host as `runScript`.
 */
export const runCommand = Object.freeze({
  name: 'run',
  schema: NO_ARGS_SCHEMA,
  example: {},
  uiEntry: 'data-cad-run',
  async run(ctx) {
    return { result: await ctx.mutate(ctx.getScript(), 'Agent run') };
  },
});
