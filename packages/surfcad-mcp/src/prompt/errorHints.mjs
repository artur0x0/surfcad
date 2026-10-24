/**
 * One table from error code to recovery. Every error payload the MCP server
 * hands an agent gets `hint` (one sentence, what to do next) from here, and
 * the codes with a longer story are also `guide { topic: "errors.<code>" }`
 * topics and `surfcad://guide/errors.<code>` resources, rendered from the
 * same rows so the two cannot drift.
 *
 * The bridge (src/agent) sends `code`, `message`, `details`; the hint is
 * added on this side so a tab that predates a hint still gets one. A hint
 * the bridge sent itself wins.
 */

const SELECTION_GUIDE = 'use_selection reads the viewport pick once. Every successful rebuild (each insert_*, set_script, undo) clears the picks because they index the mesh that was replaced, so the second insert in a row finds nothing and answers no_selection without writing. Pick again before each insert that uses the selection: list_faces { filter } → select_faces { keys } (or { names }) → insert_* { use_selection: true }. Omit use_selection to take the helper default instead (the +Z top face for holes, every convex edge for fillet and chamfer). Every insert result carries usedSelection: true | false.';

const SWEEP_GUIDE = 'insert_sweep_path and insert_make_sweep build the path from selected edges: list_feature_edges, select_edges { keys: ["e3", "e4"] } (a connected tangent chain), then insert with use_selection: true. With no edge to follow, author the path from points in one feature block instead: insert_code_snippet { gap: "sweep along points", why: "no model edge follows the path", script } where the script calls makeSweepPath / sweepPoints with your [x, y, z] mm points and sets part. guide { topic: "features" } shows the block shape.';

const TIMEOUT_GUIDE = 'One marked feature block ran past the 30 s kernel budget. The geometry worker was replaced and the part was rebuilt without that block, so the other features are on screen and the part keeps working; the errors row names the block (featureId, featureLabel, elapsedMs, budgetMs). Make it cheaper, then edit_feature / confirm_feature it, or delete_feature / undo: fewer edges (the picked face\'s edges by name or an explicit list instead of every convex edge), a smaller radius, lower segment counts, or split the body. Do not retry the same block unchanged and do not ask for a reload.';

const CRASH_GUIDE = 'The whole run was treated as a crash (reason timeout, out_of_memory or wasm_abort): the worker was killed and replaced, errors has one geometry_worker_crashed row with workerRestarted: true, and other parts keep building. Do not retry the same script: simplify the part (smaller edge sets, lower segments, fewer boolean bodies), then run again. After undo the restored script is re-run; if status.stale is true the numbers are the previous run\'s, call run {} and read status.';

const NAMES_GUIDE = 'Faces and edges are addressed by the keys and names list_faces / list_feature_edges return for the current mesh. A key from before a rebuild, a display label, or a guess answers unknown_face / unknown_edge; a key that matches several patches answers ambiguous_face / ambiguous_edge with details.candidates. List again (filter and page the list on a detailed part), then select_faces { keys } or { names } with a row from that answer. Faces a helper built carry a name (feature.role) that survives upstream edits; prefer names when you will edit the part again.';

const PAIRING_GUIDE = 'A bridge call before pair is not_paired: call pair { code } with the 6-character code from SurfCAD → Local agent → Show pairing code (or set SURFCAD_PAIRING_CODE). pair_pending means the user has not clicked Allow yet; wait and retry the same call. pair_rejected means they clicked Deny; ask before trying again. pairing_lost means the tab or relay dropped and the server re-pairs on its own: retry in a few seconds, do not ask for a new code. Webhook errors (bad_webhook_url) need a public https URL; a local session polls read_messages { wait_ms: 25000 } instead.';

const CONTOUR_GUIDE = 'open_feature on an extrude, revolve, loft or sweep that owns a contour reopens its sketch; edit_feature then patches the sketch (points, radius, width / height, polygon_preset, or tool) and confirm_feature saves the sketch and the feature in one step. no_feature_edit means nothing is open: open_feature { id } first (feature_tree {} lists ids), then edit, then confirm. sketch_cancel leaves a reopened sketch without writing.';

