import { NO_ARGS_SCHEMA } from '../registry.js';

export const partsCommand = Object.freeze({
  name: 'parts',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const read = ctx.readParts;
    const result = typeof read === 'function'
      ? read()
      : { activeId: null, assemblyName: '', parts: [] };
    return { result };
  },
});
