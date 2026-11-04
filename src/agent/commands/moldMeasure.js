/**
 * Show or hide the Measurements section of the molding results pane: part
 * volume, projected area along the pull, and extents, in inches or
 * centimetres. The viewport handler measures the active part mesh (the same
 * numbers the mold report uses) and returns them. Read-only.
 */

const SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    on: {
      type: 'boolean',
      description: 'true shows the measurements. false hides them. Omit to toggle.',
    },
    unit: {
      type: 'string',
      enum: ['in', 'cm'],
      description: 'Display unit for the pane and the display strings. Inches by default; the choice is remembered in this browser.',
    },
  },
});

export const moldMeasureCommand = Object.freeze({
  name: 'mold_measure',
  uiEntry: Object.freeze(['data-mold-measure', 'data-mold-measure-unit-in', 'data-mold-measure-unit-cm']),
  schema: SCHEMA,
  example: { on: true, unit: 'in' },
  immediate: true,
  checkArgs(args) {
    if (args?.unit != null && args.unit !== 'in' && args.unit !== 'cm') {
      return { code: 'bad_args', message: 'unit must be in or cm' };
    }
    return null;
  },
  async run(ctx, args) {
    const show = ctx.moldMeasure;
    if (typeof show !== 'function') {
      return { error: { code: 'internal', message: 'moldMeasure handler is missing' } };
    }
    const out = await show({ on: args?.on, unit: args?.unit });
    if (out?.error) return { error: out.error };
    return { result: out };
  },
});
