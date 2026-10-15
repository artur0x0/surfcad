import { NO_ARGS_SCHEMA } from '../registry.js';

export const featureTreeCommand = Object.freeze({
  name: 'feature_tree',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const read = ctx.readFeatureTree;
    const result = typeof read === 'function' ? read() : { features: [], rollbackAnchor: null, activeChipId: null };
    return { result };
  },
});
