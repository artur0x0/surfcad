/**
 * The `guide` tool: agent know-how delivered by the MCP server itself, so a
 * fresh agent does not learn the dialect by inserting scratch features.
 *
 * The initialize `instructions` stay a short quick-start (under 2 KB, hosts
 * truncate long ones) and point here. The long text lives in the topics
 * below. `start` carries the build guidance verbatim (BUILD_GUIDANCE is the
 * one copy, shared with the app side and pinned by a freshness test).
 *
 * Every statement here describes the current tool contract; the catalog
 * (data/commands.json) and docs/agent/SKILL.md are the sources. Keep each
 * topic under 1,500 words.
 */
import { BUILD_GUIDANCE, JOINT_PLACEMENT_GUIDANCE } from './buildGuidance.mjs';
import { BUILDING_STATUS_GUIDANCE, CLOSING_REPLY_GUIDANCE, PROMPT_SERVER_INSTRUCTIONS, PROMPT_TURN_GUIDANCE } from './promptTools.mjs';
import {
  ERROR_TOPIC_CODES,
  ERROR_TOPIC_PREFIX,
  errorTopic,
  errorTopicName,
  EXTRA_ERROR_TOPICS,
  withErrorHint,
} from './errorHints.mjs';
import { loadPackageVersion } from '../packageVersion.mjs';
import { DIALECT_SUMMARY, renderDialectTopic } from '../helpers.mjs';

export const GUIDE_TOOL_NAME = 'guide';

/** Instructions are truncated by some hosts past a few KB; the test pins this. */
export const INSTRUCTIONS_MAX_BYTES = 2048;

const START = `${BUILD_GUIDANCE}

Quick start, three calls after pair:
1. create_part { name: "Hub" } then insert_tube { outerRadius: 20, innerRadius: 14, height: 40 }. The part is active when create_part returns; its result carries the opaque partId. Numbers are mm.
2. list_faces { filter: { kind: "planar", normalWithin: { n: [0, 0, 1], deg: 5 } } } → select_faces { keys: [<that row's key>] } → insert_tap_drill_hole { use_selection: true, size: "M5", u: 0, v: 0 } (or insert_hole). The pick is consumed by this one insert.
3. paint_open {} → paint_set_color { color: "#2f6fdb" } → paint_part {} (or paint_faces { keys }) → paint_confirm {}.
Then select_clear {} → camera_set { view: "iso" } → screenshot { save_to: true } and show the user.

Reading results: every model-changing tool answers { ok, errors, status } with return "status" by default over MCP (no script echo; get_script reads it, get_script { range: { fromFeature, toFeature } } reads one span). status.runState is not_run_yet | ok | failed; errors rows are feature_failed with the viewport's text and a detail reason.
Ids are opaque surf ids from parts, list_assemblies, create_part, create_assembly; never a path or a display name.
Topics: guide { topic: "dialect" | "features" | "selection" | "paint" | "limits" | "camera" | "assembly" | "modeling" | "molding" }; list_helpers { names } documents any script helper.

In-viewer prompt pane. ${CLOSING_REPLY_GUIDANCE} set_status is for progress and does not close the task. ${BUILDING_STATUS_GUIDANCE} Be interactive: post_progress while you work, especially during long reasoning. A fresh surfcad-mcp process per tool call is normal and stays present. A long-lived process is optional and nothing depends on it. Call close_session once when you are done. close_session is not sent on process exit. state "responding" (alias typing) is the bouncing dots after the user sends. Listing parts, faces, edges, or transforms, status, and read_messages never start building. Building stays until the closing reply. reply_to_user takes an in_reply_to that this session actually received; any other id is unknown_prompt and is not shown in the chat. Omit in_reply_to to post one plain-text message to this paired session when no prompt is waiting (not a prompt id, one per second). After read_messages acks a prompt, that id stays in the response's recent list (the last 50 prompts in this session, oldest first, each { id, state }), including on a later empty read_messages {} and on a remote session. An idle session that has not received a prompt has recent: [].

${PROMPT_TURN_GUIDANCE}`;

