---
name: fillets
description: "How fillets and chamfers are created in this repo — the easy/hard kernel split, the Fillet-mode Accept path that writes script text, the cutter math, and the fail-loud guards. Load BEFORE touching any blend code or debugging a bad blend. Triggers on: fillet, chamfer, blend, filletAlongPath, filletEdges, makeSweepPath, variableProfile, relaxPlanar, rolling ball, dihedral, sweep cutter, easy/hard class, sliver, scrap sheet, degenerate triangle, purple sheet, Area 0 face, zero-area face, edge pick, tangent chain, sphericalCorners, blend radius clamp, src/utils/fillet*.js, edgeTangencyField, edgeSweepPath, smoke_fillet_* golden."
---

# Fillets — how they are created

Companion doc: `docs/validation.md` (the gate every PR must pass). Kernel
history and measured alternatives are in `references/kernel-internals.md` below.

Deep math, framing internals and the full guard table live in
`references/kernel-internals.md` — read it before editing cutter construction,
framing, or any threshold. This file is the map and the rules.

## The frame of reference

Every blend is a **material-remove boolean**: build a cutter solid, then
`part = part − cutter`. There is no surface-blend / face-offset kernel, because
the bundled WASM Manifold has no solid `offset()` / minkowski. 2D
`CrossSection.offset` exists but does not help loft walls.

## Three kernels, one UI

| Class | Kernel | Call |
| --- | --- | --- |
| **easy** — boxy, short chain, ~constant dihedral | dihedral **sweep**: per-segment in-face frames, θ-grouped runs | `filletAlongPath(part, path, r)` |
| **hard** — loft walls, twisted, variable θ, long chain | **varying-profile sweep** (C3.3): densified path-normal inscribed-arc frames, one cutter with a **per-knot cross-section** | `filletAlongPath(part, path, r, { variableProfile: true })` |
| manual override | classic **planar rolling-ball**: parallelepiped − cylinder per edge | `filletEdges(part, edges, r, { sphericalCorners })` |

**Concave edges are supported (C4)** and route automatically: the sign is read
per knot, convex runs become cutters (`difference`), concave runs become fillers
(`union`). The user never picks — `signedFeatureEdges` decides. Same wedge, same
rings; for a concave edge the angle between the in-face rays already IS the
empty-side angle, so only the ray orientation and the boolean differ.

Kernel choice is one function: `filletKernelSpike.js` →
`shouldUseHardVariableSweep(klass)`, gated by `FILLET_HARD_KERNEL_TRIAL = true`
(production-on for hard).

## The flow

1. **Pick** — `Viewport.jsx:1491` `enterFilletMode()` saves the prior Face/Edge
   pick mode (restored on exit) and seeds `enterFilletState()`. Entering **never**
   soft-fails on an empty selection. Taps go through `selectEdge.js`
   (`pickNearestEdgeScreen`, `buildCoherentEdges`,
   `toggleEdgeSelectionPropagated`). G1 tangent propagation is **on by default**
   so a circular rim arrives as one chain. Chain caps: 36.

2. **Classify** — `filletEdgeClass.js:640`
   `classifyFilletEdges(edges, { radius, geometry })`. **Any reason ⇒ `hard`**;
   none ⇒ `easy`; no edges ⇒ `empty` (not a warn).

   | Reason | Gate |
   | --- | --- |
   | `variable angle` | dihedral span > `DIHEDRAL_SPAN_MAX_DEG` (5°) |
   | `long chain` | segments > `EASY_SEGMENT_MAX` (12) |
   | `twisted wall` | side pair is not planar–planar or planar–cylindrical (`facesEasy`) |
   | `radius too large` | r > `maxSafeR` = `CLEARANCE_MARGIN` (0.95) · clearance · tan(θ/2) |

3. **Live preview** — `filletMode.js:236` `buildFilletBlendPreview` assembles the
   path via `assembleSweepPath` and paints wedge rings with the *same*
   `dihedralFilletContour` math the worker runs. Path topology is strict: one
   contiguous open chain or closed loop. Gaps ⇒ `FILLET_SWEEP_DISCONNECTED`; Y/T
   junctions ⇒ `FILLET_SWEEP_BRANCH`. Disconnected picks still draw their
   polylines so the user sees why.

   Radius: the card and the helper sheet seed 2 mm in every display unit
   (inches show 0.0787). The slider is a log from 0.5 mm to 25 mm. Hard max
   `sweepBlendHardMax(L) = max(6, 0.5·L)`. Planar keeps a separate `0.45·L`
   guard (`EDGE_BLEND_SIZE_GUARD`).

