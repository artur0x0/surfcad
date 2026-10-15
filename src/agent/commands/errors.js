import { NO_ARGS_SCHEMA } from '../registry.js';

/** Messages from the last finished run. Resolves immediately. */
export const errorsCommand = Object.freeze({
  name: 'errors',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const read = ctx.readStructuredErrors;
    const errors = typeof read === 'function' ? read() : ctx.readErrors().map((message) => ({
      code: 'build_failed',
      message,
    }));
    return { result: { errors } };
  },
});