const FEATURES = `Feature blocks. The script of a part is plain JavaScript over the SurfCAD helpers, and the feature strip reads it from marker comments. Every insert_* writes one block:

  // --- cube begin id=cube1 ---
  part = Manifold.cube([40, 40, 20], true);
  // --- cube end id=cube1 ---

The kind sits between "--- " and " begin"; the optional id=<name> follows it. The strip lists blocks in script order and feature_tree returns them as { id, kind, label, chipLabel, index }; a block without id= is still found and addressed by index. Contour, fillet and chamfer blocks use mode markers (contour-mode extrude / revolve / loft / sweep, fillet-mode, chamfer-mode); a saved contour is its own statement that owns its plane:

  const c1 = makeCrossSection({ center, normal, x, y }, solveContour({ ... })); // @contour id=c1

That trailing marker is the contour id (c1, c2, ...). Extrude, Revolve, Loft and Sweep blocks name the contours they use. A freehand script that keeps this marker style keeps per-feature undo, delete and rollback; a set_script without markers is one feature.

What the markers buy you:
- feature_tree {} lists the blocks; open_feature { id | index } opens that block's card, edit_feature { params } merges fields (keys depend on the kind: height, radius, distance; for a move dx, dy, dz, at), confirm_feature {} writes and runs. A confirm that changes nothing on a failing part answers ok: false with the errors.
- delete_feature { id | index, part_id? } removes the block from the active part and runs it; one undo restores it. A face pick does not retarget it. part_id (an opaque surf id) deletes from that part instead; a path or name is unknown_part. Deleting the block that declares part while later blocks use it is confirm_required (details.dependents) until the user agrees and you pass confirm: true.
- rollback_to { id | index } moves the rollback bar and re-evaluates up to there without editing the script; rollback_to { clear: true } removes it.
- undo / redo step the feature-bar stack (sketch session, assembly joints, or the active part) and return applied / reverted labels; a new committed edit clears redo. On the assembly stack one undo is one action: undoing a joint leaves a part_set_transform of a part that joint does not name, and the next undo reverts that move. A move of a part the joint names is part of the joint step.
- get_script { range: { fromFeature: "cube1", toFeature: "fillet2" } } reads one span of blocks.

Script snippet feature. When no insert_* can do an operation, insert_code_snippet { gap, why, script } adds one block (its first line is // FEATURE-GAP: <missing feature or option> | <why the existing feature did not work>); script reads and sets part. Use set_script { part_id, source } only to rewrite a whole part; part_id must be the active part. Never redeclare a reserved helper name (cut, hole, shell, filletEdges, convexEdges, ...; the set_script description lists them): rename your variable.

Sketch sessions. sketch_begin → sketch_add { tool, ... } / pick_points { kind, keys } → sketch_commit saves a contour; sketch_cancel leaves. A second closed sketch_add adds a loop on the same sketch. insert_make_extrude { height, contour? } extrudes that contour (omitted: the newest saved contour no feature uses yet). slot_assign_contour on Extrude accepts several contours; loop_role is auto, outer, or hole. In-contour entities are p0, e0, a0, ...; a saved contour is @contour id=c1 in the script.`;

const SELECTION = `Selection. Faces and edges are addressed by keys that survive a rerun of the same script and are invalid after a remesh.

Faces. list_faces { part_id?, filter?, page? } returns one row per face a viewport click selects, all bodies: id (f0, f1, ...), type (planar | cylindrical | curved), center, normal, axis and radius for cylinders, area, and key { at, n, area, src?, ord? } (the same fingerprint the viewport uses). frame is "local": center, normal, axis and key.at are the part's own coordinates, including on a placed part, and they match select_faces. Compose with part_get_transform when another part does not share that frame. The whole list on a detailed part is 100 KB or more: filter it in the tab. filter { kind, normalWithin: { n, deg }, minArea, maxArea, bbox: { min, max } } keeps the rows that match every given field. bbox keeps a face whose bounds overlap the box, including a large face whose center is outside it. page { offset, limit } returns one slice; omitting page returns the first 100 faces. The result carries total (after the filter), returned, offset, limit, and nextOffset when another page remains (pass offset: nextOffset). The top faces: { kind: "planar", normalWithin: { n: [0, 0, 1], deg: 5 } }. Hole walls: { kind: "cylindrical", maxArea }. Pass face_id together with its key to joint_pick so a stale id answers unknown_face instead of picking another face.

Edges. list_feature_edges lists every edge by name, the pair of stamped faces it lies between ("plate.top~boss.side", "[k]" for one chain of a pair that meets twice, "*" glob), with the two faces' list_faces keys; that name is the stable reference (select_edges { names }, pick_next { keys }, edgesNamed(part, name) in the script) and survives edits that keep the faces. list_edges gives raw mesh edges, also with name. Legacy e0, e1 ids still resolve but renumber after edits. Both set frame to "local" (midpoints in the same part frame as list_faces) and take filter { between: [faceKeyA, faceKeyB], minLength, maxLength, bbox } and page.

Picking. select_faces { keys: [...] } and select_edges { keys } set the viewport selection; select_clear {} clears faces, edges and contour picks. pick_begin → pick_next { keys: ["e3"] } → pick_done { accept: true } drives a card's pick session; a keys item is a grouped edge id (eN), a face id (fN), a face key, or an edge face pair { faceKeyA, faceKeyB }.

use_selection is single use. Every successful rebuild (each insert_*, set_script, undo) clears the picks because they index the mesh that was replaced. Pick, insert once with use_selection: true, then pick again before the next one. With nothing selected that insert answers no_selection and writes nothing (never the default face). Every insert_* / invoke_helper result carries usedSelection: true | false. Omit use_selection to take the helper default: the +Z top face for holes, every convex edge for fillet and chamfer.

Fillet from a face pick. insert_fillet_edges { use_selection: true, radius } with a face selected takes the convex edges whose adjacent face normal is within about 18 degrees of the picked face normal, over the whole body, so on a large part that set can be big and slow (see guide limits). Chamfer from a face pick. insert_chamfer_edges { use_selection: true, chamfer } writes edgesOf for a named face, including one the face graph calls irregular: that face's boundary only. A face pick with no name that is not planar or cylindrical is refused, not every convex edge. A chamfer that would split the solid fails as feature_failed and the part stays as it was. For a precise set, pick grouped edges (list_feature_edges, select_edges { keys: ["e3", "e4"] }) and insert with use_selection: true, or run the card: pick_begin → pick_next → pick_done.

Bodies. insert_move { dx, dy, dz } must name its body: body_index or at (a centroid) from list_bodies {}, face_id or face (key) from list_faces, or use_selection: true with a face selected; nothing named is no_body.`;

