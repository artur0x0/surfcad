/**
 * Export metadata for bridge commands (description, result, errors, mutation flags).
 * Arg shapes come from each command's `schema` on the registry.
 */

import { MUTATE_RESULT_SCHEMA, STATUS_SCHEMA } from '../schemas/common.js';
import { reservedHelperClause } from '../state/reservedHelpers.js';
import { BUILD_FLOW_NOTE, JOINT_PLACEMENT_GUIDANCE } from '../buildGuidance.js';
import { emitNote } from './insertEmits.js';

const RESERVED_HELPERS = ` ${reservedHelperClause()} list_helpers { names } (over MCP) or guide { topic: "dialect" } documents each helper.`;
/** Every tool that runs geometry says what a kernel crash looks like and what to do. */
export const CRASH_NOTE = ' If the geometry engine crashes under this part (out of memory, a wasm abort, or a run past its 30 s budget) the result is ok: false with crash { code: geometry_worker_crashed, reason: wasm_abort | out_of_memory | timeout | worker_lost, workerRestarted: true } and one failures row with the same code; status.runState is failed. The worker was already replaced and other parts kept building, so do not ask for a reload and do not retry the same script: simplify the part, lower segment counts, or split it into smaller parts, then run it again. When the run past the budget was inside one marked feature block, the part is rebuilt without that block instead: the result is ok: false with one failures row { code: feature_timeout, featureId, featureType, featureLabel, elapsedMs, budgetMs, detail }, status.runState is failed, the other features are built and shown, and status.featureMs (and feature_tree ms) say how long each block took; edit, delete, or undo that feature.';
const USE_SELECTION_RESULT_NOTE = ' The result usedSelection says whether the viewport selection was used. A face pick is written into the script by name (facesNamed for a hole, edgesOf for a fillet or chamfer around that face) and is found again on the new mesh after every rebuild, so a second use_selection insert lands on the same face; an edge pick (select_edges { names }, pick sessions, a tap) is written as edgesNamed(part, "faceA~faceB"), the pair of stamped faces it lies between, which also survives edits. Every face has a name (helper roles, fillet1.round / chamfer2.bevel, import@1.f<k>, <block>.f<k> for freehand). Edge picks still clear with the rebuild (re-pick before the next insert), and use_selection: true with nothing selected is no_selection (nothing is written).';

const UNJOINTED_WARNING_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  description: 'Present when this call placed a part that is in no joint and the assembly has two or more parts. The call succeeded.',
  properties: {
    code: { const: 'unjointed_part' },
    part_id: { type: 'string' },
    hint: { type: 'string' },
  },
});

const UNJOINTED_PARTS_SCHEMA = Object.freeze({
  type: 'array',
  items: { type: 'string' },
  description: 'Part ids in no joint when the assembly has two or more parts. Empty for a single-part document. A base part with a fixed joint is omitted.',
});
/** Appended to tools that run a part: a part edit re-solves every joint that names it. */
export const JOINT_BROKEN_NOTE = ' When the run leaves an assembly joint failing that was not failing before (its face moved or vanished, or it now conflicts), the result adds warning { code: "joint_broken", joints: [{ id, name, type, status, reason, parts }], hint }; the call still succeeds, and status.jointFailures / list_joints show the standing state.';
const FEATURE_COUNT_NOTE = ' featureCount counts insert_* feature blocks, so a freehand set_script is one feature. bodyCount is null until the first run; a finished run that produced no bodies reports 0.';

const OK = Object.freeze({ type: 'object', additionalProperties: false, properties: { ok: { const: true } } });

