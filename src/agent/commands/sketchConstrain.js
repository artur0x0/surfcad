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

export const sketchConstrainCommand = Object.freeze({
  name: 'sketch_constrain',
  uiEntry: Object.freeze(['constraints', 'data-contour-gesture-card']),
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: {
        type: 'string',
        enum: [
          'horizontal',
          'vertical',
          'parallel',
          'perpendicular',
          'tangent',
          'equal',
          'coincident',
          'fix',
        ],
      },
      side: { type: 'number', description: 'Tangent side when kind is tangent' },
      constraint_id: { type: 'string', description: 'Edit an existing constraint' },
      picks: PICK_SCHEMA,
      targets: PICK_SCHEMA,
      a: { type: 'string' },
      b: { type: 'string' },
      line: { type: 'string' },
      point: { type: 'string' },
    },
  }),
  example: Object.freeze({ kind: 'horizontal', picks: [{ kind: 'line', id: 'e1' }] }),
  async run(ctx, args) {
    const prepare = ctx.prepareSketchConstrain;
    if (typeof prepare !== 'function') {
      return { error: { code: 'internal', message: 'prepareSketchConstrain handler is missing' } };
    }
    return runContourGestureMutate(ctx, {
      label: 'Contour constraint',
      prepare: () => prepare(args || {}),
    });
  },
});