const PAINT = `Paint. Colours live on the assembly document (a colors map keyed by the part's surf id), so they persist across reloads and are written by the next git_save; the same part can carry different colours in two assemblies.

Sequence: set_active_part { part_id } → paint_open {} → paint_set_color { color: "#rrggbb" } (hex is an alias) → paint_part {} for the whole part, or paint_faces { keys: [...] } with keys from list_faces → paint_confirm {}. paint_undo {} steps back inside the session, paint_clear {} removes the part's colours, paint_cancel {} / paint_close {} leave without writing.

paint_open is safe straight after create_part or set_active_part: it waits up to 1.5 s for the viewport to take paint mode. While an in-viewer prompt is being worked it opens headless (the session runs with no card; result headless: true), so a paint during a prompt applies like any other. Past the wait it answers not_ready with details.reason (mode_not_ready) and details.retryable: true; call paint_open again.

Paint writes the working copy only; nothing reaches the vault until git_save.`;

const LIMITS = `Limits and budgets.

Each kernel job has 30 seconds. A run past that budget is treated like a crash: the geometry worker is killed and replaced, the mutate result carries crash { reason: "timeout" }, and errors has one geometry_worker_crashed row with workerRestarted: true. Out of memory and wasm aborts report the same way with reason out_of_memory or wasm_abort. Other parts keep building. Do not ask for a reload and do not retry the same script: simplify the part, lower segment counts, split the body, or pick a smaller edge set, then run again.

What is expensive: filletEdges / chamferEdges over many edges (a face pick on a large body selects every aligned convex edge; pick grouped edges instead), fillets on swept or lofted bodies, high segment counts on tubes, spheres and revolves, boolean chains over dozens of bodies, list_faces on a detailed part (filter and page it), list_commands without a group.

After a timeout. undo waits for the replaced worker, re-runs the restored script and reports that run (with return: "full", status.script is the restored script). If the run still did not report, status.stale: true says the numbers are the previous run's: call run {} again and read status. A status without stale is current.

Result sizes. Over MCP every model-changing tool defaults to return: "status" (no script echo). "summary" adds status.features, "full" echoes the script. Read scripts with get_script, one span with get_script { range }. list_commands { group } returns one tool group (core, feature, insert, pick, sketch, document, joint, paint, measure, fea, sheet, git, export, view, agent); list_commands { names } just those rows; no args is the bridge catalog plus every MCP-only tool this server registers (pair, guide, list_helpers, reply_to_user, set_status, and the other prompt tools) in the agent group.

Pairing. A bridge call before pair is not_paired. pair returns pair_pending while the user has not clicked Allow. pairing_lost means the tab or relay dropped and the server re-pairs on its own: retry in a few seconds, do not ask for a new code. Numbers are finite and within ±1,000,000 mm; NaN and Infinity are bad_args.`;

