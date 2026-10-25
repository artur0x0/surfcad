/**
 * Server-side filters and pages for list_faces, list_edges, and
 * list_feature_edges. The viewport builds the whole row list as before
 * (listPickables.js); these trim it before it leaves the tab, so an agent
 * asks for "the planar faces that look up" or "edges longer than 20 mm"
 * instead of parsing 160 KB.
 *
 * `total` is the row count after the filter and before the page, so a
 * caller can walk pages with `offset` until `offset + returned >= total`.
 */

export const FACE_KINDS = Object.freeze(['planar', 'cylindrical', 'curved']);

/**
 * list_faces page size when `page` or `page.limit` is omitted. A detailed
 * part is hundreds of rows; returning every row put `total` after the array,
 * and a host that truncated the payload cut the page fields off. One hundred
 * rows stays a complete answer, with `total` and `nextOffset` for the rest.
 */
export const FACE_PAGE_LIMIT = 100;

const FACE_FILTER_KEYS = Object.freeze(['kind', 'normalWithin', 'minArea', 'maxArea', 'bbox', 'name', 'feature', 'role']);
const EDGE_FILTER_KEYS = Object.freeze(['between', 'minLength', 'maxLength', 'bbox']);

function bad(message) {
  return { code: 'bad_args', message };
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function vec3(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const out = [Number(value[0]), Number(value[1]), Number(value[2])];
  return out.every((n) => Number.isFinite(n)) ? out : null;
}

function unit(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 0)) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function finiteOrNull(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function checkBbox(bbox, label) {
  if (!isObject(bbox)) return bad(`${label}.bbox must be { min: [x, y, z], max: [x, y, z] }`);
  const min = vec3(bbox.min);
  const max = vec3(bbox.max);
  if (!min || !max) return bad(`${label}.bbox needs min and max as [x, y, z] in mm`);
  if (min.some((v, i) => v > max[i])) return bad(`${label}.bbox min must not exceed max on any axis`);
  return null;
}

function checkRange(value, label) {
  const n = finiteOrNull(value);
  if (n == null) return null;
  if (Number.isNaN(n) || n < 0) return bad(`${label} must be a non-negative number`);
  return null;
}

/** @returns {{ code: string, message: string } | null} */
export function checkFaceFilter(filter) {
  if (filter == null) return null;
  if (!isObject(filter)) return bad('filter must be an object');
  for (const key of Object.keys(filter)) {
    if (!FACE_FILTER_KEYS.includes(key)) return bad(`filter.${key} is not a face filter (use ${FACE_FILTER_KEYS.join(', ')})`);
  }
  if (filter.kind != null && !FACE_KINDS.includes(filter.kind)) {
    return bad(`filter.kind must be one of ${FACE_KINDS.join(', ')}`);
  }
  if (filter.normalWithin != null) {
    const nw = filter.normalWithin;
    if (!isObject(nw) || !vec3(nw.n) || !unit(vec3(nw.n))) return bad('filter.normalWithin needs n: [x, y, z] (non-zero)');
    const deg = finiteOrNull(nw.deg);
    if (deg == null || Number.isNaN(deg) || deg < 0 || deg > 180) return bad('filter.normalWithin needs deg between 0 and 180');
  }
  for (const key of ['name', 'feature', 'role']) {
    if (filter[key] != null && (typeof filter[key] !== 'string' || !filter[key].trim())) {
      return bad(`filter.${key} must be a non-empty string (a face name part from list_faces rows; * is a glob)`);
    }
  }
  return checkRange(filter.minArea, 'filter.minArea')
    || checkRange(filter.maxArea, 'filter.maxArea')
    || (filter.bbox != null ? checkBbox(filter.bbox, 'filter') : null);
}

/** `*` matches anything; everything else is literal. */
function globToRegExp(pattern) {
  const esc = String(pattern).split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${esc}$`);
}

/** A row's stamped name part matches `want`: exact, or `name` without its `[k]`, or a glob. */
function nameMatches(value, want) {
  if (typeof value !== 'string' || !value) return false;
  if (value === want) return true;
  if (value.replace(/\[\d+\]$/, '') === want) return true;
  return want.includes('*') && globToRegExp(want).test(value);
}

function keyLike(value) {
  return isObject(value) && vec3(value.at) && vec3(value.n) && Number.isFinite(Number(value.area));
}

/** @returns {{ code: string, message: string } | null} */
export function checkEdgeFilter(filter) {
  if (filter == null) return null;
  if (!isObject(filter)) return bad('filter must be an object');
  for (const key of Object.keys(filter)) {
    if (!EDGE_FILTER_KEYS.includes(key)) return bad(`filter.${key} is not an edge filter (use ${EDGE_FILTER_KEYS.join(', ')})`);
  }
  if (filter.between != null) {
    const pair = filter.between;
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(keyLike)) {
      return bad('filter.between must be two face keys [{ at, n, area }, { at, n, area }] from list_faces');
    }
  }
  return checkRange(filter.minLength, 'filter.minLength')
    || checkRange(filter.maxLength, 'filter.maxLength')
    || (filter.bbox != null ? checkBbox(filter.bbox, 'filter') : null);
}

/** @returns {{ code: string, message: string } | null} */
export function checkPage(page) {
  if (page == null) return null;
  if (!isObject(page)) return bad('page must be { offset?, limit? }');
  for (const key of Object.keys(page)) {
    if (key !== 'offset' && key !== 'limit') return bad(`page.${key} is not a page field (use offset, limit)`);
  }
  if (page.offset != null && !(Number.isInteger(page.offset) && page.offset >= 0)) return bad('page.offset must be an integer >= 0');
  if (page.limit != null && !(Number.isInteger(page.limit) && page.limit >= 1)) return bad('page.limit must be an integer >= 1');
  return null;
}

function inBbox(point, bbox) {
  const p = vec3(point);
  if (!p) return false;
  const min = vec3(bbox.min);
  const max = vec3(bbox.max);
  return p.every((v, i) => v >= min[i] && v <= max[i]);
}

/** A face hits the box when its triangle bounds overlap it. Without bounds, the center must lie inside. */
function faceHitsBbox(row, bbox) {
  const bmin = vec3(row?.bounds?.min);
  const bmax = vec3(row?.bounds?.max);
  const min = vec3(bbox.min);
  const max = vec3(bbox.max);
  if (!min || !max) return false;
  if (bmin && bmax) return bmin.every((v, i) => v <= max[i]) && bmax.every((v, i) => v >= min[i]);
  return inBbox(row?.center, bbox);
}

function angleDeg(a, b) {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return (Math.acos(dot) * 180) / Math.PI;
}

/** Rows of `buildFaceList` that pass `filter` (already checked). */
export function filterFaces(faces, filter) {
  const rows = Array.isArray(faces) ? faces : [];
  if (!filter || !Object.keys(filter).length) return rows.slice();
  const want = filter.normalWithin ? unit(vec3(filter.normalWithin.n)) : null;
  const deg = filter.normalWithin ? Number(filter.normalWithin.deg) : 0;
  const minArea = finiteOrNull(filter.minArea);
  const maxArea = finiteOrNull(filter.maxArea);
  return rows.filter((row) => {
    if (filter.kind && row.kind !== filter.kind && row.type !== filter.kind) return false;
    if (want) {
      const n = row.normal ? unit(vec3(row.normal) || [0, 0, 0]) : null;
      if (!n || angleDeg(n, want) > deg + 1e-9) return false;
    }
    const area = Number(row.area);
    if (minArea != null && !(area >= minArea)) return false;
    if (maxArea != null && !(area <= maxArea)) return false;
    if (filter.bbox && !faceHitsBbox(row, filter.bbox)) return false;
    // Face identity filters: rows without a stamped name never match them.
    if (filter.name != null && !nameMatches(row.name, filter.name)) return false;
    if (filter.feature != null && !nameMatches(row.feature, filter.feature)) return false;
    if (filter.role != null && !nameMatches(row.role, filter.role)) return false;
    return true;
  });
}

const KEY_AT_TOL_MM = 1e-3;
const KEY_N_TOL = 1e-3;
const KEY_AREA_REL_TOL = 1e-3;

/** Two list_faces keys name the same face: same centre, normal, and area within tolerance. `src` / `ord` are ignored. */
export function sameFaceKey(a, b) {
  const atA = vec3(a?.at);
  const atB = vec3(b?.at);
  const nA = atA ? unit(vec3(a.n) || [0, 0, 0]) : null;
  const nB = atB ? unit(vec3(b.n) || [0, 0, 0]) : null;
  if (!atA || !atB || !nA || !nB) return false;
  if (Math.hypot(atA[0] - atB[0], atA[1] - atB[1], atA[2] - atB[2]) > KEY_AT_TOL_MM) return false;
  if (Math.hypot(nA[0] - nB[0], nA[1] - nB[1], nA[2] - nB[2]) > KEY_N_TOL) return false;
  const areaA = Number(a.area);
  const areaB = Number(b.area);
  const scale = Math.max(Math.abs(areaA), Math.abs(areaB), 1e-9);
  return Math.abs(areaA - areaB) / scale <= KEY_AREA_REL_TOL;
}

function edgeBetween(row, pair) {
  const a = row.faceKeyA;
  const b = row.faceKeyB;
  if (!a || !b) return false;
  return (sameFaceKey(a, pair[0]) && sameFaceKey(b, pair[1]))
    || (sameFaceKey(a, pair[1]) && sameFaceKey(b, pair[0]));
}

/** Rows of `buildEdgeList` / `buildGroupedEdgeList` that pass `filter` (already checked). */
export function filterEdges(edges, filter) {
  const rows = Array.isArray(edges) ? edges : [];
  if (!filter || !Object.keys(filter).length) return rows.slice();
  const minLength = finiteOrNull(filter.minLength);
  const maxLength = finiteOrNull(filter.maxLength);
  return rows.filter((row) => {
    const length = Number(row.length);
    if (minLength != null && !(length >= minLength)) return false;
    if (maxLength != null && !(length <= maxLength)) return false;
    if (filter.bbox && !inBbox(row.mid, filter.bbox)) return false;
    if (filter.between && !edgeBetween(row, filter.between)) return false;
    return true;
  });
}

/**
 * One page of `rows`. Without `page` every row is returned, with `total`
 * and `returned` so the shape is the same either way.
 */
export function paginate(rows, page) {
  const all = Array.isArray(rows) ? rows : [];
  const offset = page && Number.isInteger(page.offset) ? page.offset : 0;
  const limit = page && Number.isInteger(page.limit) ? page.limit : null;
  const slice = limit == null ? all.slice(offset) : all.slice(offset, offset + limit);
  const out = { rows: slice, total: all.length, returned: slice.length };
  if (page) {
    out.offset = offset;
    if (limit != null) out.limit = limit;
    const next = offset + slice.length;
    if (next < all.length) out.nextOffset = next;
  }
  return out;
}

/**
 * Apply filter and page to `result[rowsKey]` and add `total` / `returned`
 * (and `offset` / `limit` when a page was given). Other fields pass through.
 * `frame` is always `"local"`: face centers and edge midpoints are the part
 * mesh, not the assembly placement, so they match `select_faces` keys.
 */
export function shapeListResult(result, rowsKey, filtered, page) {
  const paged = paginate(filtered, page);
  // Page fields first. A truncated payload then still carries total and the
  // next offset, instead of a cut-off faces array with no way to continue.
  const out = {
    total: paged.total,
    returned: paged.returned,
    frame: 'local',
  };
  if (page) {
    out.offset = paged.offset;
    if (paged.limit != null) out.limit = paged.limit;
    if (paged.nextOffset != null) out.nextOffset = paged.nextOffset;
  }
  const src = result && typeof result === 'object' ? result : {};
  for (const key of Object.keys(src)) {
    if (key === rowsKey || key in out) continue;
    out[key] = src[key];
  }
  out[rowsKey] = paged.rows;
  return out;
}

/** Shared arg schemas. */
export const PAGE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  description: 'One page of rows. The result carries total (rows after the filter), returned, offset, and limit, and nextOffset when another page remains (pass it as the next offset). list_faces uses offset 0 and limit 100 when page or limit is omitted. Other lists return every remaining row when limit is omitted.',
  properties: {
    offset: { type: 'integer', minimum: 0, description: 'Rows to skip. 0 starts at the first row. list_faces also accepts the previous result\'s nextOffset.' },
    limit: { type: 'integer', minimum: 1, description: 'Rows to return. list_faces defaults to 100. Other lists return every remaining row when this is omitted.' },
  },
});

const BBOX_FILTER_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    min: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    max: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
  },
});

export const FACE_FILTER_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  description: 'Keep only matching faces. Every given field must hold.',
  properties: {
    kind: { type: 'string', enum: FACE_KINDS, description: 'Face type' },
    normalWithin: {
      type: 'object',
      additionalProperties: false,
      description: 'Faces whose normal is within deg degrees of n',
      properties: {
        n: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        deg: { type: 'number', minimum: 0, maximum: 180 },
      },
    },
    minArea: { type: 'number', minimum: 0, description: 'Smallest area in mm² to keep' },
    maxArea: { type: 'number', minimum: 0, description: 'Largest area in mm² to keep' },
    bbox: { ...BBOX_FILTER_SCHEMA, description: 'Faces whose triangle bounds overlap this box (part local, mm). A large face is kept when the box covers any part of it, even if its center lies outside.' },
  },
});

const FACE_KEY_ARG = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['at', 'n', 'area'],
  properties: {
    at: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    n: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    area: { type: 'number' },
    src: { type: 'integer' },
    ord: { type: 'integer' },
  },
});

export const EDGE_FILTER_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  description: 'Keep only matching edges. Every given field must hold.',
  properties: {
    between: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: FACE_KEY_ARG,
      description: 'Edges shared by these two faces (list_faces keys, either order)',
    },
    minLength: { type: 'number', minimum: 0, description: 'Shortest edge in mm to keep' },
    maxLength: { type: 'number', minimum: 0, description: 'Longest edge in mm to keep' },
    bbox: { ...BBOX_FILTER_SCHEMA, description: 'Edges whose midpoint lies inside this box (part local, mm)' },
  },
});
