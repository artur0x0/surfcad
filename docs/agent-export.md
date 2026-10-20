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

`npm run export:agent` (`scripts/export-agent-catalog.mjs`) rewrites `src/lib/surfcad/catalog/` and `src/agent/commands.json`:

| File | Contents |
| --- | --- |
| `helpers.json` | Every `HELPER_FUNCTIONS` key: name, signature, params (with defaults), description, doc, examples. Sources are JSDoc, `docs/helper-functions.md`, and a small gap list in the generator. |
| `manifold.json` | Static constructors and instance methods of `Manifold` and `CrossSection`, plus the module functions, from `built/manifold-encapsulated-types.d.ts`. |
| `assembly.schema.json` | JSON Schema for `.surf.json`. Field rules, groups, and the `// @surf-id` header are [the vault schema](vault-schema.md). |
| `sheet-metal.json` | `part.sheetMetal` (`sku` required), the `// --- sheet-metal begin/end ---` block, `sheetMetalSolid`, DFM rules, and export options. |
| `sync-files.json` | The copy list for an external consumer, plus `regenerate`. |
| `src/agent/commands.json` | Every live-tab bridge command from `V1_COMMANDS`: `name`, `description`, strict JSON Schema `args`, `result` shape, `errors` codes, `mutates`, `destructive`, `confirm` (MCP callers must pass `confirm: true` when true), `immediate`, `uiEntry`, and `example`. Built by `scripts/export-agent-bridge-commands.mjs`. |

Regenerate in this repo when a helper is added or its signature or docs change, when the shipped Manifold `.d.ts` changes, and when a bridge command is added or its args schema changes. Copy the JSON. Do not regenerate from a partial tree.

`npm run golden:agent-catalog` fails if a `HELPER_FUNCTIONS` key has no catalog entry, or an entry has no signature and one-line description.

