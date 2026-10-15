import { NO_ARGS_SCHEMA } from '../registry.js';
import { undoPartHistory } from '../../utils/partHistory.js';

/**
 * One step on the active part's stack, then that script is run.
 * The history snapshot is the one `undoPartHistory` returns. It is written
 * after execute, because a run may seed an assembly and replace the stack.
 * The toolbar Undo button has no `data-*` id yet, so this command has no
 * `uiEntry`. It does not call the button handler.
 */
export const undoCommand = Object.freeze({
  name: 'undo',
  schema: NO_ARGS_SCHEMA,
  example: {},
  async run(ctx) {
    const agentUndo = ctx.agentUndo;
    if (typeof agentUndo === 'function') {
      const routed = await agentUndo();
      if (routed?.handled) {
        return { result: routed.result };
      }
    }
    const before = ctx.cloneHistory(ctx.readHistory());
    const undone = undoPartHistory(before);
    if (undone.code == null) {
      return { error: { code: 'nothing_to_undo', message: 'Nothing to undo' } };
    }
    ctx.setEditor(undone.code);
    let outcome;
    try {
      outcome = await ctx.execute(undone.code);
    } catch (err) {
      outcome = ctx.failedExecute(err);
    }
    ctx.writeHistory(undone.history);
    return { result: ctx.remember(outcome, undone.code) };
  },
});
