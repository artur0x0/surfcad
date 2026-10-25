/**
 * Agent bridge helpers for HELPER_PALETTE_ITEMS (H4).
 */

import {
  HELPERS_NEED_BODY,
  HELPER_PALETTE_ITEMS,
  defaultParamsFor,
  isBufferEmpty,
  parsePatternPoints,
  rotateAxisLiteral,
} from '../utils/helperPaletteSnippets.js';
import { POSITION_LIMIT_MM } from '../utils/positionLimit.js';

const HELPER_IDS = new Set(HELPER_PALETTE_ITEMS.map((item) => item.id));

/** snake_case command name for a palette id, e.g. makeExtrude → insert_make_extrude */
export function helperCommandName(helperId) {
  const snake = String(helperId).replace(/([A-Z])/g, '_$1').toLowerCase();
  return `insert_${snake}`;
}

export function isKnownHelperId(id) {
  return typeof id === 'string' && HELPER_IDS.has(id);
}

function paramNames(item) {
  return new Set((item?.params || []).map((row) => row.name));
}

/**
 * insert_* helpers whose build() reads the face and/or edge context from
 * selectionContextFromArgs. Checked against each HELPER_PALETTE_ITEMS build:
 * primitives, boolean, center, align, mirror, array3D, polarArray, and the
 * shape fallbacks (makeExtrude, makeRevolve, makeSweep, makeLoft) do not
 * take that context. shell and addDraft accept a face argument but only
 * consult it when openScope / faceScope is 'selected', and those enums are
 * not in the agent schema, so the flag would not change the script.
 * insert_move declares its own use_selection (body targeting) below.
 */
const USE_SELECTION_BY_HELPER = {
  filletEdges: 'When true, fillet the selected edges, or the edges of the selected face if no edges are selected. Omit the flag to fillet every convex edge',
  chamferEdges: 'When true, chamfer the selected edges, or the edges of the selected face if no edges are selected. Omit the flag to chamfer every convex edge',
  crossSection: 'When true, place the contour on the selected planar face. Otherwise use the default +Z top face',
  sweepPath: 'When true, build the path from the selected edges. With no edges the insert is refused',
  hole: 'When true, place the hole on the selected planar or cylindrical face. Otherwise use the default +Z top face',
  holePattern: 'When true, place the grid on the selected planar or cylindrical face. Otherwise use the default +Z top face',
  clearanceHole: 'When true, place the hole on the selected planar or cylindrical face. Otherwise use the default +Z top face',
  tapDrillHole: 'When true, place the hole on the selected planar or cylindrical face. Otherwise use the default +Z top face',
  cboreHole: 'When true, place the hole on the selected planar or cylindrical face. Otherwise use the default +Z top face',
  cskHole: 'When true, place the hole on the selected planar or cylindrical face. Otherwise use the default +Z top face',
  cut: 'When true, cut on the plane of the selected face. A cylindrical or irregular face, or no face, cuts on XY through the origin',
  workplane: 'When true, place the construction plane on the selected planar face. Otherwise use the default XY plane at the origin',
  moveFace: 'When true, offset the selected face. With no face, the face list is empty',
  deleteFace: 'When true, delete the selected face. With no face, the face list is empty',
};

/**
 * The selection is single-use: the viewport clears face and edge picks after
 * every successful rebuild because they index the old mesh. Stated on every
 * use_selection flag so an agent re-picks before each insert.
 */
export const USE_SELECTION_NOTE = ' A named pick (select_faces { names }, or a click on a face a helper built) is resolved by name in the script (facesNamed for a face, edgesOf for the edges around it) and is found again after every rebuild, so it can be used for several inserts. A pick with no name clears with the rebuild, and use_selection: true with nothing selected is refused with no_selection.';

/** True for helpers whose compose reads the face / edge context (not insert_move, which targets a body). */
export function helperReadsSelection(helperId) {
  return Object.prototype.hasOwnProperty.call(USE_SELECTION_BY_HELPER, helperId);
}