/** @type {Record<string, { description: string, result?: object, errors?: string[], mutates?: boolean, destructive?: boolean, confirm?: boolean }>} */
export const COMMAND_META = {
  get_script: {
    description: 'Read the Monaco editor buffer for the active part. With range { fromFeature?, toFeature? } (feature_tree ids) it returns only that span of feature blocks plus range { fromFeature, toFeature, startOffset, endOffset, features }; fromFeature alone is that one block. Mutating tools omit status.script over MCP (return: "status"), so this is how the script is read.',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string' },
        range: {
          type: 'object',
          additionalProperties: false,
          properties: {
            fromFeature: { type: 'string' },
            toFeature: { type: 'string' },
            startOffset: { type: 'integer' },
            endOffset: { type: 'integer' },
            features: { type: 'integer' },
          },
        },
      },
    },
    errors: ['bad_args', 'unknown_feature', 'internal'],
    mutates: false,
  },
  set_script: {
    description:
      `Freehand fallback after insert_* feature tools. part_id is required and must be the active part's opaque surf id (a vault path or display name is unknown_part; another id is part_mismatch). Writes that part, runs it, and records one undo step when the text changes. Working copy only: nothing reaches git without an explicit git_save. Preserves or re-injects \`// @surf-id\`. Keep the feature marker blocks (// --- <kind> begin --- … // --- <kind> end ---, and // @contour id=) so the strip keeps per-feature edit, delete, rollback and undo; see guide { topic: "features" }.${RESERVED_HELPERS}${BUILD_FLOW_NOTE}${CRASH_NOTE}${JOINT_BROKEN_NOTE}`,
    result: MUTATE_RESULT_SCHEMA,
    errors: ['bad_args', 'unknown_part', 'part_mismatch', 'no_assembly', 'internal'],
    mutates: true,
  },
  run: {
    description: `Run the current editor buffer; one undo step when it is not already the stack head.${RESERVED_HELPERS}${CRASH_NOTE}${JOINT_BROKEN_NOTE}`,
    result: MUTATE_RESULT_SCHEMA,
    errors: ['internal'],
    mutates: true,
  },
  status: {
    description:
      `Status for the active part: id, name, editor script, runState (not_run_yet | ok | failed), and the last run volume/bbox/bodyCount when available. While runState is failed those three are null and lastGood carries the last successful run's volume/bbox/bodyCount (the solid still shown). Updates when the active part changes without requiring another run. unjointedParts lists part ids in no joint when the assembly has two or more parts (empty for a single part; a base part with a fixed joint is omitted). jointFailures { count, ids } names the assembly joints that do not solve right now (a broken reference or a conflict, the red chips on the joints strip); list_joints has each joint with its status and reason.${FEATURE_COUNT_NOTE}`,
    result: {
      ...STATUS_SCHEMA,
      properties: {
        ...STATUS_SCHEMA.properties,
        unjointedParts: UNJOINTED_PARTS_SCHEMA,
      },
    },
    errors: ['internal'],
    mutates: false,
  },
  errors: {
    description:
      'Structured errors from the last finished geometry run. message is the same text the viewport shows. featureType, featureLabel, and featureIndex identify the failed feature when known. detail is the exception name, a Manifold status, or the kernel message when that text is not already in message. Stack frames and URLs are omitted, and detail is always present on feature_failed: when the kernel adds nothing, it names the helper that threw (move adds how to name the body). Cleared on the next successful run. Feature and kernel failures use code feature_failed. One marked feature block that ran past the time budget while the rest of the part was rebuilt without it is one row with code feature_timeout, featureId, featureType, featureLabel, elapsedMs, budgetMs, workerRestarted: true, and detail (the recovery: fewer edges, a smaller radius, or lower segments; edit, delete, or undo that feature). A geometry engine crash (a wasm abort, out of memory, or a run past its time budget outside any block, or after three retries) is one row with code geometry_worker_crashed, reason (wasm_abort | out_of_memory | timeout | worker_lost), and workerRestarted: the worker was replaced, other parts kept building, and the next run of this part uses the fresh worker; simplify the part, reduce segment counts, or split it up. No reload is needed.',
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
              featureId: { type: 'string' },
              featureType: { type: 'string' },
              featureLabel: { type: 'string' },
              detail: { type: 'string' },
              reason: { type: 'string', enum: ['wasm_abort', 'out_of_memory', 'timeout', 'worker_lost'] },
              workerRestarted: { type: 'boolean' },
              elapsedMs: { type: 'number', description: 'feature_timeout: how long the block ran before the watchdog killed the worker' },
              budgetMs: { type: 'number', description: 'feature_timeout: the budget it ran past' },
            },
          },
        },
      },
    },
    errors: ['internal'],
    mutates: false,
  },
  screenshot: {
    description: 'Capture the viewport, centered on the camera target (an open feature card\'s view offset is not applied to the capture). The default is a full-size PNG data URL. Optional max_width and scale downscale in the browser before encoding. format is png or jpeg; quality (0 to 1) applies to jpeg only.',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dataUrl: { type: 'string' },
        width: { type: 'integer' },
        height: { type: 'integer' },
        format: { type: 'string', enum: ['png', 'jpeg'] },
      },
    },
    errors: ['bad_args', 'unsupported_format', 'screenshot_failed', 'internal'],
    mutates: false,
  },
  undo: {
    description: 'One undo on the feature-bar stack (sketch session, assembly joints, or active part script) and run when the part script changes. An assembly undo reverts one assembly action, so a joint undo leaves a part move that joint does not name. A part step returns the refreshed status, bodyCount included.',
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
    description: 'One redo on the feature-bar stack (assembly joints or active part; sketch has no redo). A part step returns the refreshed status, bodyCount included.',
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
    description: 'List bridge commands with args schema, example, and group. Same names as GET /tools and the MCP bridge tools. Pass names (a list of command names) or group (core, feature, insert, pick, sketch, document, joint, paint, measure, fea, sheet, git, export, view, agent) to get only those rows; the arg description lists what each group holds. No args or group: "all" is the whole catalog, about 130 KB compact, so ask for a group. The result also carries total (every command) and groups (row counts per group); unknown names come back in missing.',
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
              group: { type: 'string' },
            },
          },
        },
        total: { type: 'integer' },
        groups: { type: 'object', additionalProperties: { type: 'integer' } },
        group: { type: 'string' },
        missing: { type: 'array', items: { type: 'string' } },
      },
    },
    errors: ['internal'],
    mutates: false,
  },
  agent_prompt: {
    description:
      'Send a prompt from the floating in-viewer field, or stop, fold / unfold (dismiss folds on desktop), or attach a viewer screenshot. Folding never cancels a run: the prompt slides behind a chevron at the bottom of the screen that shows the agent state (typing dots, working spinner, unread dot) and comes back exactly as it was. Does not edit a part and does not write git.',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        id: { type: 'string' },
        attached: { type: 'boolean' },
        reason: { type: 'string' },
      },
    },
    errors: ['bad_args', 'unavailable', 'internal'],
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
    description: 'Open picker / card mode summary. featureEdit is { mode, featureId, kind, dialog } while any feature edit is open (the App sheet or the viewport card open_feature put up), else null.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  dirty: {
    description: 'Working-copy dirty flags. unsaved is true when the WC differs from the last AssemblyCommit (survives reload; covers rename, hide, and remove). pendingSave is an offline planned write waiting for a second Save. Changing activeId does not set assemblyDirty.',
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
    description: `Open assembly: assemblyId, assemblyName, vaultLayout, activeId, unjointedParts, and parts [{ id, name, visible, missing?, group?, instanceOf?, runState, crash? }]. unjointedParts lists part ids in no joint when the assembly has two or more parts (empty for a single part; a base part with a fixed joint is omitted). instanceOf is the definition a part instance places (insert_part instance:true): rows sharing it share one script and one run and differ in pose, name and visibility. runState is not_run_yet | ok | failed for every part, not only the active one; crash is present after a geometry engine crash on that part ({ code: geometry_worker_crashed, reason, workerRestarted, message }). Part and assembly ids are opaque surf ids, never a path or display name. No path field. featureCount and bodyCount are on status, not here.${FEATURE_COUNT_NOTE}`,
    result: {
      type: 'object',
      additionalProperties: true,
      properties: { unjointedParts: UNJOINTED_PARTS_SCHEMA },
    },
    errors: ['internal'],
    mutates: false,
  },
  set_part_visible: {
    description: 'Hide or show one part, the same working-copy change as the Parts list visibility toggle. part_id is an opaque id: this does not accept a vault path and does not fall back to the active part. This is not agent_set_visible, which toggles operator-visible cues (the synthetic cursor, highlights, and pacing). Working copy only: it does not write git or the vault.',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        partId: { type: 'string' },
        visible: { type: 'boolean' },
      },
    },
    errors: ['bad_args', 'unknown_part', 'no_assembly', 'internal'],
    mutates: true,
  },
  camera: {
    description: 'Current camera pose.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  mold_fit: {
    description: 'Read-only moldability fit for one part mesh, in the part local frame (the same frame as list_faces). Searches candidate pull directions and returns the axis with the fewest undercut regions: fit is good (0), fixable (1 to 4), or not_a_fit (5 or more), plus undercutCount, pull, and pullSource. Pass pull [x, y, z] to score that axis instead and keep its sign. The same result includes wall: a local thickness per triangle, nominal (mode, or the median when no thickness dominates the interior band), max, min, mean, median, and thin and thick regions. Thickness below 0.6× nominal is thin and above 1.5× nominal is thick. Stamped face normals are used when the stamp did not cancel; other triangles use the triangle normal. A geometric check for later molding slices, not a supplier DFM.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'no_mesh', 'internal'],
    mutates: false,
  },
  list_bodies: {
    description: 'Bodies of the active part\'s last run, in mesh order: [{ index, at, triangleCount }]. index is insert_move / insert_rotate body_index; at is the centroid move() and rotateAbout() name (insert_move / insert_rotate at, edit_feature at). Empty before the first run.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  geometry_workers: {
    description: 'Debug status of the geometry workers: cap (workers this device gets, the primary included: min(cores − 1, GB of deviceMemory), 1..4 on a phone, 1..8 on a desktop; the dev override is ?geometryWorkers=N or localStorage surfcadGeometryWorkers), live, busy, queued, peakBusy, crashes, primary { ready, busy, jobs, heapMB, crashes, lastCrash }, and pool { size, live, busy, queued, peakBusy, jobsDone, jobsFailed, members: [{ id, live, busy, jobs, heapMB, recycled, crashes }] }, plus gpu { builds, reuses, disposed, live }: solid geometries built since load (each one uploads to the GPU on its first frame), runs that kept the geometry they already showed because the mesh did not change, geometries disposed, and geometries held now. The parts that are not active build on the pool, several at once; the active part, cross-sections, and previews use the primary. Read-only.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  git_timings: {
    description: 'Debug timing of the last git operation (B17): { last, history, unscoped }. last is the most recent Open or Save span: op, ok, ms, calls (adapter calls), http (round trips on the real adapter; 0 on the mock), byMethod { listTree: { n, ms, failed } }, byEndpoint { "GET git/trees/:sha": { n, ms, failed } } and rows (one per call, in order). history is the last 20 spans without rows. unscoped counts calls made outside any span (background checks). Read-only; it never touches the vault. Set window.__SURFCAD_GIT_TIMING = true for a console line per call.',
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: false,
  },
  list_faces: {
    description: 'Every pickable face on the active part, or on part_id when set (an opaque surf id, never a path or display name). One row per face a viewport click selects, all bodies: id (f0, f1, …), name (feature.role[k] from the helper that built the face: cube1.top, boss.side, extrude2.wall[3]; feature is the marked block id, else <helper>@<n>; absent on faces no helper stamped, such as a hull), feature, role, type (planar, cylindrical, curved), center, normal, axis and radius for cylinders, area, and key. frame is "local" on every result: center, normal, axis and key.at are the part\'s own frame, including when the part is placed, and they match select_faces. Compose with part_get_transform to reach the assembly. The id is the patch index on this mesh and is only valid until the next remesh; a rerun of the same script keeps every id. Pass the key with the id to joint_pick so a stale id cannot silently pick another face. The whole list on a detailed part is 100 KB or more, so filter it in the tab: filter { kind, normalWithin: { n, deg }, minArea, maxArea, bbox: { min, max }, name, feature, role } keeps only faces that match every given field (the top faces: kind "planar", normalWithin { n: [0, 0, 1], deg: 5 }; every face of one feature: feature "boss"; the tops of every feature: role "top"; name / feature / role take a glob with *). bbox keeps a face whose triangle bounds overlap the box, so a large face is included when the box covers any part of it. page { offset, limit } returns one page; omitting page returns the first 100 faces (limit defaults to 100). The result always carries total (rows after the filter), returned, offset, and limit, and nextOffset when another page remains. Walk pages with { offset: nextOffset } until nextOffset is absent.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'no_mesh', 'unknown_part', 'internal'],
    mutates: false,
  },
  list_edges: {
    description: 'Mesh feature edges (raw or grouped). frame is "local": edge midpoints are in the same part frame as list_faces centers, including when the part is placed. Raw rows carry name (faceNameA~faceNameB), faceNameA and faceNameB when both sides are faces a helper built, the names select_edges { names } takes. Raw lists are long: filter { between: [faceKeyA, faceKeyB], minLength, maxLength, bbox } keeps only edges that match every given field (between takes two list_faces keys in either order), and page { offset, limit } returns one page. The result carries total (rows after the filter) and returned.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'no_mesh', 'unknown_part', 'internal'],
    mutates: false,
  },
  list_feature_edges: {
    description: 'Named edges of the active part (or part_id), one row per chain between two stamped faces: key and name ("plate.top~boss.side", with [k] when that pair meets in several chains), faceNameA, faceNameB, faceKeyA, faceKeyB (the same keys list_faces returns, so centres and normals agree), mid, length, closed, chains, ordinal. The name is the stable edge reference: it survives edits that keep the two faces, where the old eN ordinals renumbered after any earlier change; pass it to select_edges { names }, pick_next { keys }, or write edgesNamed(part, name) in a script. A bare pair is every chain of that pair; "[k]" one chain; "*" a glob on either side. Rows come from the mesh that is shown (the rollback bar included), so they agree with list_edges. frame is "local", the same part frame as list_faces and list_edges. filter { between: [faceKeyA, faceKeyB], minLength, maxLength, bbox } and page { offset, limit } as on list_edges.',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_mesh', 'unknown_part', 'internal'],
    mutates: false,
  },
  invoke_helper: {
    description: `Prefer this or insert_* over freehand set_script. Insert a helper palette item on the active part, the same compose path as the UI. Working copy only; git_save commits.${USE_SELECTION_RESULT_NOTE}${BUILD_FLOW_NOTE}${CRASH_NOTE}`,
    result: {
      type: 'object',
      additionalProperties: true,
      properties: {
        helperId: { type: 'string' },
        usedSelection: { type: 'boolean' },
        ok: { type: 'boolean' },
        errors: { type: 'array', items: { type: 'string' } },
        status: STATUS_SCHEMA,
      },
    },
    errors: ['bad_args', 'unknown_helper', 'no_selection', 'insert_failed', 'internal'],
    mutates: true,
  },
  open_feature: {
    description: 'Open the feature sheet or viewport edit card for a strip chip. A saved contour (a contour:<id> chip) has no card: it reopens in the contour sketch and the result says sketchOpen: true with its contourId; edit_feature then patches that sketch and confirm_feature saves and closes it.',
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
  paint: {
    description: 'Paint a whole part, or the given faces, in one call: paint_open → paint_set_color → paint_part (or paint_faces { keys } from list_faces) → paint_confirm, through the same handlers, so one part is one round trip instead of four. color is #RRGGBB. part_id (an opaque surf id) is made active first when it is not already; omit it for the active part. Colours persist with the assembly (paint_confirm writes the colors map; working copy only, git_save commits). A failure after paint mode opened cancels the session and names the step; the step tools stay for a multi-step session.',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        color: { type: 'string', description: '#RRGGBB as applied' },
        painted: { type: 'string', enum: ['part', 'faces'] },
        count: { type: 'integer', description: 'Faces painted, or 1 for the whole part' },
        partId: { type: 'string', description: 'Echoed when part_id was given' },
      },
    },
    errors: ['bad_args', 'unknown_part', 'bad_view', 'not_ready', 'internal'],
    mutates: true,
  },
  paint_open: {
    description: 'Open paint mode on the active part (the Paint chip). Waits up to 1.5 s for the viewport to take the mode, as right after create_part or set_active_part. While an in-viewer prompt is being worked the mode opens headless (the session runs, no card is shown; result headless: true), so paint is never held back by the working state. Past the wait it is not_ready with details.reason and details.retryable: true, never a silent open: false; already open returns already: true. Then paint_set_color, paint_faces or paint_part, paint_confirm.',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        open: { type: 'boolean' },
        already: { type: 'boolean', description: 'Paint mode was already open' },
      },
    },
    errors: ['bad_view', 'not_ready', 'internal'],
    mutates: false,
  },
  edit_feature: {
    description: 'Merge params into the open feature edit session (feature sheet, helper edit card, hole card, or the headless session open_feature keeps while the agent prompt is working and no card may mount). params is an open object so a strict client can send the feature\'s own keys (height, at, dx, …); a key that feature does not use is bad_args and is not stored, and with no open session the result is no_feature_edit rather than a success. Keys depend on the feature kind; for a move, params.at (a list_bodies centroid) re-points it and dx / dy / dz change the offset; for a rotate, angle, axis, center, and at. On a saved contour that open_feature reopened in the sketch, the profile keys patch that sketch: points [[u, v], …] (polyline, replaces a solved sketch), radius and segments (circle), width, height and centered (rectangle), polygon_preset and radius (polygon), or tool to switch; only the keys given change, keys the contour has no use for come back in ignored. edit_feature does not write the script. Confirm with confirm_feature.',
    result: { type: 'object', additionalProperties: true },
    errors: ['no_feature_edit', 'edit_failed', 'bad_args', 'no_sketch', 'plane_card_open', 'internal'],
    mutates: false,
  },
  confirm_feature: {
    description: `Accept the open feature edit and run through mutate. On a reopened saved contour it saves and closes the sketch (the rail checkmark: the @contour statement is rewritten by id and every feature that names it rebuilds) and the result carries sketchClosed: true; a profile that cannot be saved is an error that also closes the sketch, so no sketch is ever left open.${CRASH_NOTE}`,
    result: MUTATE_RESULT_SCHEMA,
    errors: ['no_feature_edit', 'edit_failed', 'no_write_part', 'invalid_profile', 'empty_sketch', 'commit_failed', 'internal'],
    mutates: true,
  },
  cancel_feature: {
    description: 'Close the open feature edit without writing. On a reopened saved contour it also closes the sketch (sketchClosed: true).',
    result: OK,
    errors: ['no_feature_edit', 'internal'],
    mutates: false,
  },
  delete_feature: {
    description: 'Delete a feature block from the active part (or part_id, an opaque surf id) and run that part through mutate, so the result status and errors are current and undo once restores the block. deleted: true means the block is gone; ok is the run after it, so ok: false with deleted: true is a later feature failing on the new solid (read errors), not a delete that did not happen: do not delete again. A face pick does not change the part: id and index resolve against the active part unless part_id names another row (a path or display name is unknown_part). Deleting the feature that declares part while later code still uses it is confirm_required until confirm: true; the result then carries a warning.',
    // Own result: the command returns deletedId, mutate failures, and an
    // optional warning. It does not return unchanged (that stays on MUTATE_RESULT_SCHEMA).
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        deletedId: { type: 'string' },
        deleted: { type: 'boolean', description: 'The block is gone (undo restores it). ok is the run after the delete.' },
        ok: { type: 'boolean' },
        errors: { type: 'array', items: { type: 'string' } },
        failures: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              featureIndex: { type: 'integer' },
              featureId: { type: 'string' },
              featureType: { type: 'string' },
              featureLabel: { type: 'string' },
              detail: { type: 'string' },
            },
          },
        },
        status: STATUS_SCHEMA,
        warning: { type: 'string' },
      },
    },
    errors: ['unknown_feature', 'bad_index', 'bad_args', 'confirm_required', 'delete_failed', 'no_write_part', 'unknown_part', 'internal'],
    mutates: true,
    destructive: true,
    confirm: true,
  },
  rollback_to: {
    description: 'Move the rollback bar and re-run evaluation (does not edit the script, records no undo step). Waits for that evaluation, so the result carries ok, errors and status (volume, bbox, bodyCount) of the rolled-back solid; status {} reads the same values afterwards without a run. An insert_* after rollback_to lands at the bar and the bar moves onto the new block, so it is evaluated.',
    result: {
      type: 'object',
      additionalProperties: true,
      properties: { rollbackAnchor: { type: ['string', 'null'] }, ok: { type: 'boolean' }, errors: { type: 'array', items: { type: 'string' } }, status: STATUS_SCHEMA },
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
    description: 'Select faces by name or by fingerprint key. names: ["boss.top"] takes the face a helper built under that name (from list_faces rows: name; a label without its [k] takes every piece, * is a glob) and selects exactly that face, even where a viewport click would take a merged neighbour; keys: [{ at, n, area }] is the fingerprint path. A named pick carries its name into insert_hole / insert_fillet_edges / insert_chamfer_edges with use_selection, which then resolve it by name in the script (facesNamed / edgesOf) instead of by normal. An unknown name is unknown_face and lists the names on the mesh.',
    result: { type: 'object', additionalProperties: false, properties: { count: { type: 'integer' }, names: { type: 'array', items: { type: 'string' } } } },
    errors: ['bad_args', 'unknown_face', 'ambiguous_face', 'internal'],
    mutates: false,
  },
  select_edges: {
    description: 'Select edges by name, grouped id, or face-key pair. names: ["plate.top~boss.side"] is the edge where those two named faces meet (either order; list_edges rows carry name, faceNameA and faceNameB; [k] picks one chain, * is a glob); keys take the same names, face-key pairs, or legacy grouped ids (e0). An unknown name is unknown_edge and lists the edges on the mesh.',
    result: { type: 'object', additionalProperties: false, properties: { count: { type: 'integer' }, names: { type: 'array', items: { type: 'string' } } } },
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
    description: 'Switch the editor and mesh to a part row. part_id is an opaque surf id from parts, never a path or name.',
    result: { type: 'object', additionalProperties: false, properties: { partId: { type: 'string' } } },
    errors: ['bad_args', 'unknown_part', 'internal'],
    mutates: false,
  },
  camera_set: {
    description: 'Set camera from a named view or explicit pose. A named view frames the whole assembly as placed, or the selected part alone while a part body is highlighted (set_active_part, select_parts; select_clear returns to the assembly), so no camera_fit is needed after it. World views look along fixed axes: front has the camera on -Y looking +Y with +X to the right, right on +X, back on +Y, left on -X, top above with +Y up, bottom below, iso from (+X, +Y, +Z); for a model whose length runs along X, right and left are its ends. Model views read the framed box: side looks at the long flank with the +long axis to the right, front_of_model at the +end of the longest horizontal extent (X wins a tie). An explicit position + target takes an optional up (default [0, 0, 1]) and never rolls the view.',
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
  sketch_edit: {
    description: `One call edits a saved contour: it reopens the contour in the sketch (as open_feature on its contour:<id> chip does), applies ops in order, saves and closes the sketch (the rail checkmark: the @contour statement is rewritten by id and every extrude, revolve, loft or sweep that names it rebuilds, one undo step), and returns the entities the contour now has (points, lines, arcs, dimensions, constraints with their ids). ops: profile (the edit_feature contour params: points [[u, v], …], width / height / centered, radius / segments, polygon_preset, tool), add (the sketch_add fields), constrain (the sketch_constrain fields: kind, picks or a / b / line / point), dimension (the sketch_dimension fields: kind, value, picks or edge / line / arc / a / b, name), delete { id } and undo; params is shorthand for one leading profile op. Dimensions and constraints are saved in the contour (solveContour({ points, lines, arcs, dimensions, constraints })), so the sketch stays parametric across runs and reopens with them. An op that cannot be applied is an error naming the op index and what to send; the sketch is closed without saving, so no sketch is ever left open. unknown_contour when the id is not a saved contour chip, not_a_contour when it is another feature.${CRASH_NOTE}`,
    result: MUTATE_RESULT_SCHEMA,
    errors: ['bad_args', 'unknown_contour', 'not_a_contour', 'no_write_part', 'edit_failed', 'no_sketch', 'invalid_profile', 'empty_sketch', 'commit_failed', 'nothing_to_undo', 'internal'],
    mutates: true,
  },
  sketch_cancel: {
    description: 'Exit contour mode without writing.',
    result: OK,
    errors: ['internal'],
    mutates: false,
  },
  sketch_dimension: {
    description: 'Add or edit a sketch dimension. On a saved contour reopened by open_feature or sketch_edit the gesture stays live in the sketch (result live: true, written: false) and the confirm or sketch_commit writes it with the contour.',
    result: MUTATE_RESULT_SCHEMA,
    errors: ['no_sketch', 'bad_args', 'commit_failed', 'internal'],
    mutates: true,
  },
  sketch_constrain: {
    description: 'Add or edit a sketch constraint. On a saved contour reopened by open_feature or sketch_edit the gesture stays live in the sketch (result live: true, written: false) and the confirm or sketch_commit writes it with the contour.',
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
    description: 'Add or remove picks on the active session. An edge key is an edge name from list_feature_edges ("plate.top~boss.side", "[k]" for one chain, "*" glob), a face-key pair, or a legacy eN id; a face key is a list_faces id (fN) or key.',
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
    description: 'One-shot edge pick session: pick_begin (kind edge) → pick_next { keys } → pick_done. Keys are edge names from list_feature_edges ("plate.top~boss.side"), face-key pairs, or legacy eN ids; with accept: true the card writes edgesNamed(part, …) for the picks.',
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
    description: `Seed a blank assembly with one empty part (no demo script, no seed cube: the first insert_* creates the body). Single-flight per tab: overlapping calls return the same assemblyId. Optional name is a non-unique label. No git write. Returns { assemblyId, assemblyName, activeId, partCount }.${BUILD_FLOW_NOTE}`,
    result: { type: 'object', additionalProperties: true },
    errors: ['internal'],
    mutates: true,
  },
  create_part: {
    description:
      `Add a part and make it the active part before returning. The part starts empty (no seed cube): the first insert_* creates the body. The result partId is a new opaque surf id, not the previously active part. When script is set, that script runs before the call returns (ok, errors, failures, status); a failed script still leaves the part. Agent calls default to the assembly origin; pass position [x,y,z] mm only as a rough block-out. A position, in an assembly of two or more parts, adds warning { code: "unjointed_part", part_id, hint } when the new part is in no joint; the call still succeeds. Working copy only: nothing reaches git without git_save.${BUILD_FLOW_NOTE}`,
    result: {
      type: 'object',
      additionalProperties: true,
      properties: { warning: UNJOINTED_WARNING_SCHEMA },
    },
    errors: ['bad_args', 'no_assembly', 'internal'],
    mutates: true,
  },
  rename_part: {
    description: 'Rename a part display name on the working copy. part_id is an opaque surf id; a path or name is unknown_part. Response { partId, name, moved: false }. No git write; the committed header updates on the next git_save.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'unknown_part', 'no_assembly', 'internal'],
    mutates: true,
  },
  rename_assembly: {
    description: 'Rename the open assembly display name. assembly_id is an opaque surf id, not the current name. Names may collide. Working copy only; moved is false. git_save writes the same assemblies/<id>.surf.json.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'unknown_assembly', 'no_assembly', 'internal'],
    mutates: true,
  },
  part_get_transform: {
    description:
      'Read rigid placement by opaque part_id: position [x,y,z] mm and intrinsic XYZ Euler degrees. A vault path or display name is unknown_part. Does not fall back to the active part.',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        part: { type: 'string' },
        partId: { type: 'string' },
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
      `Set rigid placement by opaque part_id (translation mm, intrinsic XYZ Euler degrees). One assembly undo step. ${JOINT_PLACEMENT_GUIDANCE} In an assembly of two or more parts, placing a part that is in no joint adds warning { code: "unjointed_part", part_id, hint } and does not block the call. A single-part document does not warn, and neither does a base part that already has a fixed joint. A vault path or display name is unknown_part. Working copy only.`,
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        part: { type: 'string' },
        partId: { type: 'string' },
        position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        eulerOrder: { type: 'string', const: 'XYZ' },
        warning: UNJOINTED_WARNING_SCHEMA,
      },
    },
    errors: ['bad_args', 'unknown_part', 'no_assembly', 'internal'],
    mutates: true,
  },
  open_assembly: {
    description: 'Open a vault assembly by opaque assembly_id only. A name or path is unknown_assembly. Does not write git.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'unknown_assembly', 'git_only', 'git_blocked', 'internal'],
    mutates: true,
  },
  open_part: {
    description: 'Open a vault part by opaque part_id and/or assembly_id into the current assembly (reference). No path or name lookup. Does not write git.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'unknown_part', 'unknown_assembly', 'git_only', 'internal'],
    mutates: true,
  },
  insert_part: {
    description: `Insert-as-reference by opaque part_id, or every part of assembly_id (same ids). copy:true mints a new part id and sets copiedFrom. instance:true with the part_id of a row already in the open assembly adds another placement of that part (a part instance): the new row shares the script, run and undo history of its definition (edit any one and all rebuild from one run) and has its own id, name, pose and visibility; position is a rough block-out (default: staggered along +X). ${JOINT_PLACEMENT_GUIDANCE} A position, in an assembly of two or more parts, adds warning { code: "unjointed_part", part_id, hint } when the new row is in no joint; the call still succeeds. The result is { partId (the new row), instanceOf, added, partCount }; parts lists the row with instanceOf. Works on local and git assemblies. A path or name is unknown_part / unknown_assembly. Does not write git.`,
    result: {
      type: 'object',
      additionalProperties: true,
      properties: { warning: UNJOINTED_WARNING_SCHEMA },
    },
    errors: ['bad_args', 'unknown_part', 'unknown_assembly', 'git_only', 'internal'],
    mutates: true,
  },
  list_assemblies: {
    description: 'List the assemblies the Open picker shows as [{ id, name, open }]: saved v2 assemblies, the open working copy (also when it is not saved yet, or local), and on a legacy vault its name-only folders as { id: null, name, legacy: true }. id is an opaque surf id; name is a label, not a key. No path field.',
    result: { type: 'object', additionalProperties: true },
    errors: ['git_blocked', 'internal'],
    mutates: false,
  },
  delete_part: {
    description: 'Drop a part by opaque part_id (a path or name is unknown_part). scope assembly removes the row and does not commit. scope repo, after confirm: true, deletes parts/<id>.js in one commit and returns the assemblies that use the part. A failed scan is delete_refused and writes nothing. Other assemblies are not rewritten.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'unknown_part', 'confirm_required', 'delete_refused', 'conflict', 'pending_save', 'no_assembly', 'internal'],
    mutates: true,
    destructive: true,
    confirm: true,
  },
  delete_assembly: {
    description: 'Delete an assembly by opaque assembly_id, whether it is open or not. Requires confirm: true. One commit deletes assemblies/<id>.surf.json. delete_parts also deletes parts/<id>.js when no other assembly references that id. A never-saved open assembly is removed from the working copy only. Returns the assemblies that use its parts. Nothing is written until confirm: true.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'unknown_assembly', 'confirm_required', 'conflict', 'pending_save', 'delete_refused', 'upgrade_required', 'no_assembly', 'internal'],
    mutates: true,
    destructive: true,
    confirm: true,
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
    description: 'Confirm the joint card and record one assembly undo step. A refused commit, or one that changes nothing (unchanged: true), records no step. The solve re-runs every joint; when this commit leaves another joint failing the result adds warning { code: "joint_broken", joints, hint } and still succeeds.',
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
  joint_create: {
    description: `${JOINT_PLACEMENT_GUIDANCE} Prefer this over hand-computed part_set_transform numbers: one call creates a joint and solves the placement. type is coincident, parallel, perpendicular, distance, angle, concentric, symmetric or fixed (planar is coincident); picks are one row per reference from list_faces (face_id with its key from the same row; a cylindrical face is an axis pick; a face_id is never an ambiguous axis; { part_id } alone is a whole-part pick), one pick for fixed and two for every other type; name, value_mm, sense and opposed as on joint_set_params. Runs the same open → pick → set params → commit path as the Joints card (the advanced path) and records one assembly undo step. The result carries jointId, type, name, valueMm, pickCount and placements: the position and rotation of every picked part after the solve. A pick that does not resolve is unknown_part / unknown_face, and a joint the solver refuses is joint_unsolvable with details.reason and, when more than one axis matches, details.candidates (id, origin, direction, radius); in both cases nothing is written and no card is left open. usedSelection is always false: the picks are explicit. The solve re-runs every joint, so when this joint leaves another one failing the result adds warning { code: "joint_broken", joints, hint } and still succeeds.`,
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'bad_view', 'joints_unavailable', 'no_assembly', 'unknown_part', 'unknown_face', 'ambiguous_face', 'pick_failed', 'no_mesh', 'joint_unsolvable', 'edit_failed', 'internal'],
    mutates: true,
  },
  joint_delete: {
    description: 'Delete one joint by joint_id (the Joints card Delete button) and record one assembly undo step. Remaining joints are solved again. A part move that this joint does not name stays. Undo restores the joint.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'no_assembly', 'unknown_joint', 'edit_failed', 'internal'],
    mutates: true,
    destructive: true,
  },
  list_joints: {
    description: 'Every assembly joint with its solve state: id, name, type, status (ok | broken | conflict), reason (the strip chip tooltip, e.g. "Face not found on Shaft"; only when failing), parts (row ids), picks [{ part_id, kind?, key? }], value_mm or value_deg, sense, opposed. failed { count, ids } is the same list status.jointFailures carries. A joint goes broken when a part run no longer has its face, edge, axis or plane (a remesh, a moved feature, a failed run) and conflict when the solver cannot satisfy it with the others; the solve re-runs after every part run, so this is the standing state. Immediate read, no part run.',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        joints: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              type: { type: 'string' },
              status: { type: 'string', enum: ['ok', 'broken', 'conflict'] },
              reason: { type: 'string' },
              parts: { type: 'array', items: { type: 'string' } },
              picks: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    part_id: { type: 'string' },
                    kind: { type: 'string' },
                    key: { type: 'object', additionalProperties: true },
                  },
                },
              },
              value_mm: { type: 'number' },
              value_deg: { type: 'number' },
              sense: { type: 'integer' },
              opposed: { type: 'boolean' },
            },
          },
        },
        total: { type: 'integer' },
        failed: {
          type: 'object',
          additionalProperties: false,
          properties: { count: { type: 'integer' }, ids: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
    errors: ['internal'],
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
    description: 'The only vault content write, same planSave path as the Save button. message required. Working-copy tools do not commit. consent_pending: Allow dialog is up; retry the same call after the user clicks Allow. pending_save: an offline plan is waiting; Save again when online. upgrade_required: legacy vault; call git_upgrade_vault { confirm: true } after the user agrees. conflict or repo-moved: a remote edit overlaps this Save; git_force_overwrite, or git_behind_resolve { action: "reload" | "branch", confirm: true }, or stop. Results omit path fields. Over the wire a save is many GitHub round trips: when it is still running after about 20 s the call answers { status: "running", saveId } and the save keeps going; poll git_save_status { save_id } until it answers the save result (committed, clean, or the same errors).',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'upgrade_required', 'conflict', 'repo-moved', 'pending_save', 'git_blocked', 'consent_pending', 'real_repo_blocked', 'internal'],
    mutates: true,
  },
  git_save_status: {
    description: 'The outcome of a git_save that answered { status: "running", saveId }: { status: "running", saveId, elapsedMs } while the save is still on the wire, else exactly what git_save would have returned (committed with sha, clean, or its error such as conflict). Read-only and immediate. unknown_save: no save with that id ran past the budget in this tab (git_save answers its result directly when it finishes in time), or it finished more than 10 minutes ago.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'unknown_save', 'conflict', 'repo-moved', 'pending_save', 'internal'],
    mutates: false,
  },
  git_upgrade_vault: {
    description: 'Upgrade a legacy (v1 folder-layout) vault to v2 in one commit of remote tip bytes, then Save a dirty working copy as a second commit under the same confirmation. Requires confirm: true. Never runs on load. On v2 returns already_upgraded. Success is a summary: status, commit SHAs, assemblyIds, counts, leftoverFiles paths, and warnings — not the full plan, file contents, meshes, partBindings paths, or rekey.scripts.',
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string' },
        sha: { type: 'string' },
        upgradeSha: { type: 'string' },
        branch: { type: 'string' },
        commits: { type: 'integer' },
        layout: { type: 'string' },
        assemblyIds: { type: 'array', items: { type: 'string' } },
        counts: {
          type: 'object',
          additionalProperties: false,
          properties: {
            commits: { type: 'integer' },
            assemblies: { type: 'integer' },
            partsKept: { type: 'integer' },
            partsMinted: { type: 'integer' },
            files: { type: 'integer' },
            leftoverFiles: { type: 'integer' },
          },
        },
        leftoverFiles: { type: 'array', items: { type: 'string' } },
        warnings: { type: 'array', items: { type: 'string' } },
        error: { type: 'string' },
      },
    },
    errors: ['confirm_required', 'upgrade_unavailable', 'conflict', 'git_blocked', 'consent_pending', 'real_repo_blocked', 'git_error', 'working_copy_unpersisted', 'internal'],
    mutates: true,
    destructive: true,
    confirm: true,
  },
  git_add_to_repo: {
    description: 'Alias of git_save. Prefer git_save. Same planSave / writeVaultCommit path. Message required. Results omit path fields.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'upgrade_required', 'conflict', 'repo-moved', 'pending_save', 'git_blocked', 'consent_pending', 'real_repo_blocked', 'internal'],
    mutates: true,
  },
  git_behind_resolve: {
    description: 'Conflict / main-moved choice. action reload = Get latest (not a git write). action branch = Save mine to a new branch. Both require confirm: true. action keep is removed (Dismiss is not a tool). No path argument.',
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'confirm_required', 'conflict', 'repo-moved', 'git_blocked', 'consent_pending', 'real_repo_blocked', 'internal'],
    mutates: true,
    destructive: true,
    confirm: true,
  },
  git_branch_create: {
    description: 'Create and switch to a new vault branch from the current tip. If the working copy has uncommitted changes, the branch is created but the session stays on the current branch (same as Parts Create, which does not discard unsaved edits); use git_branch_switch with confirm: true to switch while dirty. If create succeeds but switch fails, the result is still status created with switched: false and switchError set.',
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
    errors: ['confirm_required', 'conflict', 'repo-moved', 'git_blocked', 'consent_pending', 'real_repo_blocked', 'internal'],
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
    description: 'Export the active part mesh, or part_id when set (an opaque surf id, never a path or display name), as STL, 3MF, or STEP bytes, or trigger a browser download.',
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
  description: `Prefer this over freehand set_script. Insert this helper on the active part (set_active_part first) and run it. Numbers are finite and within ±1000000 mm (positions and deltas included); NaN and Infinity are bad_args. Working copy only; git_save commits.${USE_SELECTION_RESULT_NOTE}${BUILD_FLOW_NOTE}${CRASH_NOTE}`,
  result: {
    type: 'object',
    additionalProperties: true,
    properties: {
      helperId: { type: 'string' },
      usedSelection: { type: 'boolean' },
      ok: { type: 'boolean' },
      errors: { type: 'array', items: { type: 'string' } },
      status: STATUS_SCHEMA,
    },
  },
  errors: ['bad_args', 'no_selection', 'insert_failed', 'internal'],
  mutates: true,
};

