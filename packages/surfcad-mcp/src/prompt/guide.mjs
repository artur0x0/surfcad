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
import { BUILD_GUIDANCE } from './buildGuidance.mjs';
import { PROMPT_SERVER_INSTRUCTIONS } from './promptTools.mjs';
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
Topics: guide { topic: "dialect" | "features" | "selection" | "paint" | "limits" | "camera" | "assembly" }; list_helpers { names } documents any script helper.`;

const FEATURES = `Feature blocks. The script of a part is plain JavaScript over the SurfCAD helpers, and the feature strip reads it from marker comments. Every insert_* writes one block:

  // --- cube begin id=cube1 ---
  part = Manifold.cube([40, 40, 20], true);
  // --- cube end id=cube1 ---

The kind sits between "--- " and " begin"; the optional id=<name> follows it. The strip lists blocks in script order and feature_tree returns them as { id, kind, label, chipLabel, index }; a block without id= is still found and addressed by index. Contour, fillet and chamfer blocks use mode markers (contour-mode extrude / revolve / loft / sweep, fillet-mode, chamfer-mode); a saved contour is its own statement that owns its plane:

  const c1 = makeCrossSection({ center, normal, x, y }, solveContour({ ... })); // @contour id=c1

That trailing marker is the contour id (c1, c2, ...). Extrude, Revolve, Loft and Sweep blocks name the contours they use. A freehand script that keeps this marker style keeps per-feature undo, delete and rollback; a set_script without markers is one feature.

What the markers buy you:
- feature_tree {} lists the blocks; open_feature { id | index } opens that block's card, edit_feature { params } merges fields (keys depend on the kind: height, radius, distance; for a move dx, dy, dz, at), confirm_feature {} writes and runs. A confirm that changes nothing on a failing part answers ok: false with the errors.
- delete_feature { id | index } removes the block and runs the part; one undo restores it. Deleting the block that declares part while later blocks use it is confirm_required (details.dependents) until the user agrees and you pass confirm: true.
- rollback_to { id | index } moves the rollback bar and re-evaluates up to there without editing the script; rollback_to { clear: true } removes it.
- undo / redo step the feature-bar stack (sketch session, assembly joints, or the active part) and return applied / reverted labels; a new committed edit clears redo.
- get_script { range: { fromFeature: "cube1", toFeature: "fillet2" } } reads one span of blocks.

