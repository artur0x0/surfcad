import { NO_ARGS_SCHEMA } from '../registry.js';

/**
 * One undo step on the same stack as the feature-bar Undo button (sketch,
 * assembly joints, or active part script). Does not bypass App routing.
 */
export const undoCommand = Object.freeze({
  name: 'undo',
  schema: NO_ARGS_SCHEMA,
  example: {},
  async run(ctx) {
    const agentUndo = ctx.agentUndo;
    if (typeof agentUndo !== 'function') {
      return { error: { code: 'nothing_to_undo', message: 'Nothing to undo' } };
    }
    const routed = await agentUndo();
    if (!routed?.handled) {
      return { error: { code: 'nothing_to_undo', message: 'Nothing to undo' } };
    }
    if (routed.error) {
      return { error: routed.error };
    }
    const base = routed.result || {};
    if (base.kind === 'part' && base.status && typeof ctx.remember === 'function') {
      const script = ctx.getScript();
      const remembered = ctx.remember({
        ok: base.ok === true,
        errors: base.errors,
        volume: base.status.volume,
        bbox: base.status.bbox,
        partName: base.status.partName,
      }, script);
      return {
        result: {
          ...base,
          ok: remembered.ok,
          errors: remembered.errors,
          status: remembered.status,
        },
      };
    }
    return { result: base };
  },
});
