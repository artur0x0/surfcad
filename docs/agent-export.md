# Agent export

SurfCAD helpers stay in this repo. The external agent package pins a surfcad repo commit and copies the files in `src/lib/surfcad/catalog/sync-files.json`. It does not keep a second copy of the helper source.

This package is `"private": true`. Do not publish it as npm `surfcad`. That name belongs to the helper library the agent repo publishes.

The live tab is a different surface. `window.surfcad` drives the open SurfCAD page from the main thread. It is not part of the copied helper package. See [Live tab](#live-tab).

## Public surface

| Path | Role |
| --- | --- |
| `src/lib/surfcad/index.js` | Node entry. `loadManifold`, `runScript`, `helperScope`, `HELPER_FUNCTIONS`, `exportResult`, `meshToStl`, `meshTo3mfBytes`, `meshToStepBytes`, `sheetSpecToStep`. |
| `src/lib/surfcad/runtime.js` | Helper implementations, `executeScript`, and `bindWorker`. |
| `src/lib/surfcad/export.js` | STL, 3MF, and STEP from a `runScript` result. |
| `src/workers/sandboxWorker.js` | Browser worker. It only calls `bindWorker`. |
| `src/lib/surfcad/catalog/*.json` | Generated catalogs (below). |

`helperScope(mod)` returns the Manifold API plus `HELPER_FUNCTIONS`. `runScript` also injects the limited `window` import bag and the feature-trace hooks, the same way `executeScript` does.

## Kernel

The headless entry and the worker both need the shipped custom build: `built/manifold.js` and `built/manifold.wasm`. npm `manifold-3d` is a different build. On that package `status()` is the string `'NoError'`; on this build it is an enum object. Goldens and the app use the custom build.

`built/manifold.js` loads the wasm next to itself (`import.meta.url`) under Node. `runScript` / `loadManifold` also accept:

- `manifold` or `module` — an already constructed module
- `modulePath` plus optional `wasmPath` or `locateFile` — another copy of this factory

## Script evaluation

`runScript` calls `executeScript`. The script body is `"use strict";\n` plus the source, passed to `new Function(...helperNames, script)`. A top-level `let` or `const` in the user script shadows a helper of the same name. Do not wrap the script in another function.

`runScript` does not call worker global lockdown. That lockdown replaces `fetch` and other names on the worker global and would freeze the host process. Geometry and the helper scope match the worker.

Helpers close over one module per process, the one bound by `initializeManifold` or `bindManifoldModule`.

`runScript` returns `{ manifold, mesh, volume, surfaceArea, status, tris, boundingBox, bodyCentroids, bodyCount, parts }`. `status` is `'NoError'` when the solid is valid. `parts` is `{ index, at }` per body centroid.

## Exports

`exportResult(result, 'stl' | '3mf' | 'step')` returns bytes (`Uint8Array`).

- STL is binary.
- 3MF is the app's uncompressed OPC zip (`export3MF`).
- STEP is `meshToStep` (coplanar faces merged, curves stay faceted) unless `sheetSpec` is passed, in which case `buildSheetExport` writes true-curve cylinders (`brepToStep`) when the spec folds.

`sheetSpecToStep(spec, { mesh, script, name })` returns `{ bytes, text, stepSource, blocked, dfm, brepError }`. `stepSource: 'spec'` is the true-curve path.

## Catalog

`npm run export:agent` (`scripts/export-agent-catalog.mjs`) rewrites `src/lib/surfcad/catalog/`:

| File | Contents |
| --- | --- |
| `helpers.json` | Every `HELPER_FUNCTIONS` key: name, signature, params (with defaults), description, doc, examples. Sources are JSDoc, `HELPER_FUNCTIONS.md`, and a small gap list in the generator. |
| `manifold.json` | Static constructors and instance methods of `Manifold` and `CrossSection`, plus the module functions, from `built/manifold-encapsulated-types.d.ts`. |
| `assembly.schema.json` | JSON Schema for `.surf.json`. Field rules, groups, and the `// @surf-id` header are [the vault schema](vault-schema.md). |
| `sheet-metal.json` | `part.sheetMetal` (`sku` required), the `// --- sheet-metal begin/end ---` block, `sheetMetalSolid`, DFM rules, and export options. |
| `sync-files.json` | The copy list for an external consumer, plus `regenerate`. |

Regenerate in this repo when a helper is added or its signature or docs change, and when the shipped Manifold `.d.ts` changes. Copy the JSON. Do not regenerate from a partial tree.

`npm run golden:agent-catalog` fails if a `HELPER_FUNCTIONS` key has no catalog entry, or an entry has no signature and one-line description.

## Sync

Pin a surfcad repo commit. Copy every path in `sync-files.json` `runtimeFiles` and `catalogFiles`, keeping those paths. The imports are static ESM relative to those paths, and the wasm sits next to `built/manifold.js`.

That is a sparse copy of the import graph of `src/lib/surfcad/index.js`, not a fork and not an npm subpath of this private package.

## What stays stable

- The keys of `HELPER_FUNCTIONS` (a new key needs a catalog regen; the catalog golden fails until then).
- The `runScript` return shape above.
- The catalog file names.
- `bindWorker` message types the app already sends (`init`, `execute`, `ping`, `previewCut`, `previewBoolean`, `previewBlock`, and the rest of that handler).

## Live tab

`window.surfcad` is the stable surface a browser agent drives, and the surface a future surfcad-agent MCP server relays into unchanged. It is installed from `App.jsx` onto the main window. The worker lockdown replaces `fetch` and the other host globals, so the bridge does not live in the worker. `src/utils/agentBridge.js` owns the envelope, the queue, and the one-undo step. The commands themselves are `src/agent/commands/`.

Each command is `{ name, schema, run(ctx, args), uiEntry?, example }`. `schema` describes the args object in JSON Schema form. `example` is one args object `list_commands` returns with the schema. `uiEntry` is optional: a `data-*` attribute name that already exists on a control, or a helper id. `run` records `data-cad-run`. The other v1 commands have no `uiEntry`. Visible mode highlights `uiEntry` controls (synthetic cursor, flash ring, optional `stepDelayMs` pause) but still runs the same `run` handlers — it does not fork through DOM clicks. `ctx` is the host ref. App fills it with the editor, the part history, `execute`, and the toolbar `undo`, `redo`, and `runScript` handlers. Viewport fills `screenshot` with the same `capturePng` its imperative handle exposes. `fillAgentHost` (`src/agent/host.js`) merges by key.

Quote, order, cart, and checkout are permanently exempt (`src/agent/exempt.js`). They are not commands. A later coverage check may name them only as exempt, with that reason: commerce spends money.

### Adding a command (UI + registry)

1. **Register** `{ name, schema, run(ctx, args), uiEntry, example }` in `src/agent/commands/` and export it from `src/agent/commands/index.js`. `uiEntry` is the helper id (e.g. `makeExtrude`) or a `data-*` id that already exists on the control (e.g. `data-feature-chip`).
2. **Tag the control** with `data-ui-action="<same id as uiEntry>"` on the button or card the user clicks. Helper rail items set `data-ui-action={item.id}` automatically from `HELPER_PALETTE_ITEMS`.
3. **Coverage.** `npm test` (via `scripts/ci/run-unit-tests.mjs`) runs `coverage:agent`. If the command is not ready yet, add the id to `src/agent/coverageAllowlist.js` with a short reason and remove that row when `uiEntry` lands. Allowlist rows must match real tags; the test fails on orphans and on rows for ids that are already covered. Commerce ids never get commands or tags.
4. **Host.** When the command should mirror a button, publish the same handler App or Viewport uses into `fillAgentHost` and call it from `run` (v1 `run` / `undo` still use the mutate path until a later PR wires toolbar parity).

The object is on in dev (`import.meta.env.DEV`). Elsewhere it is opt-in: the page URL `?agent=1`, or localStorage `surfcadAgent` set to `1`. Flag off, `window.surfcad` is absent and the shells are unchanged. `golden:agent-bridge` checks that at 390 and 1280.

### Version

`window.surfcad.version` is `1`. Every envelope carries the same number as `v`.

Additive changes stay on v1:

- appending a command to `commands`
- adding an optional argument (callers that omit it keep working)
- adding a field on a result object
- adding an optional field on an error object (`details`)

Unknown argument fields are ignored, so a newer caller can send a field an older page does not read.

These bump the version: removing or renaming a command, changing what an existing field means, or making a previously optional argument required. A relay reads `version` and `commands` and does not invent names the page did not list.

### Dispatcher

```js
window.surfcad.call(name, argsJson)
```

`name` is one of `window.surfcad.commands`. `argsJson` is a JSON string (what the MCP relay sends) or a plain object (what the convenience wrappers pass). An object is cloned through `JSON.parse(JSON.stringify(...))` before the command runs, so a typed array cannot leak into the result.

The promise resolves to an envelope. It does not reject for a refused command or a script that failed to build.

```json
{ "v": 1, "ok": true, "result": {} }
{ "v": 1, "ok": false, "error": { "code": "unknown_command", "message": "Unknown command: …" } }
```

`ok: true` means the command ran. A script that fails to build is still `ok: true`: the CAD outcome is `result.ok === false` and `result.errors`. `ok: false` means the command itself was refused. There is no `result` on a refusal, and no `error` on a success.

A refusal may carry `error.details`, a JSON object with structured context (H9 pick errors: the candidate keys of an ambiguous face, the mode that owns the canvas, the index of the key that failed). It is optional and additive; a caller that reads only `code` and `message` keeps working.

The envelope and every `result` survive `JSON.stringify` and come back unchanged from `JSON.parse`. No functions, no class instances, no `ArrayBuffer` views. Numbers are finite. `bbox` is `{ "min": [x, y, z], "max": [x, y, z] }` or `null`, with plain arrays.

`get_script`, `status`, `errors`, `list_commands`, and the H2 state readers resolve immediately from the editor, the last finished run, the host ref, or the registry. `set_script`, `run`, `screenshot`, and `undo` run one at a time, in the order they were called.

### Commands

`window.surfcad.commands` is this list, in this order:

| Command | Args | Result |
| --- | --- | --- |
| `get_script` | `{}` | `{ "source": string }` — the editor buffer. |
| `set_script` | `{ "source": string }` | `{ "ok": boolean, "errors": string[], "status": Status }` — writes `source`, runs it, and records one undo step when the text differs from the head. |
| `run` | `{}` | Same shape as `set_script`. Runs the current buffer. One undo step when that buffer is not already the head. The text `set_script` just wrote is not a second step, so undo once removes that edit. |
| `status` | `{}` | `Status` from the last finished `set_script`, `run`, or `undo`. |
| `errors` | `{}` | `{ "errors": [{ "code": string, "message": string, "featureIndex"?: number }] }` — structured messages from the last finished run. `featureIndex` is set when the failing marked block is known. Empty after a good run. |
| `screenshot` | `{ "format": "png" }` | `{ "dataUrl": string }`. `format` may be omitted and defaults to `"png"`. |
| `undo` | `{}` | Same shape as `set_script`. Steps the active part's history once and runs that script. |
| `list_commands` | `{}` | `{ "commands": [{ "name": string, "schema": object, "example": object }] }` — every command, in `commands` order, including this one. `schema` is the args schema. `example` is one args object. No functions, no `uiEntry`. |
| `agent_set_visible` | `{ "enabled"?: boolean, "stepDelayMs"?: number, "cursor"?: boolean, "highlight"?: boolean, "ripple"?: boolean, "easeCamera"?: boolean }` | `{ "options": { … } }` — toggles operator-visible cues (synthetic cursor, control flashes, pacing). Same options can be seeded with `?visible=1`, `?agent=visible`, localStorage `surfcadAgentVisible` = `1`, or env `AGENT_VISIBLE=1`. Does not change command outcomes. |
| `feature_tree` | `{}` | `{ "features": [{ "id", "kind", "label", "chipLabel", "index", "failed", "sheet", "external", "separate" }], "rollbackAnchor": string \| null, "activeChipId": string \| null }` for the active part script. |
| `selection` | `{}` | `{ "activePartId", "cadPartId", "cadPartHighlighted", "face", "edges", "contour": { "armedId", "planeId" } }` — `activePartId` is the editor part. `cadPartId` is the viewer/title highlight (`select_parts`, viewer pick, or `set_active_part`); it falls back to `activePartId` when unset. `cadPartHighlighted` is true when that highlight differs from `activePartId`. Face picks include a `key` `{ at, n, area }` when known. |
| `mode` | `{}` | `{ "app": "cad" \| "game", "viewport": string, "contour", "fillet", "featureEdit", "sheetMetal" }` summary of the open picker / card. |
| `dirty` | `{}` | `{ "workspaceDirty", "assemblyDirty", "renamePending", "legacyCleanup", "partIds": string[], "unsaved", "editedSinceLoad": string[], "undoStackDirty"? }` — git fields (`workspaceDirty`, `partIds`, `assemblyDirty`, …) keep their existing meaning. `unsaved` is true when any part script differs from the snapshot at open or last save/export, or when the active part's undo stack head differs from the live buffer (`undoStackDirty`). `editedSinceLoad` lists those part ids. On a fresh local document with no git baseline, rely on `unsaved` / `editedSinceLoad` rather than `workspaceDirty` / `partIds`. |
| `toasts` | `{}` | `{ "toasts": [{ "id", "kind", "message" }] }` visible upload / git / rename notices. |
| `parts` | `{}` | `{ "activeId", "assemblyName", "parts": [{ "id", "name", "visible" }] }`. |
| `camera` | `{}` | `{ "position", "quaternion", "target", "zoom", "fov" }` arrays or null. |
| `list_faces` | `{ "part_id"?: string }` | `{ "partId", "faces": [{ "key", "center", "normal", "area", "triangleCount" }] }`. `key` is the exact object `select_faces` accepts. Omit `part_id` for the active part mesh. |
| `list_edges` | `{ "part_id"?: string, "raw"?: boolean, "grouped"?: boolean }` | Default `raw: true`: tessellated mesh feature edges (`raw: true` in the result). Set `raw: false` or `grouped: true` for the same payload as `list_feature_edges`. |
| `list_feature_edges` | `{ "part_id"?: string }` | `{ "partId", "grouped": true, "edges": [{ "key": "e0", …, "faceKeyA", "faceKeyB" }] }` — one row per boundary-edge id from the Fillet topo pass (far fewer than raw `list_edges`). |
| `invoke_helper` | `{ "id": string, "params"?: object, "use_selection"?: boolean }` | Runs `composeHelperInsert` on the active part, then the same mutate path as `set_script`. Result includes `{ "helperId", "ok", "errors", "status" }`. Unknown ids → `unknown_helper`. |
| `insert_<helper>` | param fields per `HELPER_PALETTE_ITEMS` | Thin alias for one helper id (e.g. `insert_cube`, `insert_make_extrude`). Same result shape as `invoke_helper`. Each carries `uiEntry` equal to the helper id for coverage. |
| `open_feature` | `{ "id"?: string, "index"?: number }` | Opens the feature sheet or viewport edit card for that strip chip (`data-feature-chip`). Result `{ id, kind, index }`. |
| `activate_feature` | `{ "id"?: string, "index"?: number, "clear"?: boolean }` | Sets `feature_tree.activeChipId` like a strip tap without opening the editor. `clear` clears the highlight. |
| `edit_feature` | `{ "params"?: object }` | Merges param fields into the open edit session (sheet or viewport card) before confirm. |
| `confirm_feature` | `{}` | Accept on the open feature edit (`data-feature-sheet-accept`). Uses the same `mutate` path as `set_script` / `insert_*`: writes the script, runs the viewport build, and records one undo step when the text changes. Result includes `{ ok, id, errors, status, unchanged? }` so `status.volume` is current without a separate `run`. Undo once restores the prior script and geometry. |
| `cancel_feature` | `{}` | Closes the open feature edit without writing. |
| `delete_feature` | `{ "id"?: string, "index"?: number }` | Deletes a feature block (`data-feature-sheet-delete`). With no id/index, deletes the open edit target. One undo step. |
| `rollback_to` | `{ "id"?: string, "index"?: number, "clear"?: boolean, "start"?: boolean }` | Moves the rollback bar (`data-rollback-bar`) only — the same as dragging the bar in the UI. It updates `feature_tree.rollbackAnchor` and re-runs evaluation with that anchor; it does **not** edit the Monaco script and does **not** push undo. `index` `0` is before every feature; `clear` removes the stored anchor. Result `{ rollbackAnchor }`. After `rollback_to`, call `run` only if you need a full rebuild of a script you changed elsewhere; the bar move itself already triggers a viewport run via `executeScript` with the anchor. |
| `select_clear` | `{}` | `{ "cleared": true }` — clears face, edge, and contour picks in the viewport. |
| `select_faces` | `{ "keys": [{ "at", "n", "area" }] }` or `{ "key": … }` | `{ "count": number }`. Uses the same face fingerprints as saved paint keys. |
| `select_edges` | `{ "keys": […] }` | `{ "count": number }`. Each key may be a grouped boundary id (`"e0"` from `list_feature_edges`), a packed mesh string (`"12-34"` from raw `list_edges`), or an object `{ "faceKeyA", "faceKeyB" }` using **face-centre keys** from `list_faces` (`at`, `n`, `area` with `area > 0`). Aliases: `{ "faceA", "faceB" }` or `{ "faceKeys": [keyA, keyB] }`. Grouped keys expand to the same coherent edge chain the viewport stores for UI picks (`va`/`vb`, normals, `boundaryId`). `selection` still returns thin edge rows; `invoke_helper` / `insert_*` with `use_selection: true` read the full pick via `readHelperEdgeContext`. |
| `select_parts` | `{ "part_ids": [string] }` | `{ "partIds": [string] }` — highlights the last id (`cadPartId`) without switching the editor part. |
| `set_active_part` | `{ "part_id": string }` | `{ "partId": string }` — same as choosing a parts row (Monaco + mesh). |
| `camera_set` | `{ "view"?: "iso"\|"front"\|"right"\|"top"\|…, "position"?, "target"?, "fov"? }` | `{ "ok": true }`. Named views use the same presets as `data-view-snap-*`. |
| `camera_fit` | `{}` | `{ "ok": true }` — Zoom to Fit (`data-zoom-to-fit`). |
| `zoom_to_selection` | `{}` | `{ "ok": true }` — frames the current face or edge selection. |
| `sketch_begin` | `{ "entry"?: "crossSection"\|"workplane", "offset"?, "accept_plane"?: boolean, "plane"?: "x"\|"y"\|"z"\|"face" }` | Opens contour sketch mode on the selected planar face (or preset plane). Default `accept_plane: true` leaves the plane card and arms Cursor. |
| `sketch_accept_plane` | `{ "offset"?: number }` | Accepts the plane card and starts drawing (`data-contour-confirm`). |
| `sketch_add` | `{ "tool": "circle"\|"rectangle"\|"polygon"\|"polyline"\|"cursor", …params }` | Switches the contour rail tool and sets profile params (same defaults as the UI). |
| `sketch_commit` | `{}` | Writes the sketch (`makeCrossSection` / workplane) via `mutate` — one undo step when the buffer changes; result includes refreshed `status`. |
| `sketch_dimension` | `{ "kind"?: "length"\|"angle"\|"distance"\|"offset"\|"radius", "value"?, "value_mm"?, "name"?, "picks"?: [{ "kind", "id" }], "edge"?, "line"?, "arc"?, "a"?, "b"?, "dimension_id"? }` | Adds or drives a dimension (same rules as the Dimension card). One `contourBlock` undo when the buffer changes. |
| `sketch_constrain` | `{ "kind": "horizontal"\|"vertical"\|"parallel"\|"perpendicular"\|"tangent"\|"equal"\|"coincident"\|"fix", "picks"?: [{ "kind", "id" }], "side"?, "constraint_id"? }` | Adds a geometric constraint (same rules as the Constrain card). One `contourBlock` undo when the buffer changes. |
| `sketch_cancel` | `{}` | Exits contour mode without writing (`data-contour-exit`). |
| `slot_open` | `{ "kind": "makeExtrude"\|"makeRevolve"\|"makeLoft"\|"makeSweep" }` | Opens the feature slot card (same as tapping Extrude / Revolve / Loft / Sweep on the helper rail). |
| `slot_assign_contour` | `{ "contour_id": string, "role"?: "profile"\|"path"\|"station", "index"?: number }` | Fills a slot from a saved `@contour` id. |
| `slot_set_params` | extrude / revolve / sweep / loft station fields | Updates card params (e.g. `{ "distance": 10 }` on Extrude). |
| `slot_commit` | `{}` | Confirms the slot card and writes the solid feature block — one undo step. Uses the bridge `mutate` path (write + run + `status` refresh), same as `confirm_feature`. Result includes `{ ok, written, status, errors }`. |
| `slot_cancel` | `{}` | Closes the slot card without writing. |
| `pick_begin` | `{ "kind"?: "face"\|"edge"\|"point"\|"line"\|"arc"\|"ref", "tool"?: "filletEdges"\|"chamferEdges"\|"shell"\|"addDraft"\|"moveFace"\|"deleteFace", "keep"?, "min"?, "max"?, "timeout_ms"?, "params"?, "replace"? }` | Opens a pick session (see Pick sessions). Result is the session summary `{ session, target, tool, kind, count, seeded, picks, entries, min, max, opened, editing, expiresInMs }`. |
| `pick_next` | `{ "keys": […] }` or `{ "key": … }`, `"remove"?: boolean` | Picks those keys on the session's consumer, the same as tapping them. A key already picked is skipped (`skipped`), not toggled off. `remove: true` taps them off. Resolves after the viewport shows the picks. |
| `pick_undo` | `{}` | Drops the last agent pick (the card's Undo). |
| `pick_clear` | `{}` | Drops every pick, seeded ones included (the card's Clear). |
| `pick_done` | `{ "accept"?: boolean }` | Ends the session. Without `accept`, the picks stay where they are: on the selection for `insert_* use_selection`, or on the open card. `accept: true` presses the card's own Accept, records one undo step, and waits for the run. Result adds `{ done, accepted, unchanged?, ok?, errors?, status? }`. |
| `pick_cancel` | `{}` | Ends the session and puts the consumer back: a card the session opened is dismissed; otherwise the picks from before `pick_begin` are restored. |
| `pick_state` | `{}` | `{ session, target, kind, viewport, editing }` — the live session summary or null, and what a tap would feed right now. Immediate. |
| `pick_faces` | `pick_begin` fields plus `keys` / `key` and `accept?` | One call: `pick_begin` (kind `face`) → `pick_next` → `pick_done`. Any failure after begin cancels the session. |
| `pick_edges` | same, kind `edge` | Same as `pick_faces` for edges. |
| `pick_points` | `pick_begin` fields plus `kind` (`point` \| `line` \| `arc` \| `ref`) and `keys` | One call on an open contour gesture or hole-centres sketch. UV `{ at: [u, v] }` keys add hole centres. |
| `hole_open` | `{}` | Opens the Hole card. |
| `hole_set_params` | Hole card fields (`size`, `fit`, `dia`, `through`, `depth`, ends, …) | Patches the open Hole card. |
| `hole_begin_centres` | `{}` | Next on the card: opens the centres sketch (plane card first). |
| `hole_commit` | `{}` | Accept on the centres sketch — one undo when the script changes. |
| `hole_cancel` | `{}` | Closes the Hole card or cancels the centres sketch without writing. |
| `plane_set` | `{ preset?, offset?, angles? }` | Edits the open plane card (offset along the normal). |
| `workplane_select` | `{ plane_id }` | Selects a saved construction plane on the plane card. |
| `set_active_workplane` | `{ plane_id }` or `{ clear: true }` | Sets or clears the construction-plane overlay highlight. |
| `list_sketch_entities` | `{}` | `{ points, lines, arcs, refs }` in the open sketch (immediate). |
| `create_assembly` | `{}` | Seeds a blank assembly (Parts **+** → Assembly). One assembly-history undo step when replacing an open document. |
| `create_part` | `{ name?, script? }` | Adds a part row (Parts **+** → Part). Local parts receive a `surf-id` when missing. |
| `open_assembly` | `{ name }` | Opens a vault assembly (git mode). |
| `open_part` | `{ path }` | Opens or links a vault part into the assembly (git mode). |
| `insert_part` | `{ source_assembly }` or `{ name?, script? }` | Inserts another assembly’s parts (git) or adds a new part row (local, same as `create_part`). |
| `joint_open` | `{}` | Opens the Joints create card (`data-joints-button`). Clears CAD part highlight for the joint strip. |
| `joint_set_params` | `{ type?, name?, value_mm?, sense?, opposed? }` | Patches the open joint card (mate type and fields). Returns the merged card fields (`type`, `name`, `valueMm`, …). `planar` is an alias for `coincident`. |
| `joint_pick` | `{ part_id, key, kind? }` or `{ picks: [{ part_id, key, kind? }] }` | Face keys from `list_faces` (or explicit axis/edge keys) — classified like a canvas tap (`cylindrical` walls become axis picks for concentric). |
| `joint_commit` | `{}` | Confirms the joint card (`applyJointCard`). One assembly-history undo step. |
| `joint_cancel` | `{}` | Dismisses the joint card without writing. |
| `joint_select` | `{ joint_id }` | Opens an existing joint from the strip (`data-joint-chip`) in edit mode. |
| `joint_edit` | `{ joint_id?, type?, name?, value_mm?, … }` | Patches a joint in edit mode (optional `joint_id` selects first). Commit with `joint_commit`. |
| `git_move_to_repo` | `{ vault_name? }` | G6: local assembly → vault (mock or real adapter). One assembly-history undo when promoted. |
| `git_save` | `{ message }` | Save (commit) on the current branch — same as the ribbon Save flow after the message step. |
| `git_add_to_repo` | `{ part_id }` | Add one stray/local part into the vault layout (`handleAddToRepo`). |
| `git_behind_resolve` | `{ action: "keep" \| "reload" \| "branch", path?, kind? }` | Get-latest choice for one behind marker. `keep` needs no path when the assembly or a single part is behind. `reload` and `branch` require `confirm: true`. |
| `git_branch_create` | `{ name }` | Create a branch from the current tip. |
| `git_branch_switch` | `{ branch, confirm? }` | Switch working branch. `confirm: true` required when `dirty.workspaceDirty`. |
| `git_branch_delete` | `{ branch, confirm: true }` | Delete a branch ref (not `main`, not current). |
| `git_force_overwrite` | `{ confirm: true }` | Conflict popup → Overwrite main (`handleOverwriteMain`). |
| `git_list_branches` | `{}` | `{ branches, branch }` from `handleListBranches` (immediate). Read-only: allowed even when the real GitHub adapter is active. |

**Real vault guard.** If the live adapter is GitHub (`kind: real`, e.g. a token in storage), the first agent git **write** in a tab opens a consent modal (`data-agent-git-consent-allow` / `data-agent-git-consent-deny`) naming the command and `owner/repo/branch`, e.g. “An agent wants to save to *acme/widgets/main*. Allow agent writes to your GitHub repos for this session?”. **Allow for this session** sets session opt-in and runs the pending command; **Deny** or dismiss sets a session deny flag, returns `real_repo_blocked` with a clear decline message, and does not show the modal again that session. Opt-in also works via URL `?agentGit=real`, localStorage `surfcadAgentGitReal` = `1`, or sessionStorage `surfcadAgentGitRealSession` = `1` after Allow. Headless / playtest / automation (`navigator.webdriver`) never waits on the modal: writes return `real_repo_blocked` immediately with `error.details.reason` `consent_pending`. After a deny, `details.reason` is `consent_declined`. UI Save / branch flows are unaffected.

### Pick sessions

A pick session feeds one consumer, the same one a tap in the viewport would feed:

- **The selection.** No picker card is open. `kind` is required and sets the Face / Edge pick mode (`data-pick-mode-face` / `data-pick-mode-edge`). Picks land on `selection`, which is what `invoke_helper` / `insert_*` read with `use_selection: true` (a face for `insert_hole`, edges for `insert_fillet_edges`, `insert_make_sweep_path`, and the other edge helpers). The selection starts empty unless `keep: true`.
- **A picker card.** `tool` opens Fillet, Chamfer, Shell, Draft, Move Face, or Delete Face through the same enter handler as the rail button. With no `tool`, the open card is the target, including a card `open_feature` opened on a strip chip. A card keeps its preselection or the edit's stored picks unless `keep: false`. `params` sets the card fields first: Fillet `radius`, Chamfer `chamfer`, Shell `wall` / `openingMode`, Draft `angle` / `flip`, Move Face `distance` / `flip`. Draft takes the first face as the neutral plane and drafts the rest.

Keys are the stable ids from `list_faces` (`{ at, n, area, src?, ord? }`) and `list_feature_edges` (`"eN"`; packed mesh keys and `{ faceKeyA, faceKeyB }` pairs also work). A grouped `eN` expands to the coherent edge chain a UI tap stores, and counts as one pick toward `min` / `max`. Seeded entries count one each. Every change republishes the whole list, so the card or selection ends exactly as that sequence of taps would leave it.

One session at a time. A session idle for `timeout_ms` (default 120000, 1000–1800000) expires: the next call that needs it gets `pick_timeout` once, and the picks stay in the viewport. Cut, Boolean, and Move pick bodies and planes, not keyed faces or edges, so they refuse with `picker_busy`; so do the sketch (except an open contour gesture or hole-centres target for sketch kinds), slot cards (use `slot_assign_contour`), the Hole card before centres begin, paint, measure, joints, and sheet metal.

`pick_done { accept: true }` runs the card's Accept unchanged: its gates, its compose, and its edit path. If the card stays open, the result is `accept_refused` with the card's toast as the message, and the session stays open so the agent can fix the picks. On an edit card this is the way to commit changed edge or face picks; `confirm_feature` there writes only the fields.

`Status` is `{ "volume": number \| null, "bbox": { "min": number[3], "max": number[3] } \| null, "partName": string, "featureCount": number }`. `volume` and `bbox` are null when the run failed. `bbox` is millimetres. `featureCount` is the number of marked feature blocks in the script that ran. Before any run, `volume` is null, `bbox` is null, `partName` is `""`, and `featureCount` is `0`.

`set_script`, `run`, and `undo` resolve only after the viewport has run. The editor shows the same text. The stack is the part history the Undo button already uses (`src/utils/partHistory.js`). The first real run may seed an assembly and replace that stack; the bridge snapshots the stack first and writes exactly one step back.

### Error codes

| Code | When |
| --- | --- |
| `unknown_command` | `name` is not in `commands`. |
| `bad_json` | `argsJson` is a string and `JSON.parse` throws. |
| `bad_args` | Args are not a JSON object, are not serialisable (function, class instance, typed array, non-finite number), or a required field has the wrong type (`set_script` `source` must be a string). |
| `confirm_required` | A destructive git command was called without `confirm: true` (`git_branch_delete`, `git_force_overwrite`, `git_behind_resolve` reload/branch, or `git_branch_switch` while the vault working copy is dirty). |
| `real_repo_blocked` | Agent git write while the real GitHub adapter is active without opt-in. `error.details.reason` is `consent_pending` (no answer / headless), `consent_declined` (user denied this session), or omitted when blocked by legacy query/storage-only paths. Message explains consent or decline. |
| `git_error` | Git handler returned `{ status: "error" }` (message in `error.message`). |
| `unsupported_format` | `screenshot` `format` is present and is not `"png"`. |
| `nothing_to_undo` | `undo` is already at the bottom of the stack. The editor and the history do not change. Also `pick_undo` with no agent pick in the session. |
| `screenshot_failed` | The viewport did not return a `data:image/png` URL. |
| `internal` | The command threw unexpectedly. |
| `unknown_face` | `select_faces` / `pick_next` key did not match any patch. From `pick_next`, `details.index` is the failing key. |
| `ambiguous_face` | `select_faces` / `pick_next` key matched more than one patch. From `pick_next`, `details.candidates` lists the matching `list_faces` keys (with `src` / `ord` when tagged) to retry with. |
| `unknown_edge` | `select_edges` / `pick_next` key or face-key pair did not match. From `pick_next`, `details.index` is the failing key. |
| `ambiguous_edge` | `select_edges` / `pick_next` face-key pair matched more than one edge. |
| `unknown_part` | `set_active_part` or `select_parts` id is not in the assembly. |
| `bad_view` | `camera_set` `view` is not a known preset. |
| `no_mesh` | Selection or camera command ran before a solid was shown. |
| `no_selection` | `zoom_to_selection` with no face or edge picked. |
| `camera_failed` | Viewport could not apply the requested camera change. |
| `unknown_feature` | `open_feature`, `delete_feature`, or `rollback_to` id is not in the active script strip. |
| `bad_index` | `open_feature`, `activate_feature`, `delete_feature`, or `rollback_to` index is out of range. |
| `no_feature_edit` | `edit_feature`, `confirm_feature`, or `cancel_feature` with no open feature session. |
| `edit_failed` | Confirm or open refused (stale feature, assembly lock, etc.). |
| `delete_failed` | Delete could not commit to the editor. |
| `no_write_part` | Feature strip or contour commit could not load the writable part. |
| `sketch_open` | `sketch_begin` while another sketch or slot card is open. |
| `no_sketch` | Sketch command while contour mode is closed. |
| `plane_card_open` | `sketch_add` / `sketch_commit` before the plane card is accepted. |
| `empty_sketch` | `sketch_commit` with nothing drawn. |
| `invalid_profile` | Profile params fail `validateContourProfile`. |
| `no_slot` | Slot command while the feature slot card is closed. |
| `slot_not_ready` | `slot_commit` before every required contour slot is filled. |
| `unknown_contour` | `slot_assign_contour` id is not in the script. |
| `commit_failed` | `commitContourPayload` refused (toast / soft-fail). |
| `pick_open` | `pick_begin` while a session is live (pass `replace: true`). `details` is the live session. |
| `no_pick_session` | `pick_next` / `pick_undo` / `pick_clear` / `pick_done` / `pick_cancel` with no session. |
| `pick_timeout` | The session expired after `timeout_ms` idle (reported once), or the viewport did not show a pick or open a card within 6 s. |
| `pick_closed` | The session's card closed, or the selection's Face / Edge mode changed, since the last pick call. The session ends. |
| `picker_busy` | Another mode owns the canvas, or `tool` names a different card than the open one. `details.viewport` names it; `details.hint` says what to call instead when there is one. |
| `wrong_kind` | `kind` does not match the card (`details.kind` is what it picks). |
| `empty_pick` | `pick_done` with nothing picked and `min` > 0. The session stays open. |
| `pick_count` | `pick_done` with fewer than `min` picks. The session stays open. |
| `pick_limit` | `pick_next` would pass `max`, or `pick_begin` with `keep` found more than `max`. The viewport does not change. |
| `pick_rejected` | The consumer kept fewer picks than were sent. The session keeps its previous picks. |
| `not_picked` | `pick_next { remove: true }` with keys that are not picked. |
| `no_card` | `pick_done { accept: true }` on the selection. Call the helper with `use_selection` instead. |
| `accept_refused` | The card's Accept gate refused; `message` is its toast. The session stays open. |

### Convenience methods

These are thin wrappers over `call()`. They pass a plain object as `argsJson`, unwrap `result`, and throw an `Error` with a `code` property when the envelope is `ok: false`. A script that fails to build does not throw: `setScript`, `run`, and `undo` return the CAD outcome, whose own `ok` is false.

| Method | Relays | Returns |
| --- | --- | --- |
| `getScript()` | `get_script` | `source` string |
| `setScript(source)` | `set_script` `{ source }` | `{ ok, errors, status }` |
| `run()` | `run` | `{ ok, errors, status }` |
| `status()` | `status` | `Status` |
| `errors()` | `errors` | `{ code, message, featureIndex? }[]` |
| `screenshot()` | `screenshot` `{ format: "png" }` | `dataUrl` string |
| `undo()` | `undo` | `{ ok, errors, status }`, or throws `nothing_to_undo` |
| `listCommands()` | `list_commands` | The `commands` array from that result |

`scripts/demo/agent-bridge-demo.mjs` is a Playwright agent that uses only `call()` with JSON strings: a box, then a hole, then status and a screenshot, then undo once, then a script that throws.