Script snippet feature. When no insert_* can do an operation, insert_code_snippet { gap, why, script } adds one block (its first line is // FEATURE-GAP: <missing feature or option> | <why the existing feature did not work>); script reads and sets part. Use set_script { part_id, source } only to rewrite a whole part; part_id must be the active part. Never redeclare a reserved helper name (cut, hole, shell, filletEdges, convexEdges, ...; the set_script description lists them): rename your variable.

Sketch sessions. sketch_begin → sketch_add { tool, ... } / pick_points { kind, keys } → sketch_commit saves a contour; sketch_cancel leaves. In-contour entities are p0, e0, a0, ...; a saved contour is @contour id=c1 in the script.`;

const SELECTION = `Selection. Faces and edges are addressed by keys that survive a rerun of the same script and are invalid after a remesh.

Faces. list_faces { part_id?, filter?, page? } returns one row per face a viewport click selects, all bodies: id (f0, f1, ...), type (planar | cylindrical | curved), center, normal, axis and radius for cylinders, area, and key { at, n, area, src?, ord? } (the same fingerprint the viewport uses). The whole list on a detailed part is 100 KB or more: filter it in the tab. filter { kind, normalWithin: { n, deg }, minArea, maxArea, bbox: { min, max } } keeps the rows that match every given field; page { offset, limit } returns one slice; the result carries total (after the filter) and returned. The top faces: { kind: "planar", normalWithin: { n: [0, 0, 1], deg: 5 } }. Hole walls: { kind: "cylindrical", maxArea }. Pass face_id together with its key to joint_pick so a stale id answers unknown_face instead of picking another face.

Edges. list_feature_edges gives grouped ids e0, e1, ... (a whole edge chain, the stable choice); list_edges gives raw mesh edges. Both take filter { between: [faceKeyA, faceKeyB], minLength, maxLength, bbox } and page.

Picking. select_faces { keys: [...] } and select_edges { keys } set the viewport selection; select_clear {} clears faces, edges and contour picks. pick_begin → pick_next { keys: ["e3"] } → pick_done { accept: true } drives a card's pick session; a keys item is a grouped edge id (eN), a face id (fN), a face key, or an edge face pair { faceKeyA, faceKeyB }.

use_selection is single use. Every successful rebuild (each insert_*, set_script, undo) clears the picks because they index the mesh that was replaced. Pick, insert once with use_selection: true, then pick again before the next one. With nothing selected that insert answers no_selection and writes nothing (never the default face). Every insert_* / invoke_helper result carries usedSelection: true | false. Omit use_selection to take the helper default: the +Z top face for holes, every convex edge for fillet and chamfer.

Fillet and chamfer from a face pick. insert_fillet_edges { use_selection: true, radius } and insert_chamfer_edges { use_selection: true, chamfer } with a face selected take the convex edges whose adjacent face normal is within about 18 degrees of the picked face normal, over the whole body, so on a large part that set can be big and slow (see guide limits). For a precise set, pick grouped edges (list_feature_edges, select_edges { keys: ["e3", "e4"] }) and insert with use_selection: true, or run the card: pick_begin → pick_next → pick_done.

Bodies. insert_move { dx, dy, dz } must name its body: body_index or at (a centroid) from list_bodies {}, face_id or face (key) from list_faces, or use_selection: true with a face selected; nothing named is no_body.`;

const PAINT = `Paint. Colours live on the assembly document (a colors map keyed by the part's surf id), so they persist across reloads and are written by the next git_save; the same part can carry different colours in two assemblies.

Sequence: set_active_part { part_id } → paint_open {} → paint_set_color { color: "#rrggbb" } (hex is an alias) → paint_part {} for the whole part, or paint_faces { keys: [...] } with keys from list_faces → paint_confirm {}. paint_undo {} steps back inside the session, paint_clear {} removes the part's colours, paint_cancel {} / paint_close {} leave without writing.

paint_open is safe straight after create_part or set_active_part: it waits up to 1.5 s for the viewport to take paint mode. Past that it answers not_ready with details.reason (prompt_working while an in-viewer prompt is being worked, or mode_not_ready) and details.retryable: true; call paint_open again. Already open answers { open: true, already: true }. Game mode is bad_view.

Paint writes the working copy only; nothing reaches the vault until git_save.`;

const LIMITS = `Limits and budgets.

Each kernel job has 30 seconds. A run past that budget is treated like a crash: the geometry worker is killed and replaced, the mutate result carries crash { reason: "timeout" }, and errors has one geometry_worker_crashed row with workerRestarted: true. Out of memory and wasm aborts report the same way with reason out_of_memory or wasm_abort. Other parts keep building. Do not ask for a reload and do not retry the same script: simplify the part, lower segment counts, split the body, or pick a smaller edge set, then run again.

What is expensive: filletEdges / chamferEdges over many edges (a face pick on a large body selects every aligned convex edge; pick grouped edges instead), fillets on swept or lofted bodies, high segment counts on tubes, spheres and revolves, boolean chains over dozens of bodies, list_faces on a detailed part (filter and page it), list_commands without a group.

After a timeout. undo waits for the replaced worker, re-runs the restored script and reports that run (with return: "full", status.script is the restored script). If the run still did not report, status.stale: true says the numbers are the previous run's: call run {} again and read status. A status without stale is current.

Result sizes. Over MCP every model-changing tool defaults to return: "status" (no script echo). "summary" adds status.features, "full" echoes the script. Read scripts with get_script, one span with get_script { range }. list_commands { group } returns one tool group (core, feature, insert, pick, sketch, document, joint, paint, measure, fea, sheet, git, export, view, agent); list_commands { names } just those rows; no args is the whole catalog, about 130 KB.

Pairing. A bridge call before pair is not_paired. pair returns pair_pending while the user has not clicked Allow. pairing_lost means the tab or relay dropped and the server re-pairs on its own: retry in a few seconds, do not ask for a new code. Numbers are finite and within ±1,000,000 mm; NaN and Infinity are bad_args.`;

const CAMERA = `Camera and screenshots.

Named views place the camera on one side of the target and look back at it, Z up: iso (camera at +X +Y +Z), front (camera on -Y, looking +Y, so you see the -Y face), back (camera on +Y), right (camera on +X, looking -X, so you see the +X face), left (camera on -X), top (camera on +Z, looking down, -Y up on screen), bottom (camera on -Z), normal_to_sketch (square to the open sketch plane). For a model whose length runs along X, "right" is therefore an end view, not a side elevation; use an explicit pose for that: camera_set { position: [cx, cy - d, cz], target: [cx, cy, cz] } looks along +Y with X across the screen (up defaults to [0, 0, 1] and the view never rolls; fov is optional).

A named view frames the whole assembly as placed, or the highlighted part alone while one is selected (set_active_part or select_parts highlights it; select_clear returns to the assembly), so no camera_fit is needed after it. camera_fit {} frames the model.

Before a screenshot for the user: select_clear {} so highlights and pick rings do not paint the frame, then camera_set, then screenshot { save_to: true } (or a path), which writes the PNG on the MCP host and returns { path, size } instead of base64; max_width or scale downscale, format jpeg with quality shrinks further. An open feature card's view offset is not applied to the capture. Take one after each build stage, and before asking the user to judge proportions.`;

const ASSEMBLY = `Assemblies, placement and joints.

Documents. create_assembly { name? } seeds an empty assembly with one empty part (no seed cube; single-flight per tab; no git write). open_assembly { assembly_id } opens a saved one; list_assemblies {} returns [{ id, name, open }]. parts {} returns assemblyId, activeId and every part row with runState and crash, so a failed part that is not active is visible without switching.

Parts. create_part { name?, script?, position? } adds a part, makes it active and returns its new opaque id. Agent-created parts land at the assembly origin unless position [x, y, z] mm is given; parts created from the UI stagger along +X. The part starts empty; the first insert_* creates the body. Feature tools write the active part, so set_active_part { part_id } before inserting. rename_part changes the label only; delete_part { part_id, scope: "assembly" | "repo" } drops the row (repo also plans the file delete and needs confirm: true).

Reuse. insert_part { part_id } or { assembly_id } inserts by reference (the same id; one definition, several placements). copy: true mints a new id and sets copiedFrom. open_part { part_id } opens a vault part into the document.

Placement. part_get_transform { part_id } / part_set_transform { part_id, position?, rotation? } set a rigid placement: translation in mm, rotation as intrinsic XYZ Euler degrees; one assembly undo step. Use it for final positions after the part is built. A placed part's features, previews and picks are in its own frame; list_faces centers are world coordinates.

Joints. joint_open {} → joint_pick { part_id, face_id?, key? } (a whole part, a face with its key, or an edge) → joint_set_params { type, value?, sense?, opposed? } → joint_commit {}. Fixed takes one pick and no second reference: joint_pick { part_id } alone suggests fixed; a face pick needs joint_set_params { type: "fixed" }. Distance is mm, angle is degrees. Joints are the right tool when two parts must stay related; part_set_transform when one part just needs to sit somewhere.

Hardware. One part per unique fastener type, patterned to every place it goes: list_faces on the fastened part (cylindrical rows, filter by radius) gives each hole's center and axis; insert_pattern_points { points: [{ at, axis }, ...], up } on the fastener part places one instance per hole; insert_array3_d and insert_polar_array cover grids and bolt circles.

Saving. Working-copy tools never commit. git_save { message } is the one vault write; it answers consent_pending while the Allow dialog is up (retry the same call after the user clicks Allow), clean when nothing changed, and passes through pending_save, upgrade_required, conflict and repo-moved unchanged.`;

/** Topic name → one-line summary and the text. Order is the listing order. */
export const GUIDE_TOPICS = Object.freeze({
  start: { summary: 'How to build in SurfCAD (block, build, polish, place), a three-call example, how to read results', text: START },
  dialect: { summary: DIALECT_SUMMARY, text: renderDialectTopic() },
  features: { summary: 'Marker blocks, feature ids, edit / delete / rollback / undo, script snippets, sketches', text: FEATURES },
  selection: { summary: 'Face and edge keys, list_faces filters, single-use picks, no_selection, fillet edge sets', text: SELECTION },
  paint: { summary: 'paint_open → paint_set_color → paint_part / paint_faces → paint_confirm; colours persist with the assembly', text: PAINT },
  limits: { summary: 'The 30 s kernel budget, what is slow, worker restarts and stale status, result sizes, pairing errors', text: LIMITS },
  camera: { summary: 'Which side each named view looks from, explicit poses, select_clear before a screenshot, screenshot to file', text: CAMERA },
  assembly: { summary: 'Documents, create_part placement, insert by reference, part_set_transform vs joints, hardware, git_save', text: ASSEMBLY },
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
  `SurfCAD quick start. Pair, then call guide { topic: "start" } before the first model call; guide {} lists every topic (${GUIDE_TOPIC_NAMES.join(', ')}; every error payload carries hint, and see names its errors.<code> topic).`,
  'Flow, in ribbon order, each stage across the whole assembly before the next: 1 Block: create_part, then insert_cube / insert_cylinder / insert_tube at rough size, screenshot for the user. 2 Build: insert_hole, insert_cut, insert_shell, insert_make_extrude / revolve / sweep / loft. 3 Polish: insert_fillet_edges, insert_chamfer_edges on small edge sets. 4 Place: patterns, insert_move, part_set_transform or joints.',
  'Rules that bite: helper names (cut, hole, shell, ...) are reserved, never redeclare them; set_script needs the active part\'s id (set_active_part first) and only rewrites a whole part, insert_code_snippet { gap, why, script } is the one-operation fallback; use_selection is single use: pick, insert once, pick again (nothing selected is no_selection).',
  'Verify: select_clear → camera_set { view } → screenshot { save_to: true }. right puts the camera on +X, front on -Y, top on +Z.',
  'Save only when the user asks: git_save { message } answers consent_pending until the user clicks Allow; retry the same call.',
  'Keep results small: tools default to return: "status" (no script echo; get_script reads it), list_faces { filter, page }, list_commands { group }.',
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