4. **Accept → code** — `Viewport.jsx:1510` → `App.jsx:794` → `filletMode.js:397`
   `composeFilletCommit`. Accept does **not** call the kernel; it writes JS into
   the user's script between `FILLET_MODE_BEGIN` / `FILLET_MODE_END`
   (emitter: `helperPaletteSnippets.js:938`), then Auto-Runs:

   ```js
   const selEdges = edgesNamed(part, "plate.top~boss.side"); // the pair of stamped faces
   const path1 = makeSweepPath(selEdges);   // edge→sweep path
   part = filletAlongPath(part, path1, 3, { variableProfile: true }); // hard (C3)
   ```

   **Edges are written by name** (`mvp3/edge-identity-design.md`): each
   picked edge carries `edgeName` from the stamped face table
   (`withEdgeNames` in Viewport, `edgeNamesForPicks` in `faceIdentity.js`),
   and `emitNamedEdgeLines` writes one `edgesNamed(part, ...)` per contiguous
   component: a pair whose every chain is picked is bare, a partial set keeps
   `[k]`. Blend surfaces are named too (`fillet-2.round`, `chamfer-3.bevel`),
   so a fillet on a fillet is `edgesNamed(part, "fillet-2.round~plate.top")`.
   The old forms stay only as fallbacks for rows with no name (test fixtures):
   `edge(part, id)` / `edgesBetween(part, a, b)` when a boundary id is present,
   else the literal `va/vb` wire, which `filletAlongPath` now refuses when it
   is no longer on the solid. Reopening the card parses `edgesNamed` and
   resolves the names on the live edges (`parseStoredEdges` kind `named`).

   A second Accept **appends** a block (`commitMode: 'append'`, chosen by
   `hasFilletModeBlock`) so it fillets the already-filleted solid.

   Several disjoint corners are separate pairs in that one block. Every
   `edgesNamed` lookup is written before the first `filletAlongPath`, as the
   `edgesBetween` / `edge` lookups were: the first blend renames the faces it
   cut (`<block>.round`), so a lookup of the next corner after that blend
   would name faces that no longer meet.

5. **Execute** — `src/workers/sandboxWorker.js` against WASM Manifold.

## Invariants — do not "fix" these

Each one is a scar. Changing it reintroduces a shipped bug.

- **The emit is regex-verified, and failure is loud.** Missing `makeSweepPath` /
  `filletAlongPath` / `variableProfile: true`, a stray `relaxPlanar: true`,
  unbalanced markers, or a missing marker block ⇒ refusal, never a silent no-op.
- **C3 supersedes C2.** `filletEdges(..., { relaxPlanar: true })` was the old hard
  path. `composeFilletCommit` actively refuses to emit it on the hard path.
- **The cutter pad is size-neutral.** Every first-quadrant contour vertex stays at
  exactly `r`; only the rear `(−e,−e)` bumper grows. A uniform Q1 scale silently
  redefines the requested radius — never do it.
- **Keep the full wire.** `planFilletSweepPath` always returns `as-is`. PR #27
  skipped prior-fillet micro-arcs and left a *gap* instead of wrapping the old
  blend. Slivers are consumed by the exterior overlap, never by dropping path
  segments. The dead `mode:'runs'` branch stays so that regression is
  mutation-tested.
- **Preview == commit.** `normalizeFilletParams` clamps the committed sweep radius
  to the same `sweepBlendHardMax` the preview painted, so the worker's
  "removed X vs expected" net never fires from the chip.
- **Profiles are shaped from the measured dihedral**, never a hard-coded 90°
  wedge — a 90°-only expectation false-trips acute fillets.
- **Never collapse θ(s) to one value on the hard path.** A loft ridge's dihedral
  genuinely ramps (measured 161.5° → 92.8° over 19.8 mm). Piecewise-constant θ
  runs give a staircase (C3.1); a single median θ gouges 11× too deep where the
  wall is nearly flat (C3.2). The cutter carries one section per knot — that is
  the whole point of `_s23VaryingProfileCutter`.
- **Volume guards cannot see a distribution error.** C3.2's total was 1.19× the
  true integral while its per-quarter profile was inverted. When you change
  cutter geometry, pin the SHAPE (per-quarter removal), not just the integral.
- **Hard class never blocks.** The chip does not warn. Hard-block Accept is an explicit non-goal.
- **Import thresholds, don't restate them.** `SLIVER_MAX_ABS` (80) /
  `SLIVER_MAX_FRAC` (0.06) live in `filletSliverGuard.js` precisely so the worker
  and the goldens cannot drift.
- **No naive sphere-hull cutters.** A sausage of spheres is not a rolling ball —
  measured ~919 mm³ removed vs ~77 mm³ analytic.
- **No CSG inside the convexity test.** The per-edge ball probe cost 5.5 s of a
  5.6 s loft fillet and returned garbage on fine meshes (f = 0.5 for 90° edges,
  negative volumes at ~0.012 mm probe radius). Convexity is a local winding
  test; keep it that way.
- **Sign per knot, never once per path.** A chain that changes sign mid-way was
  cut as whatever its first segment was.
