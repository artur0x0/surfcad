import {
  coerceHelperParams,
  describeHelperRefusal,
  exampleArgsForHelper,
  helperCommandName,
  isKnownHelperId,
  schemaPropertiesForHelper,
  selectionContextFromArgs,
  validateHelperParams,
} from '../helperPaletteAgent.js';
import { HELPER_PALETTE_ITEMS } from '../../utils/helperPaletteSnippets.js';
import { helperUiEntries } from '../helperUiEntryExtras.js';

async function runHelperInsert(ctx, helperId, args) {
  const item = HELPER_PALETTE_ITEMS.find((row) => row.id === helperId);
  if (!item) {
    return { error: { code: 'unknown_helper', message: `Unknown helper id: ${helperId}` } };
  }
  const params = coerceHelperParams(item, args);
  const refused = validateHelperParams(item, params);
  if (refused) return { error: refused };
  const { faceContext, edgeContext } = selectionContextFromArgs(ctx, args);
  const prepare = ctx.prepareHelperInsert;
  if (typeof prepare !== 'function') {
    return { error: { code: 'internal', message: 'prepareHelperInsert handler is missing' } };
  }
  const prepared = prepare({
    helperId,
    params,
    faceContext,
    edgeContext,
  });
  if (prepared?.error) return { error: prepared.error };
  const source = typeof prepared?.source === 'string' ? prepared.source : null;
  if (!source) {
    return {
      error: {
        code: 'insert_failed',
        message: describeHelperRefusal(item, { params, faceContext, edgeContext }),
      },
    };
  }
  const result = await ctx.mutate(source, `Agent helper: ${helperId}`);
  return { result: { helperId, ...result } };
}

export const invokeHelperCommand = Object.freeze({
  name: 'invoke_helper',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'HELPER_PALETTE_ITEMS id' },
      params: {
        type: 'object',
        additionalProperties: true,
        description: 'HelperParamModal values (defaults apply when omitted)',
      },
      use_selection: {
        type: 'boolean',
        description: 'Pass current viewport face/edge picks as compose context',
      },
    },
  }),
  example: Object.freeze({ id: 'cube', params: {} }),
  checkArgs(args) {
    if (typeof args?.id !== 'string' || !args.id) {
      return { code: 'bad_args', message: 'invoke_helper needs id' };
    }
    if (!isKnownHelperId(args.id)) {
      return { code: 'unknown_helper', message: `Unknown helper id: ${args.id}` };
    }
    const item = HELPER_PALETTE_ITEMS.find((row) => row.id === args.id);
    const params = coerceHelperParams(item, args);
    return validateHelperParams(item, params);
  },
  async run(ctx, args) {
    return runHelperInsert(ctx, args.id, args);
  },
});

/** One registry command per palette item (coverage uiEntry = helper id). */
export function buildHelperPaletteCommands() {
  return HELPER_PALETTE_ITEMS.map((item) => Object.freeze({
    name: helperCommandName(item.id),
    uiEntry: helperUiEntries(item.id),
    schema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: schemaPropertiesForHelper(item, { includeId: false }),
    }),
    example: Object.freeze(exampleArgsForHelper(item)),
    checkArgs(args) {
      const params = coerceHelperParams(item, args);
      return validateHelperParams(item, params);
    },
    async run(ctx, args) {
      return runHelperInsert(ctx, item.id, args);
    },
  }));
}
