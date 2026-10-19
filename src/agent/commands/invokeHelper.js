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
import { trackPaletteFeature } from '../../utils/analytics.js';

/** insert_move target fields, top level or inside params. */
export function moveTargetArgs(args) {
  const bag = args?.params && typeof args.params === 'object' ? args.params : {};
  const pick = (key) => (args?.[key] !== undefined ? args[key] : bag[key]);
  return {
    at: pick('at') ?? null,
    face: pick('face') ?? null,
    faceId: pick('face_id') ?? null,
    bodyIndex: pick('body_index') ?? null,
    useSelection: args?.use_selection === true,
  };
}

/** Shape check for the move target before the host resolves it. */
export function checkMoveTargetArgs(args) {
  const target = moveTargetArgs(args);
  if (target.at != null) {
    const at = Array.isArray(target.at) ? target.at : [];
    if (at.length !== 3 || at.some((v) => !Number.isFinite(Number(v)))) {
      return { code: 'bad_args', message: 'insert_move at must be [x, y, z] in mm (a body centroid from list_bodies)' };
    }
  }
  if (target.bodyIndex != null && !(Number.isInteger(target.bodyIndex) && target.bodyIndex >= 0)) {
    return { code: 'bad_args', message: 'insert_move body_index must be a non-negative integer from list_bodies' };
  }
  if (target.faceId != null && typeof target.faceId !== 'string') {
    return { code: 'bad_args', message: 'insert_move face_id must be a list_faces id like f12' };
  }
  if (target.face != null && (typeof target.face !== 'object' || Array.isArray(target.face))) {
    return { code: 'bad_args', message: 'insert_move face must be a list_faces key { at, n, area }' };
  }
  return null;
}

async function runHelperInsert(ctx, helperId, args) {
  const item = HELPER_PALETTE_ITEMS.find((row) => row.id === helperId);
  if (!item) {
    return { error: { code: 'unknown_helper', message: `Unknown helper id: ${helperId}` } };
  }
  let params = coerceHelperParams(item, args);
  const refused = validateHelperParams(item, params);
  if (refused) return { error: refused };
  if (helperId === 'move') {
    // The body is named by the agent (body_index, at, face, face_id) or the
    // selection, never assumed to sit at the origin. The host snaps the
    // anchor to the kernel centroid move() checks against.
    const badTarget = checkMoveTargetArgs(args);
    if (badTarget) return { error: badTarget };
    const resolve = ctx.resolveMoveAnchor;
    if (typeof resolve !== 'function') {
      return { error: { code: 'internal', message: 'resolveMoveAnchor handler is missing' } };
    }
    const anchor = await Promise.resolve(resolve(moveTargetArgs(args)));
    if (anchor?.error) return { error: anchor.error };
    if (!Array.isArray(anchor?.at)) {
      return { error: { code: 'no_body', message: 'insert_move needs a body: pass body_index or at (from list_bodies), face or face_id (from list_faces), or select a face first.' } };
    }
    params = { ...params, at: anchor.at.slice(0, 3).map(Number) };
  }
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
  trackPaletteFeature(helperId);
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
      const bad = validateHelperParams(item, params);
      if (bad) return bad;
      return item.id === 'move' ? checkMoveTargetArgs(args) : null;
    },
    async run(ctx, args) {
      return runHelperInsert(ctx, item.id, args);
    },
  }));
}
