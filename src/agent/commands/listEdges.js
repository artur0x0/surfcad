import {
  EDGE_FILTER_SCHEMA,
  PAGE_SCHEMA,
  checkEdgeFilter,
  checkPage,
  filterEdges,
  shapeListResult,
} from '../state/listFilters.js';

/** Trim an edge list the host built: filter, then page (listFilters.js). */
export function shapeEdgeList(out, args) {
  const filtered = filterEdges(out?.edges, args?.filter);
  const result = shapeListResult(out || {}, 'edges', filtered, args?.page);
  if (args?.filter && Object.keys(args.filter).length) result.filter = JSON.parse(JSON.stringify(args.filter));
  return result;
}

export const listEdgesCommand = Object.freeze({
  name: 'list_edges',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      part_id: { type: 'string' },
      raw: {
        type: 'boolean',
        description: 'When true (default), return tessellated mesh feature edges. When false, same as list_feature_edges.',
      },
      grouped: {
        type: 'boolean',
        description: 'Alias for raw:false — topology-stable boundary edges.',
      },
      filter: EDGE_FILTER_SCHEMA,
      page: PAGE_SCHEMA,
    },
  },
  example: { raw: true },
  immediate: true,
  checkArgs(args) {
    return checkEdgeFilter(args?.filter) || checkPage(args?.page);
  },
  run(ctx, args) {
    const wantRaw = args?.grouped === true ? false : (args?.raw !== false);
    if (!wantRaw) {
      const listGrouped = ctx.listFeatureEdges;
      if (typeof listGrouped !== 'function') {
        return { error: { code: 'internal', message: 'listFeatureEdges handler is missing' } };
      }
      const out = listGrouped({ partId: args?.part_id });
      if (out?.error) return { error: out.error };
      return { result: shapeEdgeList(out, args) };
    }
    const list = ctx.listEdges;
    if (typeof list !== 'function') {
      return { error: { code: 'internal', message: 'listEdges handler is missing' } };
    }
    const out = list({ partId: args?.part_id, raw: true });
    if (out?.error) return { error: out.error };
    return { result: shapeEdgeList(out, args) };
  },
});