const CONSENT_GUIDE = 'Vault writes on a real GitHub repository need the user\'s Allow once per session. consent_pending: the dialog is up, nothing was written; ask the user to click Allow, then retry the same call after details.retry_after_ms. real_repo_blocked: this session cannot get consent (headless, or the user denied); tell the user and stop, do not loop. confirm_required: a destructive change (delete_feature on the base feature, delete_part scope repo, git_force_overwrite, ...) was called without confirm: true; nothing changed; ask the user, only then retry with confirm: true.';

const BUSY_GUIDE = 'Another mode owns the canvas (a sketch, paint, joint, sheet, measure or pick card) or the viewport is still switching. details.viewport names the mode and details.hint says what to call instead when there is one. Close or finish that mode (sketch_commit / sketch_cancel, paint_confirm / paint_cancel, joint_commit, pick_done / pick_cancel) and call again; not_ready from paint_open is retryable after a moment.';

/**
 * code → { hint, guide? }. `hint` is one sentence that fits in a payload;
 * `guide` is the errors.<code> topic text (only where the story needs more
 * than a sentence). Keep hints concrete: the next call to make.
 * @type {Readonly<Record<string, { hint: string, guide?: string }>>}
 */
export const ERROR_HINTS = Object.freeze({
  // Selection and names
  no_selection: { hint: 'Picks clear after every rebuild: list_faces { filter } → select_faces { keys } (or { names }), then insert again with use_selection: true, or omit use_selection for the helper default.', guide: SELECTION_GUIDE },
  unknown_face: { hint: 'The key or name is not on the current mesh: list_faces { filter, page } again and pass a key or name from that answer.', guide: NAMES_GUIDE },
  unknown_edge: { hint: 'The key or pair is not on the current mesh: list_feature_edges (grouped ids) or list_edges again and pass a key from that answer.', guide: NAMES_GUIDE },
  ambiguous_face: { hint: 'The key matched several patches: pick one of details.candidates (list_faces keys) and select it by that key, or by name.', guide: NAMES_GUIDE },
  ambiguous_edge: { hint: 'The face-key pair matched several edges: use a grouped edge id from list_feature_edges instead.', guide: NAMES_GUIDE },
  ambiguous: { hint: 'More than one entity matched: pass an id or key from the matching list_* call.' },
  unknown_entity: { hint: 'The sketch entity id is not in the open contour: list_sketch_entities {} and use an id from it (p0, e0, a0, ...).' },
  no_body: { hint: 'Name the body: body_index or at from list_bodies {}, face or face_id from list_faces, or select a face and pass use_selection: true.' },
  no_mesh: { hint: 'No solid is shown yet: insert a block (insert_cube, insert_cylinder, ...) or run {} the part, then call again.' },
  not_picked: { hint: 'pick_next { remove: true } named keys that are not picked: pick_next with no remove to see the live picks, or pick_clear {}.' },
  empty_pick: { hint: 'The card needs at least one pick: pick_next { keys } before pick_done, or pick_cancel {}.' },
  pick_count: { hint: 'Fewer picks than the card\'s minimum: pick_next more keys, then pick_done again.' },
  pick_limit: { hint: 'The card takes at most max picks: pick_next { remove: true } some, or pick_begin again with fewer keys.' },
  pick_rejected: { hint: 'The card kept fewer picks than sent (not on the solid or wrong kind): re-list the faces or edges and pick again.' },
  pick_timeout: { hint: 'The pick session expired or the viewport did not respond: pick_begin again and finish within timeout_ms.' },
  pick_closed: { hint: 'The card closed or the Face / Edge mode changed: open the card again (open_feature or the insert) and pick_begin.' },
  pick_open: { hint: 'A pick session is live (details): pick_done or pick_cancel it, or pass replace: true to pick_begin.' },
  no_pick_session: { hint: 'No pick session: pick_begin first, or use select_faces / select_edges with use_selection: true instead.' },
  picker_busy: { hint: 'Another mode owns the canvas (details.viewport): finish or cancel it, then call again; details.hint names the call when there is one.', guide: BUSY_GUIDE },
  wrong_kind: { hint: 'The card picks details.kind (faces or edges): pass keys of that kind.' },
  bad_pick: { hint: 'The key is not a grouped edge id, face id, face key or { faceKeyA, faceKeyB } pair: copy one from list_faces / list_feature_edges.' },
  pick_failed: { hint: 'The viewport could not apply the pick: re-list and pick again, or select_clear {} and start over.' },
  no_card: { hint: 'Nothing to accept on a bare selection: call the insert with use_selection: true instead of pick_done { accept: true }.' },
  accept_refused: { hint: 'The card\'s Accept gate refused (message is its toast): fix what it names, then pick_done again; the session stays open.' },
  // Features and script
  insert_failed: { hint: 'Read message: it names the missing body, face, edge or profile; insert that first (a block for an empty part, a sketch for extrude / revolve), then insert again.' },
  feature_failed: { hint: 'The kernel rejected this block (detail says why): edit_feature its params or delete_feature it; a script fix goes through set_script with the markers kept.' },
  feature_timeout: { hint: 'This block ran past the 30 s budget and the part was rebuilt without it: make it cheaper (fewer edges, smaller radius, lower segments), then edit or delete it; do not retry it unchanged.', guide: TIMEOUT_GUIDE },
  geometry_worker_crashed: { hint: 'The worker was replaced and other parts keep building: simplify the part (smaller edge sets, lower segments, fewer bodies) and run again; do not retry the same script or ask for a reload.', guide: CRASH_GUIDE },
  build_failed: { hint: 'The script did not run: read errors {} for the feature rows, fix that block with edit_feature or set_script, then run {}.' },
  run_failed: { hint: 'The run did not complete: read status {} (stale: true means call run {} again) and errors {}.' },
  timeout: { hint: 'The tab did not answer in time: call status {} to see the current run, then retry once; a 30 s kernel budget applies per run.' },
  unknown_feature: { hint: 'The id is not in the active part\'s strip: feature_tree {} lists ids and indexes; set_active_part if the block is on another part.' },
  bad_index: { hint: 'The index is out of range: feature_tree {} gives the current count; indexes start at 0 in script order.' },
  no_feature_edit: { hint: 'No feature card is open: open_feature { id | index } first, then edit_feature { params }, then confirm_feature {}.', guide: CONTOUR_GUIDE },
  edit_failed: { hint: 'The edit could not be applied (stale feature or a lock): feature_tree {} again, open_feature, and retry; cancel_feature {} leaves.' },
  delete_failed: { hint: 'The block could not be removed from the editor: feature_tree {} again and retry delete_feature with the current id.' },
  no_write_part: { hint: 'The active part is not writable (none active or still loading): parts {} then set_active_part { part_id }, and retry.' },
  part_mismatch: { hint: 'part_id is not the active part: set_active_part { part_id } first, or pass the active id from parts {}.' },
  unknown_helper: { hint: 'Not a helper id: list_commands { group: "insert" } lists the insert_* tools, invoke_helper takes a HELPER_PALETTE id.' },
  unknown_chip: { hint: 'The chip id is not in the strip: feature_tree {} lists the current chips.' },
  unknown_sku: { hint: 'Not a fastener size: pass size as "M3", "M5", "1/4-20", ...; listFastenerSizes() in a script lists them.' },
  bad_tool: { hint: 'tool is not a sketch tool: use line, polyline, rectangle, circle, polygon or arc (the sketch_add description lists them).' },
  bad_stage: { hint: 'The call is out of order for this card: follow its sequence (open, pick or set params, commit) and call again.' },
  wrong_entry: { hint: 'This helper is opened from a different ribbon entry: use the insert_* tool the description names.' },
  no_draft: { hint: 'No pending change to confirm: make the edit first (edit_feature, sketch_add, joint_set_params), then confirm.' },
  nothing_to_cancel: { hint: 'Nothing is open to cancel: no call needed; continue with the next step.' },
  // Sketches, slots, contours
  no_sketch: { hint: 'Sketch mode is closed: sketch_begin { plane } first, or open_feature on a contour feature to reopen its sketch.' },
  sketch_open: { hint: 'A sketch or slot card is already open: sketch_commit or sketch_cancel it, then sketch_begin.' },
  plane_card_open: { hint: 'Accept the plane first: sketch_begin { plane, accept_plane: true } or sketch_accept_plane {}, then sketch_add.' },
  empty_sketch: { hint: 'Nothing is drawn: sketch_add { tool, ... } at least one closed profile before sketch_commit, or sketch_cancel.' },
  invalid_profile: { hint: 'The profile params are invalid (message names the field): fix radius / width / height / points and sketch_add again.' },
  no_profile: { hint: 'The feature needs a closed profile: sketch a contour (sketch_begin → sketch_add → sketch_commit) or pass one with insert_cross_section first.' },
  no_cross_section: { hint: 'No saved contour to use: insert_cross_section or a sketch_commit first; feature_tree {} shows the @contour ids.' },
  unknown_contour: { hint: 'The contour id is not in the script: get_script shows the @contour id= markers; use one of those (c1, c2, ...).' },
  not_a_contour: { hint: 'That chip is another feature, not a saved contour: sketch_edit takes a contour:<id> chip; use open_feature / edit_feature / confirm_feature for the rest.' },
  no_slot: { hint: 'The slot card is closed: open the feature (insert_make_loft / open_feature) before slot_* calls.' },
  slot_not_ready: { hint: 'A required contour slot is empty: slot_assign_contour each slot, then slot_commit.' },
  commit_failed: { hint: 'The commit was refused (message is the toast): fix the sketch or params it names and commit again; sketch_cancel leaves.' },
  dimension_failed: { hint: 'The dimension could not be applied: check the entity ids with list_sketch_entities and that the value is finite.' },
  constraint_failed: { hint: 'The constraint could not be solved: remove a conflicting one (sketch_undo) or change the value and retry.' },
  // Documents, parts, assemblies
  unknown_part: { hint: 'Not an open part id (paths and names are never ids): parts {} and pass a row\'s id.' },
  unknown_assembly: { hint: 'Not a saved assembly id: list_assemblies {} and pass a row\'s id.' },
  no_assembly: { hint: 'No document is open: create_assembly {} or open_assembly { assembly_id } first.' },
  unknown_joint: { hint: 'The joint id is not in this assembly: joint_edit takes an id from a joint_commit result; joint_open {} starts a new one.' },
  no_joint_card: { hint: 'The joint card is closed: joint_open {} first, then joint_pick / joint_set_params / joint_commit.' },
  no_joint_edit: { hint: 'No joint is open for editing: joint_open {} for a new joint or joint_edit { joint_id } for an existing one.' },
  joints_unavailable: { hint: 'The joint card could not open because another card or session is open: close it (cancel_feature, sketch_cancel, sheet_exit) and call joint_create again.' },
  joint_unsolvable: { hint: 'The solver refused that joint (details.reason is its message): check that the two picks are on different parts and fit the type, for example concentric needs two cylindrical faces (axes); nothing was written.' },
  part_still_referenced: { hint: 'Another assembly lists this part: delete it with scope: "assembly", or delete those parents first.' },
  origin_blocked: { hint: 'This change would move the assembly origin: place the part with part_set_transform instead.' },
  off_study_part: { hint: 'The FEA study belongs to another part: set_active_part to the study\'s part (fea_state {} names it) and retry.' },
  no_fea: { hint: 'No FEA study is open: fea_open {} (or the study tool the description names) first.' },
  no_paint_mode: { hint: 'Paint mode is closed: paint_open {} first (it waits up to 1.5 s for the viewport), or use paint { color } for one call.' },
  bad_paint: { hint: 'color must be a #rrggbb hex (color or hex): paint_set_color { color: "#2f6fdb" }.' },
  no_sheet_mode: { hint: 'Sheet-metal mode is closed: sheet_open {} first.' },
  no_measure_mode: { hint: 'Measure mode is closed: measure_open {} first.' },
  not_ready: { hint: 'The viewport is still switching (details.reason): wait a moment and call again; details.retryable is true.', guide: BUSY_GUIDE },
  busy: { hint: 'The tab is still working on the previous call: status {} and retry when runState is not working.' },
  unavailable: { hint: 'This tool is not available in the current page state (message says why): check status {} and the tool description.' },
  nothing_to_undo: { hint: 'The active stack is at its bottom: nothing to undo; history {} shows the stack.' },
  nothing_to_redo: { hint: 'The active stack is at its top, or sketch mode (no redo): nothing to redo.' },
  // Git and vault
  consent_pending: { hint: 'Nothing was written: ask the user to click Allow in SurfCAD, then retry the same call after details.retry_after_ms.', guide: CONSENT_GUIDE },
  real_repo_blocked: { hint: 'This session cannot get consent for a real-repo write: tell the user and stop; do not loop.', guide: CONSENT_GUIDE },
  confirm_required: { hint: 'Nothing changed: ask the user (details lists what the change touches), and only then retry with confirm: true.', guide: CONSENT_GUIDE },
  pending_save: { hint: 'The write is planned offline: ask the user to Save again when online; nothing more to do now.' },
  upgrade_required: { hint: 'Legacy vault: after the user agrees, git_upgrade_vault { confirm: true }, then git_save again.' },
  upgrade_unavailable: { hint: 'The vault cannot be upgraded from here (message says why): tell the user and stop.' },
  conflict: { hint: 'A remote edit overlaps this save: git_behind_resolve { action: "reload" | "branch", confirm: true } after the user chooses, or git_force_overwrite with confirm: true.' },
  'repo-moved': { hint: 'The repository moved or was renamed: ask the user; git_behind_resolve { action: "reload", confirm: true } reloads from it.' },
  git_blocked: { hint: 'Git is unavailable here (local document or no vault): git_move_to_repo first, or keep working locally; nothing was written.' },
  git_only: { hint: 'This tool needs a vault: git_move_to_repo first, or stay local and use create_part / insert_* instead.' },
  git_error: { hint: 'The git handler failed (message): retry once; stop and tell the user with the message if it repeats.' },
  working_copy_unpersisted: { hint: 'The working copy has not been written yet: git_save { message } (the user clicks Allow), then retry.' },
  not_found: { hint: 'The id or path does not exist in the vault: list_assemblies {} / parts {} and use a listed id.' },
  bind_failed: { hint: 'The part could not be bound to the vault: retry once; tell the user if it repeats.' },
  open_failed: { hint: 'The document could not be opened (message): list_assemblies {} and retry with a listed id.' },
  // Camera, export, screenshot
  bad_view: { hint: 'view must be iso, front, back, right, left, top, bottom, side, front_of_model or normal_to_sketch; or pass position and target.' },
  camera_failed: { hint: 'The viewport could not apply the camera: camera_fit {} then camera_set again.' },
  screenshot_failed: { hint: 'The viewport returned no image: camera_fit {}, wait a moment, then screenshot { save_to: true } again.' },
  screenshot_save_failed: { hint: 'The PNG could not be written on the MCP host (message): pass save_to with a writable path, or save_to: true for a temp file.' },
  unsupported_format: { hint: 'format must be png or jpeg (screenshot) or stl, 3mf, step (export).' },
  export_failed: { hint: 'The mesh could not be exported (message): run {} the part to a runState of ok, then export again.' },
  // Args and envelope
  bad_args: { hint: 'Fix the argument the message names (numbers finite and within ±1000000 mm); list_commands { names: ["<tool>"] } shows the schema.' },
  bad_json: { hint: 'argsJson must be valid JSON: send args as an object instead.' },
  bad_call: { hint: 'The call shape is wrong (message): pass arguments as an object with the keys the tool schema names.' },
  internal: { hint: 'The command threw unexpectedly: retry once; if it repeats, status {} and tell the user with the message.' },
  refused: { hint: 'The tab refused this call (message says why): fix what it names and call again.' },
  forbidden: { hint: 'This call is not allowed for the agent (message): ask the user to do it in the SurfCAD UI.' },
  unknown_tool: { hint: 'Not a tool of this server: list_commands { group } or the tools list shows the names.' },
  unknown_command: { hint: 'Not a bridge command: list_commands {} shows the names.' },
  unknown_topic: { hint: 'guide {} lists the topics; error topics are errors.<code>.' },
  // Pairing and prompts (MCP side)
  not_paired: { hint: 'pair { code } with the code from SurfCAD → Local agent → Show pairing code, then the user clicks Allow; or set SURFCAD_PAIRING_CODE.', guide: PAIRING_GUIDE },
  pair_pending: { hint: 'The user has not clicked Allow yet: wait a few seconds and retry the same call; do not ask for a new code.', guide: PAIRING_GUIDE },
  pair_rejected: { hint: 'The user clicked Deny: ask them before calling pair again.', guide: PAIRING_GUIDE },
  pair_cancelled: { hint: 'The pairing attempt was cancelled: pair { code } again when the user is ready.', guide: PAIRING_GUIDE },
  pair_failed: { hint: 'Pairing failed (message): check the code (6 characters, from the open tab) and that the tab shows it, then pair again.', guide: PAIRING_GUIDE },
  pairing_lost: { hint: 'The tab or relay dropped and the server re-pairs on its own: retry in a few seconds; do not ask for a new code.', guide: PAIRING_GUIDE },
  bad_pairing_code: { hint: 'pair { code: "......" } with the 6-character code from SurfCAD → Local agent → Show pairing code.', guide: PAIRING_GUIDE },
  relay_unavailable: { hint: 'The local relay is not running: start surfcad-mcp normally (it owns the relay) or set SURFCAD_AGENT_BRIDGE_WS_URL.', guide: PAIRING_GUIDE },
  bridge_error: { hint: 'The tab refused the call without a code: status {} and retry once; tell the user if it repeats.' },
  bad_webhook_url: { hint: 'Webhooks need a public https URL (no credentials, localhost or private hosts): fix it, or poll read_messages { wait_ms: 25000 } instead.', guide: PAIRING_GUIDE },
  no_request: { hint: 'in_reply_to is not an open prompt id: read_messages {} lists the queued prompts.' },
  reply_too_long: { hint: 'Shorten the reply (message gives the limit) or send it in several reply_to_user calls with final on the last.' },
});

