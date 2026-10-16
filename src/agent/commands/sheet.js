import { NO_ARGS_SCHEMA } from '../schemas/common.js';
import { sheetParamsFromArgs, sheetPickRowsFromArgs, sheetToolFromArgs } from '../sheetAgent.js';
import { runSheetWrite } from './runSheetCommit.js';

function hostCall(ctx, name, args) {
  const fn = ctx[name];
  if (typeof fn !== 'function') {
    return { error: { code: 'internal', message: `${name} handler is missing` } };
  }
  const out = fn(args);
  if (out?.error) return { error: out.error };
  return { result: out?.result ?? out };
}

export const sheetOpenCommand = Object.freeze({
  name: 'sheet_open',
  uiEntry: ['data-sheet-metal-button', 'data-sheet-metal-picker'],
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'sheetOpen');
  },
});

export const sheetStartCommand = Object.freeze({
  name: 'sheet_start',
  uiEntry: 'data-sheet-metal-start',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      sku: { type: 'string', description: 'SendCutSend SKU from the catalog' },
      material: { type: 'string', description: 'Optional material name when sku is omitted' },
    },
  }),
  example: { sku: 'ALU-090' },
  checkArgs(args) {
    if (!args?.sku && !args?.material) {
      return { code: 'bad_args', message: 'sheet_start needs sku or material' };
    }
    return null;
  },
  async run(ctx, args) {
    const fn = ctx.sheetStart;
    if (typeof fn !== 'function') {
      return { error: { code: 'internal', message: 'sheetStart handler is missing' } };
    }
    const out = await fn(args);
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? out };
  },
});

export const sheetSetToolCommand = Object.freeze({
  name: 'sheet_set_tool',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['tool'],
    properties: {
      tool: {
        type: 'string',
        enum: ['tab', 'bend', 'hole', 'countersink', 'tapped'],
      },
    },
  }),
  example: { tool: 'bend' },
  checkArgs(args) {
    const built = sheetToolFromArgs(args);
    return built.error ? built.error : null;
  },
  run(ctx, args) {
    const built = sheetToolFromArgs(args);
    if (built.error) return { error: built.error };
    return hostCall(ctx, 'sheetSetTool', { tool: built.tool });
  },
});

export const sheetSetParamsCommand = Object.freeze({
  name: 'sheet_set_params',
  uiEntry: 'data-sheet-metal-base',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      plane: { type: 'string', enum: ['XY', 'XZ', 'YZ'] },
      width: { type: 'number' },
      height: { type: 'number' },
      angle: { type: 'number' },
      length: { type: 'number' },
      flip: { type: 'boolean' },
      depth: { type: 'number' },
      centered: { type: 'boolean' },
      offset: { type: 'number' },
      d: { type: 'number' },
      u: { type: 'number' },
      v: { type: 'number' },
      thread: { type: 'string' },
      cskDia: { type: 'number' },
      cskAngle: { type: 'number' },
      r: { type: 'number', description: 'Inner bend radius (mm) on the live spec' },
      k: { type: 'number', description: 'K-factor on the live spec' },
      t: { type: 'number', description: 'Thickness (mm) on the live spec' },
      sku: { type: 'string', description: 'Rebind gauge / thickness from catalog' },
      material: { type: 'string' },
    },
  }),
  example: { width: 80, height: 50 },
  checkArgs(args) {
    const built = sheetParamsFromArgs(args);
    return built.error ? built.error : null;
  },
  async run(ctx, args) {
    const built = sheetParamsFromArgs(args);
    if (built.error) return { error: built.error };
    const fn = ctx.sheetSetParams;
    if (typeof fn !== 'function') {
      return { error: { code: 'internal', message: 'sheetSetParams handler is missing' } };
    }
    const out = await fn({ patch: built.patch });
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? out };
  },
});

