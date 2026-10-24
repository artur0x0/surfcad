/**
 * The helper registry inside the package: data/helpers.json is a copy of
 * src/lib/surfcad/catalog/helpers.json (every HELPER_FUNCTIONS key with its
 * signature, params, description, doc and examples), refreshed by
 * `npm run export:agent` and pinned by a freshness test. `guide dialect`
 * and the `list_helpers` tool are rendered from it at load time, so a
 * helper change updates both in the same commit as the registry.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const HELPERS_JSON_REL = 'data/helpers.json';

export const LIST_HELPERS_TOOL_NAME = 'list_helpers';

/**
 * Ribbon-order groups for the dialect topic and the list_helpers filter.
 * A helper the map does not name lands in "other" (the test flags it).
 */
export const HELPER_GROUPS = Object.freeze({
  blocks: ['roundedBox', 'tube', 'rectTube', 'hexPrism', 'sheetMetalSolid'],
  shapes: ['makeCrossSection', 'solveContour', 'profileCircle', 'profileRectangle', 'profilePolygon', 'makeExtrude', 'makeRevolve', 'makeLoft', 'loft', 'sweep', 'sweepPoints', 'makeSweepPath', 'rotateContour', 'offsetPlaneFrame'],
  build: ['cut', 'hollow', 'shell', 'hole', 'holeSpan', 'cboreHole', 'cskHole', 'clearanceHole', 'tapDrillHole', 'holePattern', 'holesOnContour', 'booleanBodies', 'externalBody', 'addDraft', 'draftFaces', 'moveFace', 'deleteFace'],
  polish: ['filletEdges', 'chamferEdges', 'filletAlongPath', 'convexEdges', 'concaveEdges', 'signedFeatureEdges', 'edge', 'edgesBetween', 'boundaryEdges'],
  place: ['move', 'rotateAbout', 'center', 'align', 'mirror', 'array3D', 'polarArray', 'patternOnPoints', 'getDimensions'],
  faces: ['faceNames', 'facesNamed', 'edgesOf', 'surfaceOf', 'facesByNormal', 'planarFaceAt', 'edgesByOrientation', 'workplaneFromFace', 'placeInFrame', 'transformByFrame', 'placeOnFace'],
  fasteners: ['fastenerClearanceDia', 'fastenerTapDrillDia', 'fastenerMajorDia', 'listFastenerSizes', 'resolveFastenerSize'],
  vectors: ['vecAdd', 'vecSub', 'vecMul', 'vecDot', 'vecCross', 'vecNorm', 'vecNormalize', 'sumSqDist'],
  legacy: ['getScaleRatio'],
});

const GROUP_TITLES = Object.freeze({
  blocks: 'Blocks (primitives; Manifold.cube / cylinder / sphere are the kernel\'s own)',
  shapes: 'Shapes from contours (sketch profiles, extrude, revolve, loft, sweep)',
  build: 'Build (cuts, holes, shells, booleans, draft, face edits)',
  polish: 'Polish (edges: fillet, chamfer, edge sets)',
  place: 'Place and pattern',
  faces: 'Faces, names and frames (selection and workplanes)',
  fasteners: 'Fastener tables',
  vectors: 'Vectors',
  legacy: 'Legacy',
  other: 'Other',
});

export const HELPER_GROUP_NAMES = Object.freeze([...Object.keys(HELPER_GROUPS), 'other']);

const GROUP_OF = new Map();
for (const [group, names] of Object.entries(HELPER_GROUPS)) for (const name of names) GROUP_OF.set(name, group);

/** @param {string} name */
export function helperGroup(name) {
  return GROUP_OF.get(name) || 'other';
}

/**
 * @returns {{ generatedFrom: string, count: number, helpers: Array<{ name: string, signature: string, params: Array<{ name: string, text: string, default?: string }>, description: string, doc: string, examples: string[] }> }}
 */
export function loadHelpersCatalog(path = join(PKG_ROOT, HELPERS_JSON_REL)) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.helpers)) {
    throw new Error('Invalid helpers catalog');
  }
  return doc;
}

const SHORT_MAX = 110;

/**
 * One short line for a helper: the first sentence of its description with
 * a leading "name(...) —" (the signature again) dropped.
 * @param {{ name: string, description?: string, doc?: string }} helper
 */
