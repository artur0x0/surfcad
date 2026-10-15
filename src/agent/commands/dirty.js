import { NO_ARGS_SCHEMA } from '../registry.js';

export const dirtyCommand = Object.freeze({
  name: 'dirty',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const read = ctx.readDirty;
    const result = typeof read === 'function'
      ? read()
      : {
        workspaceDirty: false,
        assemblyDirty: false,
        renamePending: false,
        legacyCleanup: false,
        partIds: [],
      };
    return { result };
  },
});