`npm run golden:agent-commands` (and `src/agent/commandsExport.test.js` in `npm test`) fails when `commands.json` is stale, when a registry command has an incomplete args schema (`additionalProperties: false` at the top level; every property typed), or when export metadata is missing.

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
3. **Coverage.** `npm test` (via `scripts/ci/run-unit-tests.mjs`) runs `coverage:agent` and `commandsExport.test.js`. If the command is not ready yet, add the id to `src/agent/coverageAllowlist.js` with a short reason and remove that row when `uiEntry` lands. Allowlist rows must match real tags; the test fails on orphans and on rows for ids that are already covered. Commerce ids never get commands or tags.
4. **Export.** Run `npm run export:agent` and commit `src/agent/commands.json` when `schema`, `description`, or export metadata changes.
5. **Lint (R2).** New `button` elements with `onClick` in harness surfaces (toolbar, rails, mode chips, feature/sheet cards, `FeatureStrip`, `CrossSectionPanel`, `AgentBridgePairing`, etc. — see `eslint.config.js`) must include `data-ui-action` on the same element (ESLint `no-restricted-syntax`).
6. **Host.** When the command should mirror a button, publish the same handler App or Viewport uses into `fillAgentHost` and call it from `run` (v1 `run` / `undo` still use the mutate path until a later PR wires toolbar parity).

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
| `set_script` | `{ "part_id": string, "source": string }` | `{ "ok": boolean, "errors": string[], "failures"?: ErrorRow[], "status": Status }` — freehand fallback after `insert_*`. `part_id` is required and must be the active part's opaque surf id (a path or name is `unknown_part`; another id is `part_mismatch`). Writes `source`, runs it, and records one undo step when the text differs from the head. Re-injects `// @surf-id` when the text lacks it. Working copy only. `errors` is the viewport popup text. `failures` repeats the structured rows from `errors` (code, feature type, label, index, detail). A run that keeps a recovered mesh after a feature throw is still `ok: false`. |
| `run` | `{}` | Same shape as `set_script`. Runs the current buffer. One undo step when that buffer is not already the head. The text `set_script` just wrote is not a second step, so undo once removes that edit. |
| `status` | `{}` | `Status` for the **active** part (`partId`, `partName`, `script`, `runState`: `not_run_yet` \| `ok` \| `failed`, plus last-run `volume` / `bbox` / `bodyCount` for that part). Updates on `set_active_part` without requiring another `run`. `runState` is `not_run_yet` until the part's first run finishes and never for a part `create_part` returned (it runs the new part, blank starter included, before it returns); `bodyCount` is set after `undo` / `redo` like after `run`. |
| `errors` | `{}` | `{ "errors": [{ "code": "feature_failed" \| "build_failed", "message": string, "featureId"?: string, "featureType"?: string, "featureLabel"?: string, "featureIndex"?: number, "detail"?: string }] }` — `message` is the same text the viewport shows. `feature_failed` is a kernel or feature error; type, label, and index are set when the marked block is known. `detail`, when present, is the exception name, a Manifold status, or the kernel message, when that text is not already in `message`; when the kernel adds nothing, `detail` names the helper that threw (and for `move`, how to name the body), so `feature_failed` rows always carry `detail`. Stack frames and URLs are omitted. Empty after the next successful run. |
| `screenshot` | `{ "format": "png" }` | `{ "dataUrl": string }`. `format` may be omitted and defaults to `"png"`. The capture is centered on the camera target: the view offset an open feature card uses to pan the model above the card is not applied to it, so the framed model is not cropped. |
| `undo` | `{}` | One feature-bar undo (sketch session, assembly joints when `cadPartId` is null, else active part script). `{ ok, kind: "sketch" \| "assembly" \| "part", applied: { label, … }, reverted: { label, … }, status?, errors? }`. Part steps include `status` like `set_script`. Assembly steps include joint `reverted` metadata (H11). Sketch steps report depth. No separate bridge stack. |
| `redo` | `{}` | One feature-bar redo (assembly or part; sketch redo is disabled in the UI). Same `applied` / `reverted` / `reapplied` labels as undo. `nothing_to_redo` when the strip Redo button would be disabled. |
| `history` | `{}` | `{ kind, head, canUndo, canRedo, entries: [{ index, label, current }], partId? }` for the stack the next undo/redo would use. Immediate read. |
| `list_commands` | `{}` | `{ "commands": [{ "name": string, "schema": object, "example": object }] }` — every command, in `commands` order, including this one. `schema` is the args schema. `example` is one args object. No functions, no `uiEntry`. |
| `agent_set_visible` | `{ "enabled"?: boolean, "stepDelayMs"?: number, "cursor"?: boolean, "highlight"?: boolean, "ripple"?: boolean, "easeCamera"?: boolean }` | `{ "options": { … } }` — toggles operator-visible cues (synthetic cursor, control flashes, pacing). Same options can be seeded with `?visible=1`, `?agent=visible`, localStorage `surfcadAgentVisible` = `1`, or env `AGENT_VISIBLE=1`. Does not change command outcomes. |
| `feature_tree` | `{}` | `{ "features": [{ "id", "kind", "label", "chipLabel", "index", "failed", "sheet", "external", "separate" }], "rollbackAnchor": string \| null, "activeChipId": string \| null }` for the active part script. |
| `selection` | `{}` | `{ "activePartId", "cadPartId", "cadPartHighlighted", "face", "edges", "contour": { "armedId", "planeId" } }` — `activePartId` is the editor part. `cadPartId` is the viewer/title highlight (`select_parts`, viewer pick, or `set_active_part`); it falls back to `activePartId` when unset. `cadPartHighlighted` is true when that highlight differs from `activePartId`. Face picks include a `key` `{ at, n, area }` when known. |
| `mode` | `{}` | `{ "app": "cad" \| "game", "viewport": string, "contour", "fillet", "featureEdit", "sheetMetal" }` summary of the open picker / card. `featureEdit` is `{ mode, featureId, kind, dialog }` while any feature edit is open: the App sheet or the viewport's own card (helper card, fillet card, contour reopen), so it is set after `open_feature` and null after confirm or cancel. |
| `dirty` | `{}` | `{ "workspaceDirty", "assemblyDirty", "renamePending", "legacyCleanup", "partIds": string[], "unsaved", "editedSinceLoad": string[], "undoStackDirty"? }` — git fields (`workspaceDirty`, `partIds`, `assemblyDirty`, …) keep their existing meaning. `unsaved` is true when any part script differs from the snapshot at open or last save/export, or when the active part's undo stack head differs from the live buffer (`undoStackDirty`). `editedSinceLoad` lists those part ids. On a fresh local document with no git baseline, rely on `unsaved` / `editedSinceLoad` rather than `workspaceDirty` / `partIds`. `editedSinceLoad` is keyed by the document identity (id or name, plus source), so adding or removing a part keeps the other parts' edits; a new part joins the snapshot with its starter. |
| `toasts` | `{}` | `{ "toasts": [{ "id", "kind", "message" }] }` visible upload / git / rename notices, plus the viewport execution error (`id: "execution-error"`) while that popup is showing. |
| `parts` | `{}` | `{ "activeId", "assemblyName", "parts": [{ "id", "name", "visible" }] }`. |
| `camera` | `{}` | `{ "position", "quaternion", "target", "zoom", "fov" }` arrays or null. |
| `list_faces` | `{ "part_id"?: string }` | `{ "partId", "faces": [{ "id", "type", "kind", "key", "center", "normal", "area", "triangleCount", "axis"?, "radius"? }] }`. One row per face a single viewport click selects (the face-graph patch), on every body in the mesh, with no size filter. `id` is `f<N>`, the patch id; it is the same on a rerun of the same script, and `joint_pick` accepts it as `face_id`. `type` is `planar`, `cylindrical`, or `curved`. Cylindrical rows add `axis: { at, dir, radius }` and `radius`. `key` is the exact object `select_faces` accepts. Omit `part_id` for the active part mesh. |
| `list_bodies` | `{}` | `{ "partId", "bodies": [{ "index", "at": [x, y, z], "triangleCount" }] }` — the active part's bodies from its last run, in mesh order. `index` is `insert_move` `body_index`; `at` is the centroid `move()` names (`insert_move` `at`, `edit_feature` `at` on a move). Empty before the first run. |
| `list_edges` | `{ "part_id"?: string, "raw"?: boolean, "grouped"?: boolean }` | Default `raw: true`: tessellated mesh feature edges (`raw: true` in the result). Set `raw: false` or `grouped: true` for the same payload as `list_feature_edges`. |
| `list_feature_edges` | `{ "part_id"?: string }` | `{ "partId", "grouped": true, "edges": [{ "key": "e0", …, "faceKeyA", "faceKeyB" }] }` — one row per boundary-edge id from the Fillet topo pass (far fewer than raw `list_edges`). |
| `invoke_helper` | `{ "id": string, "params"?: object, "use_selection"?: boolean }` | Runs `composeHelperInsert` on the active part, then the same mutate path as `set_script`. Result includes `{ "helperId", "ok", "errors", "failures"?, "status" }`. A feature that fails to build reports the viewport message, feature type, and label (`feature_failed`), not a generic "Feature failed". Unknown ids → `unknown_helper`. A value outside a param min/max is `bad_args` with the helper, the value, and the limit. Positions, offsets, and deltas (block Pos X/Y/Z, `insert_move` dx/dy/dz, `create_part` / `part_set_transform` `position`) are limited to ±1,000,000 mm (`POSITION_LIMIT_MM`), and every number is capped there so a typo cannot overflow the kernel; NaN and Infinity are always rejected. The card's slider range is the part-size range from `helperFieldSpec`, not this cap. A compose refusal is `insert_failed` and names what the helper needed. |
| `insert_<helper>` | param fields per `HELPER_PALETTE_ITEMS` | Thin alias for one helper id (e.g. `insert_cube`, `insert_make_extrude`). Same result shape as `invoke_helper`. Each carries `uiEntry` equal to the helper id for coverage. `insert_move` also takes the body to move: `body_index` or `at` (from `list_bodies`), `face` or `face_id` (from `list_faces`), else the selected face with `use_selection`; nothing named and nothing selected is `no_body` (the origin is never assumed). `edit_feature { params: { at } }` on a move re-points it. |
| `open_feature` | `{ "id"?: string, "index"?: number }` | Opens the feature sheet or viewport edit card for that strip chip (`data-feature-chip`). Result `{ id, kind, index }`. |
| `activate_feature` | `{ "id"?: string, "index"?: number, "clear"?: boolean }` | Sets `feature_tree.activeChipId` like a strip tap without opening the editor. `clear` clears the highlight. |
| `edit_feature` | `{ "params"?: object }` | Merges param fields into the open edit session (sheet or viewport card) before confirm. |
| `confirm_feature` | `{}` | Accept on the open feature edit (`data-feature-sheet-accept`). Uses the same `mutate` path as `set_script` / `insert_*`: writes the script, runs the viewport build, and records one undo step when the text changes. Result includes `{ ok, id, errors, status, unchanged? }` so `status.volume` is current without a separate `run`. Undo once restores the prior script and geometry. An unchanged confirm on a part whose last run failed returns `ok: false` with those `errors`, not `ok: true`. |
| `cancel_feature` | `{}` | Closes the open feature edit without writing. |
| `delete_feature` | `{ "id"?: string, "index"?: number, "confirm"?: boolean }` | Deletes a feature block (`data-feature-sheet-delete`). With no id/index, deletes the open edit target. Uses the same `mutate` path as `confirm_feature`: writes the script, runs the part, and records one undo step, so the result `{ deletedId, ok, errors, failures, status }` is current without a separate `run`. Deleting the block that declares `part` while later code still uses `part` is refused with `confirm_required` until `confirm: true`; the result then adds `warning`. |
| `rollback_to` | `{ "id"?: string, "index"?: number, "clear"?: boolean, "start"?: boolean }` | Moves the rollback bar (`data-rollback-bar`) only — the same as dragging the bar in the UI. It updates `feature_tree.rollbackAnchor` and re-runs evaluation with that anchor; it does **not** edit the Monaco script and does **not** push undo. `index` `0` is before every feature; `clear` removes the stored anchor. Result `{ rollbackAnchor }`. After `rollback_to`, call `run` only if you need a full rebuild of a script you changed elsewhere; the bar move itself already triggers a viewport run via `executeScript` with the anchor. |
| `select_clear` | `{}` | `{ "cleared": true }` — clears face, edge, and contour picks in the viewport. |
| `select_faces` | `{ "keys": [{ "at", "n", "area" }] }` or `{ "key": … }` | `{ "count": number }`. Uses the same face fingerprints as saved paint keys. |
| `select_edges` | `{ "keys": […] }` | `{ "count": number }`. Each key may be a grouped boundary id (`"e0"` from `list_feature_edges`), a packed mesh string (`"12-34"` from raw `list_edges`), or an object `{ "faceKeyA", "faceKeyB" }` using **face-centre keys** from `list_faces` (`at`, `n`, `area` with `area > 0`). Aliases: `{ "faceA", "faceB" }` or `{ "faceKeys": [keyA, keyB] }`. Grouped keys expand to the same coherent edge chain the viewport stores for UI picks (`va`/`vb`, normals, `boundaryId`). `selection` still returns thin edge rows; `invoke_helper` / `insert_*` with `use_selection: true` read the full pick via `readHelperEdgeContext`. |
| `select_parts` | `{ "part_ids": [string] }` | `{ "partIds": [string] }` — highlights the last id (`cadPartId`) without switching the editor part. |
| `set_active_part` | `{ "part_id": string }` | `{ "partId": string }` — same as choosing a parts row (Monaco + mesh). |
| `camera_set` | `{ "view"?: "iso"\|"front"\|"right"\|"top"\|…, "position"?, "target"?, "fov"?, "up"? }` | `{ "ok": true }`. Named views use the same presets as `data-view-snap-*` and frame the whole assembly as placed (every visible part's world box), or the selected part alone while a part body is highlighted (a parts-row tap, `set_active_part`, or `select_parts`; `select_clear` or an empty click returns to the whole assembly), so they need no `camera_fit`. An explicit `position` + `target` takes `up` (default `[0, 0, 1]`, Z-up) and never rolls the view; a zero or malformed `up` is `bad_args`. |
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
| `create_assembly` | `{}` | Seeds a blank assembly (Parts **+** → Assembly) with one empty part: no demo script and no seed cube; the first `insert_*` creates the body (a git part carries only its `// @surf-id` header). One assembly-history undo step when replacing an open document. |
| `create_part` | `{ name?, script?, position? }` | Adds a part row (Parts **+** → Part) and returns its new opaque surf id. Agent default is the assembly origin; optional `position` is `[x,y,z]` mm. Working copy only. The new part runs before the call returns, blank starter included, so its `status` is never `not_run_yet`. Without `script` the part starts empty (no seed cube); the first `insert_*` Block or Shape creates the body, and a helper that needs a body (hole, fillet, array, …) is `insert_failed` on an empty part (`insert_move` there is `no_mesh` / `no_body`). |
| `rename_part` | `{ part_id, name }` | Working-copy display name. `{ partId, name, moved: false }`. A path or name is `unknown_part`. The committed header updates on the next `git_save`. |
| `rename_assembly` | `{ assembly_id, name }` | Working-copy assembly label. `assembly_id` is an opaque id, not the current name. Names may collide. No git write. |
| `part_get_transform` | `{ part_id }` | Rigid placement by opaque id: `position` `[x,y,z]` mm and `rotation` as intrinsic XYZ Euler degrees (`eulerOrder: "XYZ"`). A path or name is `unknown_part`. |
| `part_set_transform` | `{ part_id, position?, rotation? }` | Sets translation and/or rotation for that id. One assembly-history undo step. Working copy only. |
| `open_assembly` | `{ assembly_id }` | Opens a vault assembly by opaque id (git mode). A name or path is `unknown_assembly`. |
| `open_part` | `{ part_id? , assembly_id? }` | Opens a vault part by id into the current assembly (reference). No path argument. |
| `insert_part` | `{ part_id? , assembly_id?, copy? }` | Insert-as-reference by part id, or every part of an assembly id. `copy: true` mints a new id. No git write. |
| `list_assemblies` | `{}` | The assemblies the Open picker shows, as `[{ id, name, open }]`: saved v2 assemblies, the open working copy (also before its first Save, and in local mode), and on a legacy vault its name-only folders as `{ id: null, name, legacy: true }` (no opaque id until `git_upgrade_vault`). No path field. |
| `delete_part` | `{ part_id, scope, confirm? }` | `scope: "assembly"` drops the row. `scope: "repo"` also plans a file delete and requires `confirm: true`. Neither scope commits. |
| `delete_assembly` | `{ assembly_id, confirm: true, delete_parts? }` | Deletes the open assembly. `confirm: true` required. Save commits later. |
| `joint_open` | `{}` | Opens the Joints create card (`data-joints-button`). Clears CAD part highlight for the joint strip. |
| `joint_set_params` | `{ type?, name?, value_mm?, sense?, opposed? }` | Patches the open joint card (mate type and fields). Returns the merged card fields (`type`, `name`, `valueMm`, …). `planar` is an alias for `coincident`. |
| `joint_pick` | `{ part_id, face_id }` or `{ picks: [{ part_id, face_id }] }` (`key` / `kind` instead of `face_id` also work) | `face_id` is a `list_faces` id on that part, or pass its face key, or an explicit axis/edge key. Resolved on the same catalog `list_faces` returns and classified like a canvas tap: a cylindrical face becomes an axis pick (concentric), a flat a face pick. A curved face with no axis is `pick_failed`; an id not on the part is `unknown_face`. |
| `joint_commit` | `{}` | Confirms the joint card (`applyJointCard`). One assembly-history undo step. |
| `joint_cancel` | `{}` | Dismisses the joint card without writing. |
| `joint_select` | `{ joint_id }` | Opens an existing joint from the strip (`data-joint-chip`) in edit mode. |
| `joint_edit` | `{ joint_id?, type?, name?, value_mm?, … }` | Patches a joint in edit mode (optional `joint_id` selects first). Commit with `joint_commit`. |
| `paint_open` | `{}` | Opens Paint mode (`data-paint-chip`). Waits up to 1.5 s for the viewport to take the mode (a part switch right after `create_part` / `set_active_part`, or the feature-popup gate while an agent prompt is being worked); past that it is a `not_ready` error with `details.reason` and `details.retryable: true`, never a silent `open: false`. |
| `paint_close` | `{}` | Closes Paint without Confirm (same as ✕). |
| `paint_set_color` | `{ color: "#RRGGBB" }` | Active paint color (swatch or hex). |
| `paint_faces` | `{ keys: [faceKey, …] }` | Live session paint on face keys from `list_faces`. |
| `paint_part` | `{}` | Paint whole body (Part button). |
| `paint_undo` | `{}` | Session undo inside the Paint card. |
| `paint_clear` | `{}` | Clear session paints. |
| `paint_confirm` | `{}` | Confirm — writes assembly `colors` (one assembly save). |
| `paint_cancel` | `{}` | Dismiss Paint without write. |
| `paint_state` | `{}` | `{ open, color, pendingCount, canConfirm, … }`. `pendingCount` counts the paints made since the popup opened (faces and part colors not in the saved map with the same color), not the saved paints the session starts from. |
| `measure_open` | `{}` | Opens Measure (`data-measure-toggle`). |
| `measure_close` | `{}` | Closes Measure without write. |
| `measure_set_unit` | `{ unit: "mm" \| "in" }` | Global display unit (`surfcad.displayUnit`). |
| `measure_pick` | `{ face_keys }`, `{ edge_keys }`, or `{ point: [x,y,z] }` | Toggle measure picks like canvas taps. |
| `measure_clear` | `{}` | Clear picks, stay in Measure. |
| `measure_state` | `{}` | Picks, unit, and `measureReadout` rows. |
| `cross_section_toggle` | `{ enabled?: boolean }` | Cross-section on/off (`data-cross-section-toggle`); omit `enabled` to flip. |
| `cross_section_expand` | `{ open: boolean }` | Options popup (`data-cross-section-expand`). |
| `cross_section_plane` | `{ plane: "XY"\|"XZ"\|"YZ" }` | Preset plane chips (`data-cross-section-plane`). |
| `cross_section_offset` | `{ offset: number }` | Section position along the normal (`data-section-offset`, model units). |
| `cross_section_state` | `{}` | `{ enabled, optionsOpen, plane, offset, normal, offsetMin, offsetMax, offsetCenter }`. |
| `cad_select_all` | `{}` | Select all script text (`data-cad-select-all`). |
| `sketch_delete_entity` | `{ id }` | Delete one sketch entity (`data-contour-entity-card`); one sketch undo. |
| `fea_open` | `{}` | Opens Analyze (`data-analyze-chip`). |
| `fea_close` | `{}` | Closes Analyze without cancelling an in-flight solve. |
| `fea_set_material` | `{ id }` | Library material id on the study. |
| `fea_set_fixture` / `fea_fix` | `{ face_id }` or `{ keys }` | Fixed support on a face (`part_id` when scoped). |
| `fea_set_force` | `{ magnitudeN, direction?, keys? }` | Force in **newtons**; direction token or `[x,y,z]`; optional face pick. Commits magnitude to existing loads. |
| `fea_set_pressure` | `{ pressureMPa, keys? }` | Pressure in **MPa**; optional face pick. |
| `fea_pick` | `{ part_id?, face_id }` or `{ keys }` | Apply the current fixture/force/pressure target on a face. |
| `fea_remove_fixture` / `fea_remove_load` | `{ index }` | Remove by list index. |
| `fea_run` | `{}` | Run TET10/modal solve; resolves with `{ status, stale, dof, timing, maxVonMises_MPa, maxDisplacement_m, … }`. |
| `fea_cancel` | `{}` | Abort the in-flight solve. |
| `fea_back_to_setup` | `{}` | Results → setup (same as Back to Setup). |
| `fea_state` | `{ include?: ["summary","probes"] }` | Open/screen/material/fixtures/loads draft. |
| `fea_results` | `{ include?: ["probes"] }` | Compact results read (no mesh arrays). |
| `sheet_open` | `{}` | Opens the Sheet Metal picker (`data-sheet-metal-button`). |
| `sheet_start` | `{ sku }` or `{ material }` | Binds SendCutSend stock and enters sheet-metal mode (`data-sheet-metal-start`). |
| `sheet_set_tool` | `{ tool: "tab"\|"bend"\|"hole"\|"countersink"\|"tapped" }` | Active tool on the sheet left rail. |
| `sheet_set_params` | plane, base dims, bend/tab/hole fields, `r`/`k`/`t`, or `sku` | Patches the open sheet stage. |
| `sheet_pick` | `{ plane }`, `{ panel, edge }`, `{ ref_key }`, `{ chip_id }`, or `{ picks: [...] }` | Plane pick, edge toggle, hole panel, or ribbon chip. |
| `sheet_commit` | `{}` | Confirm base flange or open draft — one undo when the script changes. |
| `sheet_cancel` | `{}` | Back from draft, check card, base popup, or close picker. |
| `sheet_exit` | `{}` | Leave sheet-metal mode without Done (`data-sheet-metal-exit`). |
| `sheet_check` | `{}` | Open flat pattern / DFM (`data-sm-check`). |
| `sheet_refold` | `{}` | Close check and return to bent edit. |
| `sheet_done` | `{}` | Write if the spec changed, then close (`data-sm-done`). |
| `sheet_edit` | `{ chip_id?, feature_id?, …params }` | Open a sheet chip for edit; optional param patch. |
| `sheet_begin_hole` | `{}` | Next on a new sheet hole — opens centres sketch. |
| `git_move_to_repo` | `{ vault_name? }` | G6: local assembly → vault (mock or real adapter). One assembly-history undo when promoted. |
| `git_save` | `{ message }` | The vault write, same planSave path as the Save button. `consent_pending` while the Allow dialog is up (retry the same call). `pending_save` when an offline plan is waiting. `upgrade_required` on a legacy vault (`git_upgrade_vault { confirm: true }` after the user agrees). `conflict` or `repo-moved` when a remote edit overlaps this Save. Results omit path fields. |
| `git_add_to_repo` | `{ message }` | Alias of `git_save`. Prefer `git_save`. |
| `git_behind_resolve` | `{ action: "reload" \| "branch", confirm: true }` | `reload` is Get latest (not a git write). `branch` saves mine to a new branch. Both require `confirm: true`. `keep` is removed. No path argument. |
| `git_branch_create` | `{ name }` | Create a branch from the current tip and switch to it. Uncommitted working-copy edits stay on the current branch (no switch; same as Parts Create). Use `git_branch_switch` with `confirm: true` to move a dirty copy. If the branch is created but switch fails, the result is `{ status: "created", switched: false, switchError }`. |
| `git_branch_switch` | `{ branch, confirm? }` | Switch working branch. `confirm: true` required when `dirty.workspaceDirty`. |
| `git_branch_delete` | `{ branch, confirm: true }` | Delete a branch ref (not `main`, not current). |
| `git_force_overwrite` | `{ confirm: true }` | Conflict popup → Overwrite main (`handleOverwriteMain`). |
| `git_list_branches` | `{}` | `{ branches, branch }` from `handleListBranches` (immediate). Read-only: allowed even when the real GitHub adapter is active. |
| `export_part` | `{ format: "stl"\|"3mf"\|"step", part_id?, download? }` | Part mesh export. Default `part_id` is the active CAD part. `download: false` (default) returns `{ format, filename, bytesBase64, byteLength }`; `download: true` saves in the browser (`3mf` matches the ribbon Download writer). Resolves mesh like `selectedPartDownload` and runs the part when needed. No undo step. |
| `export_download` | `{ format?: "stl"\|"3mf"\|"step", part_id? }` | Same as `export_part` with `download: true`; format defaults to `3mf`. `uiEntry` `data-part-download`. |

**Real vault guard.** If the live adapter is GitHub (`kind: real`, e.g. a token in storage), agent git **writes** (`git_*` writes and a vault `rename_part`) need session consent. A bridge call never waits on the user: the first write opens a consent modal (`data-agent-git-consent-allow` / `data-agent-git-consent-deny`) naming the command and `owner/repo/branch`, e.g. “An agent wants to save to *acme/widgets/main*. Allow agent writes to your GitHub repos for this session?”, and returns `consent_pending` at once with `details: { reason: "consent_pending", command, retry: true, retry_after_ms }`. Nothing is written. Further writes while the modal is up return the same error. After **Allow for this session**, retry the same call. **Deny** or dismiss sets a session deny flag; later writes return `real_repo_blocked` with `details.reason` `consent_declined` and the modal does not show again that session. Opt-in also works via URL `?agentGit=real`, localStorage `surfcadAgentGitReal` = `1`, or sessionStorage `surfcadAgentGitRealSession` = `1` after Allow. Headless / playtest / automation (`navigator.webdriver`) cannot show the modal: writes return `real_repo_blocked` immediately with `error.details.reason` `consent_pending`. UI Save / branch flows are unaffected.

### Pick sessions

A pick session feeds one consumer, the same one a tap in the viewport would feed:

- **The selection.** No picker card is open. `kind` is required and sets the Face / Edge pick mode (`data-pick-mode-face` / `data-pick-mode-edge`). Picks land on `selection`, which is what `invoke_helper` / `insert_*` read with `use_selection: true` (a face for `insert_hole`, edges for `insert_fillet_edges`, `insert_make_sweep_path`, and the other edge helpers). The selection starts empty unless `keep: true`.
- **A picker card.** `tool` opens Fillet, Chamfer, Shell, Draft, Move Face, or Delete Face through the same enter handler as the rail button. With no `tool`, the open card is the target, including a card `open_feature` opened on a strip chip. A card keeps its preselection or the edit's stored picks unless `keep: false`. `params` sets the card fields first: Fillet `radius`, Chamfer `chamfer`, Shell `wall` / `openingMode`, Draft `angle` / `flip`, Move Face `distance` / `flip`. Draft takes the first face as the neutral plane and drafts the rest.

Keys are the stable ids from `list_faces` (`{ at, n, area, src?, ord? }`) and `list_feature_edges` (`"eN"`; packed mesh keys and `{ faceKeyA, faceKeyB }` pairs also work). A grouped `eN` expands to the coherent edge chain a UI tap stores, and counts as one pick toward `min` / `max`. Seeded entries count one each. Every change republishes the whole list, so the card or selection ends exactly as that sequence of taps would leave it.

One session at a time. A session idle for `timeout_ms` (default 120000, 1000–1800000) expires: the next call that needs it gets `pick_timeout` once, and the picks stay in the viewport. Cut, Boolean, and Move pick bodies and planes, not keyed faces or edges, so they refuse with `picker_busy`; so do the sketch (except an open contour gesture or hole-centres target for sketch kinds), slot cards (use `slot_assign_contour`), the Hole card before centres begin, paint, measure, joints, and sheet metal.

`pick_done { accept: true }` runs the card's Accept unchanged: its gates, its compose, and its edit path. If the card stays open, the result is `accept_refused` with the card's toast as the message, and the session stays open so the agent can fix the picks. On an edit card this is the way to commit changed edge or face picks; `confirm_feature` there writes only the fields.

`Status` is `{ "partId": string, "partName": string, "script": string, "runState": "not_run_yet" \| "ok" \| "failed", "volume": number \| null, "bbox": { "min": number[3], "max": number[3] } \| null, "featureCount": number, "bodyCount": number \| null }`. `volume` and `bbox` are millimetres and come from that part’s last cached run, not the worker’s last execute of any part. `runState` is `not_run_yet` when this part has never been run.

`set_script`, `run`, and `undo` resolve only after the viewport has run. The editor shows the same text. The stack is the part history the Undo button already uses (`src/utils/partHistory.js`). The first real run may seed an assembly and replace that stack; the bridge snapshots the stack first and writes exactly one step back.

### Error codes

| Code | When |
| --- | --- |
| `unknown_command` | `name` is not in `commands`. |
| `bad_json` | `argsJson` is a string and `JSON.parse` throws. |
| `bad_args` | Args are not a JSON object, are not serialisable (function, class instance, typed array, non-finite number), or a required field has the wrong type (`set_script` `source` must be a string). |
| `confirm_required` | A destructive command was called without `confirm: true`: a git command (`git_branch_delete`, `git_force_overwrite`, `git_behind_resolve` reload/branch, or `git_branch_switch` while the vault working copy is dirty), or `delete_feature` on the block that declares `part` while later code still uses it (`details.featureId`, `details.dependents`). |
| `consent_pending` | Agent git write on the real GitHub adapter while the consent modal is waiting for the user. Nothing was written. `details.retry` is `true`; retry the same call after the user clicks Allow (`details.retry_after_ms` is a suggested wait). |
| `real_repo_blocked` | Agent git write while the real GitHub adapter is active without opt-in. `error.details.reason` is `consent_pending` (no answer / headless), `consent_declined` (user denied this session), or omitted when blocked by legacy query/storage-only paths. Message explains consent or decline. |
| `git_error` | Git handler returned `{ status: "error" }` (message in `error.message`). |
| `unsupported_format` | `screenshot` `format` is present and is not `"png"`. |
| `nothing_to_undo` | `undo` is already at the bottom of the active stack (sketch, assembly, or part). The editor and the history do not change. Also `pick_undo` with no agent pick in the session. |
| `nothing_to_redo` | `redo` is already at the top of the active stack, or sketch mode (no redo). |
| `screenshot_failed` | The viewport did not return a `data:image/png` URL. |
| `internal` | The command threw unexpectedly. |
| `unknown_face` | `select_faces` / `pick_next` key did not match any patch. From `pick_next`, `details.index` is the failing key. |
| `ambiguous_face` | `select_faces` / `pick_next` key matched more than one patch. From `pick_next`, `details.candidates` lists the matching `list_faces` keys (with `src` / `ord` when tagged) to retry with. |
| `unknown_edge` | `select_edges` / `pick_next` key or face-key pair did not match. From `pick_next`, `details.index` is the failing key. |
| `ambiguous_edge` | `select_edges` / `pick_next` face-key pair matched more than one edge. |
| `unknown_part` | `set_active_part` or `select_parts` id is not in the assembly. |
| `bad_view` | `camera_set` `view` is not a known preset. |
| `no_mesh` | Selection or camera command ran before a solid was shown. |
| `no_body` | `insert_move` with no body named (`body_index`, `at`, `face`, `face_id`) and no selected face, or a point / index that is not one of the part's bodies. Call `list_bodies`. |
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
| `setScript(source, partId)` | `set_script` `{ source, part_id }` | `{ ok, errors, failures?, status }` |
| `run()` | `run` | `{ ok, errors, failures?, status }` |
| `status()` | `status` | `Status` |
| `errors()` | `errors` | `{ code, message, featureId?, featureType?, featureLabel?, featureIndex?, detail? }[]` |
| `screenshot()` | `screenshot` `{ format: "png" }` | `dataUrl` string |
| `undo()` | `undo` | `{ ok, errors, status }`, or throws `nothing_to_undo` |
| `listCommands()` | `list_commands` | The `commands` array from that result |

`scripts/demo/agent-bridge-demo.mjs` is a Playwright agent that uses only `call()` with JSON strings: a box, then a hole, then status and a screenshot, then undo once, then a script that throws.

### Local WebSocket pairing (M1)

Loopback-only relay for a local MCP / stdio process to drive the same bridge as `window.surfcad.call` without injecting into the page.

| Piece | Role |
| --- | --- |
| `scripts/vite-agent-bridge-ws.mjs` | Vite plugin: starts the relay on `127.0.0.1` (port `SURFCAD_AGENT_BRIDGE_WS_PORT`, default **17341**) during `vite` dev and `vite preview`. |
| `src/components/AgentBridgePairing.jsx` | In-app UI: user must **Show pairing code**, then **Allow connection** when a client connects. Paired state and **Disconnect** are visible. |
| `src/agent/ws/relayHub.js` | Pairing state machine and message routing. |
| `src/agent/ws/tabConnection.js` | Tab side: forwards `{ id, command, args }` to `window.surfcad.call`. Takes `createSocket` for the transport. |
| `src/agent/ws/popupTransport.js` | Safari transport: frames go through the loopback bridge window (`http://127.0.0.1:17341/bridge`) with postMessage. |
| `packages/surfcad-mcp/src/bridge/bridgePage.mjs`, `bridgePopup.mjs` | Relay-served bridge page and its script (`/bridge`, `/bridge.js`). |
| `scripts/agent-bridge-ws-client.mjs` | Tiny Node client: `npm run agent-bridge:client -- --token CODE --command list_faces`. |

**Pairing (control messages use `type`):**

1. Tab (after the user shows a code): `{ "type": "register_tab", "token": "ABCDEF" }`
2. Local client: `{ "type": "pair", "token": "ABCDEF" }`
3. Tab user approves: `{ "type": "pair_approve" }` → both sides receive `{ "type": "paired", "token": "…" }`

**Bridge traffic (after paired):**

```json
{ "id": "1", "command": "list_faces", "args": {} }
{ "id": "1", "ok": true, "result": { … } }
{ "id": "2", "ok": false, "error": { "code": "real_repo_blocked", "message": "…" } }
```

Refusals use the same `error` objects as the in-page envelope. Non-loopback TCP peers and non-local `Origin` values are dropped.

### MCP stdio server (M2)

| Piece | Role |
| --- | --- |
| `packages/surfcad-mcp` | npm package `surfcad-mcp`: MCP over stdio, one tool per `commands.json` row plus `pair`. |
| `packages/surfcad-mcp/data/commands.json` | Copy of `src/agent/commands.json`; refreshed by `npm run export:agent`. `GET /tools` on the loopback relay returns the same bridge tools (`name`, `description`, `inputSchema`). `list_commands` and the MCP bridge tools match that list. `pair` and the in-process prompt tools are MCP-only. |
| `SURFCAD_PAIRING_CODE` | Optional env pairing code (same as **profile** → **Local agent** → **Show pairing code**). |
| `SURFCAD_AGENT_BRIDGE_WS_URL` | Relay URL (default `ws://127.0.0.1:17341`). |

The MCP server instructions (initialize) are: `call register_webhook { url, bearer? } if you can receive https webhooks, otherwise poll read_messages.`

When `pair` succeeds and no webhook is registered, the tool result's text content tells the agent to ask the user for a webhook URL and key. The key is the `bearer` argument. Suggested wording to relay, exactly: "To get SurfCAD messages instantly, send me your webhook URL and key. This only needs to be done once. Otherwise I'll check for SurfCAD messages between steps, so replies may lag." If the user declines, poll `read_messages`. The URL and bearer are memory only, so the note also says to save them in the agent's own config or memory and call `register_webhook` again after every pair. The note is a `type: "text"` content block, not only `structuredContent` or `_meta`. When a webhook is already registered at pair time, that onboarding note is omitted and the text says the webhook is active.

`register_webhook` takes `{ url, bearer? }`. `url` is https only: no credentials in the URL, no localhost, no `.local` name, no private or loopback address. Optional `bearer` is the user's key: a non-empty string of at most 4096 characters with no CR or LF. When it is set, each prompt POST sends `Authorization: Bearer <bearer>`. The URL and the bearer stay in the MCP process memory. There is no persistence. `unregister_webhook` and the end of the pairing session clear both. They are never logged, never included in a tool result, error, or status, and never sent to the page or the relay. The POST times out after 10 seconds, retries once, then the prompt is queued for `read_messages`.

The MCP `status` tool returns the host part status plus `webhookRegistered` (boolean; the URL's secret parts and the bearer are not echoed), `queued` (the number of prompt messages waiting for `read_messages`; cancelled prompts are not counted), `counts` (`{ queued, delivered, replied, cancelled }`), and `last` (`{ id, state }` of the latest prompt, or `null`). A fresh session is `webhookRegistered: false`, `queued: 0`, and `last: null`. One prompt with no webhook makes `queued` `1` and `last.state` `queued`. The host `status` command and both `commands.json` files do not grow these fields; the MCP server adds them to the tool result.

Stop on the in-viewer prompt sends `agent.prompt.cancel` (`v: 1`, `{ id }`) from the page to the paired MCP process. The process answers with `agent.prompt.cancel.result` (`v: 1`, `{ id, state }`) where `state` is `cancelled`, `not_found`, or `already_final`. A prompt still waiting in the queue is dropped. A prompt already given to the agent (webhook POST, or returned by `read_messages`) is `cancelled`: the registered webhook is POSTed `{ "type": "cancel", "id" }` using the same bearer, https, 10 second timeout, and one retry as a prompt, and if that POST fails or no webhook is registered, `read_messages` returns `{ "type": "cancel", "id" }` on its next call. The agent stops work on that id. `reply_to_user` and `set_status` for a cancelled id return `{ "ok": false, "error": "cancelled" }` and are not forwarded to the page. After Stop, `status.last.state` is `cancelled`.

Claude Desktop / Cursor config examples live in `packages/surfcad-mcp/README.md`. The short agent skill for outside LLMs is `docs/agent/SKILL.md`. End-to-end MCP demo: `npm run demo:mcp`.