export function shortDescription(helper) {
  let text = String(helper.description || helper.doc || '').replace(/\s+/g, ' ').trim();
  text = text.replace(new RegExp(`^${helper.name}\\([^)]*\\)\\s*(→|—|-|:)\\s*`), '');
  const first = text.split(/(?<=[.!?])\s+(?=[A-Z`(])/)[0] || text;
  text = first.replace(/[.\s]+$/, '');
  if (text.length > SHORT_MAX) text = `${text.slice(0, SHORT_MAX - 1).trimEnd()}…`;
  return text;
}

const DIALECT_INTRO = `The SurfCAD dialect. A part's script is plain JavaScript over the Manifold kernel plus the helpers below, which the runtime passes in as function parameters (so their names are reserved: never declare them with const, let, class or function). The script sets and returns part; numbers are mm; insert_* tools write one marker block each (see guide features) and their descriptions quote the code they write with default arguments. list_helpers { names: [...] } returns a helper's full doc and examples; list_helpers { group } or { match } lists a slice.`;

/**
 * The dialect topic text, rendered from the registry: one signature line per
 * helper, in ribbon-order groups.
 * @param {ReturnType<typeof loadHelpersCatalog>} [catalog]
 */
export function renderDialectTopic(catalog = loadHelpersCatalog()) {
  const byGroup = new Map(HELPER_GROUP_NAMES.map((g) => [g, []]));
  for (const helper of catalog.helpers) byGroup.get(helperGroup(helper.name)).push(helper);
  // Within a group, the order of HELPER_GROUPS (basic before derived), not registry order.
  for (const [group, rows] of byGroup) {
    const order = HELPER_GROUPS[group] || [];
    rows.sort((x, y) => order.indexOf(x.name) - order.indexOf(y.name));
  }
  const sections = [];
  for (const group of HELPER_GROUP_NAMES) {
    const rows = byGroup.get(group);
    if (!rows.length) continue;
    sections.push([
      `${GROUP_TITLES[group]}:`,
      ...rows.map((h) => `  ${h.signature} — ${shortDescription(h)}`),
    ].join('\n'));
  }
  return `${DIALECT_INTRO}\n\n${sections.join('\n\n')}\n\nGenerated from ${catalog.generatedFrom} (${catalog.count} helpers).`;
}

export const DIALECT_SUMMARY = 'Every script helper by signature, in ribbon-order groups, rendered from the helper registry; list_helpers has the full docs';

export function listHelpersToolDefinition() {
  return {
    name: LIST_HELPERS_TOOL_NAME,
    description: `The script helper registry as JSON, no pairing needed: name, group, signature, params (with defaults) and a one-line description per helper; with names, the full doc and examples too. list_helpers {} is every helper (compact); { names: ["tube", "filletEdges"] } those with docs (unknown names in missing); { group } one of ${HELPER_GROUP_NAMES.join(', ')}; { match: "hole" } name or description substring; page { offset, limit } slices. The same registry renders guide { topic: "dialect" } and the insert_* descriptions.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        names: { type: 'array', items: { type: 'string' }, description: 'Only these helpers, with full doc and examples. Unknown names come back in missing.' },
        group: { type: 'string', enum: [...HELPER_GROUP_NAMES], description: 'Only the helpers in this group.' },
        match: { type: 'string', description: 'Case-insensitive substring of the name or description.' },
        page: {
          type: 'object',
          additionalProperties: false,
          properties: {
            offset: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
          description: 'One slice of the filtered rows; the result carries total and returned.',
        },
      },
    },
  };
}

function compactRow(helper) {
  return {
    name: helper.name,
    group: helperGroup(helper.name),
    signature: helper.signature,
    params: helper.params,
    description: shortDescription(helper),
  };
}

function fullRow(helper) {
  return { ...compactRow(helper), doc: helper.doc, examples: helper.examples };
}

/**
 * @param {Record<string, unknown>} args
 * @param {ReturnType<typeof loadHelpersCatalog>} [catalog]
 * @returns {{ content: Array<{ type: 'text', text: string }>, isError: boolean }}
 */
export function callListHelpersTool(args, catalog = loadHelpersCatalog()) {
  const bad = (message) => ({
    content: [{ type: 'text', text: JSON.stringify({ code: 'bad_args', message }) }],
    isError: true,
  });
  const src = args && typeof args === 'object' ? args : {};
  if (src.names != null && (!Array.isArray(src.names) || !src.names.every((n) => typeof n === 'string'))) {
    return bad('list_helpers names must be an array of helper names');
  }
  if (src.group != null && !HELPER_GROUP_NAMES.includes(src.group)) {
    return bad(`list_helpers group must be one of ${HELPER_GROUP_NAMES.join(', ')}`);
  }
  if (src.match != null && typeof src.match !== 'string') return bad('list_helpers match must be a string');
  const page = src.page;
  if (page != null && (typeof page !== 'object' || Array.isArray(page)
    || (page.offset != null && !(Number.isInteger(page.offset) && page.offset >= 0))
    || (page.limit != null && !(Number.isInteger(page.limit) && page.limit >= 1 && page.limit <= 200)))) {
    return bad('list_helpers page must be { offset?: integer >= 0, limit?: 1..200 }');
  }

  const wanted = Array.isArray(src.names) ? new Set(src.names) : null;
  const match = typeof src.match === 'string' && src.match.trim() ? src.match.trim().toLowerCase() : null;
  let rows = catalog.helpers;
  if (wanted) rows = rows.filter((h) => wanted.has(h.name));
  if (src.group) rows = rows.filter((h) => helperGroup(h.name) === src.group);
  if (match) rows = rows.filter((h) => h.name.toLowerCase().includes(match) || String(h.description || '').toLowerCase().includes(match));
  const total = rows.length;
  const offset = page?.offset ?? 0;
  const limit = page?.limit ?? total;
  const slice = page ? rows.slice(offset, offset + limit) : rows;
  const groups = {};
  for (const h of catalog.helpers) {
    const g = helperGroup(h.name);
    groups[g] = (groups[g] || 0) + 1;
  }
  const result = {
    helpers: slice.map((h) => (wanted ? fullRow(h) : compactRow(h))),
    total,
    returned: slice.length,
    groups,
  };
  if (page) {
    result.offset = offset;
    result.limit = limit;
  }
  if (wanted) {
    const found = new Set(slice.map((h) => h.name));
    const missing = [...wanted].filter((n) => !found.has(n));
    if (missing.length) result.missing = missing;
  }
  if (src.group) result.group = src.group;
  return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false };
}