const CAMERA = `Camera and screenshots.

Named views place the camera on one side of the target and look back at it, Z up: iso (camera at +X +Y +Z), front (camera on -Y, looking +Y, so you see the -Y face), back (camera on +Y), right (camera on +X, looking -X, so you see the +X face), left (camera on -X), top (camera on +Z, looking down, -Y up on screen), bottom (camera on -Z), normal_to_sketch (square to the open sketch plane). For a model whose length runs along X, "right" is therefore an end view, not a side elevation; use an explicit pose for that: camera_set { position: [cx, cy - d, cz], target: [cx, cy, cz] } looks along +Y with X across the screen (up defaults to [0, 0, 1] and the view never rolls; fov is optional).

A named view frames the whole assembly as placed, or the highlighted part alone while one is selected (set_active_part or select_parts highlights it; select_clear returns to the assembly), so no camera_fit is needed after it. camera_fit {} frames the model.

Before a screenshot for the user: select_clear {} so highlights and pick rings do not paint the frame, then camera_set, then screenshot { save_to: true } (or a path), which writes the PNG on the MCP host and returns { path, size } instead of base64; max_width or scale downscale, format jpeg with quality shrinks further. An open feature card's view offset is not applied to the capture. Take one after each build stage, and before asking the user to judge proportions.`;

const ASSEMBLY = `Assemblies, placement and joints.

Documents. create_assembly { name? } seeds an empty assembly with one empty part (no seed cube; single-flight per tab; no git write). open_assembly { assembly_id } opens a saved one; list_assemblies {} returns [{ id, name, open }]. parts {} returns assemblyId, activeId, unjointedParts and every part row with runState and crash, so a failed part that is not active is visible without switching. status carries the same unjointedParts list. unjointedParts is empty for a single-part document; a base part with a fixed joint is omitted.

Parts. create_part { name?, script?, position? } adds a part, makes it active and returns its new opaque id. Agent-created parts land at the assembly origin unless position [x, y, z] mm is given (a rough block-out; joint_create sets the final pose of a part that touches another); parts created from the UI stagger along +X. The part starts empty; the first insert_* creates the body. Feature tools write the active part, so set_active_part { part_id } before inserting. rename_part changes the label only; delete_part { part_id, scope: "assembly" | "repo", confirm? } drops the row (repo deletes parts/<id>.js in one commit, needs confirm: true, and returns the other assemblies that use it).

Reuse. insert_part { part_id } or { assembly_id } inserts by reference (the same id; one definition shared across assemblies). copy: true mints a new id and sets copiedFrom. open_part { part_id } opens a vault part into the document.

Instances. insert_part { part_id, instance: true, position? } adds another placement of a part already in the open assembly: a new row with its own id, name ("Roller (2)"), pose and visibility that shares the definition's script, run and undo history, so set_script on any one rebuilds all of them from one run. parts lists such rows with instanceOf (the definition id). Joints, part_set_transform, set_part_visible and paint act on the one row; set_script, list_faces, export and FEA act on the shared definition. delete_part on an instance keeps the script while another row still places it; the last row to go takes the script with it. Use instances for repeated hardware (rollers, bolts) instead of copies, and joint_create to place each one that touches another. Patterns and instances inside one part (insert_array3_d, insert_polar_array, insert_pattern_points, insert_move) are bodies of that part, not assembly parts.

Placement. ${JOINT_PLACEMENT_GUIDANCE} part_get_transform { part_id } reads a rigid placement: translation in mm, rotation as intrinsic XYZ Euler degrees. A placed part's features, previews and picks are in its own frame. list_faces, list_edges and list_feature_edges set frame to "local" (centers and edge midpoints are part-local, not world); compose them with part_get_transform when another part does not share that frame. part_set_transform { part_id, position?, rotation? } writes that placement in one assembly undo step and is only for a part that touches nothing. create_part and insert_part { position } are a rough block-out. In an assembly of two or more parts, part_set_transform, or create_part / insert_part with a position, returns warning { code: "unjointed_part", part_id, hint } when that part is in no joint. The call still succeeds. A single-part document does not warn, and neither does the base part once it has a fixed joint.

Joints. joint_create { type, picks } is the call. type is coincident, parallel, perpendicular, distance, angle, concentric, symmetric or fixed (planar is coincident). picks come from list_faces: face_id with its key, a cylindrical face as an axis, or { part_id } alone for a whole-part pick. A face_id selects that face, including on a pattern or an instance, and is never an ambiguous axis. A real tie (two different axes) is joint_unsolvable and details.candidates lists each axis id, origin, direction and radius. joint_delete { joint_id } removes one joint and is one undo step. Fixed takes one pick; every other type takes two, one per part. Distance is mm, angle is degrees. list_joints {} lists every joint with status (ok | broken | conflict), reason and picks; status.jointFailures { count, ids } is the short form. A joint goes broken when a later part run no longer has its face (a remesh, a moved or deleted feature) and conflict when it cannot hold with the others; the solve re-runs after every part run, so the strip's red chips and this list agree. A part edit or joint commit that leaves a joint failing returns warning { code: "joint_broken", joints, hint } and still succeeds.

The Joints card is the advanced path for the same write: joint_open {} → joint_pick { part_id, face_id?, key? } (a whole part, a face with its key, or an edge) → joint_set_params { type, value?, sense?, opposed? } → joint_commit {}. Fixed takes one pick and no second reference: joint_pick { part_id } alone suggests fixed; a face pick needs joint_set_params { type: "fixed" }.

Hardware. One part per unique fastener type, patterned to every place it goes: list_faces on the fastened part (cylindrical rows, filter by radius) gives each hole's center and axis in that part's frame (frame is "local"); compose with part_get_transform when the fastener does not share it. insert_pattern_points { points: [{ at, axis }, ...], up } on the fastener part places one instance per hole; insert_array3_d covers a grid. A bolt circle of holes is insert_polar_array { count, boltCircleRadius, axis, boreRadius, boreHeight } on the part being drilled (boreRadius greater than 0 subtracts the holes and does not copy the body; boreRadius 0 copies it; boltCircleRadius defaults to 0, on the axis). Do not record a bolt-circle hole pattern as a FEATURE-GAP.

Saving. Working-copy tools never commit. git_save { message } is the one vault write; it answers consent_pending while the Allow dialog is up (retry the same call after the user clicks Allow), clean when nothing changed, and passes through pending_save, unsupported_vault_version, conflict and repo-moved unchanged. Checked out on main, git_save and git_add_to_repo answer save_on_main and write nothing: git_branch_create { name }, then git_save { message } on that branch. A save is many GitHub round trips: when it is still running after about 20 s, git_save answers { status: "running", saveId } and keeps going; poll git_save_status { save_id } until it answers the save result.`;