/** JSON-schema properties for one palette item's params (plus agent-only fields). */
export function schemaPropertiesForHelper(item, { includeId = false } = {}) {
  const properties = {};
  if (includeId) {
    properties.id = { type: 'string', description: 'HELPER_PALETTE_ITEMS id' };
    properties.params = {
      type: 'object',
      additionalProperties: true,
      description: 'Optional param bag when id is set at the top level',
    };
    properties.use_selection = {
      type: 'boolean',
      description: `When true, pass the current viewport face/edge selection as context.${USE_SELECTION_NOTE}`,
    };
  }
  if (item?.id === 'move' || item?.id === 'rotate') {
    // The body to move or rotate. The host tries body_index, then at, then
    // face_id / face, then use_selection: true (the selected face). Nothing
    // named and use_selection not true is no_body (the origin is never assumed).
    const verb = item.id === 'rotate' ? 'rotate' : 'move';
    properties.body_index = { type: 'integer', minimum: 0, description: 'Body from list_bodies' };
    properties.at = {
      type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
      description: 'Body centroid [x, y, z] mm from list_bodies',
    };
    properties.face_id = { type: 'string', description: `A list_faces id (f12) on the body to ${verb}` };
    properties.face = { type: 'object', description: `A list_faces key { at, n, area } on the body to ${verb}` };
    properties.use_selection = {
      type: 'boolean',
      description: `When true and no body_index, at, face_id, or face is given, ${verb} the body of the selected face`,
    };
  } else if (Object.prototype.hasOwnProperty.call(USE_SELECTION_BY_HELPER, item?.id)) {
    properties.use_selection = {
      type: 'boolean',
      description: `${USE_SELECTION_BY_HELPER[item.id]}.${USE_SELECTION_NOTE}`,
    };
  }
  if (item?.id === 'roundedBox') {
    properties.width = {
      type: 'number',
      minimum: 0.1,
      description: 'X size in mm. Same axis as sx; width wins when both are set.',
    };
    properties.depth = {
      type: 'number',
      minimum: 0.1,
      description: 'Y size in mm. Same axis as sy; depth wins when both are set.',
    };
    properties.height = {
      type: 'number',
      minimum: 0.1,
      description: 'Z size in mm. Same axis as sz; height wins when both are set.',
    };
  }
  if (item?.id === 'hole' || item?.id === 'tapDrillHole') {
    properties.depth = {
      type: 'number',
      minimum: 0.1,
      description: 'Blind depth in mm, into the part from the face. Omit for a through hole, which is the default.',
    };
  }
  for (const param of item?.params || []) {
    if (param.type === 'number') {
      properties[param.name] = { type: 'number' };
      if (Number.isFinite(param.min)) properties[param.name].minimum = param.min;
      if (Number.isFinite(param.max)) properties[param.name].maximum = param.max;
      if (param.description) properties[param.name].description = param.description;
    } else if (param.type === 'bool') {
      properties[param.name] = { type: 'boolean' };
    } else if (param.type === 'select' && Array.isArray(param.options)) {
      const allowed = param.options.map((row) => (
        row && typeof row === 'object' && 'value' in row ? row.value : row
      ));
      properties[param.name] = { type: 'string', enum: allowed };
      if (param.description) properties[param.name].description = param.description;
    } else if (param.type === 'points') {
      properties[param.name] = {
        type: ['array', 'string'],
        description: 'Points as [[x, y, z], …] or [{ at: [x, y, z], axis: [nx, ny, nz] }, …] in mm (a JSON string of the same is accepted). For hardware: the center and axis of each hole from list_faces on the mating part.',
      };
    } else if (param.type === 'axis') {
      properties[param.name] = {
        type: ['string', 'array'],
        description: "'x', 'y', or 'z' (a leading '-' flips it), or an [ax, ay, az] vector; right-hand rule",
      };
    } else if (param.type === 'vec3') {
      properties[param.name] = {
        type: ['array', 'null'],
        items: { type: 'number' },
        minItems: 3,
        maxItems: 3,
        description: '[x, y, z] in mm; omit or null for the default',
      };
    } else if (param.type === 'string') {
      // (schema below) required text params are enforced by validateHelperParams
      properties[param.name] = { type: 'string' };
    } else if (param.type === 'body' || param.type === 'solid') {
      properties[param.name] = { type: 'string', description: 'Part script binding name' };
    } else {
      properties[param.name] = { type: 'string' };
    }
  }
  return properties;
}

