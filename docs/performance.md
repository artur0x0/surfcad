# Fillet and graph speed

For operators and cloud agents. #154 (`d87b983`) is the speed work on Artur's fillet script. Read this before changing sweeps or the face, edge, or contour graphs. Do not relearn it, and do not put the slow paths back.

## Goal

Artur's script (`scripts/golden/fixtures/artur_wrap_hollow.txt`):

- Centered cube 40×30×20.
- Four disjoint r=6 vertical corners: `edgesBetween`, then `filletAlongPath`.
- One long r=6 wrap along +Y of coherent edge segments.
- `hollow` 2.5, opening −Y.

**Target:** about **1 s** Run-to-ready on Safari latest iOS, iPhone Air.

Before #154 it was over 5 s on that phone, and **5.9 s** in desktop WebKit against https://surfcad.com.

## What was slow

The public site and Spark load the same single-threaded wasm (`built/manifold.wasm`, 480700 bytes). There is no COOP/COEP, so there are no pthreads. The Oct 3 / later main build is not a debug or unminified worker. Chasing a "site vs Spark" or "debug wasm" theory wastes the run.

Worker execute was a minority of Run-to-ready. After the mesh came back, main-thread face, edge, and contour graph builds took several seconds on the denser mesh.

Two kernel choices made that mesh, and the graphs, expensive:

- Face-graph curvature walked every adjacency once per triangle. Manifold gives each triangle its own `faceID`, so that scan was quadratic.
- Fillet sweeps used `extrudeSegments = max(48, frames * 4)`. Each semi-arc cutter carried about 48 rings. The same-radius semi-arc split then multiplied that across cutters. Frame densify at 5° and face-join were not the jump. The 48-slice floor was.

## What #154 changed

Merge `d87b983`. Keep all of this.

- One extrusion ring per 5° path knot (`_s23SweepKnotRings`, sweep frames). No 48-slice floor. Cross-section is `FILLET_ARC_SEGMENTS = 96`, the planar kernel's density. Same-radius semi-arc split stays. No sphere caps. No extra concave pad.
- N-way `difference([part, ...cutters])` instead of chaining cutter unions.
- `signedFeatureEdges` cached on the same part object across semi-arc runs (`_s23ProbeFeatureEdges`). The boolean result is a new object, so the next fillet misses and rebuilds.
- Face-id vertex dedup is a `Set` of vertex indices, not `array.includes` on vector refs.
- Face graph walks each atom's own neighbors. A plane is flooded only when another triangle lies on it (0.5° / 0.05 mm). A fillet facet with nothing else on its plane stays as it is.
- One interpolated ring on a ruling longer than 29 mm (`_S23_LONG_CHORD_MM`) so the rounded top rim stays one loop. Near-duplicate verts are welded inside face runs (`_S23_RESULT_WELD_MM`, 0.001 mm) so wrap-chamfer fins stay under the ceiling. The weld is kept only when volume moves by less than 0.001 mm³.

## Measured timings

Warm runs of Artur's script. Hollow confirmed (2.5 mm, opening −Y). Desktop WebKit with no throttle is the proxy that matched the live site, not a phone measurement.

