import { SHEET_PLANES } from '../utils/sheetMetal/sheetModel.js';
import { SHEET_TOOLS } from '../utils/sheetMetal/sheetMetalMode.js';

const SHEET_TOOL_IDS = new Set(SHEET_TOOLS.map((t) => t.id));
const PLANE_IDS = new Set(Object.keys(SHEET_PLANES));

export function sheetToolFromArgs(args) {
  const tool = args?.tool != null ? String(args.tool) : '';
  if (!SHEET_TOOL_IDS.has(tool)) {
    return {
      error: {
        code: 'bad_args',
        message: `sheet tool must be one of: ${[...SHEET_TOOL_IDS].join(', ')}`,
      },
    };
  }
  return { tool };
}

export function sheetParamsFromArgs(args) {
  const patch = {};
  const bag = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  if (bag.plane != null) {
    const plane = String(bag.plane);
    if (!PLANE_IDS.has(plane)) {
      return { error: { code: 'bad_args', message: `plane must be one of: ${[...PLANE_IDS].join(', ')}` } };
    }
    patch.plane = plane;
  }
  for (const key of ['width', 'height', 'angle', 'length', 'depth', 'd', 'u', 'v', 'cskDia', 'cskAngle', 'offset', 'r', 'k', 't']) {
    if (bag[key] !== undefined && bag[key] !== '') {
      const n = Number(bag[key]);
      if (!Number.isFinite(n)) {
        return { error: { code: 'bad_args', message: `${key} must be a finite number` } };
      }
      patch[key] = n;
    }
  }
  if (bag.flip !== undefined) patch.flip = bag.flip === true;
  if (bag.centered !== undefined) patch.centered = bag.centered !== false;
  if (bag.thread != null) patch.thread = String(bag.thread);
  if (bag.sku != null) patch.sku = String(bag.sku);
  if (bag.material != null) patch.material = String(bag.material);
  return { patch };
}

export function sheetPickRowsFromArgs(args) {
  if (Array.isArray(args?.picks) && args.picks.length) {
    const rows = [];
    for (const row of args.picks) {
      const built = sheetPickRowFromArgs(row);
      if (built.error) return built;
      rows.push(built.pick);
    }
    return { picks: rows };
  }
  const single = sheetPickRowFromArgs(args);
  if (single.error) return single;
  if (!single.pick) {
    return { error: { code: 'bad_args', message: 'sheet_pick needs plane, panel+edge, ref_key, chip_id, or picks[]' } };
  }
  return { picks: [single.pick] };
}

function sheetPickRowFromArgs(args) {
  if (!args || typeof args !== 'object') {
    return { error: { code: 'bad_args', message: 'sheet_pick needs a pick object' } };
  }
  if (args.chip_id != null) {
    return { pick: { kind: 'chip', chip_id: String(args.chip_id) } };
  }
  if (args.plane != null) {
    const plane = String(args.plane);
    if (!PLANE_IDS.has(plane)) {
      return { error: { code: 'bad_args', message: `plane must be one of: ${[...PLANE_IDS].join(', ')}` } };
    }
    return { pick: { kind: 'plane', plane } };
  }
  if (args.ref_key != null) {
    return { pick: { kind: 'edge', ref_key: String(args.ref_key) } };
  }
  if (args.panel != null && args.edge != null) {
    return { pick: { kind: 'edge', panel: String(args.panel), edge: String(args.edge) } };
  }
  if (args.panel != null && args.kind === 'hole') {
    return { pick: { kind: 'panel', panel: String(args.panel) } };
  }
  return { pick: null };
}