export function exampleArgsForHelper(item) {
  const base = defaultParamsFor(item.id);
  const example = {};
  for (const param of item.params || []) {
    if (Object.prototype.hasOwnProperty.call(base, param.name)) {
      example[param.name] = base[param.name];
    }
  }
  // The catalog example is a bolt circle of holes. Defaults stay bore 0 /
  // radius 0 (copy the body, on the axis); the description says which is which.
  if (item.id === 'polarArray') {
    example.count = 6;
    example.boltCircleRadius = 20;
    example.axis = 'z';
    example.boreRadius = 3;
    example.boreHeight = 10;
  }
  return example;
}

/** Top-level arg wins over the same key inside params. */
function readArg(args, key) {
  if (args && Object.prototype.hasOwnProperty.call(args, key) && args[key] !== undefined) {
    return args[key];
  }
  const bag = args?.params;
  if (bag && typeof bag === 'object' && !Array.isArray(bag)
    && Object.prototype.hasOwnProperty.call(bag, key) && bag[key] !== undefined) {
    return bag[key];
  }
  return undefined;
}

/**
 * width / depth / height are not sheet fields. Copy them onto sx / sy / sz
 * so coerce does not drop them before the rounded box is built.
 */
function applyRoundedBoxSizeAliases(item, args, merged) {
  if (item?.id !== 'roundedBox') return;
  const width = readArg(args, 'width');
  const depth = readArg(args, 'depth');
  const height = readArg(args, 'height');
  if (width !== undefined) {
    merged.sx = width;
    merged.width = width;
  }
  if (depth !== undefined) {
    merged.sy = depth;
    merged.depth = depth;
  }
  if (height !== undefined) {
    merged.sz = height;
    merged.height = height;
  }
}

/**
 * A depth with no through flag is a blind hole. The sheet sends through
 * explicitly, so this only changes the agent call.
 */
function applyBlindHoleDepth(item, args, merged) {
  if (item?.id !== 'hole' && item?.id !== 'tapDrillHole') return;
  const depth = readArg(args, 'depth');
  if (depth === undefined || depth === null || depth === '') return;
  merged.depth = depth;
  const through = readArg(args, 'through');
  if (through === undefined) merged.through = false;
  else merged.through = through;
}

/**
 * Merge explicit args with palette defaults. Strips invoke_helper-only keys.
 */
export function coerceHelperParams(item, args) {
  const names = paramNames(item);
  const bag = {};
  if (args?.params && typeof args.params === 'object' && !Array.isArray(args.params)) {
    Object.assign(bag, args.params);
  }
  for (const [key, value] of Object.entries(args || {})) {
    if (key === 'id' || key === 'params' || key === 'use_selection') continue;
    if (names.has(key)) bag[key] = value;
  }
  // insert_move target fields are resolved by the host, not palette params.
  for (const key of ['at', 'face', 'face_id', 'body_index']) delete bag[key];
  const defaults = defaultParamsFor(item.id);
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(bag)) {
    if (names.has(key)) merged[key] = value;
  }
  applyRoundedBoxSizeAliases(item, args, merged);
  applyBlindHoleDepth(item, args, merged);
  return merged;
}

function helperLabel(item) {
  return item?.label || item?.id || 'Helper';
}

function fieldName(param) {
  if (param?.label && param.label !== param.name) return `${param.label} (${param.name})`;
  return param?.label || param?.name || 'value';
}

function showWhenHolds(param, params) {
  const rule = param?.showWhen;
  if (!rule || !Array.isArray(rule.values)) return true;
  const current = String(params?.[rule.field] ?? '');
  return rule.values.map(String).includes(current);
}