const INSERT_MOVE_META = {
  ...INSERT_HELPER_META,
  description: `Prefer this over freehand set_script. Move one body of the active part by [dx, dy, dz]. Name the body: body_index or at from list_bodies, face or face_id from list_faces, or use_selection with a selected face. Nothing named and nothing selected is no_body; the origin is never assumed. Working copy only; git_save commits.${BUILD_FLOW_NOTE}${CRASH_NOTE}`,
  errors: ['bad_args', 'no_body', 'no_mesh', 'unknown_face', 'insert_failed', 'internal'],
};

const INSERT_MIRROR_META = {
  ...INSERT_HELPER_META,
  description: `Prefer this over freehand set_script. Mirror the active part, or one body of it, across a plane and keep the original. plane is xy, yz, or xz (through the origin). With no body named the whole part is mirrored (body defaults to part). To mirror one body name it the same way as insert_move: body_index or at from list_bodies, face or face_id from list_faces, or use_selection with a selected face. A workplane or a planar face is picked in the Mirror card. edit_feature on the mirror takes plane, keepOriginal, and at. Working copy only; git_save commits.${BUILD_FLOW_NOTE}${CRASH_NOTE}`,
  errors: ['bad_args', 'no_body', 'no_mesh', 'unknown_face', 'insert_failed', 'internal'],
};

