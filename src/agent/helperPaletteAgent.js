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
  const defaults = defaultParamsFor(item.id);
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(bag)) {
    if (names.has(key)) merged[key] = value;
  }
  return merged;
}

export function validateHelperParams(item, params) {
  for (const param of item.params || []) {
    if (!Object.prototype.hasOwnProperty.call(params, param.name)) continue;
    const value = params[param.name];
    if (param.type === 'number') {
      if (!Number.isFinite(Number(value))) {
        return { code: 'bad_args', message: `${param.name} must be a number` };
      }
      const n = Number(value);
      if (Number.isFinite(param.min) && n < param.min) {
        return { code: 'bad_args', message: `${param.name} must be >= ${param.min}` };
      }
      if (Number.isFinite(param.max) && n > param.max) {
        return { code: 'bad_args', message: `${param.name} must be <= ${param.max}` };
      }
    }
    if (param.type === 'bool' && typeof value !== 'boolean') {
      return { code: 'bad_args', message: `${param.name} must be a boolean` };
    }
    if (param.type === 'select' && Array.isArray(param.options)) {
      const allowed = param.options.map((row) => (
        row && typeof row === 'object' && 'value' in row ? row.value : row
      ));
      if (!allowed.includes(value)) {
        return { code: 'bad_args', message: `${param.name} must be one of: ${allowed.join(', ')}` };
      }
    }
  }
  return null;
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