export const ERROR_TOPIC_PREFIX = 'errors.';

/** Codes that carry a guide topic (errors.<code>), in table order. */
export const ERROR_TOPIC_CODES = Object.freeze(
  Object.keys(ERROR_HINTS).filter((code) => typeof ERROR_HINTS[code].guide === 'string'),
);

/** @param {string} code */
export function errorTopicName(code) {
  return `${ERROR_TOPIC_PREFIX}${code}`;
}

/**
 * The errors.<code> topic for a code, or null.
 * @param {string} code
 * @returns {{ summary: string, text: string } | null}
 */
export function errorTopic(code) {
  const row = ERROR_HINTS[code];
  if (!row || typeof row.guide !== 'string') return null;
  return {
    summary: row.hint,
    text: `${code}. ${row.hint}\n\n${row.guide}`,
  };
}

/** A hint for a code the table does not know, naming the tool when known. */
function fallbackHint(tool) {
  const schema = tool ? `list_commands { names: ["${tool}"] } shows its args and error codes; ` : '';
  return `Read message and details; ${schema}guide { topic: "limits" } covers budgets and pairing.`;
}

/**
 * Message-aware hints: a code whose recovery depends on what the message says.
 * @param {string} code
 * @param {string} message
 * @returns {{ hint: string, see?: string } | null}
 */