const MODELING = `3D modeling guidelines. Follow these on every part; for a part that will be injection molded also read guide { topic: "molding" }.

First part. create_assembly already made the first part and made it active; its result partId is that part. rename_part it and build on it. Do not call create_part for the first part; create_part is for the second part onward.

Order of operations.
- Block out with primitives, then Build and Shape, then Polish, then pattern and place (the ribbon order in guide { topic: "start" }).
- Shell before fillets: insert_shell first, then fillet the concave (inside) edges, then the convex (outside) edges. Filleting every convex edge before the shell can leave the shell as several bodies; shell-first keeps one body and an even wall. Check status.bodyCount is 1 after each step.
- Draft (insert_add_draft) goes before the shell, so the inside walls inherit it.
- Keep edges that must stay sharp (a parting line, a rib base on a molded part) out of the fillet selection: select the faces whose edges you want with select_faces, then insert_fillet_edges { use_selection: true }.

Reuse instead of rebuilding.
- Repeated parts: one part, many instances. insert_part { part_id, instance: true } or a pattern, never a second copy rebuilt by hand. Hardware is one part per unique fastener type, patterned to every place it goes.
- Symmetric geometry: model one half or one side and insert_mirror it.
- Repeated features: insert_hole_pattern for holes, insert_polar_array for bolt circles, insert_array3_d for grids, insert_pattern_points to put one copy on every hole center. Never place the same hole N times.
- Prefer boolean operations with primitives (insert_cube, insert_rounded_box, insert_cylinder, insert_tube, insert_sphere with combine add or subtract, or insert_boolean) over hand sketches. Sketch (sketch_begin, then insert_make_extrude or insert_make_revolve) only for a profile no primitive or primitive boolean gives.
- Features first; insert_code_snippet only for a real feature gap, with its // FEATURE-GAP line.

Assemblies and joints.
- Fix one base part with a fixed joint (joint_create { type: "fixed" }).
- Place every part that touches or attaches to another with joint_create: one call creates the joint and solves the placement. Block-out positions are rough; joints set the final positions.
- Use part_set_transform only for a part that touches nothing. An unjointed_part warning means a touching part has no joint yet: joint it.
- After a part edit, a joint_broken warning means a joint face moved or vanished: list_joints {}, then fix the part or joint_edit to new picks.
- Pick joint faces by stamped name (list_faces, then face_id) rather than by position, so the joint survives later edits; and add joints as soon as two parts mate, not at the end.

Check your work. After each stage: status (runState ok, bodyCount 1 for a one-piece part), screenshot { save_to } from iso plus one useful view, and show the user.`;