- **Sign from TRIANGLE normals, angle contract from GROUP normals.** A group
  normal is an average — on a fillet sail it flips the cross product (2101 false
  concaves on a filleted box). But the normals the helper *returns* are the
  group pair, and downstream rejects a coplanar pair, so that gate stays on the
  returned pair. Getting this backwards broke pilot case 94480bca.

## Guards — fail loud, never silent

A wrong solid must never ship quietly. `filletAlongPath` checks, in order:
concavity (sphere probe ≥ 45% inside) → degenerate θ → no orientation → zero
cutter volume → empty result → near-no-op (`removed < 2% · expectVol`) →
oversize (`removed > 8 × expectVol`) → scrap components (`decompose()`; closed
paths drop empty seam shells and hard-fail when two components have volume)
→ degenerate triangles (`isFilletSliverDirty`). Full table
and the `_testCutterScale` test hook: `references/kernel-internals.md`.

**Know what these cannot catch.** They all integrate. C3.0–C3.2 shipped three
times through this suite because a wrongly-*distributed* cut can have the right
total. The distribution net lives in the C3.3 golden, not in the worker.

The viewport scrap banner is **delta-based** (pre-Accept degenerate-tri count via
`countDegenerateTriangles`) so a loft's baseline needles don't false-trigger
"zero-area faces".

## Where things live

| File | Role |
| --- | --- |
| `src/utils/filletAlongPath.js` | pure profile/area/frame math shared by UI, worker, goldens |
| `src/utils/filletEdgeClass.js` | easy/hard classification + `countDegenerateTriangles` |
| `src/utils/filletKernelSpike.js` | kernel choice + `FILLET_HARD_KERNEL_TRIAL` |
| `src/utils/filletMode.js` | in-mode state, validation, live preview, `composeFilletCommit` |
| `src/utils/filletSliverGuard.js` | degenerate-tri thresholds — import, never restate |
| `src/utils/edgeSweepPath.js` | `assembleSweepPath` / ordering / topology gates |
| `src/utils/edgeTangencyField.js` | tangency field, densify, transport, variable-profile frames |
| `src/utils/selectEdge.js` | edge picking, coherent chains, radius defaults/caps |
| `src/components/FilletModeChip.jsx` | Tangent / Clear / Undo / Confirm on the shared feature card; X cancels |
| `src/components/Viewport.jsx` | mode lifecycle, preview paint, classification, scrap notice |
| `src/utils/helperPaletteSnippets.js:938` | the `filletEdges` emitter (script text) |
| `src/lib/surfcad/runtime.js` | `filletEdges`, `makeSweepPath`, `filletAlongPath` (worker binds this module) |

## Goldens

```bash
npm run golden:slice23                        # fillet via sweep
npm run golden:slice27                        # fillet-in-mode
npm run golden:fillet-dihedral                # dihedral profile math
npm run golden:fillet-followup                # fillet-on-fillet
npm run golden:fillet-easy-hard               # classification + Accept gates
npm run golden:fillet-box-corners             # four vertical box corners; no face-boundary toast
npm run golden:fillet-kernel-spike-c
npm run golden:fillet-c2-rolling-ball
npm run golden:fillet-c3-variable-sweep
npm run golden:fillet-c3.1-along-path-tangency
npm run golden:fillet-c3.2-tighter-continuity
npm run golden:fillet-c3.3-varying-profile     # per-knot section + distribution net
npm run golden:fillet-c4-signed-concave        # signed edges, per-knot sign, concave filler
```

They pin both the pure math **and** the guard thresholds. A threshold change
without a golden change is a review stop. `npm run verify` is the real gate.

## Known-open (measured 2026-09-27, not yet fixed)

- **`convexEdges` is 97% of fillet runtime** — 5.5 s of 5.6 s on a 41k-tri loft.
  It runs a CSG sphere intersection *per candidate edge*. A winding-aware local
  test (`dot(cross(n₀,n₁), edge_dir) > 0`) measured 5 ms for the same answer at a
  12–15° gate; at the current 2° gate it disagrees, because the sphere probe
  doubles as a tessellation-seam filter. Does **not** affect the picking UI,
  which uses `buildFeatureEdges` on the three.js geometry instead.
- **The rear pad `e` scales with `r`, not with the local setback `t`.** On a
  shallow edge (θ=161°, t=0.32 mm) the 0.30 mm pad is as large as the blend.
- **Closed rims over-cut ~34% vs Pappus** on *both* easy and hard paths.
  Predates C3.

## Non-goals

Hard-block Accept. Rewriting the easy path. Face-offset / pair-blend (stays out
until Manifold gains solid offset, or someone writes a custom offsetter).
Adaptive multi-pass sweep (more booleans on mobile, no fix for variable-frame
error). Naive sphere-hull cutters.
