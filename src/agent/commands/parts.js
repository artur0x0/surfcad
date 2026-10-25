import { NO_ARGS_SCHEMA } from '../registry.js';
import { unjointedPartIds } from '../state/unjointedParts.js';

function jointsFrom(ctx) {
  const read = ctx?.readJoints;
  if (typeof read !== 'function') return [];
  const joints = read();
  return Array.isArray(joints) ? joints : [];
}

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
    if (!result || typeof result !== 'object' || Array.isArray(result)) return { result };
    if (Array.isArray(result.unjointedParts)) return { result };
    return {
      result: {
        ...result,
        unjointedParts: unjointedPartIds(result.parts, jointsFrom(ctx)),
      },
    };
  },
});