/**
 * Design guidelines for high pressure injection molding. The numbers that
 * have a code constant are pinned by test/moldingGuide.test.mjs against
 * src/molding (draft threshold, the 0.5° vertical band, the lifter tilts,
 * the wall thin/thick ratios). Rib ratio, wall range and texture draft are
 * design rules with no code constant.
 */
const MOLDING = `Design guidelines: high pressure injection molding. Follow these whenever the user's part will be injection molded. Check the part with mold_fit and mold_draft before you call it done.

Draft.
- Give every face that slides against the mold at least 1° of draft along the pull. This is also the default mold_draft / mold_dfm threshold.
- Use 0.5° only as a rare exception, and tell the user where.
- 0.25° is acceptable only around ejector sleeves.
- Textured surfaces: use at least 3°, or follow the Mold-Tech recommendation for that specific texture (deeper textures need more draft).
- The checker treats a wall within 0.5° of vertical as vertical. That wall is below threshold, so it is not a pass.

Wall thickness.
- Keep walls between 1 and 6.35 mm. Prefer 1 to 4 mm.
- Never go below 0.75 mm.
- Keep the wall uniform: avoid thin areas under 50% of nominal. mold_fit flags walls thinner than 0.6× nominal as thin and thicker than 1.5× nominal as thick. Fix any flagged region, or explain it to the user.

Ribs.
- Make ribs 0.5 to 0.65× the adjoining wall thickness.
- When a rib must be thicker because it is tall, add a moat (a local groove in the wall at the rib's base) that is 40% of the wall thickness deep and 40% of the wall thickness wide. This keeps the junction from becoming a thick section that sinks or voids.

Ejector side.
- Put holes and rib patterns on the ejector (cavity) side where possible, so the part releases with the ejector half and does not stick in the other half.

Undercuts, slides and lifters.
- Every undercut adds steel and cost. Aim for none.
- mold_fit fit bands: good is 0 undercut regions, fixable is 1 to 4, not_a_fit is 5 or more.
- Slide: withdraws in the parting plane. All trapped features that share one direction on one connected surface are one block, so two holes in one wall are one slide. Group features to share slides.
- Lifter: used only when no in-plane direction frees the region. The checker tries tilts of 15°, 20°, then 25° into the core and takes the first that leaves the part without entering material. 20° is the nominal lifter angle. A feature that needs more than 25° cannot be made with a lifter.
- Unresolved undercut: no straight direction frees it (for example, a slot whose ends narrow toward the outer face). Redesign it. Do not leave it for a special mechanism unless the user agrees.
- A wall within 0.5° of vertical is not a side action. Faces nearly parallel to the motion (under about 3°) do not block it.

What mold_fit checks.
- Pull direction: it searches box axes, large planar normals, and about 80 icosphere directions, and picks the pull with the least occluded undercut area. Pass pull to score your own axis.
- Wall: local thickness per triangle, with nominal, min, max, mean, and median, plus thin regions (under 0.6× nominal) and thick regions (over 1.5×).
- Draft: checked against 1°. Triangles within 0.5° of perpendicular to the pull are not undercuts.
- Parting: core and cavity by visibility, with one outer parting loop.
- sideActions: slides, lifters, and unresolved undercuts. Their count is what the report prices.
- Ejector pin candidate spots: place ejectors on flat, thick, cored-out areas, not on cosmetic faces.
- It is a geometric check, not a supplier DFM. It can run a minute or more on a real part; keep the tab in the foreground.
- Long runs answer a heartbeat. A mold_* analysis still going after about 30 s answers { status: "running", stillRunning: true, jobId, command, phase, percent, elapsedSec, etaSec } instead of the result. That is not the result and not a failure. Call mold_status { job_id }: it waits up to about 30 s and answers the next heartbeat or the final result. Repeat until status is no longer running. Do not call mold_fit again while a job is running; that starts a second analysis.

Edges.
- Avoid sharp edges. Fillet edges and corners everywhere except along the parting line, which must stay sharp so the mold halves shut off cleanly, and at the base of ribs, where the rib-to-wall junction must stay sharp to reduce sink. Do not fillet a rib base.
- Avoid sudden thickness jumps, knife edges, and sharp inside corners (rib bases excepted).

Shape.
- Avoid big openings in the middle of a part. Flow has to split around them and meet again, which leaves knit lines (weak, visible seams).
- Avoid horseshoe or C-shaped parts, because they warp. Add a tie bar or close the shape if the design allows it.
- Avoid very long aspect ratios (more than about 10:1). They warp and often need hot runners.

SurfCAD examples (from the flanged-box side-action playtests).
- Keep the flange flush with the inside wall at the rim, with no step into the cavity.
- Make bosses protrude outward, not into the cavity.
- Keep flange holes clear of the corner fillets.`;