| Target | Engine | CPU | Click→ready | Notes |
| --- | --- | --- | --- | --- |
| This branch (#154) | WebKit | none | ~0.49 s | Proxy that matched the live site |
| This branch | Chromium | 4× | ~1.45 s | Phone-ish main-thread throttle; wasm barely slows |
| surfcad.com pre-#154 | WebKit | none | ~5.87 s | Worker ~0.63 s; main thread after the result ~5.2 s |
| surfcad.com pre-#154 | Chromium | 4× | ~13.8 s | Main thread dominated |

In-app split on this branch at 4×: worker ~0.20 s, face ~0.44 s, edge ~0.30 s, contour ~0.23 s.

The surfcad.com rows are the site **before** #154. After that deploy, the public site should match this branch. Re-time both anyway.

## Quality bar — what not to undo

Do not buy speed by:

- Dropping arc segments below 24, or densifying on a turn coarser than 5° (`FRAME_DENSIFY_MAX_TURN_DEG`).
- Removing the same-radius semi-arc split, or adding sphere caps or an extra concave pad.
- Putting back `extrudeSegments = max(48, frames * 4)`.
- Putting back the all-adjacency-per-triangle curvature scan.

Gate the fillet surface against a high-res reference: the same quads with extra 0.5 mm stations (`__FILLET_REF_STATION_MM`). Do not gate it against main's 48-slice mesh. Main's mesh is coarser than the reference.

| Surface | This branch vs reference | Main vs reference |
| --- | --- | --- |
| Fillet | ~0.0003 mm | ~0.0125 mm |
| After hollow | ~0.24 mm | ~1.13 mm |
| After `chamferEdges` | ~0.73 mm | ~0.93 mm |

`golden:fillet-sweep-quality` locks that comparison (fillet under 0.02 mm; hollow and `chamferEdges` ceilings 0.35 mm and 0.8 mm, and closer than main). Related wrap and shell goldens: `golden:fillet-wrap-draft`, `golden:fillet-tangent-round-wrap`, `golden:fillet-chamfer-rounded-wrap`, `golden:artur-playtest-wrap-chamfer`, `golden:artur-playtest-shell-after-fillets`.

`golden:edges-pr2-patches` and `golden:artur-playtest-fillet-after-hollow` were already red on main before #154; the goldens pass (#166) brought them and every other golden back to green. One #154 effect is pinned, not fixed: `golden:playtest-draft-fillet-tear` allows the 4 zero-area triangles one-ring-per-knot leaves in the r=3.65 blend (ceiling, not 0).

## Open follow-ups

Do not start these unless asked.

- Faster boundary, coherent-edge, and contour graphs: string keys → numeric bins, the same idea as the face graph. Expected to bring 4× Chromium in-app nearer ~1.0 s. In flight after Artur's pick.
- Hollow and `chamferEdges` that sample the fine surface. Large. That is what closes the remaining millimetre-scale gaps.

## How to re-time

Playwright against `vite preview` (this branch) and against https://surfcad.com. The public site needs no login.

- WebKit, no CPU throttle, for Safari parity.
- Chromium with a 4× CPU throttle for main-thread pressure. Wasm barely moves under that throttle; the graphs do.
- Warm run. Confirm the hollow (opening on −Y, thickness 2.5) before recording.
- Wall-clock the Run click until the mesh is ready.

If the timing hook is present, a successful run sets `window.__SURFCAD_RUN_TIMING`:

| Field | Split |
| --- | --- |
| `workerExecMs` | Worker execute |
| `faceGraphMs` | Face graph |
| `edgeGraphMs` | Edge graph (feature + boundary topo + annotate) |
| `contourGraphMs` | Contour graph (coherent chains + contact seam) |
| `totalMs` | From the start of that execute to ready, not from the click |

## Viewport orbit (dev vs production)

This is not a fillet or wasm regression. Staging is `vite` dev. Production is `vite build` behind nginx. Same commit, same `built/manifold.wasm` (480700 bytes, sha256 `1b0597b065b041457e157daf6b53872337da0da75459d678eaf1d8cc4979bf43`).

React StrictMode in dev mounts the viewport effect twice. The effect started a `requestAnimationFrame` loop that called `controlsRef.current.update()` and `renderer.render`, and the cleanup did not cancel the frame or call `controls.dispose()`. Both loops stayed alive and both drove the second controls instance, so development applied every TrackballControls step twice per frame. Production mounts once.

`TrackballControls.update()` consumes the pointer delta on the first call and, when `staticMoving` is false, coasts on the next call with `dynamicDampingFactor` 0.2 (`_lastAngle *= Math.sqrt(1 - factor)` for rotation; zoom and pan eat `factor` of the leftover delta). Two calls per frame is a faster drag and a shorter coast. `controls.enableDamping = true` was a no-op: that property is on OrbitControls, not TrackballControls.

Ruled out on a 390×844 page, devicePixelRatio 3, in Chromium and WebKit, dev server and `vite preview`:

- Pixel ratio cap is `min(devicePixelRatio, 2)` in both, and both created a 2× backing store with antialias on.
- Live `rotateSpeed` / `zoomSpeed` / `panSpeed` / `dynamicDampingFactor` were the three.js defaults in both bundles. Minification did not change them.
- The wasm bytes above were the response in dev (`/built/manifold.wasm`) and in preview (`/assets/manifold-*.wasm`).
- Dev also loads `@vite/client` and the React refresh client. Those scripts do not touch the orbit. Stripe and Monaco load in both.

Before the fix, idle `controls.update()` / `renderer.render` per frame was 2 in dev and 1 in preview (the extra perpetual `requestAnimationFrame` in the sample is the probe). A 120 CSS-pixel pointer drag dispatched in the page (same `pageX`/`pageY` in both browsers) rotated about 0.568 deg/px in dev and 0.306 deg/px in preview (about 1.85×), and the coast dropped under 0.05 deg/frame in 15 frames in dev and 25 frames in preview. Chromium and WebKit agreed. Frame cost did not explain the sluggish prod feel: render CPU was a fraction of a millisecond, and the preview frame interval was the same or shorter than dev.

The viewport init effect now cancels its frame and disposes the controls. `src/utils/trackballFeel.js` sets one update to that double-update feel: speeds 2× the defaults, `dynamicDampingFactor` 0.36.

After that change, dev and preview both do one `update()` and one `render` per frame (one wheel listener, one key listener). The same in-page drag rotates 0.609 deg/px and coasts in 15 frames on Chromium dev, Chromium preview, and WebKit preview: about 7% above the old dev drag, same settle. A Playwright mouse drag, three trials, was about 6% above that browser's old dev number, and dev matched preview in each browser. Chromium's frame interval is 33 ms in both builds. Render CPU stays under a millisecond, so production was never the slow renderer.

## Loft tessellation

The Futuristic Bike saddle is not in the repo. The numbers below are the same four 32-point ellipses (70×28, 62×24, 36×16, 14×8 mm at offsets 0 / 160 / 270 / 285), from `npm run golden:loft-perf`. Artur's in-app times on the real assembly (open ~16 s, saddle switch 4–5 s, saddle Move 8–10 s, Move kernel ~0.5 s) were dominated by the 378k-triangle mesh. This script times the kernel and the same face/edge graph builders the part switch and Move path call. It does not include the browser upload.

The old parallel loft floored the polar table at 128 rays, unioned an arc-length resample of every station, and then inflated the extrude to `ceil(height / minSpan) * 16` slices (capped at 256). The 15 mm nose forced that cap across the whole 285 mm, so resolution 16 and 32 built the same mesh.

The adaptive loft keeps a vertex when dropping it would leave the chord farther than 0.0005 of the part's bounding diagonal (clamped to 0.01–0.25 mm), or when the corner turns 25° or more. Straight spans are one slice. A twisted span is split until the quad-twist sagitta is inside that tolerance. `opts.resolution`, when set, is the maximum polar gap `2π / N`.

| | Legacy uniform table | Adaptive |
| --- | --- | --- |
| Triangles | 377,708 | 3,580 (resolution 16 → 2,548, resolution 32 → 2,724) |
| Build | 877 ms | 9.7 ms |
| Volume | 1,215,028.42 mm³ | 1,215,045.15 mm³ (Δ 0.0014%) |
| Mass at 1 g/cm³ | 1215.028 g | 1215.045 g (same ratio; density is uniform) |
| Chordal tolerance | — | 0.161 mm |
| Deviation vs station-exact surface | station rings miss the mesh by max 0.255 mm, p95 0.233 mm (the extrude grid does not land on the stations) | max 0.062 mm, p95 0.0077 mm |
| STL triangles | 377,708 (equal to the mesh) | 3,580 (equal to the mesh) |
| STEP faces | — | 3,362. Coplanar merge stays at 1e-6 mm; a 0.05 mm kink is not merged |
| Face + edge graphs | not re-timed (the 378k mesh) | face 65 ms, edge 20 ms; cache hit ~0 ms |
| Move | kernel was ~0.5 s in the app on the dense mesh | kernel 0.1 ms, then face 87 ms + edge 12 ms |

A 102,152-triangle sphere (Frame/Fork scale stand-in) still spends 1.66 s in the face graph and 0.18 s in the edge graph. That is the remaining post-run cost once the saddle is no longer hundreds of thousands of triangles.
