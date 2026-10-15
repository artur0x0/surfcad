/**
 * Pure helpers for agent sketch_add args → contour tool params.
 */

import { defaultContourParams, isContourTool } from '../utils/contourMode.js';

const TOOL_ALIASES = Object.freeze({
  rect: 'rectangle',
  line: 'polyline',
  poly: 'polyline',
});

export function normalizeSketchTool(raw) {
  const id = String(raw || 'rectangle').toLowerCase();
  const mapped = TOOL_ALIASES[id] || id;
  return isContourTool(mapped) ? mapped : null;
}

/**
 * @param {string} tool
 * @param {object} args command args (width, height, radius, points, …)
 */
export function sketchParamsFromArgs(tool, args = {}) {
  const base = { ...defaultContourParams(tool) };
  if (tool === 'rectangle') {
    if (args.width != null) base.width = Number(args.width);
    if (args.height != null) base.height = Number(args.height);
    if (args.centered != null) base.centered = !!args.centered;
  } else if (tool === 'circle') {
    if (args.radius != null) base.radius = Number(args.radius);
    if (args.segments != null) base.segments = Math.round(Number(args.segments));
  } else if (tool === 'polygon') {
    if (args.polygon_preset != null) base.polygonPreset = String(args.polygon_preset);
    if (args.polygonPreset != null) base.polygonPreset = String(args.polygonPreset);
    if (args.radius != null) base.radius = Number(args.radius);
  } else if (tool === 'polyline' || tool === 'cursor') {
    if (Array.isArray(args.points)) {
      base.points = args.points.map((row) => [Number(row[0]), Number(row[1])]);
    }
  }
  return base;
}
