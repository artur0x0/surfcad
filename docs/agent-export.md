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

Each command is `{ name, schema, run(ctx, args), uiEntry?, example }`. `schema` describes the args object in JSON Schema form. `example` is one args object `list_commands` returns with the schema. `uiEntry` is optional: a `data-*` attribute name that already exists on a control, or a helper id. `run` records `data-cad-run`. The other v1 commands have no `uiEntry`. Nothing in this version clicks that attribute. `ctx` is the host ref. App fills it with the editor, the part history, `execute`, and the toolbar `undo`, `redo`, and `runScript` handlers. Viewport fills `screenshot` with the same `capturePng` its imperative handle exposes. `fillAgentHost` (`src/agent/host.js`) merges by key.

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
| `feature_tree` | `{}` | `{ "features": [{ "id", "kind", "label", "chipLabel", "index", "failed", "sheet", "external", "separate" }], "rollbackAnchor": string \| null, "activeChipId": string \| null }` for the active part script. |
| `selection` | `{}` | `{ "activePartId", "cadPartId", "face", "edges", "contour": { "armedId", "planeId" } }` — face picks include a `key` `{ at, n, area }` when known. |
| `mode` | `{}` | `{ "app": "cad" \| "game", "viewport": string, "contour", "fillet", "featureEdit", "sheetMetal" }` summary of the open picker / card. |
| `dirty` | `{}` | `{ "workspaceDirty", "assemblyDirty", "renamePending", "legacyCleanup", "partIds": string[] }` git / local dirty chrome. |
| `toasts` | `{}` | `{ "toasts": [{ "id", "kind", "message" }] }` visible upload / git / rename notices. |
| `parts` | `{}` | `{ "activeId", "assemblyName", "parts": [{ "id", "name", "visible" }] }`. |
| `camera` | `{}` | `{ "position", "quaternion", "target", "zoom", "fov" }` arrays or null. |

`Status` is `{ "volume": number \| null, "bbox": { "min": number[3], "max": number[3] } \| null, "partName": string, "featureCount": number }`. `volume` and `bbox` are null when the run failed. `bbox` is millimetres. `featureCount` is the number of marked feature blocks in the script that ran. Before any run, `volume` is null, `bbox` is null, `partName` is `""`, and `featureCount` is `0`.

`set_script`, `run`, and `undo` resolve only after the viewport has run. The editor shows the same text. The stack is the part history the Undo button already uses (`src/utils/partHistory.js`). The first real run may seed an assembly and replace that stack; the bridge snapshots the stack first and writes exactly one step back.

### Error codes

| Code | When |
| --- | --- |
| `unknown_command` | `name` is not in `commands`. |
| `bad_json` | `argsJson` is a string and `JSON.parse` throws. |
| `bad_args` | Args are not a JSON object, are not serialisable (function, class instance, typed array, non-finite number), or a required field has the wrong type (`set_script` `source` must be a string). |
| `unsupported_format` | `screenshot` `format` is present and is not `"png"`. |
| `nothing_to_undo` | `undo` is already at the bottom of the stack. The editor and the history do not change. |
| `screenshot_failed` | The viewport did not return a `data:image/png` URL. |
| `internal` | The command threw unexpectedly. |

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
