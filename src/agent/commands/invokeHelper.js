import {
  coerceHelperParams,
  describeHelperRefusal,
  exampleArgsForHelper,
  helperCommandName,
  helperReadsSelection,
  isKnownHelperId,
  USE_SELECTION_NOTE,
  schemaPropertiesForHelper,
  selectionContextFromArgs,
  validateHelperParams,
} from '../helperPaletteAgent.js';
import { HELPER_PALETTE_ITEMS } from '../../utils/helperPaletteSnippets.js';
import { helperUiEntries } from '../helperUiEntryExtras.js';
import { trackPaletteFeature } from '../../utils/analytics.js';

/** Helpers that act on one named body (insert_move, insert_rotate): the host resolves the target. */
export const BODY_TARGET_HELPERS = Object.freeze(new Set(['move', 'rotate', 'mirror']));

/** insert_move / insert_rotate target fields, top level or inside params. */
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

/** Shape check for the body target before the host resolves it. */
export function checkMoveTargetArgs(args, name = 'insert_move') {
  const target = moveTargetArgs(args);
  if (target.at != null) {
    const at = Array.isArray(target.at) ? target.at : [];
    if (at.length !== 3 || at.some((v) => !Number.isFinite(Number(v)))) {
      return { code: 'bad_args', message: `${name} at must be [x, y, z] in mm (a body centroid from list_bodies)` };
    }
  }
  if (target.bodyIndex != null && !(Number.isInteger(target.bodyIndex) && target.bodyIndex >= 0)) {
    return { code: 'bad_args', message: `${name} body_index must be a non-negative integer from list_bodies` };
  }
  if (target.faceId != null && typeof target.faceId !== 'string') {
    return { code: 'bad_args', message: `${name} face_id must be a list_faces id like f12` };
  }
  if (target.face != null && (typeof target.face !== 'object' || Array.isArray(target.face))) {
    return { code: 'bad_args', message: `${name} face must be a list_faces key { at, n, area }` };
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
  const target = moveTargetArgs(args);
  const namesBody = target.at != null || target.face != null || target.faceId != null || target.bodyIndex != null || target.useSelection;
  // Mirror of the whole part needs no body: the card's Body field defaults to
  // `part`, and the documented { body: "part" } used to be refused as no_body
  // (follow-up 5). Move and rotate still name one body.
  if (BODY_TARGET_HELPERS.has(helperId) && !(helperId === 'mirror' && !namesBody)) {
    // The body is named by the agent (body_index, at, face, face_id) or the
    // selection, never assumed to sit at the origin. The host snaps the
    // anchor to the kernel centroid move() / rotateAbout() check against.
    const badTarget = checkMoveTargetArgs(args, helperCommandName(helperId));
    if (badTarget) return { error: badTarget };
    const resolve = ctx.resolveMoveAnchor;
    if (typeof resolve !== 'function') {
      return { error: { code: 'internal', message: 'resolveMoveAnchor handler is missing' } };
    }
    const anchor = await Promise.resolve(resolve(moveTargetArgs(args)));
    if (anchor?.error) return { error: anchor.error };
    if (!Array.isArray(anchor?.at)) {
      return { error: { code: 'no_body', message: `${helperCommandName(helperId)} needs a body: pass body_index or at (from list_bodies), face or face_id (from list_faces), or select a face first.` } };
    }
    params = { ...params, at: anchor.at.slice(0, 3).map(Number) };
  }
  const { faceContext, edgeContext } = selectionContextFromArgs(ctx, args);
  // The selection is single-use: the viewport clears picks after every
  // rebuild because they index the old mesh. An explicit use_selection with
  // nothing selected is refused rather than quietly built on the default
  // face or edge set. insert_move / insert_rotate resolve their body on the host (no_body).
  const wantsSelection = args?.use_selection === true && !BODY_TARGET_HELPERS.has(helperId) && helperReadsSelection(helperId);
  const moveTarget = BODY_TARGET_HELPERS.has(helperId) ? moveTargetArgs(args) : null;
  const usedSelection = moveTarget
    ? moveTarget.useSelection && moveTarget.bodyIndex == null && moveTarget.at == null
      && moveTarget.face == null && moveTarget.faceId == null
    : Boolean(faceContext || edgeContext);
  if (wantsSelection && !usedSelection) {
    return {
      error: {
        code: 'no_selection',
        message: `${item.label || helperId}: use_selection is true but nothing is selected. A face pick with a name survives rebuilds; edge picks and unnamed faces clear after every rebuild (each insert_*, set_script, undo): pick again with select_faces / pick_faces / select_edges or pick_begin … pick_done, then insert. Omit use_selection to use the helper default.`,
      },
    };
  }
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
  return { result: { helperId, usedSelection, ...result } };
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
        description: `Pass current viewport face/edge picks as compose context.${USE_SELECTION_NOTE}`,
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
      return BODY_TARGET_HELPERS.has(item.id) ? checkMoveTargetArgs(args, helperCommandName(item.id)) : null;
    },
    async run(ctx, args) {
      return runHelperInsert(ctx, item.id, args);
    },
  }));
}
