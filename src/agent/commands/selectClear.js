import { NO_ARGS_SCHEMA } from '../registry.js';

export const selectClearCommand = Object.freeze({
  name: 'select_clear',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const clear = ctx.clearSelection;
    if (typeof clear !== 'function') {
      return { error: { code: 'internal', message: 'clearSelection handler is missing' } };
    }
    clear();
    return { result: { cleared: true } };
  },
});
