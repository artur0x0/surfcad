import { NO_ARGS_SCHEMA } from '../registry.js';

/** Active-part CAD status (script, run state, last geometry). Resolves immediately. */
export const statusCommand = Object.freeze({
  name: 'status',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return { result: ctx.readStatus() };
  },
});