const INSERT_ROTATE_META = {
  ...INSERT_HELPER_META,
  description: `Prefer this over freehand set_script. Rotate one body of the active part by angle degrees (right-hand rule) about the line through center along axis: the Rotate button, directly below Move. axis is x, y, or z (a leading - flips it) or an [ax, ay, az] vector; center is [x, y, z] in mm, or omitted for the body's own centroid; angle defaults to 90. Name the body the same way as insert_move: body_index or at from list_bodies, face or face_id from list_faces, or use_selection with a selected face. Nothing named and nothing selected is no_body; the origin is never assumed. Volume is unchanged and the bounding box follows the turn. edit_feature on the rotate takes angle, axis, center, and at. Working copy only; git_save commits.${BUILD_FLOW_NOTE}${CRASH_NOTE}`,
  errors: ['bad_args', 'no_body', 'no_mesh', 'unknown_face', 'insert_failed', 'internal'],
};

const INSERT_CODE_SNIPPET_META = {
  ...INSERT_HELPER_META,
  description: `The script snippet feature: one operation no feature can do, as its own feature block on the active part, kept next to the insert_* features instead of replacing the whole part. gap names the missing feature or option, why says why the existing feature did not work, script is the operation (it reads and sets part). The block starts with // FEATURE-GAP: <gap> | <why>, which the feature backlog is grepped from. All three are required; an empty one is bad_args. Prefer insert_* whenever a feature can do the job; use set_script only to rewrite a whole part. Working copy only; git_save commits.`,
  errors: ['bad_args', 'insert_failed', 'internal'],
};

