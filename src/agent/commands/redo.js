import { NO_ARGS_SCHEMA } from '../registry.js';

/**
 * One redo step on the same stack as the feature-bar Redo button.
 */
export const redoCommand = Object.freeze({
  name: 'redo',
  uiEntry: Object.freeze(['data-cad-redo', 'data-feature-bar-redo']),
  schema: NO_ARGS_SCHEMA,
  example: {},
  async run(ctx) {
    const agentRedo = ctx.agentRedo;
    if (typeof agentRedo !== 'function') {
      return { error: { code: 'nothing_to_redo', message: 'Nothing to redo' } };
    }
    const routed = await agentRedo();
    if (!routed?.handled) {
      return { error: { code: 'nothing_to_redo', message: 'Nothing to redo' } };
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