function hintFromMessage(code, message) {
  if (code === 'insert_failed' && /needs a selected edge|could not use the .* selected edge/i.test(message)) {
    return { hint: 'Select a connected edge chain (list_feature_edges → select_edges) and insert with use_selection: true, or author the path from points with sweepPoints / makeSweepPath in an insert_code_snippet block.', see: 'sweep_path' };
  }
  if (code === 'insert_failed' && /needs a body first/i.test(message)) {
    return { hint: 'The part is empty: insert_cube / insert_cylinder / insert_tube (or an extrude from a sketch) first, then this insert again.' };
  }
  if (code === 'insert_failed' && /needs a sketch profile|needs two or more sketch profiles/i.test(message)) {
    return { hint: 'Sketch the profile first: sketch_begin → sketch_add → sketch_commit (one contour per profile), then insert again.' };
  }
  return null;
}

/** The sweep-path story is a topic of its own (M10) even though its code is the generic insert_failed. */
export const EXTRA_ERROR_TOPICS = Object.freeze({
  sweep_path: { summary: 'insert_sweep_path / insert_make_sweep with no edge to follow: pick a chain, or author the path from points', text: `sweep_path. ${SWEEP_GUIDE}` },
});

/**
 * The hint and guide pointer for one error.
 * @param {string} code
 * @param {string} [message]
 * @param {{ tool?: string }} [context]
 * @returns {{ hint: string, see?: string }}
 */