export const sheetPickCommand = Object.freeze({
  name: 'sheet_pick',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      plane: { type: 'string', enum: ['XY', 'XZ', 'YZ'] },
      panel: { type: 'string' },
      edge: { type: 'string', enum: ['u+', 'u-', 'v+', 'v-'] },
      ref_key: { type: 'string' },
      chip_id: { type: 'string' },
      kind: { type: 'string', enum: ['hole'] },
      picks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            plane: { type: 'string' },
            panel: { type: 'string' },
            edge: { type: 'string' },
            ref_key: { type: 'string' },
            chip_id: { type: 'string' },
            kind: { type: 'string' },
          },
        },
      },
    },
  }),
  example: { panel: 'base', edge: 'u+' },
  checkArgs(args) {
    const built = sheetPickRowsFromArgs(args);
    return built.error ? built.error : null;
  },
  run(ctx, args) {
    const built = sheetPickRowsFromArgs(args);
    if (built.error) return { error: built.error };
    return hostCall(ctx, 'sheetApplyPicks', { picks: built.picks });
  },
});

export const sheetCommitCommand = Object.freeze({
  name: 'sheet_commit',
  uiEntry: 'data-sm-accept',
  schema: NO_ARGS_SCHEMA,
  example: {},
  async run(ctx) {
    return runSheetWrite(ctx, {
      prepare: () => ctx.prepareSheetCommit?.(),
      finish: (prepared) => ctx.finishSheetCommit?.(prepared),
      label: 'Sheet metal',
    });
  },
});

export const sheetCancelCommand = Object.freeze({
  name: 'sheet_cancel',
  uiEntry: 'data-sm-back',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'sheetCancel');
  },
});

export const sheetExitCommand = Object.freeze({
  name: 'sheet_exit',
  uiEntry: ['data-sheet-metal-exit', 'data-sheet-metal-mode-chip'],
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'sheetExit');
  },
});

export const sheetCheckCommand = Object.freeze({
  name: 'sheet_check',
  uiEntry: 'data-sm-check',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'sheetCheck');
  },
});

export const sheetRefoldCommand = Object.freeze({
  name: 'sheet_refold',
  uiEntry: 'data-sheet-metal-export',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    return hostCall(ctx, 'sheetRefold');
  },
});

export const sheetDoneCommand = Object.freeze({
  name: 'sheet_done',
  uiEntry: 'data-sm-done',
  schema: NO_ARGS_SCHEMA,
  example: {},
  async run(ctx) {
    return runSheetWrite(ctx, {
      prepare: () => ctx.prepareSheetDone?.(),
      finish: (prepared) => ctx.finishSheetDone?.(prepared),
      label: 'Sheet metal',
    });
  },
});

const SHEET_EDIT_PARAM_PROPERTIES = sheetSetParamsCommand.schema.properties;

export const sheetEditCommand = Object.freeze({
  name: 'sheet_edit',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      chip_id: { type: 'string', description: 'Sheet ribbon chip id (sheet:base, sheet:bend:b1, …)' },
      feature_id: { type: 'string', description: 'Sheet-metal marker id from feature_tree' },
      ...SHEET_EDIT_PARAM_PROPERTIES,
    },
  }),
  example: { chip_id: 'sheet:base' },
  checkArgs(args) {
    if (!args?.chip_id && !args?.feature_id) {
      const built = sheetParamsFromArgs(args);
      if (built.error) return built.error;
      if (!Object.keys(built.patch).length) {
        return { code: 'bad_args', message: 'sheet_edit needs chip_id, feature_id, or params to patch' };
      }
    }
    return null;
  },
  async run(ctx, args) {
    const fn = ctx.sheetEdit;
    if (typeof fn !== 'function') {
      return { error: { code: 'internal', message: 'sheetEdit handler is missing' } };
    }
    const built = sheetParamsFromArgs(args);
    if (built.error) return { error: built.error };
    const out = await fn({
      chip_id: args?.chip_id,
      feature_id: args?.feature_id,
      patch: built.patch,
    });
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? out };
  },
});

export const sheetBeginHoleCommand = Object.freeze({
  name: 'sheet_begin_hole',
  uiEntry: 'data-sm-next',
  schema: NO_ARGS_SCHEMA,
  example: {},
  run(ctx) {
    return hostCall(ctx, 'sheetBeginHole');
  },
});
