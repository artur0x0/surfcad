import { NO_ARGS_SCHEMA } from '../registry.js';

/** One contour sketch history step (Contour rail Back). */
export const sketchUndoCommand = Object.freeze({
  name: 'sketch_undo',
  uiEntry: 'data-contour-back',
  schema: NO_ARGS_SCHEMA,
  example: {},
  run(ctx) {
    const undo = ctx.agentSketchUndo;
    if (typeof undo !== 'function') {
      return { error: { code: 'internal', message: 'agentSketchUndo handler is missing' } };
    }
    const out = undo();
    if (!out?.ok) {
      return { error: { code: 'nothing_to_undo', message: 'Nothing to undo in the open sketch' } };
    }
    return { result: out };
  },
});
