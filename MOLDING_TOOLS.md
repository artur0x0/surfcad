# Molding tools: design

The molding tools are four read-only inspections of the active part for
injection molding: wall thickness, core and cavity (with side actions),
mold draft, and a budgetary report. They share one pull direction, one
worker, one cache, and one results pane. Nothing here edits the mesh,
solves FEA, or places an order.

This document explains how the tools are built and how they fit together.
The money side (tooling math, vendor ranking, leads, Stripe) is in
[docs/injection-molding-quoting.md](docs/injection-molding-quoting.md) and
the Mongo collections are in
[docs/injection-molding-schema.md](docs/injection-molding-schema.md). Pixel
placement and selectors are in [docs/ui-map.md](docs/ui-map.md) under
"Molding tools". The agent command table is in
[docs/agent-export.md](docs/agent-export.md).

## Contents

1. [Pieces at a glance](#pieces-at-a-glance)
2. [UI model](#ui-model)
3. [The shared pull reference](#the-shared-pull-reference)
4. [The four tools](#the-four-tools)
5. [Analysis pipeline](#analysis-pipeline)
6. [Caching and invalidation](#caching-and-invalidation)
7. [Skins](#skins)
8. [Agent commands](#agent-commands)
9. [Report, quote, and leads](#report-quote-and-leads)
10. [Tests and goldens](#tests-and-goldens)
11. [Invariants and sharp edges](#invariants-and-sharp-edges)

## Pieces at a glance

| Layer | Files | Job |
| --- | --- | --- |
| Geometry analysis | `src/molding/pullDirection.js`, `wallThickness.js`, `parting.js`, `sideActions.js`, `moldDraft.js`, `dfmReport.js` | Pure functions over a triangle soup. No React, no three.js. |
| Worker | `src/molding/wallFieldWorker.js`, `wallFieldJob.js`, `wallFieldClient.js` | Runs the analysis off the main thread with progress, a coarse pass, and cancel. |
| Cache | `src/molding/moldToolCache.js` | Results keyed by mesh content, pull, and (for draft) threshold. |
| Skins | `src/molding/thicknessSkin.js`, `partingSkin.js`, `moldDraftSkin.js`, `sideActionSkin.js`, `thicknessColor.js` | Lit child meshes that colour the part per triangle. |
| Report | `src/molding/moldReport.js`, `moldReportXlsx.js`, `toolingRateCard.js`, `toolingEstimate.js`, `partQuote.js`, `resinSuggest.js`, `solidVolume.js` | One report object for the pane, the spreadsheet, and the agent. |
| Pull reference | `src/molding/pullReference.js` | Auto, plane, or face. Shared by every pull-based tool. |
| Viewport glue | `src/components/Viewport.jsx` (search `mold`, `wall`, `parting`, `draft`, `report`) | Refs, job generations, show tokens, the handlers every button and agent command calls. |
| Drawer | `src/components/MoldingToolsControl.jsx`, `pressMoldTool.js`, mounted from `CrossSectionPanel.jsx` | Right-rail trigger and the four-button flyout. |
| Pane | `src/components/molding/MoldResultsPane.jsx`, `MoldAnalysisPane.jsx`, `moldPaneScroll.js`, `MoldProgress.jsx`, `PullReference.jsx`, `WallLegend.jsx`, `PartingLegend.jsx`, `MoldDraftLegend.jsx`, `MoldReportPanel.jsx` | One results card with one section per active tool. |
| Agent commands | `src/agent/commands/mold*.js`, `src/utils/agentBridge.js` | Eleven `mold_*` commands that call the same Viewport handlers the buttons do. |
| Backend | `backend/routes/moldingQuote.js`, `moldingLead.js`, `moldingResinPublic.js`, `moldingAdmin.js`; `backend/services/molding*.js`; `backend/db/models/Molding*.js` | Vendor ranking, leads, review checkout, resin library, admin. |

## UI model

### One drawer, one pane, one tool at a time

The right rail has a single molding trigger (Lucide `Factory`,
`data-mold-tools-toggle`) in the inspection group after Analyze. Tapping
it unfurls a horizontal flyout to the left with four buttons, in order:
wall thickness, core and cavity, mold draft, report. A tap on a tool
closes the flyout first and then toggles that tool (`pressMoldTool`). The
drawer itself holds no state about the tools; it only reads `active` and
`pending` flags from Viewport and renders button state. Both the desktop
and the phone tree mount it through `CrossSectionPanel`, so there is one
instance, not one per layout.

Only one molding tool is on at a time. Opening any tool clears the other
three. Paint, Analyze, and game mode clear all of them. This is enforced
in the Viewport handlers, not in the drawer: every `show*` path starts
by calling the `clear*` of the other tools.

Results render in one absolutely positioned card, `MoldResultsPane`
(`data-mold-results-pane`). It is the feature-sheet shell placed under
the feature strip. Its left edge and width come from
`measureFeatureSheetWidth` so it stays between the two rails; a CSS
fallback of one rail width holds until that measure lands. The pane is
mounted only while something is showing: progress, a legend, or the
report.

Inside the card, each result is a `mold-results-section`:

1. `MoldProgress` while a job is running (stage name plus percent).
2. `PullReference` (Auto | Plane | Face) whenever core and cavity, mold
   draft, or the report is on. Wall thickness does not use a pull, so it
   does not show this section.
3. Exactly one legend or the report: `WallLegend`, `PartingLegend`,
   `MoldDraftLegend`, or `MoldReportPanel`.

### Phone behaviour

On 768px and under the card gets the `mold-analysis-pane` class. That
class makes it its own vertical scroll container, capped to the visible
viewport (`100dvh` or `--modal-vvh` from `useModalViewport`) minus the top
safe area, the feature-strip stack, and the home-indicator reserve.
`bindMoldPaneGestures` attaches capture-phase listeners for wheel, touch,
pointer, and iOS `gesture*` events that call `stopPropagation` so a scroll
or drag on the pane does not reach the camera controls. They never call
`preventDefault`, so the pane still scrolls, and an event whose target is
a button, field, link, or label is left alone so the control still fires.

## The shared pull reference

Core and cavity, side actions, mold draft, and the report all depend on
one pull direction. The wall field does not.

`pullReferenceRef` in Viewport holds `{ mode, plane, pull }`:

- **auto**: `pull` is `null`. The worker searches candidate directions.
- **plane**: `pull` is the normal of Top (+Z), Front (+Y), or Right (+X)
  from `MOLD_PULL_PLANES`.
- **face**: `pull` is the normal of the next face the user picks, sign
  kept. Until a face is picked `pull` is `null` and the section shows
  "Pick a face". The face-pick handler in Viewport checks
  `pullReferenceRef.current.mode === 'face'` and feeds the classified
  normal back through `applySharedPullRef`.

`sharedMoldPull()` returns the override vector or `null`. It is the pull
every cache lookup and every analysis request uses.

`applySharedPullRef.current(next)` is the one place the reference changes.
It:

1. Validates and stores the new reference.
2. Drops every pull-dependent field ref (`partingFieldRef`,
   `moldDraftFieldRef`, `dfmFieldRef`, `quoteFieldRef`), the in-flight
   analysis slot (`moldAnalysisRef`), the side-action selection, and the
   pull-keyed cache entries (`invalidatePull`), then cancels in-flight
   analysis jobs (`dropMoldJobs`).
3. Starts a new analysis for the tool that is currently on (parting,
   draft, or report; `'pull'` if none), waits for it, and repaints that
   tool. If the report is on it re-opens the report with the same grade,
   quantity, and cavity count.

The agent command for this is `mold_pull`. The pane buttons call the same
ref.

## The four tools

### Wall thickness

Toggle: `data-wall-heatmap`. Agent: `mold_wall_map`.

The field is computed by `measureWallThickness` in `wallThickness.js`
through `analyzeWallOnly`. Each triangle gets a thickness from a ray along
its geometric normal and an inscribed shrinking sphere; the ray wins when
it is stable and agrees with the sphere, otherwise the sphere diameter is
the thickness. Nominal is the mode (or median) of an interior band of
triangle values. Thin is below 0.6× nominal, thick above 1.5× nominal.
The header comment of `wallThickness.js` is the full definition.

It runs as the `wall` job kind: a coarse centroid pass is posted first and
painted immediately (`onCoarse`), then the refined pass replaces it. The
button stays pending until the refined field lands. The skin
(`thicknessSkin.js`) is a viridis ramp from `thicknessColor.js`; the
legend shows Thin, Nominal, Thick with the millimetre values.

### Core and cavity, with side actions

Toggle: `data-mold-parting`. Agent: `mold_parting`, alias
`mold_side_actions`.

`classifyParting` in `parting.js` assigns every triangle to core or
cavity by complete visibility along the pull, using a depth grid. A wall
within 0.5° of vertical is not a seed and takes the role of the labelled
neighbour it can reach. The parting line is the single outer core-cavity
loop with the largest projected perimeter, drawn as a polyline. Stamped
edges keep their names on that loop, which is what the report's naming
summary reads.

`groupSideActions` in `sideActions.js` clusters true undercuts (from the
pull search's regions) into slides and lifters. A slide has an
unobstructed escape in the parting plane; a lifter is angled 20° into the
core. The escape is never the pull axis. Groups of the same kind whose
escapes agree within 35° merge. Each group is a button in the legend
(`data-mold-side-action-group`) and selecting one highlights its faces
through `selectedSideGroupRef`. There is no separate side-action tool;
the earlier one was folded into this pane, and `clearSideActions` and
`applySideActionSkinRef` only detach a legacy skin.

### Mold draft

Toggle: `data-mold-draft`. Agent: `mold_draft`.

`analyzeMoldDraft` in `moldDraft.js` produces a signed draft angle per
triangle from its geometric normal against the pull. The sign uses the
part centroid in the plane perpendicular to the pull: a normal pointing
away from that centre is an outside wall (lean flipped), one pointing
toward it is a hole wall (lean kept). The worker stores that signed
field once. `classifyMoldDraft(base, threshold)` buckets it into
Positive ≥ T (cavity colour), Negative ≥ T (core colour), and Below T
(red hatch, with the positive/negative sign split). Changing the
threshold rebuckets on the main thread and never re-measures. Presets are
0.5, 1, 2, 3, 5; the agent may pass any angle in (0, 90].

The skin (`moldDraftSkin.js`) uses a custom shader program for the
world-space hatch on Below T faces, so the class does not depend on hue
alone. Ejector pin and sleeve counts are a heuristic on the wall field
and are reported, not drawn.

### Report

Toggle: `data-mold-dfm`. Agent: `mold_dfm` and `mold_quote` (same
handler; `mold_quote` also takes `cavityCount`).

The report needs the full analysis (for projected area along the pull,
side-action count, draft counts, and max wall), the public resin library,
and a vendor quote from `POST /api/molding/quote`. `openMoldReport` in
Viewport gathers those, then `buildMoldReport` in `moldReport.js` returns
one object with `geometry`, `estimates`, `notes`, and `assumptions`. The
pane, the `.xlsx` export, and both agent commands return that same object.
There is no skin. Grade and quantity changes call `openMoldReport` again;
quotes are memoized per `grade|quantity|cavityCount` inside the cache
slot. The firm quote, human review, and pay-review buttons live on this
section once a vendor quote is loaded.

## Analysis pipeline

### Two job kinds, one worker

`wallFieldClient.js` owns a single module worker
(`wallFieldWorker.js`) and a `pending` map of job id to callbacks. Two
job kinds exist:

- `wall`: `runWallJob`. Coarse centroid pass, yield, refined pass.
  Posts `progress`, `coarse`, then `done`.
- `analysis`: `runAnalysisJob`. Opens the query, measures the wall, then
  either scores the override pull or searches the plan's directions
  (yielding every eight candidates), then runs parting, side actions,
  mold draft, and `dfmReport` in `finishMoldQuery`. Posts `progress` then
  `done`.

Both runners live in `wallFieldJob.js` and are plain async functions that
take `{ post, cancelled }`, so the client runs them inline when `Worker`
is undefined (tests, SSR). The worker runs jobs strictly one after another
on a promise chain; a second request waits for the first.

The message to the worker is a copy of the mesh: `Float64Array`
positions, `Uint32Array` indices, the stamped face table (`triFace`,
per-face `normals` and `names`), and plain patch rows from the face graph.
Buffers are transferred, which is why the client copies first. The
`stamped` table gives the analysis real face normals and edge names; a
triangle with no stamp falls back to its cross product.

### Progress

Every job reports `{ stage, percent }`. Stages are `Pull direction`,
`Wall thickness`, and `Parting`. Viewport keeps one `moldProgress` state
tagged with the `tool` that started it and the job `gen`;
`endMoldProgress(gen)` clears it only if that generation is still the
current one. The drawer reads `moldProgress.tool` to mark a button
pending, and the pane shows the stage line.

### Cancellation

Cancel is cooperative. A `{ cancel: id }` message adds the id to a set
the runner checks at each `await yieldTick()`. The client resolves the
caller's promise with `{ dropped: true }` immediately and ignores any
later reply for that id. `dropWallJobs` and `dropMoldJobs` cancel every
pending job of one kind. The worker is never terminated, because that
would lose other callers' promises.

On the Viewport side three layers of staleness guard exist, and each
handler checks the ones it needs after every `await`:

| Guard | Scope | Bumped when |
| --- | --- | --- |
| `wallJobGenRef`, `moldJobGenRef` | One per job kind | A new job of that kind starts. A reply whose gen is not current is ignored. |
| `partingShowRef`, `draftShowRef`, `reportShowRef` | One per tool | That tool is opened or cleared. A handler that awaited and finds a newer token returns `{ on: false }` without painting. |
| `moldAnalysisRef` | One slot | Key is `geometry.uuid|pullKey`. Holds the pending promise or the last good result. |

`loadMoldAnalysis(geometry, faceIDs, pull, tool)` is the shared entry:

- Same key with a stored result: resolve immediately with `gen: null`
  (no progress indicator, nothing to cancel).
- Same key with a promise in flight: return that promise and the current
  gen, so two tools opened quickly share one job.
- Different key: drop the old job, bump the gen, show progress, post a
  new job.

The analysis result (`kind: 'mold-analysis'`) carries `pull`,
`pullSource`, `fit`, `undercutCount`, `wall`, `parting`, `sideActions`,
`moldDraft`, and `dfm`. Each tool reads its slice.

## Caching and invalidation

Three levels hold results, from most to least volatile:

1. **Field refs** (`wallFieldRef`, `partingFieldRef`, `moldDraftFieldRef`,
   `dfmFieldRef`, `quoteFieldRef`): the result currently painted, tagged
   with its `geometry` object. The `apply*SkinRef` functions compare
   `geometry` by identity and resync the skin without recomputing.
2. **In-flight slot** (`moldAnalysisRef`): see above. Keyed by geometry
   uuid, so a rebuilt mesh misses.
3. **Mold tool cache** (`createMoldToolCache`): keyed by mesh *content*.
   `meshStamp` hashes every position and index, so a part rebuilt to the
   same vertices hits. Tools `parting`, `draft`, and `report` add the
   pull stamp (`auto` or a 6-decimal vector); `draft` also adds the
   threshold. `wall` ignores the pull. `findDraftBase(mesh, pull)` returns
   any stored draft field for that mesh and pull regardless of threshold,
   which is what makes a threshold change free.

Invalidation rules:

- `invalidateMesh(prevGeometry)` runs in `renderMeshData` when the
  viewport swaps the active geometry. It drops every tool for that
  stamp.
- `invalidatePull()` runs in `applySharedPullRef`. It drops `parting`,
  `draft`, and `report` entries for every mesh and keeps `wall`.
- `rememberMoldAnalysis(geometry, analyzed)` is the single writer after a
  successful job. It fills the field refs, stores `parting` and `draft`
  under the current override pull, and merges the analysis into the
  `report` slot while preserving any memoized quotes.

When a tool is re-opened with a cache hit, the handler paints from the
cache and returns without touching the worker or the progress line. That
is the behaviour the ui-map calls "switching back with the same mesh and
pull shows the cached result".

## Skins

Each overlay is a child `Mesh` added to the active part's `Object3D`,
built from the part's unwelded triangles with a vertex-colour attribute.
They share the face-skin material from `src/utils/faceColorSkin.js`
(headlight lit, no raycast) except mold draft, which carries its own
hatch shader. Render order keeps them layered and out of each other's
way:

| Skin | Render order |
| --- | --- |
| Face paint | 2 |
| Core / cavity (`mold-parting-skin`) | 2.35 |
| Wall thickness (`wall-thickness-skin`) | 2.4 |
| Side action (legacy) | 2.42 |
| Mold draft (`mold-draft-skin`) | 2.43 |
| Stress (FEA) | 2.5 |
| Pick highlights | 6 |

While any molding skin is visible the face-paint skin is hidden; detach
restores paint visibility unless another skin is still holding it hidden.
The parting skin also owns the parting-line `Line`.

`applyFaceSkinRef` in Viewport is the one hook that runs whenever the
host mesh is (re)built or face paint changes. It calls every molding
`apply*SkinRef` in turn, and each of those either detaches (tool off, or
host is not the active part), resyncs from its field ref (same geometry),
or starts a new job (tool on, new geometry). `refreshDfmRef` does the
same for the report: if the report is on and the new mesh has no cached
analysis, it re-opens the report. This is how a tool survives a script
re-run without a button press.

Skins never attach to assembly extras; the `clear*` paths detach from
them defensively.

## Agent commands

Every command is a thin validator that calls a host function published by
Viewport through the bridge (`src/utils/agentBridge.js`, the `mold*` rows
of the host function map). The button handlers and the agent handlers are
the same functions, so UI and agent cannot drift.

| Command | Host ref in Viewport | Notes |
| --- | --- | --- |
| `mold_pull` | `applySharedPullRef` | `mode` auto / plane / face; `plane` or `normal`. |
| `mold_fit` | `agentMoldFitRef` | Runs the full analysis for `part_id` with an optional `pull` override and returns it without painting. Drops `dfm` from the payload. |
| `mold_wall_map` | `agentMoldWallMapRef` | `on` toggle. Returns legend numbers. |
| `mold_parting` | `agentMoldPartingRef` | `on`, `group`. With the tool already on and a `group`, only the selection changes. |
| `mold_side_actions` | `agentMoldSideActionsRef` | Alias. `on: false` does not hide; it names `mold_parting`. |
| `mold_draft` | `agentMoldDraftRef` | `on`, `threshold`. `threshold` without `on` shows at that threshold. |
| `mold_dfm` | `agentMoldDfmRef` → `openMoldReport` | `on`, `grade`, `quantity`. |
| `mold_quote` | `agentMoldQuoteRef` → `openMoldReport` | Adds `cavityCount`. |
| `mold_request_firm_quote` | `agentMoldFirmQuoteRef` | Signed-in. Needs the report open. |
| `mold_request_human_review` | `agentMoldHumanReviewRef` | Signed-in. Needs the report open. |
| `mold_pay_human_review` | `agentMoldPayReviewRef` | Opens Stripe Checkout. Needs the report open. |

All are `immediate: true` and grouped under `measure` in
`commandGroups.js`. Each pane control carries a `data-ui-action` that
matches a command's `uiEntry`; the resin menu, quantity presets, custom
quantity, export button, and drawer trigger are instead listed in
`src/agent/coverageAllowlist.js` because `mold_dfm` and `mold_quote`
already set those values. After changing a command or its description,
run `npm run export:agent` and commit `src/agent/commands.json` and the
catalog.

Error codes the handlers return: `no_mesh` (no active geometry, or the
report is not open for the lead commands), `bad_args`, and `internal`
(worker failure or a cancelled job surfaced to `mold_fit`).

## Report, quote, and leads

Covered in full by
[docs/injection-molding-quoting.md](docs/injection-molding-quoting.md).
The short version, from the tool's point of view:

- `openMoldReport` always fetches a ranked vendor quote
  (`postMoldingQuote`) and the public resin library, but
  `buildMoldReport` prices from the **published** rate card and resin
  table when no catalog is passed, which is the browser path. The vendor
  list is used for the firm-quote and review buttons and as a price
  fallback.
- `publishQuote` also computes heuristic fill flags and a stiffness hint
  from an in-memory FEA study (`resinSuggest.js`). The pane does not show
  them today; they ride along in `moldQuote.suggestion`.
- Leads and review payment are driven from `requestLead`, `payReview`,
  and `runReviewPoll`. The partner name is revealed only when the server
  says the caller's human-review lead is paid. A `?moldReview=return`
  query only triggers a status poll; it never reveals.

## Tests and goldens

Unit tests sit next to each module (`src/molding/*.test.js`,
`src/agent/commands/mold*.test.js`, `src/components/molding/*.test.js`,
`src/components/moldingToolsDrawer.test.js`, `src/components/toolToggle.test.js`)
and run with `npm test`. Backend molding routes and services have
`backend/test/molding-*.test.js`.

Browser goldens that touch these tools:

- `scripts/golden/smoke_mold_pane_scroll.mjs`: phone and desktop pane
  placement, drawer closes on tool press, pane scroll does not move the
  camera.
- `scripts/golden/smoke_ui_polish_icons_layout.mjs`: rail and flyout
  icons.
- The agent bridge goldens (`golden:agent-bridge-*`) exercise `mold_*`
  through the bridge; `src/utils/agentBridgeHandlers.test.js` checks that
  `mold_pull` reaches its Viewport handler.

## Invariants and sharp edges

Things that must stay true, and the places where a bug is most likely to
hide. Check these first when a tool misbehaves.

1. **One tool on at a time.** Every `show*`/`agentMold*` path clears the
   other three before painting. A tool that appears on top of another
   means a clear was skipped on one entry path (button, agent, pull
   change, mesh rebuild).
2. **Pending state and progress are separate.** The drawer's `pending`
   flag reads `moldProgress.tool`, plus `wallFieldRef.pending` for the
   wall. `endMoldProgress(gen)` only clears a matching gen, and a cache
   hit returns `gen: null`. A spinner that never stops means a path
   returned without calling `endMoldProgress`, or cleared progress for
   the wrong tool tag (`'dfm'`, `'report'`, `'quote'`, `'side'` all
   exist).
3. **Generations versus show tokens.** Gens guard worker replies, show
   tokens guard user intent. A handler that awaits and then paints must
   check both, plus `resultRef.current.geometry === geometry`. A stale
   paint after a quick toggle-off-on, or after switching parts during a
   job, is one of those checks missing.
4. **The worker is serial.** A long wall job delays an analysis job
   queued behind it, and vice versa. Cancel lands only at yields: in the
   analysis job that is before the wall pass, every eight pull
   candidates, and before parting. The wall measurement itself
   (`measureMoldWall`) is not interruptible.
5. **`meshStamp` hashes the whole mesh** on every cache `get` and `set`.
   It is linear in vertex count and runs on the main thread. On a large
   part that cost shows up on every toggle.
6. **Cache key and slot key differ.** `moldAnalysisRef` keys by
   `geometry.uuid`; the tool cache keys by content. A rebuilt mesh with
   identical vertices misses the slot and hits the cache, so parting and
   draft paint instantly but the report path (`refreshDfmRef`) checks the
   `report` cache entry, which `rememberMoldAnalysis` writes under
   `sharedMoldPull()` at the time of the job.
7. **The stored pull is the override, not the found pull.** Cache entries
   and `rememberMoldAnalysis` use `sharedMoldPull()` (`null` in Auto),
   while the analysis result carries the pull the search chose. In Auto
   mode two different searched pulls on two meshes both file under
   `auto`.
8. **Face mode waits.** With `mode: 'face'` and no pick yet, `pull` is
   `null`, so `loadMoldAnalysis` runs an Auto search and the pane shows
   "Pick a face". The next face pick anywhere in the viewport re-runs the
   open tool with that normal.
9. **Threshold changes never re-measure.** `MoldDraftLegend.onThreshold`
   rebuckets `moldDraftFieldRef.current.base`. If that field is missing
   (tool on, geometry changed, job still running) the press is a no-op
   by design.
10. **The report always re-fetches the library on first open per
    session** and the quote on each new `grade|quantity|cavityCount`.
    Network failures land in `moldQuote.status === 'error'` and
    `report.notes`; they are not toasts and not Sentry events.
11. **Phone pane height** depends on `--modal-vvh` / `--modal-vv-top`,
    which `useModalViewport` publishes from `visualViewport`. A pane
    that runs under the home indicator or behind the keyboard means
    those variables are stale or the feature-strip variables changed
    without updating the `.mold-analysis-pane` calc.
12. **Game mode hides everything.** The `mode === 'game'` effect clears
    all six `clear*Ref`s and `pullToolsOn` is false, so no pane mounts.
