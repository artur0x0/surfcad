import { NO_ARGS_SCHEMA } from '../registry.js';
import { unjointedPartsFor } from '../state/unjointedParts.js';

/** Active-part CAD status (script, run state, last geometry). Resolves immediately. */
export const statusCommand = Object.freeze({
  name: 'status',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const result = ctx.readStatus() || {};
    return { result: { ...result, unjointedParts: unjointedPartsFor(ctx) } };
  },
});