export function hintFor(code, message = '', context = {}) {
  const byMessage = hintFromMessage(code, String(message || ''));
  if (byMessage) {
    return byMessage.see
      ? { hint: byMessage.hint, see: `guide { topic: "${errorTopicName(byMessage.see)}" }` }
      : { hint: byMessage.hint };
  }
  const row = ERROR_HINTS[code];
  if (!row) return { hint: fallbackHint(context.tool) };
  const out = { hint: row.hint };
  if (typeof row.guide === 'string') out.see = `guide { topic: "${errorTopicName(code)}" }`;
  return out;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Add `hint` (and `see` when a topic exists) to an error payload. A hint
 * the bridge already sent is kept. Anything that is not an object with a
 * string code is returned as is.
 * @template T
 * @param {T} payload
 * @param {{ tool?: string }} [context]
 * @returns {T}
 */
export function withErrorHint(payload, context = {}) {
  if (!isPlainObject(payload) || typeof payload.code !== 'string') return payload;
  const { hint, see } = hintFor(payload.code, payload.message, context);
  const out = { ...payload };
  if (typeof out.hint !== 'string' || !out.hint) out.hint = hint;
  if (see && typeof out.see !== 'string') out.see = see;
  return out;
}

/**
 * Hints on the error rows inside a successful tool result: `errors` rows
 * (feature_failed, feature_timeout, geometry_worker_crashed) and the
 * `crash` record. Plain-string rows and rows without a code are left alone.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function withRowHints(value) {
  if (!isPlainObject(value)) return value;
  let out = value;
  if (Array.isArray(value.errors) && value.errors.some((row) => isPlainObject(row) && typeof row.code === 'string')) {
    out = { ...out, errors: value.errors.map((row) => (isPlainObject(row) ? withErrorHint(row) : row)) };
  }
  if (isPlainObject(value.crash) && typeof value.crash.code === 'string') {
    out = { ...out, crash: withErrorHint(value.crash) };
  }
  return out;
}