/** Topic name → one-line summary and the text. Order is the listing order. */
export const GUIDE_TOPICS = Object.freeze({
  start: { summary: 'How to build in SurfCAD (block, build, polish, place), a three-call example, how to read results, and the closing reply for an in-viewer prompt', text: START },
  dialect: { summary: DIALECT_SUMMARY, text: renderDialectTopic() },
  features: { summary: 'Marker blocks, feature ids, edit / delete / rollback / undo, script snippets, sketches', text: FEATURES },
  selection: { summary: 'Face and edge keys, list_faces filters, single-use picks, no_selection, fillet edge sets', text: SELECTION },
  paint: { summary: 'paint_open → paint_set_color → paint_part / paint_faces → paint_confirm; colours persist with the assembly', text: PAINT },
  limits: { summary: 'The 30 s kernel budget, what is slow, worker restarts and stale status, result sizes, pairing errors', text: LIMITS },
  camera: { summary: 'Which side each named view looks from, explicit poses, select_clear before a screenshot, screenshot to file', text: CAMERA },
  assembly: { summary: 'Documents, create_part placement, insert by reference, part instances, joint_create as the default assembly path, hardware, git_save', text: ASSEMBLY },
  modeling: { summary: '3D modeling guidelines: build on the create_assembly seed part, shell before fillets, draft before shell, reuse (instances, mirror, patterns) over rebuilding, joints, check bodyCount', text: MODELING },
  molding: { summary: 'Injection molding design rules: draft 1° (0.5° vertical band), walls 1 to 6.35 mm with 0.6× / 1.5× thin and thick flags, ribs, ejector side, slides and lifters (15/20/25°), parting line and rib bases stay sharp, what mold_fit checks', text: MOLDING },
});

/** The core topics, in listing order (the error topics are listed on one line after them). */
export const GUIDE_TOPIC_NAMES = Object.freeze(Object.keys(GUIDE_TOPICS));

/**
 * errors.<code> topics, rendered from the hint table (errorHints.mjs) so a
 * payload's hint and its topic come from one row. sweep_path has no code of
 * its own (the bridge says insert_failed) and is listed with them.
 */
export const ERROR_GUIDE_TOPICS = Object.freeze(Object.fromEntries([
  ...ERROR_TOPIC_CODES.map((code) => [errorTopicName(code), errorTopic(code)]),
  ...Object.entries(EXTRA_ERROR_TOPICS).map(([name, topic]) => [errorTopicName(name), topic]),
]));

export const ERROR_GUIDE_TOPIC_NAMES = Object.freeze(Object.keys(ERROR_GUIDE_TOPICS));

/** Every topic the guide tool and the resources serve: core first, then errors.<code>. */
export const ALL_GUIDE_TOPICS = Object.freeze({ ...GUIDE_TOPICS, ...ERROR_GUIDE_TOPICS });
export const ALL_GUIDE_TOPIC_NAMES = Object.freeze(Object.keys(ALL_GUIDE_TOPICS));

/** MCP resource URI of a topic: the same text as guide { topic }. */
export const GUIDE_RESOURCE_SCHEME = 'surfcad://guide/';

/** @param {string} topic */
export function guideResourceUri(topic) {
  return `${GUIDE_RESOURCE_SCHEME}${topic}`;
}

/** The topic a guide resource URI names, or null. */
export function topicFromResourceUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith(GUIDE_RESOURCE_SCHEME)) return null;
  const topic = uri.slice(GUIDE_RESOURCE_SCHEME.length);
  return Object.prototype.hasOwnProperty.call(ALL_GUIDE_TOPICS, topic) ? topic : null;
}

/**
 * resources/list rows: one per topic, versioned with the package so a host
 * that pins or caches them can tell a newer server's text apart.
 * @param {string} [version]
 */
