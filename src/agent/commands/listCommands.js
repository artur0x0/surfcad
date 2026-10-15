import { NO_ARGS_SCHEMA } from '../registry.js';

/**
 * Name, schema, and example for every registered command, in public order.
 * Resolves immediately. It does not read the editor or the undo stack.
 */
export const listCommandsCommand = Object.freeze({
  name: 'list_commands',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return { result: { commands: ctx.listCommands() } };
  },
});
