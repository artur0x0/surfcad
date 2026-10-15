import { NO_ARGS_SCHEMA } from '../registry.js';

/** Editor buffer. Resolves immediately, ahead of a queued mutation. */
export const getScriptCommand = Object.freeze({
  name: 'get_script',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const text = ctx.getScript();
    return { result: { source: typeof text === 'string' ? text : '' } };
  },
});
