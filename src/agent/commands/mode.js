import { NO_ARGS_SCHEMA } from '../registry.js';

export const modeCommand = Object.freeze({
  name: 'mode',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const read = ctx.readMode;
    const result = typeof read === 'function'
      ? read()
      : { app: 'cad', viewport: 'idle', contour: null, fillet: null, featureEdit: null, sheetMetal: null };
    return { result };
  },
});