export function guideResourceList(version = loadPackageVersion()) {
  return ALL_GUIDE_TOPIC_NAMES.map((topic) => ({
    uri: guideResourceUri(topic),
    name: topic,
    title: topic.startsWith(ERROR_TOPIC_PREFIX) ? `SurfCAD error: ${topic.slice(ERROR_TOPIC_PREFIX.length)}` : `SurfCAD guide: ${topic}`,
    description: ALL_GUIDE_TOPICS[topic].summary,
    mimeType: 'text/plain',
    _meta: { version },
  }));
}

/**
 * resources/read contents for one topic URI, or null for a URI this server
 * does not serve.
 * @param {string} uri
 * @param {string} [version]
 */
export function guideResourceContents(uri, version = loadPackageVersion()) {
  const topic = topicFromResourceUri(uri);
  if (!topic) return null;
  return {
    contents: [{
      uri: guideResourceUri(topic),
      mimeType: 'text/plain',
      text: ALL_GUIDE_TOPICS[topic].text,
      _meta: { version },
    }],
  };
}

/**
 * The initialize `instructions`: the webhook line first (clients and
 * goldens pin it), then a quick-start that fits under INSTRUCTIONS_MAX_BYTES
 * and points at `guide start` for the rest.
 */
export const SERVER_INSTRUCTIONS = [
  PROMPT_SERVER_INSTRUCTIONS,
  '',
  `SurfCAD quick start. Pair, then call guide { topic: "start" } before the first model call; guide {} lists the topics (${GUIDE_TOPIC_NAMES.join(', ')}).`,
  'Flow: create_part then insert_cube / insert_cylinder / insert_tube, then insert_hole, insert_cut, insert_shell, insert_fillet_edges. Place: fix one base part with a fixed joint, then joint_create. part_set_transform only for parts that touch nothing.',
  'Rules: use_selection is single use (nothing selected is no_selection). git_save { message } answers consent_pending until Allow. Tools default to return: "status". list_faces { filter, page }. list_commands { group }.',
].join('\n');

export function guideToolDefinition() {
  return {
    name: GUIDE_TOOL_NAME,
    description: `SurfCAD agent guide, plain text. guide { topic } returns one topic; guide {} lists them. Read "start" before the first model call. Topics: ${GUIDE_TOPIC_NAMES.map((n) => `${n} (${GUIDE_TOPICS[n].summary})`).join('; ')}. Error recoveries: errors.<code> for the code an error payload carries (its see field names the topic), e.g. ${ERROR_GUIDE_TOPIC_NAMES.slice(0, 3).join(', ')}. The same texts are the ${GUIDE_RESOURCE_SCHEME}<topic> resources.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        topic: {
          type: 'string',
          enum: [...ALL_GUIDE_TOPIC_NAMES],
          description: 'Which topic to read. Omit to list the topics with one line each.',
        },
      },
    },
  };
}

function topicList() {
  return [
    `SurfCAD guide topics (guide { topic }; also resources ${GUIDE_RESOURCE_SCHEME}<topic>, surfcad-mcp ${loadPackageVersion()}):`,
    ...GUIDE_TOPIC_NAMES.map((n) => `- ${n}: ${GUIDE_TOPICS[n].summary}`),
    `- error recoveries, one per code an error payload names in see: ${ERROR_GUIDE_TOPIC_NAMES.join(', ')}`,
  ].join('\n');
}

/** Second content item of a topic answer: where the same text lives as a resource. */
function resourcePointer(topic) {
  return `Resource: ${guideResourceUri(topic)} (surfcad-mcp ${loadPackageVersion()}).`;
}

/**
 * @param {Record<string, unknown>} args
 * @returns {{ content: Array<{ type: 'text', text: string }>, isError: boolean }}
 */
export function callGuideTool(args) {
  const topic = args && typeof args.topic === 'string' ? args.topic.trim() : '';
  if (!topic) {
    return { content: [{ type: 'text', text: topicList() }], isError: false };
  }
  const entry = ALL_GUIDE_TOPICS[topic];
  if (!entry) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(withErrorHint({
          code: 'unknown_topic',
          message: `Unknown guide topic: ${topic}. Topics: ${GUIDE_TOPIC_NAMES.join(', ')}; error topics: ${ERROR_GUIDE_TOPIC_NAMES.join(', ')}.`,
          topics: ALL_GUIDE_TOPIC_NAMES,
        })),
      }],
      isError: true,
    };
  }
  return {
    content: [
      { type: 'text', text: entry.text },
      { type: 'text', text: resourcePointer(topic) },
    ],
    isError: false,
  };
}
