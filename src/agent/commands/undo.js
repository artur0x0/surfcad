import { NO_ARGS_SCHEMA } from '../registry.js';

/**
 * One undo step on the same stack as the feature-bar Undo button (sketch,
 * assembly joints, or active part script). Does not bypass App routing.
 */
export const undoCommand = Object.freeze({
  name: 'undo',
  uiEntry: Object.freeze(['data-cad-undo', 'data-feature-bar-undo']),
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
    const { restoredScript, ...base } = routed.result || {};
    if (base.kind === 'part' && base.status && typeof ctx.remember === 'function') {
      // Echo the script the host restored, never a re-read of the editor
      // that could still hold the block this step removed.
      const script = typeof restoredScript === 'string' ? restoredScript : ctx.getScript();
      const remembered = ctx.remember({
        ok: base.ok === true,
        errors: base.errors,
        // A run that never reported: status says stale instead of passing the
        // previous failure off as this step's result.
        ...(base.stale === true ? { stale: true } : {}),
        volume: base.status.volume,
        bbox: base.status.bbox,
        partName: base.status.partName,
        // The host counted the bodies of the run it just did; without this
        // the cached status reported bodyCount null after every undo (Pi 5 C2).
        bodyCount: base.status.bodyCount ?? null,
        // Explicit null clears a previous failure. Omitting the key would
        // re-read a stale viewport ref and keep the last error.
        ...(Object.prototype.hasOwnProperty.call(base, 'runFailure')
          ? { runFailure: base.runFailure }
          : {}),
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