const INSERT_POLAR_ARRAY_META = {
  ...INSERT_HELPER_META,
  description: `Prefer this over freehand set_script. Copies the active part's body around an axis, or drills a bolt circle of holes. boreRadius 0 (the default) copies the body; boltCircleRadius 0 (the default) leaves that copy on the axis. boreRadius greater than 0 subtracts count holes of that radius and boreHeight (mm, cutter centered on the axis) at boltCircleRadius, which must be greater than 0 or the insert is bad_args, and does not leave a second copy of the source body. The example args drill 6 holes of radius 3 mm on a 20 mm circle. Use this for a bolt circle of holes; do not insert_code_snippet a FEATURE-GAP for a bolt-circle hole pattern. On an empty part the same bore params insert a circle of pins (there is no body to drill yet); bore 0 and radius 0 there insert pins of radius 3 mm on a 20 mm circle. Working copy only; git_save commits.${BUILD_FLOW_NOTE}${CRASH_NOTE}`,
};

const INSERT_PATTERN_POINTS_META = {
  ...INSERT_HELPER_META,
  description: `Pattern on points (Array Type=Points): one copy of the body at every point, turned so its up axis follows the point's axis when the point has one. points is [[x, y, z], …] or [{ at: [x, y, z], axis: [nx, ny, nz] }, …] in mm (a JSON string of the same is accepted); up is the body axis (x | y | z) that follows a point axis; keepOriginal keeps the source where it is; merge false keeps overlapping copies as separate bodies. Hardware: model one bolt in its own part, then call list_faces on the part it fastens, take the center and axis of each cylindrical hole face (filter by radius), and pass them here with up set to the bolt's own axis; when the holes move, run this again with the new centers. Empty or malformed points are bad_args. Working copy only; git_save commits.`,
  errors: ['bad_args', 'insert_failed', 'internal'],
};

