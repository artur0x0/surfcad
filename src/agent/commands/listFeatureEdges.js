import { EDGE_FILTER_SCHEMA, PAGE_SCHEMA, checkEdgeFilter, checkPage } from '../state/listFilters.js';
import { shapeEdgeList } from './listEdges.js';

export const listFeatureEdgesCommand = Object.freeze({
  name: 'list_feature_edges',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      part_id: { type: 'string' },
      filter: EDGE_FILTER_SCHEMA,
      page: PAGE_SCHEMA,
    },
  },
  example: {},
  immediate: true,
  checkArgs(args) {
    return checkEdgeFilter(args?.filter) || checkPage(args?.page);
  },
  run(ctx, args) {
    const list = ctx.listFeatureEdges;
    if (typeof list !== 'function') {
      return { error: { code: 'internal', message: 'listFeatureEdges handler is missing' } };
    }
    const out = list({ partId: args?.part_id });
    if (out?.error) return { error: out.error };
    return { result: shapeEdgeList(out, args) };
  },
});