export function validateHelperParams(item, params) {
  const label = helperLabel(item);
  for (const param of item.params || []) {
    if (!showWhenHolds(param, params)) continue;
    if (param.type === 'points') {
      const has = params && Object.prototype.hasOwnProperty.call(params, param.name);
      if (!has || !parsePatternPoints(params[param.name])) {
        return {
          code: 'bad_args',
          message: `${label} ${fieldName(param)} must be a non-empty array of [x, y, z] or { at: [x, y, z], axis: [nx, ny, nz] } in mm (a JSON string of one is accepted); an axis must not be zero.`,
        };
      }
    }
    if (param.type === 'string' && param.required === true) {
      const text = params && Object.prototype.hasOwnProperty.call(params, param.name) ? String(params[param.name] ?? '') : '';
      if (!text.trim()) {
        return {
          code: 'bad_args',
          message: item?.id === 'codeSnippet'
            ? `${label} needs ${fieldName(param)}: every snippet names the feature that would have made it unnecessary (gap), why the existing feature did not work (why), and the one operation it does (script).`
            : `${label} ${fieldName(param)} is required.`,
        };
      }
    }
    if (!Object.prototype.hasOwnProperty.call(params, param.name)) continue;
    const value = params[param.name];
    if (param.type === 'number') {
      if (!Number.isFinite(Number(value))) {
        return { code: 'bad_args', message: `${label} ${fieldName(param)} must be a finite number.` };
      }
      const n = Number(value);
      // Every number is capped at ±POSITION_LIMIT_MM so a typo cannot overflow the kernel.
      if (Math.abs(n) > POSITION_LIMIT_MM) {
        return {
          code: 'bad_args',
          message: `${label} ${fieldName(param)} is ${n}, beyond the ±${POSITION_LIMIT_MM} mm limit.`,
        };
      }
      if (Number.isFinite(param.min) && n < param.min) {
        return {
          code: 'bad_args',
          message: `${label} ${fieldName(param)} is ${n}, below the minimum ${param.min}.`,
        };
      }
      if (Number.isFinite(param.max) && n > param.max) {
        return {
          code: 'bad_args',
          message: `${label} ${fieldName(param)} is ${n}, above the maximum ${param.max}.`,
        };
      }
    }
    if (param.type === 'bool' && typeof value !== 'boolean') {
      return { code: 'bad_args', message: `${label} ${fieldName(param)} must be a boolean.` };
    }
    if (param.type === 'axis' && !rotateAxisLiteral(value)) {
      return {
        code: 'bad_args',
        message: `${label} ${fieldName(param)} must be x, y, or z (a leading - flips it) or a non-zero [ax, ay, az] vector.`,
      };
    }
    if (param.type === 'vec3' && value != null) {
      const ok = Array.isArray(value) && value.length === 3 && value.every((n) => Number.isFinite(Number(n)))
        && value.every((n) => Math.abs(Number(n)) <= POSITION_LIMIT_MM);
      if (!ok) {
        return {
          code: 'bad_args',
          message: `${label} ${fieldName(param)} must be [x, y, z] in mm within ±${POSITION_LIMIT_MM}, or omitted.`,
        };
      }
    }
    if (param.type === 'select' && Array.isArray(param.options)) {
      const allowed = param.options.map((row) => (
        row && typeof row === 'object' && 'value' in row ? row.value : row
      ));
      if (!allowed.includes(value)) {
        return {
          code: 'bad_args',
          message: `${label} ${fieldName(param)} must be one of: ${allowed.join(', ')}.`,
        };
      }
    }
  }
  if ((item?.id === 'hole' || item?.id === 'tapDrillHole')
    && params && params.depth != null && params.depth !== '') {
    const n = Number(params.depth);
    if (!Number.isFinite(n)) {
      return { code: 'bad_args', message: `${label} Depth (depth) must be a finite number.` };
    }
    if (n < 0.1) {
      return { code: 'bad_args', message: `${label} Depth (depth) is ${n}, below the minimum 0.1.` };
    }
    if (n > POSITION_LIMIT_MM) {
      return {
        code: 'bad_args',
        message: `${label} Depth (depth) is ${n}, beyond the ±${POSITION_LIMIT_MM} mm limit.`,
      };
    }
  }
  const polar = item?.id === 'polarArray' || (item?.id === 'array3D' && params?.arrayType === 'polar');
  if (polar && Number(params?.boreRadius) > 0 && !(Number(params?.boltCircleRadius) > 0)) {
    return {
      code: 'bad_args',
      message: `${label} boltCircleRadius must be greater than 0 when boreRadius is greater than 0. boreRadius drills that many holes on the bolt circle and does not copy the body; boreRadius 0 copies the body, and boltCircleRadius 0 leaves a copy on the axis.`,
    };
  }
  return null;
}

