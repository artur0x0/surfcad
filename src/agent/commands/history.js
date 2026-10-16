import { NO_ARGS_SCHEMA } from '../registry.js';

/**
 * Read-only summary of the stack the next undo/redo would use.
 */
export const historyCommand = Object.freeze({
  name: 'history',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const read = ctx.agentHistory;
    const result = typeof read === 'function'
      ? read()
      : {
        kind: 'part',
        head: -1,
        canUndo: false,
        canRedo: false,
        entries: [],
      };
    return { result };
  },
});
