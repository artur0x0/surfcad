/**
 * Agent bridge helpers for HELPER_PALETTE_ITEMS (H4).
 */

import {
  HELPER_PALETTE_ITEMS,
  defaultParamsFor,
} from '../utils/helperPaletteSnippets.js';

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
      description: 'When true, pass the current viewport face/edge selection as context',
    };
  }
  if (item?.id === 'move') {
    // The body to move, by one of these. Nothing given uses the selected
    // face; nothing selected is no_body (the origin is never assumed).
    properties.body_index = { type: 'integer', minimum: 0, description: 'Body from list_bodies' };
    properties.at = {
      type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
      description: 'Body centroid [x, y, z] mm from list_bodies',
    };
    properties.face_id = { type: 'string', description: 'A list_faces id (f12) on the body to move' };
    properties.face = { type: 'object', description: 'A list_faces key { at, n, area } on the body to move' };
  }
  for (const param of item?.params || []) {
    if (param.type === 'number') {
      properties[param.name] = { type: 'number' };
      if (Number.isFinite(param.min)) properties[param.name].minimum = param.min;
      if (Number.isFinite(param.max)) properties[param.name].maximum = param.max;
    } else if (param.type === 'bool') {
      properties[param.name] = { type: 'boolean' };
    } else if (param.type === 'select' && Array.isArray(param.options)) {
      const allowed = param.options.map((row) => (
        row && typeof row === 'object' && 'value' in row ? row.value : row
      ));
      properties[param.name] = { type: 'string', enum: allowed };
    } else if (param.type === 'string') {
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
  return example;
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
  return merged;
}

function helperLabel(item) {
  return item?.label || item?.id || 'Helper';
}

function fieldName(param) {
  if (param?.label && param.label !== param.name) return `${param.label} (${param.name})`;
  return param?.label || param?.name || 'value';
}

export function validateHelperParams(item, params) {
  const label = helperLabel(item);
  for (const param of item.params || []) {
    if (!Object.prototype.hasOwnProperty.call(params, param.name)) continue;
    const value = params[param.name];
    if (param.type === 'number') {
      if (!Number.isFinite(Number(value))) {
        return { code: 'bad_args', message: `${label} ${fieldName(param)} must be a finite number.` };
      }
      const n = Number(value);
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
  const params = ctx.params && typeof ctx.params === 'object' ? ctx.params : {};
  const edgeCount = Array.isArray(ctx.edgeContext) ? ctx.edgeContext.length : 0;
  const face = ctx.faceContext;
  const hasFace = !!(face && (face.type || face.center || face.key || face.normal));

  if (id === 'move') {
    const bits = ['dx', 'dy', 'dz']
      .map((name) => (Number.isFinite(Number(params[name])) ? `${name} ${Number(params[name])}` : null))
      .filter(Boolean);
    const where = bits.length ? ` (${bits.join(', ')} mm)` : '';
    return `Move refused${where}. Each axis must be a finite translation from -1000 to 1000 mm.`;
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
