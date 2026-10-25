import {
  FACE_FILTER_SCHEMA,
  FACE_PAGE_LIMIT,
  PAGE_SCHEMA,
  checkFaceFilter,
  checkPage,
  filterFaces,
  shapeListResult,
} from '../state/listFilters.js';

/** list_faces always pages. Omitted page or limit uses FACE_PAGE_LIMIT. */
function facePage(page) {
  const offset = page && Number.isInteger(page.offset) ? page.offset : 0;
  const limit = page && Number.isInteger(page.limit) ? page.limit : FACE_PAGE_LIMIT;
  return { offset, limit };
}

/**
 * Read-only catalog of face keys for select_faces. `filter` and `page` trim
 * the list in the tab (listFilters.js); the result always carries `total`
 * (rows after the filter), `returned`, and `frame: "local"`.
 */
export const listFacesCommand = Object.freeze({
  name: 'list_faces',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      part_id: { type: 'string' },
      filter: FACE_FILTER_SCHEMA,
      page: PAGE_SCHEMA,
    },
  },
  example: {},
  immediate: true,
  checkArgs(args) {
    return checkFaceFilter(args?.filter) || checkPage(args?.page);
  },
  run(ctx, args) {
    const list = ctx.listFaces;
    if (typeof list !== 'function') {
      return { error: { code: 'internal', message: 'listFaces handler is missing' } };
    }
    const out = list({ partId: args?.part_id });
    if (out?.error) return { error: out.error };
    const filtered = filterFaces(out?.faces, args?.filter);
    const result = shapeListResult(out || {}, 'faces', filtered, facePage(args?.page));
    if (args?.filter && Object.keys(args.filter).length) result.filter = JSON.parse(JSON.stringify(args.filter));
    return { result };
  },
});