/**
 * Fillets and chamfers are the slow features (MVP-2 step 5): the tool says so
 * in its own description, not only in guide limits, so an agent reading one
 * schema still orders its work and sizes its edge set.
 */
export const BLEND_COST_NOTE = ' Cost: fillets and chamfers are the slow features. Do them last, once the shape is final, on the smallest edge set that does the job (a face pick writes edgesOf for that face only; grouped edges from list_edges for less), because a blend over many edges, or on a swept or lofted body, can run past the 30 s block budget and come back as feature_timeout with the part rebuilt without it.';

const INSERT_BLEND_META = {
  ...INSERT_HELPER_META,
  description: `${INSERT_HELPER_META.description}${BLEND_COST_NOTE}`,
};

/** An insert_* description ends with the code the block carries at default arguments (insertEmits.js). */
function withEmit(name, meta) {
  return { ...meta, description: `${meta.description}${emitNote(name)}` };
}

export function metaForCommand(name) {
  if (COMMAND_META[name]) return COMMAND_META[name];
  if (name === 'insert_move') return withEmit(name, INSERT_MOVE_META);
  if (name === 'insert_rotate') return withEmit(name, INSERT_ROTATE_META);
  if (name === 'insert_mirror') return withEmit(name, INSERT_MIRROR_META);
  if (name === 'insert_code_snippet') return withEmit(name, INSERT_CODE_SNIPPET_META);
  if (name === 'insert_polar_array') return withEmit(name, INSERT_POLAR_ARRAY_META);
  if (name === 'insert_pattern_points') return withEmit(name, INSERT_PATTERN_POINTS_META);
  if (name === 'insert_fillet_edges' || name === 'insert_chamfer_edges') return withEmit(name, INSERT_BLEND_META);
  if (name.startsWith('insert_')) return withEmit(name, INSERT_HELPER_META);
  return {
    description: `Bridge command ${name}.`,
    result: { type: 'object', additionalProperties: true },
    errors: ['bad_args', 'internal'],
    mutates: false,
  };
}
