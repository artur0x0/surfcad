import { NO_ARGS_SCHEMA } from '../registry.js';

/** Last finished set_script, run, or undo. Resolves immediately. */
export const statusCommand = Object.freeze({
  name: 'status',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return { result: ctx.readStatus() };
  },
});
