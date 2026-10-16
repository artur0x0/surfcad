import { runContourGestureMutate } from './contourGestureMutate.js';

const PICK_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['point', 'line', 'arc', 'ref'] },
      id: { type: 'string' },
    },
  },
};

export const sketchDimensionCommand = Object.freeze({
  name: 'sketch_dimension',
  uiEntry: Object.freeze(['dimension', 'data-contour-gesture-card']),
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['length', 'angle', 'distance', 'offset', 'radius'] },
      value: { type: 'number' },
      value_mm: { type: 'number' },
      name: { type: 'string' },
      side: { type: 'number' },
      sense: { type: 'number' },
      dimension_id: { type: 'string', description: 'Edit an existing dimension' },
      picks: PICK_SCHEMA,
      targets: PICK_SCHEMA,
      edge: { type: 'string', description: 'Shorthand line id for length' },
      line: { type: 'string' },
      arc: { type: 'string' },
      point: { type: 'string' },
      a: { type: 'string' },
      b: { type: 'string' },
    },
  }),
  example: Object.freeze({ kind: 'length', edge: 'e0', value: 30 }),
  async run(ctx, args) {
    const prepare = ctx.prepareSketchDimension;
    if (typeof prepare !== 'function') {
      return { error: { code: 'internal', message: 'prepareSketchDimension handler is missing' } };
    }
    return runContourGestureMutate(ctx, {
      label: 'Contour dimension',
      prepare: () => prepare(args || {}),
    });
  },
});
