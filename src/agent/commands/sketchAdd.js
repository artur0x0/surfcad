import { normalizeSketchTool, sketchParamsFromArgs } from '../sketchAgent.js';

export const sketchAddCommand = Object.freeze({
  name: 'sketch_add',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      tool: {
        type: 'string',
        description: 'circle | rectangle | polygon | polyline | cursor',
      },
      width: { type: 'number' },
      height: { type: 'number' },
      centered: { type: 'boolean' },
      radius: { type: 'number' },
      segments: { type: 'number' },
      polygon_preset: { type: 'string' },
      polygonPreset: { type: 'string', description: 'Alias for polygon_preset' },
      centers: { type: 'boolean', description: 'Rectangle: place by centers' },
      params: {
        type: 'object',
        additionalProperties: true,
        description: 'Extra contour params merged over the tool defaults (same keys the sketch card edits)',
      },
      points: {
        type: 'array',
        items: {
          type: 'array',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
        },
      },
    },
  }),
  example: Object.freeze({ tool: 'rectangle', width: 30, height: 20 }),
  uiEntry: Object.freeze([
    'rectangle',
    'cursor',
    'circle',
    'polygon',
    'polyline',
    'arc',
    'dimension',
    'constraints',
  ]),
  checkArgs(args) {
    const tool = normalizeSketchTool(args?.tool || 'rectangle');
    if (!tool) return { code: 'bad_args', message: 'sketch_add needs a supported tool' };
    return null;
  },
  run(ctx, args) {
    const add = ctx.sketchAdd;
    if (typeof add !== 'function') {
      return { error: { code: 'internal', message: 'sketchAdd handler is missing' } };
    }
    const tool = normalizeSketchTool(args?.tool || 'rectangle');
    if (!tool) {
      return { error: { code: 'bad_args', message: 'sketch_add needs a supported tool' } };
    }
    const params = sketchParamsFromArgs(tool, args || {});
    const extra = args?.params;
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      Object.assign(params, extra);
    }
    const out = add({ tool, params });
    if (out?.error) return { error: out.error };
    return { result: { tool, ...(out?.result || {}) } };
  },
});
