import { isSolidContourEntry } from '../../utils/contourMode.js';

export const slotOpenCommand = Object.freeze({
  name: 'slot_open',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['kind'],
    properties: {
      kind: {
        type: 'string',
        enum: ['makeExtrude', 'makeRevolve', 'makeLoft', 'makeSweep'],
      },
    },
  }),
  example: Object.freeze({ kind: 'makeExtrude' }),
  uiEntry: 'makeExtrude',
  checkArgs(args) {
    if (!isSolidContourEntry(args?.kind)) {
      return { code: 'bad_args', message: 'slot_open kind must be makeExtrude, makeRevolve, makeLoft, or makeSweep' };
    }
    return null;
  },
  run(ctx, args) {
    const open = ctx.slotOpen;
    if (typeof open !== 'function') {
      return { error: { code: 'internal', message: 'slotOpen handler is missing' } };
    }
    const out = open({ kind: args.kind });
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? { kind: args.kind } };
  },
});
