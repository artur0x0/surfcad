import { NO_ARGS_SCHEMA } from '../registry.js';

export const selectionCommand = Object.freeze({
  name: 'selection',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const read = ctx.readSelection;
    const result = typeof read === 'function'
      ? read()
      : {
        activePartId: null,
        cadPartId: null,
        face: null,
        edges: [],
        contour: { armedId: null, planeId: null },
      };
    return { result };
  },
});