/**
 * Why composeHelperInsert returned nothing. Names the helper and the
 * selection or range it needed, instead of a generic refusal.
 *
 * @param {{ id?: string, label?: string }|null|undefined} item
 * @param {{ params?: object|null, faceContext?: object|null, edgeContext?: unknown[]|null }} [ctx]
 */
export function describeHelperRefusal(item, ctx = {}) {
  const label = helperLabel(item);
  const id = item?.id || '';
  // No seed cube: on an empty part, a helper that needs a body is refused.
  if (HELPERS_NEED_BODY.has(id) && typeof ctx.buffer === 'string' && isBufferEmpty(ctx.buffer)) {
    return `${label} needs a body first. Insert a Block (insert_cube, insert_cylinder, …) or a Shape (extrude, revolve, …), then ${label} again.`;
  }
  const params = ctx.params && typeof ctx.params === 'object' ? ctx.params : {};
  const edgeCount = Array.isArray(ctx.edgeContext) ? ctx.edgeContext.length : 0;
  const face = ctx.faceContext;
  const hasFace = !!(face && (face.type || face.center || face.key || face.normal));

  if (id === 'rotate') {
    return `Rotate refused. axis must be x, y, or z or a non-zero [ax, ay, az] vector, angle a finite number of degrees, and center [x, y, z] in mm or omitted for the body centroid.`;
  }
  if (id === 'move') {
    const bits = ['dx', 'dy', 'dz']
      .map((name) => (Number.isFinite(Number(params[name])) ? `${name} ${Number(params[name])}` : null))
      .filter(Boolean);
    const where = bits.length ? ` (${bits.join(', ')} mm)` : '';
    return `Move refused${where}. Each axis must be a finite translation within ±${POSITION_LIMIT_MM} mm.`;
  }
  if (id === 'chamferEdges' && hasFace && !edgeCount && face.type === 'irregular' && !(typeof face.name === 'string' && face.name)) {
    return 'Chamfer refused. This face pick is an irregular region with no face name, so it does not name one face boundary. Pick a named face (select_faces { names }) or grouped edges, then insert again.';
  }
  if (id === 'filletEdges' || id === 'chamferEdges' || id === 'sweepPath' || id === 'makeSweep') {
    if (!edgeCount) {
      return `${label} needs a selected edge. Pick an edge or a tangent chain, then insert again.`;
    }
    const noun = edgeCount === 1 ? 'edge' : 'edges';
    return `${label} could not use the ${edgeCount} selected ${noun}. Pick a connected tangent chain and insert again.`;
  }
  if (id === 'moveFace' || id === 'deleteFace' || id === 'shell' || id === 'addDraft') {
    if (!hasFace) return `${label} needs a selected face. Pick a face on the solid, then insert again.`;
    return `${label} could not use the selected face. Pick a face on the solid and insert again.`;
  }
  if (id === 'makeLoft') {
    return `${label} needs two or more sketch profiles before it can build.`;
  }
  if (id === 'makeExtrude' || id === 'makeRevolve' || id === 'crossSection') {
    return `${label} needs a sketch profile before it can build.`;
  }
  if ((id === 'polarArray' || (id === 'array3D' && params.arrayType === 'polar'))
    && Number(params.boreRadius) > 0 && !(Number(params.boltCircleRadius) > 0)) {
    return `${label} needs boltCircleRadius greater than 0 when boreRadius is greater than 0. That drills a bolt circle of holes; boreRadius 0 copies the body, and boltCircleRadius 0 leaves a copy on the axis.`;
  }
  return `${label} could not be inserted. Check its parameters and the current face or edge selection, then insert again.`;
}

export function selectionContextFromArgs(ctx, args) {
  if (!args?.use_selection) return { faceContext: null, edgeContext: null };
  const helperEdges = ctx.readHelperEdgeContext?.();
  const sel = ctx.readSelection?.() ?? {};
  const face = sel.face || null;
  const edges = Array.isArray(helperEdges) && helperEdges.length
    ? helperEdges
    : (Array.isArray(sel.edges) && sel.edges.length ? sel.edges : null);
  return { faceContext: face, edgeContext: edges };
}
