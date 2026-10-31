/**
 * Command groups for `list_commands { group }` and the `group` field on
 * every commands.json row. One explicit table: a per-command override wins,
 * then the name prefix. `commandGroups.test.js` fails when a command lands
 * in no group, so a new command is placed on purpose.
 */

/** Group name → what it holds (the text an agent sees in the arg description). */
export const COMMAND_GROUPS = Object.freeze({
  core: 'script, run, status, errors, history, undo/redo, feature_tree, list_commands',
  feature: 'the open feature edit: open, activate, edit, confirm, cancel, delete, rollback',
  insert: 'insert_* feature tools and invoke_helper',
  pick: 'pick sessions, selection, and the face/edge/body lists',
  sketch: 'sketch, slot, hole-centre, workplane and plane sessions',
  document: 'parts and assemblies: create, open, rename, delete, insert_part, placement, dirty',
  joint: 'assembly joints',
  paint: 'face and part paint',
  measure: 'measure sessions',
  fea: 'FEA study',
  sheet: 'sheet metal',
  git: 'vault writes and branches',
  export: 'STL / 3MF / STEP export',
  view: 'screenshot, camera, visibility, cross section, mode, toasts',
  agent: 'operator-visible cues and the in-viewer prompt',
});

export const COMMAND_GROUP_NAMES = Object.freeze(Object.keys(COMMAND_GROUPS));

const OVERRIDES = Object.freeze({
  get_script: 'core',
  set_script: 'core',
  run: 'core',
  status: 'core',
  errors: 'core',
  undo: 'core',
  redo: 'core',
  history: 'core',
  feature_tree: 'core',
  list_commands: 'core',
  geometry_workers: 'core',
  invoke_helper: 'insert',
  insert_part: 'document',
  open_feature: 'feature',
  activate_feature: 'feature',
  edit_feature: 'feature',
  confirm_feature: 'feature',
  cancel_feature: 'feature',
  delete_feature: 'feature',
  rollback_to: 'feature',
  selection: 'pick',
  cad_select_all: 'pick',
  list_faces: 'pick',
  mold_fit: 'measure',
  mold_wall_map: 'measure',
  mold_parting: 'measure',
  mold_side_actions: 'measure',
  mold_draft: 'measure',
  mold_dfm: 'measure',
  mold_quote: 'measure',
  mold_request_firm_quote: 'measure',
  mold_request_human_review: 'measure',
  list_edges: 'pick',
  list_feature_edges: 'pick',
  list_bodies: 'pick',
  list_sketch_entities: 'sketch',
  plane_set: 'sketch',
  workplane_select: 'sketch',
  set_active_workplane: 'sketch',
  set_sketch_overlay: 'sketch',
  parts: 'document',
  list_assemblies: 'document',
  list_joints: 'joint',
  set_active_part: 'document',
  part_get_transform: 'document',
  part_set_transform: 'document',
  dirty: 'document',
  screenshot: 'view',
  camera: 'view',
  zoom_to_selection: 'view',
  set_part_visible: 'view',
  mode: 'view',
  toasts: 'view',
});

const PREFIXES = Object.freeze({
  insert: 'insert',
  pick: 'pick',
  select: 'pick',
  sketch: 'sketch',
  slot: 'sketch',
  hole: 'sketch',
  create: 'document',
  open: 'document',
  rename: 'document',
  delete: 'document',
  joint: 'joint',
  paint: 'paint',
  measure: 'measure',
  fea: 'fea',
  sheet: 'sheet',
  git: 'git',
  export: 'export',
  camera: 'view',
  cross: 'view',
  agent: 'agent',
});

/** @returns {string | null} the group, or null for a command the table does not place */
export function groupForCommand(name) {
  if (typeof name !== 'string') return null;
  if (OVERRIDES[name]) return OVERRIDES[name];
  const prefix = name.split('_')[0];
  return PREFIXES[prefix] || null;
}
