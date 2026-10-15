import { NO_ARGS_SCHEMA } from '../registry.js';

export const toastsCommand = Object.freeze({
  name: 'toasts',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const read = ctx.readToasts;
    const result = typeof read === 'function' ? read() : { toasts: [] };
    return { result };
  },
});
