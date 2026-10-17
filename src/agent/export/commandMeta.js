/**
 * Export metadata for bridge commands (description, result, errors, mutation flags).
 * Arg shapes come from each command's `schema` on the registry.
 */

import { MUTATE_RESULT_SCHEMA, STATUS_SCHEMA } from '../schemas/common.js';

const OK = Object.freeze({ type: 'object', additionalProperties: false, properties: { ok: { const: true } } });
const SOURCE = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: { source: { type: 'string' } },
});

/** @type {Record<string, { description: string, result?: object, errors?: string[], mutates?: boolean, destructive?: boolean, confirm?: boolean }>} */
export const COMMAND_META = {
  get_script: {
    description: 'Read the Monaco editor buffer for the active part.',
    result: SOURCE,
    errors: ['internal'],
    mutates: false,
  },
  set_script: {
    description:
      'Write the editor, run the script, and record one undo step when the text changes. Preserves or re-injects the active part `// @surf-id` header when the part has a surf id.',
    result: MUTATE_RESULT_SCHEMA,
    errors: ['bad_args', 'internal'],
    mutates: true,
  },
  run: {
    description: 'Run the current editor buffer; one undo step when it is not already the stack head.',
    result: MUTATE_RESULT_SCHEMA,
    errors: ['internal'],
    mutates: true,
  },
  status: {
    description:
      'Status for the active part: id, name, editor script, runState (not_run_yet | ok | failed), and the last run volume/bbox/bodyCount when available. Updates when the active part changes without requiring another run.',
    result: STATUS_SCHEMA,
    errors: ['internal'],
    mutates: false,
  },
  errors: {
    description: 'Structured errors from the last finished geometry run.',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        errors: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              featureIndex: { type: 'integer' },
            },
          },
        },
      },
    },
    errors: ['internal'],
    mutates: false,
  },
  screenshot: {
    description: 'Capture the viewport as a PNG data URL.',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: { dataUrl: { type: 'string' } },
    },
    errors: ['unsupported_format', 'screenshot_failed', 'internal'],
    mutates: false,
  },
  undo: {
    description: 'One undo on the feature-bar stack (sketch session, assembly joints, or active part script) and run when the part script changes.',
    result: {
      type: 'object',
      additionalProperties: true,
      properties: {
        ok: { type: 'boolean' },
        kind: { type: 'string', enum: ['sketch', 'assembly', 'part'] },
        applied: { type: 'object', additionalProperties: true },
        reverted: { type: 'object', additionalProperties: true },
        status: STATUS_SCHEMA,
        errors: { type: 'array', items: { type: 'string' } },
      },
    },
    errors: ['nothing_to_undo', 'no_write_part', 'internal'],
    mutates: true,
  },
  redo: {
    description: 'One redo on the feature-bar stack (assembly joints or active part; sketch has no redo).',
    result: {
      type: 'object',
      additionalProperties: true,
      properties: {
        ok: { type: 'boolean' },
        kind: { type: 'string', enum: ['assembly', 'part'] },
        applied: { type: 'object', additionalProperties: true },
        reverted: { type: 'object', additionalProperties: true },
        reapplied: { type: 'object', additionalProperties: true },
        status: STATUS_SCHEMA,
        errors: { type: 'array', items: { type: 'string' } },
      },
    },
    errors: ['nothing_to_redo', 'no_write_part', 'internal'],
    mutates: true,
  },
  history: {
    description: 'Summary of the stack the next undo/redo would use: entries, head, labels, canUndo, canRedo.',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['sketch', 'assembly', 'part'] },
        head: { type: 'integer' },
        canUndo: { type: 'boolean' },
        canRedo: { type: 'boolean' },
        partId: { type: 'string' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              index: { type: 'integer' },
              label: { type: 'string' },
              current: { type: 'boolean' },
            },
          },
        },
      },
    },
    errors: ['internal'],
    mutates: false,
  },
  list_commands: {
    description: 'List every bridge command with args schema and example.',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        commands: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              schema: { type: 'object' },
              example: { type: 'object' },
            },
          },
        },
      },
    },
    errors: ['internal'],
    mutates: false,
  },
  agent_set_visible: {
    description: 'Toggle operator-visible cues (synthetic cursor, highlights, pacing).',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        options: { type: 'object', additionalProperties: true },
      },
    },
    errors: ['bad_args', 'internal'],
    mutates: false,
  },
  feature_tree: {
    description: 'Feature strip for the active part script.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  selection: {
    description: 'Current viewport and editor selection summary.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  mode: {
    description: 'Open picker / card mode summary.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  dirty: {
    description: 'Workspace and per-part dirty flags.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  toasts: {
    description: 'Visible upload / git / rename notices.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  parts: {
    description: 'Assembly parts list and active editor part.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  camera: {
    description: 'Current camera pose.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  list_faces: {
    description: 'Every pickable face on the active or named part mesh (one row per face a viewport click selects, all bodies): id (f0, f1, …), type (planar, cylindrical, curved), center, normal, axis and radius for cylinders, area, and key. The id is the patch index on this mesh and is only valid until the next remesh; a rerun of the same script keeps every id. Pass the key with the id to joint_pick so a stale id cannot silently pick another face.',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_mesh', 'unknown_part', 'internal'],
    mutates: false,
  },
  list_edges: {
    description: 'Mesh feature edges (raw or grouped).',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_mesh', 'unknown_part', 'internal'],
    mutates: false,
  },
  list_feature_edges: {
    description: 'Topology-stable boundary edge ids (e0, e1, …).',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_mesh', 'unknown_part', 'internal'],
    mutates: false,
  },
  invoke_helper: {
    description: 'Insert a helper palette item through the same compose path as the UI.',
    result: {
      type: 'object',
      additionalProperties: true,
      properties: {
        helperId: { type: 'string' },
        ok: { type: 'boolean' },
        errors: { type: 'array', items: { type: 'string' } },
        status: STATUS_SCHEMA,
      },
    },
    errors: ['bad_args', 'unknown_helper', 'insert_failed', 'internal'],
    mutates: true,
  },
  open_feature: {
    description: 'Open the feature sheet or viewport edit card for a strip chip.',
    result: { type: 'object', additionalProperties: true },
    errors: ['unknown_feature', 'bad_index', 'edit_failed', 'internal'],
    mutates: false,
  },
  activate_feature: {
    description: 'Highlight a feature strip chip without opening the editor.',
    result: { type: 'object', additionalProperties: true },
    errors: ['unknown_feature', 'bad_index', 'internal'],
    mutates: false,
  },
  edit_feature: {
    description: 'Merge fields into the open feature edit session.',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_feature_edit', 'edit_failed', 'internal'],
    mutates: false,
  },
  confirm_feature: {
    description: 'Accept the open feature edit and run through mutate.',
    result: MUTATE_RESULT_SCHEMA,
    errors: ['no_feature_edit', 'edit_failed', 'no_write_part', 'internal'],
    mutates: true,
  },
  cancel_feature: {
    description: 'Close the open feature edit without writing.',
    result: OK,
    errors: ['no_feature_edit', 'internal'],
    mutates: false,
  },
  delete_feature: {
    description: 'Delete a feature block from the script.',
    result: MUTATE_RESULT_SCHEMA,
    errors: ['unknown_feature', 'bad_index', 'delete_failed', 'no_write_part', 'internal'],
    mutates: true,
    destructive: true,
    confirm: true,
  },
  rollback_to: {
    description: 'Move the rollback bar and re-run evaluation (does not edit the script).',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: { rollbackAnchor: { type: ['string', 'null'] } },
    },
    errors: ['unknown_feature', 'bad_index', 'internal'],
    mutates: true,
  },
  select_clear: {
    description: 'Clear face, edge, and contour picks.',
    result: { type: 'object', additionalProperties: false, properties: { cleared: { const: true } } },
    errors: ['internal'],
    mutates: false,
  },
  select_faces: {
    description: 'Select faces by fingerprint keys.',
    result: { type: 'object', additionalProperties: false, properties: { count: { type: 'integer' } } },
    errors: ['bad_args', 'unknown_face', 'ambiguous_face', 'internal'],
    mutates: false,
  },
  select_edges: {
    description: 'Select edges by grouped id or face-key pair.',
    result: { type: 'object', additionalProperties: false, properties: { count: { type: 'integer' } } },
    errors: ['bad_args', 'unknown_edge', 'ambiguous_edge', 'internal'],
    mutates: false,
  },
  select_parts: {
    description: 'Highlight assembly parts in the viewer without switching the editor part.',
    result: { type: 'object', additionalProperties: false, properties: { partIds: { type: 'array', items: { type: 'string' } } } },
    errors: ['bad_args', 'unknown_part', 'internal'],
    mutates: false,
  },
  set_active_part: {
    description: 'Switch the editor and mesh to a part row.',
    result: { type: 'object', additionalProperties: false, properties: { partId: { type: 'string' } } },
    errors: ['bad_args', 'unknown_part', 'internal'],
    mutates: false,
  },
  camera_set: {
    description: 'Set camera from a named view or explicit pose.',
    result: OK,
    errors: ['bad_view', 'bad_args', 'camera_failed', 'internal'],
    mutates: false,
  },
  camera_fit: {
    description: 'Zoom the camera to fit the model.',
    result: OK,
    errors: ['camera_failed', 'no_mesh', 'internal'],
    mutates: false,
  },
  zoom_to_selection: {
    description: 'Frame the current face or edge selection.',
    result: OK,
    errors: ['no_selection', 'camera_failed', 'internal'],
    mutates: false,
  },
  sketch_begin: {
    description: 'Open contour sketch mode on a plane or face.',
    result: { type: 'object', additionalProperties: true },
    errors: ['sketch_open', 'picker_busy', 'internal'],
    mutates: false,
  },
  sketch_accept_plane: {
    description: 'Accept the plane card and arm drawing tools.',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_sketch', 'internal'],
    mutates: false,
  },
  sketch_add: {
    description: 'Switch contour rail tool and set profile parameters.',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_sketch', 'plane_card_open', 'invalid_profile', 'internal'],
    mutates: false,
  },
  sketch_commit: {
    description: 'Write the sketch into the part script.',
    result: MUTATE_RESULT_SCHEMA,
    errors: ['no_sketch', 'plane_card_open', 'empty_sketch', 'invalid_profile', 'commit_failed', 'no_write_part', 'internal'],
    mutates: true,
  },
  sketch_cancel: {
    description: 'Exit contour mode without writing.',
    result: OK,
    errors: ['internal'],
    mutates: false,
  },
  sketch_dimension: {
    description: 'Add or edit a sketch dimension.',
    result: MUTATE_RESULT_SCHEMA,
    errors: ['no_sketch', 'bad_args', 'commit_failed', 'internal'],
    mutates: true,
  },
  sketch_constrain: {
    description: 'Add or edit a sketch constraint.',
    result: MUTATE_RESULT_SCHEMA,
    errors: ['no_sketch', 'bad_args', 'commit_failed', 'internal'],
    mutates: true,
  },
  slot_open: {
    description: 'Open Extrude / Revolve / Loft / Sweep slot card.',
    result: { type: 'object', additionalProperties: true },
    errors: ['picker_busy', 'internal'],
    mutates: false,
  },
  slot_assign_contour: {
    description: 'Assign a saved @contour id to a slot on the open card.',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_slot', 'unknown_contour', 'bad_args', 'internal'],
    mutates: false,
  },
  slot_set_params: {
    description: 'Patch parameters on the open slot card.',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_slot', 'bad_args', 'internal'],
    mutates: false,
  },
  slot_commit: {
    description: 'Confirm the slot card and write the solid feature.',
    result: MUTATE_RESULT_SCHEMA,
    errors: ['no_slot', 'slot_not_ready', 'commit_failed', 'no_write_part', 'internal'],
    mutates: true,
  },
  slot_cancel: {
    description: 'Close the slot card without writing.',
    result: OK,
    errors: ['internal'],
    mutates: false,
  },
  pick_begin: {
    description: 'Open a pick session for faces, edges, or sketch entities.',
    result: { type: 'object', additionalProperties: true },
    errors: ['pick_open', 'picker_busy', 'wrong_kind', 'pick_limit', 'bad_args', 'internal'],
    mutates: false,
  },
  pick_next: {
    description: 'Add or remove picks on the active session.',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_pick_session', 'pick_closed', 'pick_timeout', 'pick_rejected', 'pick_limit', 'unknown_face', 'ambiguous_face', 'unknown_edge', 'ambiguous_edge', 'not_picked', 'bad_args', 'internal'],
    mutates: false,
  },
  pick_undo: {
    description: 'Drop the last agent pick in the session.',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_pick_session', 'nothing_to_undo', 'pick_closed', 'internal'],
    mutates: false,
  },
  pick_clear: {
    description: 'Clear every pick in the session.',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_pick_session', 'pick_closed', 'internal'],
    mutates: false,
  },
  pick_done: {
    description: 'End the pick session; optional accept runs the card Accept.',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_pick_session', 'empty_pick', 'pick_count', 'no_card', 'accept_refused', 'pick_closed', 'internal'],
    mutates: true,
  },
  pick_cancel: {
    description: 'End the session and restore pre-session picks.',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_pick_session', 'internal'],
    mutates: false,
  },
  pick_state: {
    description: 'Read the live pick session summary.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  pick_faces: {
    description: 'One-shot face pick session (begin → next → done).',
    result: { type: 'object', additionalProperties: true },
    errors: ['picker_busy', 'pick_open', 'pick_timeout', 'unknown_face', 'ambiguous_face', 'internal'],
    mutates: false,
  },
  pick_edges: {
    description: 'One-shot edge pick session.',
    result: { type: 'object', additionalProperties: true },
    errors: ['picker_busy', 'pick_open', 'pick_timeout', 'unknown_edge', 'ambiguous_edge', 'internal'],
    mutates: false,
  },
  pick_points: {
    description: 'One-shot sketch or hole-centre point picks.',
    result: { type: 'object', additionalProperties: true },
    errors: ['picker_busy', 'pick_open', 'wrong_kind', 'internal'],
    mutates: false,
  },
  hole_open: {
    description: 'Open the Hole feature card.',
    result: { type: 'object', additionalProperties: true },
    errors: ['picker_busy', 'internal'],
    mutates: false,
  },
  hole_set_params: {
    description: 'Patch fields on the open Hole card.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'internal'],
    mutates: false,
  },
  hole_begin_centres: {
    description: 'Start the hole centres sketch (plane card first).',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  hole_commit: {
    description: 'Accept hole centres and write the hole feature.',
    result: MUTATE_RESULT_SCHEMA,
    errors: ['commit_failed', 'no_write_part', 'internal'],
    mutates: true,
  },
  hole_cancel: {
    description: 'Close the Hole card or cancel centres sketch.',
    result: OK,
    errors: ['internal'],
    mutates: false,
  },
  plane_set: {
    description: 'Edit the open plane card (preset, offset, angles).',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'internal'],
    mutates: false,
  },
  workplane_select: {
    description: 'Select a saved construction plane on the plane card.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'internal'],
    mutates: false,
  },
  set_active_workplane: {
    description: 'Highlight or clear the construction-plane overlay.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'internal'],
    mutates: false,
  },
  list_sketch_entities: {
    description: 'List entities in the open contour sketch.',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_sketch', 'internal'],
    mutates: false,
  },
  create_assembly: {
    description: 'Seed a blank assembly document.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: true,
    destructive: true,
    confirm: true,
  },
  create_part: {
    description:
      'Add a part row to the assembly. Agent calls default to the assembly origin (identity placement); pass position [x,y,z] mm to place explicitly. The UI still staggers new parts +40 mm on X so bodies do not overlap. In a git assembly the part has no vault path until git_save.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'internal'],
    mutates: true,
  },
  rename_part: {
    description: 'Rename a part. A vault part also moves its .js path in the same folder (-2, -3 on collision) and updates the .surf.json in one rename commit; that write needs git consent like git_save.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'unknown_part', 'name_taken', 'consent_pending', 'real_repo_blocked', 'git_error', 'internal'],
    mutates: true,
  },
  part_get_transform: {
    description:
      'Read a part rigid placement: position [x,y,z] mm and rotation as intrinsic XYZ Euler degrees (three.js Euler XYZ order).',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        part: { type: 'string' },
        position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        eulerOrder: { type: 'string', const: 'XYZ' },
      },
    },
    errors: ['bad_args', 'unknown_part', 'internal'],
    mutates: false,
  },
  part_set_transform: {
    description:
      'Set a part rigid placement (translation mm, intrinsic XYZ Euler degrees). Records one assembly undo step like a UI move.',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        part: { type: 'string' },
        position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        eulerOrder: { type: 'string', const: 'XYZ' },
      },
    },
    errors: ['bad_args', 'unknown_part', 'no_assembly', 'internal'],
    mutates: true,
  },
  open_assembly: {
    description: 'Open a vault assembly (git mode).',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'internal'],
    mutates: true,
    destructive: true,
    confirm: true,
  },
  open_part: {
    description: 'Open or link a vault part into the assembly.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'internal'],
    mutates: true,
  },
  insert_part: {
    description: 'Insert another assembly or add a new local part row.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'internal'],
    mutates: true,
  },
  joint_open: {
    description: 'Open the Joints create card.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  joint_set_params: {
    description: 'Patch mate type and fields on the open joint card.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'internal'],
    mutates: false,
  },
  joint_pick: {
    description: 'Feed face picks on parts into the joint card. Pass face_id from list_faces together with the key from that row (ids are only valid until the next remesh; a stale pair returns unknown_face). A cylindrical face becomes an axis pick, as a viewport tap does.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'unknown_part', 'unknown_face', 'ambiguous_face', 'pick_failed', 'no_mesh', 'internal'],
    mutates: false,
  },
  joint_commit: {
    description: 'Confirm the joint card and record one assembly undo step. A refused commit, or one that changes nothing (unchanged: true), records no step.',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_joint_card', 'commit_failed', 'edit_failed', 'internal'],
    mutates: true,
  },
  joint_cancel: {
    description: 'Dismiss the joint card without writing.',
    result: OK,
    errors: ['internal'],
    mutates: false,
  },
  joint_select: {
    description: 'Highlight a joint on the assembly strip.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'unknown_joint', 'internal'],
    mutates: false,
  },
  joint_edit: {
    description: 'Open a joint by joint_id and patch it (same fields as joint_set_params); joint_commit writes it. A refused edit changes nothing.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'no_assembly', 'unknown_joint', 'no_joint_edit', 'edit_failed', 'internal'],
    mutates: false,
  },
  sheet_open: {
    description: 'Open the Sheet Metal picker (Shape rail).',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_view', 'internal'],
    mutates: false,
  },
  sheet_start: {
    description: 'Bind a SendCutSend SKU and enter sheet-metal mode.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'unknown_sku', 'bind_failed', 'internal'],
    mutates: true,
  },
  sheet_set_tool: {
    description: 'Select Tab, Bend, Hole, Countersink, or Tapped on the sheet rail.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'no_sheet_mode', 'bad_tool', 'internal'],
    mutates: false,
  },
  sheet_set_params: {
    description: 'Patch the open sheet stage (plane, base dims, bend/tab/hole draft, or spec r/k/t/sku).',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'no_sheet_mode', 'bad_stage', 'unknown_sku', 'internal'],
    mutates: false,
  },
  sheet_pick: {
    description: 'Pick a plane, sheet edge (panel+edge or ref_key), hole panel, or ribbon chip.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'no_sheet_mode', 'bad_pick', 'unknown_chip', 'internal'],
    mutates: false,
  },
  sheet_commit: {
    description: 'Confirm the open base flange or feature draft (one undo when the script changes).',
    result: MUTATE_RESULT_SCHEMA,
    errors: ['commit_failed', 'no_draft', 'no_write_part', 'internal'],
    mutates: true,
  },
  sheet_cancel: {
    description: 'Back out of a draft, base popup, check view, or picker.',
    result: OK,
    errors: ['no_sheet_mode', 'nothing_to_cancel', 'internal'],
    mutates: false,
  },
  sheet_exit: {
    description: 'Exit sheet-metal mode without Done.',
    result: OK,
    errors: ['internal'],
    mutates: false,
  },
  sheet_check: {
    description: 'Open the flat-pattern / DFM check card (unfold).',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_stage', 'internal'],
    mutates: false,
  },
  sheet_refold: {
    description: 'Close the check card and return to bent edit.',
    result: OK,
    errors: ['bad_stage', 'internal'],
    mutates: false,
  },
  sheet_done: {
    description: 'Write pending sheet edits if needed and close the flow.',
    result: MUTATE_RESULT_SCHEMA,
    errors: ['bad_stage', 'commit_failed', 'no_write_part', 'internal'],
    mutates: true,
  },
  sheet_edit: {
    description: 'Open a sheet ribbon chip or marker for edit; optional param patch.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'no_sheet_mode', 'unknown_chip', 'unknown_feature', 'edit_failed', 'internal'],
    mutates: false,
  },
  sheet_begin_hole: {
    description: 'Next on a new sheet hole: open the centres sketch on the panel.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_stage', 'internal'],
    mutates: false,
  },
  git_move_to_repo: {
    description: 'Move the open local assembly into a new vault repo layout.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'git_blocked', 'consent_pending', 'real_repo_blocked', 'internal'],
    mutates: true,
    destructive: true,
    confirm: true,
  },
  git_save: {
    description: 'Save like the Parts Save button: give every path-less part a vault path, then commit those parts, dirty parts, and the .surf.json in one commit on the current branch. A real repo returns consent_pending at once until the user clicks Allow; retry after.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'git_blocked', 'consent_pending', 'real_repo_blocked', 'internal'],
    mutates: true,
  },
  git_add_to_repo: {
    description: 'Add a part row into the vault tree and commit. Other path-less parts are pathed and committed with it so the .surf.json stays valid.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'git_blocked', 'consent_pending', 'real_repo_blocked', 'internal'],
    mutates: true,
  },
  git_behind_resolve: {
    description: 'Resolve behind-remote: keep mine, reload, or branch.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'confirm_required', 'git_blocked', 'consent_pending', 'real_repo_blocked', 'internal'],
    mutates: true,
    destructive: true,
    confirm: true,
  },
  git_branch_create: {
    description: 'Create and switch to a new vault branch.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'git_blocked', 'consent_pending', 'real_repo_blocked', 'internal'],
    mutates: true,
  },
  git_branch_switch: {
    description: 'Switch vault branch; confirm when the working copy is dirty.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'confirm_required', 'git_blocked', 'consent_pending', 'real_repo_blocked', 'internal'],
    mutates: true,
    destructive: true,
    confirm: true,
  },
  git_branch_delete: {
    description: 'Delete a vault branch (requires confirm: true).',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'confirm_required', 'git_blocked', 'consent_pending', 'real_repo_blocked', 'internal'],
    mutates: true,
    destructive: true,
    confirm: true,
  },
  git_force_overwrite: {
    description: 'Force-overwrite remote conflicts (requires confirm: true).',
    result: { type: 'object', additionalProperties: true },
    errors: ['confirm_required', 'git_blocked', 'consent_pending', 'real_repo_blocked', 'internal'],
    mutates: true,
    destructive: true,
    confirm: true,
  },
  git_list_branches: {
    description: 'List vault branches for the open assembly.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  fea_run: {
    description: 'Run the FEA study; resolves when the solver finishes with a compact results summary.',
    result: {
      type: 'object',
      additionalProperties: true,
      properties: {
        status: { type: 'string' },
        stale: { type: 'boolean' },
        dof: { type: ['integer', 'null'], description: 'Solver degrees of freedom' },
        timing: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ms: { type: ['number', 'null'] },
            dofs: { type: ['integer', 'null'] },
            stage: { type: ['string', 'null'] },
          },
        },
        maxVonMises_MPa: { type: ['number', 'null'] },
        p95VonMises_MPa: { type: ['number', 'null'] },
        maxDisplacement_m: { type: ['number', 'null'], description: 'Peak displacement in metres' },
        safetyFactor: { type: ['number', 'null'] },
      },
    },
    errors: ['no_fea', 'busy', 'run_failed', 'timeout', 'internal'],
    mutates: false,
  },
  fea_results: {
    description: 'Read compact von Mises, displacement (m), safety, modal, and contact summary.',
    result: {
      type: 'object',
      additionalProperties: true,
      properties: {
        status: { type: 'string' },
        dof: { type: ['integer', 'null'] },
        maxVonMises_MPa: { type: ['number', 'null'] },
        maxDisplacement_m: { type: ['number', 'null'] },
        screen: { type: 'string' },
      },
    },
    errors: ['no_fea', 'internal'],
    mutates: false,
  },
  export_part: {
    description: 'Export the active (or named) part mesh as STL, 3MF, or STEP bytes, or trigger a browser download.',
    result: {
      type: 'object',
      additionalProperties: true,
      properties: {
        format: { type: 'string' },
        filename: { type: 'string' },
        bytesBase64: { type: 'string' },
        byteLength: { type: 'integer' },
        downloaded: { type: 'boolean' },
        stepSource: { type: 'string' },
      },
    },
    errors: ['bad_args', 'unknown_part', 'export_failed', 'internal'],
    mutates: false,
  },
  export_download: {
    description: 'Browser-download a part mesh (defaults to 3MF like the Parts ribbon Download button).',
    result: {
      type: 'object',
      additionalProperties: true,
      properties: {
        format: { type: 'string' },
        filename: { type: 'string' },
        byteLength: { type: 'integer' },
        downloaded: { type: 'boolean' },
      },
    },
    errors: ['bad_args', 'unknown_part', 'export_failed', 'internal'],
    mutates: false,
  },
};

const INSERT_HELPER_META = {
  description: 'Insert this helper through composeHelperInsert and mutate.',
  result: {
    type: 'object',
    additionalProperties: true,
    properties: {
      helperId: { type: 'string' },
      ok: { type: 'boolean' },
      errors: { type: 'array', items: { type: 'string' } },
      status: STATUS_SCHEMA,
    },
  },
  errors: ['bad_args', 'insert_failed', 'internal'],
  mutates: true,
};

export function metaForCommand(name) {
  if (COMMAND_META[name]) return COMMAND_META[name];
  if (name.startsWith('insert_')) return INSERT_HELPER_META;
  return {
    description: `Bridge command ${name}.`,
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'internal'],
    mutates: false,
  };
}
