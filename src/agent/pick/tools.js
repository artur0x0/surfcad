/**
 * Picker cards an agent pick session can drive (H9).
 *
 * Each row is a card the left rail opens with its mode chip. `kind` is what
 * a tap on that card picks. `params` are the card fields `pick_begin` may
 * set before picking, the same inputs the card shows.
 */

export const PICK_TOOLS = Object.freeze({
  filletEdges: Object.freeze({
    kind: 'edge',
    viewport: 'fillet',
    uiEntry: 'data-fillet-mode-chip',
    params: Object.freeze({ radius: 'positive' }),
  }),
  chamferEdges: Object.freeze({
    kind: 'edge',
    viewport: 'chamfer',
    uiEntry: 'data-chamfer-mode-chip',
    params: Object.freeze({ chamfer: 'positive' }),
  }),
  shell: Object.freeze({
    kind: 'face',
    viewport: 'shell',
    uiEntry: 'data-shell-mode-chip',
    params: Object.freeze({ wall: 'positive', openingMode: Object.freeze(['face', 'none']) }),
  }),
  addDraft: Object.freeze({
    kind: 'face',
    viewport: 'draft',
    uiEntry: 'data-draft-mode-chip',
    params: Object.freeze({ angle: 'positive', flip: 'boolean' }),
  }),
  moveFace: Object.freeze({
    kind: 'face',
    viewport: 'moveFace',
    uiEntry: 'data-move-face-mode-chip',
    params: Object.freeze({ distance: 'number', flip: 'boolean' }),
  }),
  deleteFace: Object.freeze({
    kind: 'face',
    viewport: 'deleteFace',
    uiEntry: 'data-delete-face-mode-chip',
    params: Object.freeze({}),
  }),
});

export const PICK_TOOL_IDS = Object.freeze(Object.keys(PICK_TOOLS));

export const PICK_KINDS = Object.freeze(['face', 'edge']);

/** `pick_begin` uiEntry: the mode chips of every card it can open. */
export const PICK_TOOL_UI_ENTRIES = Object.freeze(PICK_TOOL_IDS.map((id) => PICK_TOOLS[id].uiEntry));

/** Null when `params` fit the tool's card, else a `bad_args` error. */
export function checkToolParams(tool, params) {
  if (params == null) return null;
  if (typeof params !== 'object' || Array.isArray(params)) {
    return { code: 'bad_args', message: 'params must be an object' };
  }
  const spec = PICK_TOOLS[tool];
  if (!spec) return { code: 'bad_args', message: 'params need a picker card (tool)' };
  for (const [name, value] of Object.entries(params)) {
    const rule = spec.params[name];
    if (!rule) {
      const known = Object.keys(spec.params);
      return {
        code: 'bad_args',
        message: known.length
          ? `${tool} params are ${known.join(', ')}; got ${name}`
          : `${tool} takes no params; got ${name}`,
      };
    }
    if (Array.isArray(rule)) {
      if (!rule.includes(value)) return { code: 'bad_args', message: `${name} must be one of: ${rule.join(', ')}` };
    } else if (rule === 'boolean') {
      if (typeof value !== 'boolean') return { code: 'bad_args', message: `${name} must be a boolean` };
    } else if (rule === 'positive') {
      if (!(typeof value === 'number' && Number.isFinite(value) && value > 0)) {
        return { code: 'bad_args', message: `${name} must be a number > 0` };
      }
    } else if (!(typeof value === 'number' && Number.isFinite(value))) {
      return { code: 'bad_args', message: `${name} must be a number` };
    }
  }
  return null;
}

/**
 * Which consumer a tap would feed right now, from the Viewport's mode refs.
 * `target` is a PICK_TOOLS id, `'selection'`, or null when something else
 * owns the canvas; then `busy` names it.
 *
 * @param {{
 *   game?: boolean, fillet?: { entry?: string } | null, shell?: boolean,
 *   draft?: boolean, moveFace?: boolean, deleteFace?: boolean, cut?: boolean,
 *   boolean?: boolean, move?: boolean, contour?: boolean, featureSlot?: boolean,
 *   paint?: boolean, measure?: boolean, sheetMetal?: boolean, hole?: boolean,
 *   joints?: boolean, fea?: boolean, featureEdit?: boolean,
 * }} modes
 */
export function pickTargetFrom(modes = {}) {
  if (modes.game) return { target: null, kind: null, busy: 'game' };
  let tool = null;
  if (modes.fillet) tool = modes.fillet.entry === 'chamferEdges' ? 'chamferEdges' : 'filletEdges';
  else if (modes.shell) tool = 'shell';
  else if (modes.draft) tool = 'addDraft';
  else if (modes.moveFace) tool = 'moveFace';
  else if (modes.deleteFace) tool = 'deleteFace';
  if (tool) return { target: tool, kind: PICK_TOOLS[tool].kind, busy: null };
  const order = [
    ['cut', 'cut'],
    ['boolean', 'boolean'],
    ['move', 'move'],
    ['contour', 'contour'],
    ['featureSlot', 'featureSlot'],
    ['paint', 'paint'],
    ['measure', 'measure'],
    ['sheetMetal', 'sheetMetal'],
    ['hole', 'hole'],
    ['joints', 'joints'],
    ['fea', 'fea'],
    ['featureEdit', 'featureEdit'],
  ];
  for (const [flag, name] of order) {
    if (modes[flag]) return { target: null, kind: null, busy: name };
  }
  return { target: 'selection', kind: null, busy: null };
}

const BUSY_HINTS = Object.freeze({
  contour: 'Finish or cancel the sketch (sketch_commit / sketch_cancel).',
  featureSlot: 'Slot cards take contours through slot_assign_contour.',
  featureEdit: 'This edit card has no viewport picker; use edit_feature / confirm_feature.',
  hole: 'The hole card places on its own face; confirm_feature or cancel_feature first.',
  game: 'The agent bridge drives the CAD tab.',
});

/** `picker_busy` error with the mode that owns the canvas. */
export function pickerBusyError(busy, wanted = null) {
  const message = wanted
    ? `Cannot open ${wanted}: ${busy} is open`
    : `Cannot pick while ${busy} is open`;
  const details = { viewport: busy };
  if (BUSY_HINTS[busy]) details.hint = BUSY_HINTS[busy];
  return { code: 'picker_busy', message, details };
}
