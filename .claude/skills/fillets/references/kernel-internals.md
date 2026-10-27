# Fillet kernel internals

Cutter construction, framing, and the complete guard table. Read this before
editing any of it. The map, the flow and the invariants are in `../SKILL.md`.

---

## 0. Finding the edges — `signedFeatureEdges`

Convexity is a **local winding test**, not a CSG query:

```
convex  ⟺  dot(cross(n0, n1), dir) > 0
```

`dir` is the edge as wound in the triangle whose normal is `n0`; `e.tris[i]`
pairs with `e.faces[i]`, so triangle and group always correspond. Winding is
what carries inside/outside — a dot product alone cannot separate a 90° convex
edge from a 270° concave one, since both give the same normal angle.

Two normal sources, used for different jobs, and swapping them breaks things:

| job | source | why |
| --- | --- | --- |
| sign + feature angle | adjacent **triangles** | a group normal is an area-weighted average; on a fillet sail it points nowhere near the local surface and flips the cross product (2101 false concaves on a filleted box) |
| returned `n0`/`n1`, coplanarity gate | **face groups** | downstream (`chamferEdges`, the framing) consumes these and rejects a coplanar pair; gating on triangle normals alone hands it coplanar groups — this broke pilot case 94480bca |

Fallbacks, both load-bearing:
- A **degenerate sliver triangle** has no usable normal → its group normal
  stands in. Tessellated lofts carry hundreds (218 on the playtest loft).
- A **zero face-group normal** → the triangle normal stands in. `c4MeshData`
  sums a group's triangle normals, and on a difference-derived solid a group can
  cancel to zero: 13 of 17 convex edges on an L-shape, flowing straight into the
  framing as `n0`/`n1`. Long-standing, found during C4.

`FEATURE_EDGE_MIN_DEG = 18` is the ball probe's threshold made explicit: the old
`f < 0.45` is exactly `(180 − dihedral)/360 < 0.45`. That probe also failed
outright on fine meshes — at a ~0.012 mm sphere radius Manifold returns `f = 0.5`
for 90° edges and negative volumes — so it is not a reference to match.

## 1. Cross-section math

Shared between UI, worker and goldens from `src/utils/filletAlongPath.js` —
there is one implementation, not two.

`dihedralFilletContour(r, θ)` — origin → setback `t = r/tan(θ/2)` along face 0 →
arc of radius `r` → setback along face 1.

- Removed area per unit length: `r·t − ½r²(π − θ)`.
- At θ = 90° this degenerates to the classic square-minus-quarter-disk wedge,
  area `r²(1 − π/4)`.
- Chamfer is the equal-leg triangle, area `½c²·sin θ`.
- `FILLET_ARC_SEGMENTS = 24` — a 7.5° facet at 90°, chosen so the 15° / 5%
  boundary filter drops blend strips and keeps real edges.

`filletSetback` throws on degenerate θ rather than returning a huge number.

## 2. Boolean fuzz — size-neutral by construction

`expandDihedralCutterContour` replaces the contour origin with a rear bumper in
the `(−e, −e)` family plus thickness-`e` strips in Q2/Q4, where

```
e = filletSweepCutterExpand(r) = clamp(0.15·r, 0.30, 1.20)   // mm
```

**Why it exists:** the nominal wedge legs lie exactly *on* the two adjacent
faces. Manifold CSG on coincident surfaces leaves sliver sheets — worst when the
path includes tessellated prior-fillet micro-arcs whose chordal frames sit
near-tangent to the old cylinder. The pad moves the legs into empty space past
the crease.

**Why it is shaped this way:** every first-quadrant vertex stays at exactly `r`,
so the realized blend equals the requested radius. Mixed-radius and tighter
follow-on sweeps needed a deeper rear pad than the original 4%·r sliver, hence
the floor and cap. A uniform Q1 scale was tried and rejected — it only
redefined `r`.

The `(0,0)` corner is skipped by the loop, so the bumper vertex must replace it
or the contour collapses. The floor/cap pair is an unvalidated
boolean-robustness margin: the rim gap net cannot certify it, but the legs must
not coplanar-coincide with faces. Leave it alone unless you have a new net.

## 3. Framing — easy path

`_s23ProbeSegments` (`sandboxWorker.js:3133`):

1. One `convexEdges()` pass + one mesh-info build for the whole path.
2. Per path segment, nearest convex edge by midpoint distance, tolerance
   `max(0.85, 0.55·segLen, 0.35)` — loose enough that densified knots (shorter
   than mesh edges) still pick up local walls.
3. Two in-face directions from the triangle pair sharing that edge
   (`_c6InFaceDir` on the third vertex of each triangle).
4. `orientFilletFrame(T, f0, f1, prevN)` → orthonormal (N, B, T), right-handed so
   a CCW (u,v) contour extrudes along +T. `prevN` keeps a chain from swapping
   axes at every sample.
5. Unmatched segments carry the nearest matched frame (`_s23CarryFrame` /
   `_s23NearestMatched`) — smooth G1 bridges are not convex edges, so they
   inherit the neighboring dihedral frame rather than failing.

Convexity is probed **once** per path, at the first matched segment: a small
sphere at the segment midpoint, `fIn = intersection(part, sphere).volume() /
sphere.volume()`. `fIn ≥ 0.45` ⇒ concave ⇒ throw. Sweep fillet is external /
material-remove only.

Segments whose θ agrees within `_S23_THETA_TOL` (3°) group into runs
(`_s23GroupRuns`; a closed path also merges head into tail when they match).
Each run sweeps via `_s23SweepKnotRings`: one cross-section ring at every path
knot (that segment's frame; the end knot reuses the last frame), stitched by
`varyingProfileTubeMesh` and capped. Nothing is inserted between knots. A
uniform `Manifold.extrude` slice count spaces samples by arc length, so a long
straight in the same run as a short arc chord skips the 5° knots. Runs are
unioned into one cutter. A closed loop still sweeps one lap plus an 8% overlap
as an open tube. An open-end extension inserts a station beyond the knot
instead of moving it, so the knot still has a ring. A span longer than
29 mm (`_S23_LONG_CHORD_MM`) is filled with linearly interpolated rings on
that ruled quad so a full-height fillet meets the cap as one loop; shorter
chords, including the 28 mm wrap straights, stay one quad. After the boolean,
`_s23WeldFilletResult` snaps vertices within 0.001 mm and drops the collapsed
triangles, keeping the original runs and faceIDs, and keeps that mesh only
when the volume moves by less than 0.001 mm³. A measurement flag
`__FILLET_REF_STATION_MM` replaces the 29 mm step with a finer grid.

## 4. Framing — hard path (C3 variable profile)

`_s23BuildVariableProfileCutter` (`sandboxWorker.js:3535`):

1. **Densify** — step `min(0.28·R, pathLen/48)`
   (`variableProfileDensifyStep`), then a max-turn refinement at
   `FRAME_DENSIFY_MAX_TURN_DEG` = 10°. Chord-only densify misses high-curvature
   loft polylines whose knots are already short but whose turns are large.
   0.75·R alone (C3.0) was too sparse for large-R ridges.
2. **Probe wall normals per knot** — `_s23ProbeKnotNormals`, same mid-match
   spirit as the easy path, requiring `e.n0`/`e.n1`. Knots that miss carry the
   nearest matched normals (circular distance when closed). Same one-shot
   concavity probe.
3. **Build frames** — `buildVariableProfileFrames`: inscribed arc of radius R in
   the local wall square (side ≈ 2R), with parallel transport along the path
   (`parallelTransportNormal`, damping `FRAME_TRANSPORT_DAMP_DEG` = 12°,
   θ-jump tolerance `FRAME_TRANSPORT_THETA_JUMP` = 5°). At least one non-weak
   frame is required or it throws.
4. **One cutter, one section per knot** — `_s23VaryingProfileCutter`.

### Concave runs (C4)

The path splits into maximal same-**sign** runs. Convex runs build cutters,
concave runs build fillers, from the *same* `_s23VaryingProfileTube`.

For a concave edge the angle between the two in-face rays already IS the
empty-side angle, so the contour that carves a convex corner fills a concave
one. Only two things differ:

1. `inFaceDirsFromNormals(..., convex=false)` negates both rays. The convex
   orientation points them into the material wedge; on a concave edge that wedge
   is the reflex one, so the rays end up inside solid rather than along the walls
   (measured on an L: `f0 = −Y`, `f1 = −X` where the walls run `+Y`, `+X`).
2. `M.union([out, filler])` instead of `M.difference`.

The two booleans run and are **measured separately** — a single net-volume check
could pass on a mixed chain while both halves were wrong.

Unpolished: where a chain changes sign the cutter and filler overlap at the
corner (net +6.4 on a mixed L chain where ideal is ~0).

**Open ends of a concave run** (`_s23ExtendConcaveOpenEnds`). Every concave
open end is padded by the cutter-expand length so the filler cap is not
coplanar with the face the edge ends on, and the pad is then taken back:

| What is past the end | Rule |
| --- | --- |
| a face of the pre-fillet bbox (shell opening, plate skin) | pad, bbox clip (`_s23ClipToBBox`, grown by the section reach on the other sides) |
| an exterior face inside the bbox, aligned with the tangent (boss end wall, cutout skin under a flange) | pad, clip to that plane (`_s23ClipSolidToPlanes`). Among aligned faces within 0.75 mm the **nearest** wins: B6 was a plate side 0.375 mm out tying the boss end wall and taking the clip plane with it (0.375 mm wings) |
| material (pocket end wall, inner ceiling) | pad, swallowed by the union |
| air with no aligned face (the straight segment ends where a previous fillet's round begins) | **no pad**: the tube ends flush at the endpoint. B7 / follow-up 4 were this pad standing proud as a 0.42 mm nub (+1.65 mm³) |

Material vs air is one tiny cube intersection per end (`_s23MaterialPastEnd`),
probed 0.1 mm past the endpoint along the tangent and 0.1·r into the empty
wedge (`f0 + f1` span it on a concave segment). Two booleans per chain, never
per edge.

### Why not extrude+warp (the C3.0–C3.2 dead end)

`Manifold.extrude` + `warp` can only *reorient* one fixed 2D profile; it cannot
change its shape along the sweep. On a loft ridge the dihedral genuinely ramps
(measured 161.5° at the smooth circle end → 92.8° at the rect corner), so any
single section is wrong somewhere:

| | approximation of θ(s) | symptom |
| --- | --- | --- |
| C3.1 | 17 piecewise-constant θ runs | staircase |
| C3.2 | 1 run at the median θ | gouge — 11× over-cut at the shallow end |

`_s23VaryingProfileCutter` builds the mesh directly instead: for each knot,
`_s23DihedralContour(r, θᵢ, …)` placed through that knot's frame as a ring, and
`varyingProfileTubeMesh` stitches consecutive rings into a closed tube.

- Every θ tessellates to the **same vertex count** (2 legs + `arcSegs` + 2 pad
  verts), so rings stitch with no special-casing. `varyingProfileTubeMesh`
  throws if that ever stops being true.
- Side quads are wound `(i,k) (i,k+1) (i+1,k+1)` / `(i,k) (i+1,k+1) (i+1,k)`,
  which is outward for CCW-about-+T rings advancing along +T.
- **Caps are a fan from vertex 0** — the rear bumper corner. Valid for every θ:
  the section is a convex wedge minus a convex disk bite, and vertex 0 lies
  outside that bite, so the section is star-shaped from it and no fan triangle
  can escape the region.
- θ is **clamped** per knot to `[0.08, π−0.08]`, not thrown — one noisy knot
  must not kill a 48-knot blend. `clampedKnots` goes into the meta; a mostly
  clamped path still fails the volume guards.
- A cutter that needs `_meshDataToManifold` to weld is a **loud fail**: the
  rings are watertight by construction, so a weld means two rings collided.
- `expectVol` is the true per-knot integral `Σ area(θᵢ)·lenᵢ`, which makes the
  downstream volume guards meaningful instead of self-confirming.

Diagnostics land on `globalThis.__filletVariableProfileMeta`:
`usedFrames`, `frameCount`, `densifiedPoints`, `rawSegCount`, `strongFrames`,
`alongPathTransport`, `maxFrameJumpDeg`, `singleRunCutter`, `runCount`,
`thetaRunCount`. The C3 goldens assert against these — keep them populated.

## 5. Closed loops

Try the exact revolve fast path first (`_s23TryRevolveCutter`): the 2D profile
revolved about the rim axis. It throws "too large for this rim" when the radius
would revolve through the axis — that throw propagates, it is not swallowed.

Otherwise sweep **one lap + 8% overlap as an open path** of knot rings. A true
closed tube leaves a seam that triangulates into purple sliver sheets.

## 6. Legacy RMF

Reached only when `opts.initialNormal` is passed explicitly: a single 90° wedge
spun by one start frame, with heuristics that may reverse the path to get the
binormal on the right side. Kept as an escape hatch for scripts; it is **not** a
fallback for a failed probe, and the acute-edge hook is exactly why a 90°
start-frame fallback was removed from the automatic path.

## 7. `filletEdges` — planar rolling-ball

`sandboxWorker.js:2150`.

Per edge: the parallelepiped spanned by `t·f0` and `t·f1` extruded along the
edge, **minus** a cylinder of radius `r` whose axis is the interior bisector at
distance `r/sin(θ/2)` from the edge (1 mm overshoot each end).

- `SEGMENTS = 384`. At 96, each flat facet dipped inward by
  `r·(1 − cos(π/96))` ≈ 1.07e-3 mm for r=2, leaving a measurable residual band
  (~4.5e-2 mm³ per 20 mm edge). 384 cuts that ~16× (2.7e-3 mm³) for ~400 tris
  per edge vs ~108.
- **Closed circular runs** (`_c6DetectRuns` / `_c6ClosedRunCutter`): a
  tessellated circular rim fillets as *one exact revolved feature* — quad minus
  circle, revolved once. Half the triangles of two revolves, zero degenerate
  tris. Revolve stays phase-locked to the part mesh's segment count.
- **Planarity assert** (`_c6AssertPlanarAtEdge`): singletons and fallback edges
  only. Successful closed runs skip it — the circle fit plus the on-circle check
  *is* the run-level validity proof. `relaxPlanar` skips it too (C2 legacy).
- **Sliver skip**: `t > 0.45·L` ⇒ skip, don't throw. Short edges are
  tessellation slivers of a curved arc that a filtered edge list picks up
  alongside the real edge; filing one off adds noise, and one bad sliver must
  not kill the whole part. But if *every* edge was skipped, throw loud with the
  example `t`/`L` and the "pass `convexEdges(part)` unfiltered" hint.
- **Union then subtract once**, so shared-corner overlaps are counted once
  (matches analytic inclusion–exclusion).
- **Zero cutters with a non-empty edge list is a loud failure.** An empty edge
  list is a no-op. The old `console.warn` hid missed hole rims.
- `sphericalCorners`: where three filleted edges meet, a ball of radius `r` at
  the trihedral incenter replaces the cusp. The incenter is equidistant `r` from
  all three faces (patch tangent to each face) *and* lies on each fillet
  cylinder's axis at the same radius (patch tangent to each sail along a circle
  ⇒ C1 junction). Applied only to box-like ~90° equal-radius triple vertices;
  other corners keep the cusp.

## 8. Guard table — `filletAlongPath`

In execution order. Every one throws; none degrade silently.

| Guard | Trigger |
| --- | --- |
| concavity | sphere probe `fIn ≥ 0.45` ⇒ "sweep fillet is external / material-remove only" |
| degenerate θ | θ ≤ 0.05 or ≥ π − 0.05 rad ⇒ "re-pick edges" |
| no orientation | no convex edge near the path / no inscribed-arc frames |
| bad cutter status | Manifold status error on the swept solid |
| zero-volume cutter | `cutterVol ≤ 1e-9` — "check radius / path" |
| boolean failure | `difference` threw |
| empty result | `volAfter ≤ 1e-9` — cutter consumed the solid |
| no-op | `removed ≤ 1e-6` — cutter outside the solid (wrong orientation/path) |
| near-no-op | `removed < 0.02 · expectVol` |
| oversize | `removed > 8 · expectVol` |
| scrap components | `decompose()` > 1: closed paths keep the largest when every other component is seam dust (volume ≤ 1e-8); two components with volume still hard-fail. Open paths keep the largest only if scrap ≤ 5% of it and ≤ 1e-2 |
| degenerate tris | `isFilletSliverDirty(tiny, nTri)` — tiny > 80 **and** > 6% of tris |

`expectVol` uses the **dihedral** removed area when the per-segment cutter ran
(`expectVolOverride`), never a 90°-only figure: a 90° expectation false-trips an
acute fillet (removed area grows as θ shrinks) and misses a hooked 90° wedge.

**These guards are blind to distribution errors, by construction.** Measured on
the playtest loft ridge: true per-knot integral 7.202, C3.2's median-θ cut
8.556 (1.19× — passes), C3.3 7.274. Yet per quarter of the path the correct
shape is 0.29 / 1.26 / 2.35 / 3.29 and C3.2 produced 3.32 / 2.39 / 1.52 / 1.32
— an inverted ramp. A cut can be wrong everywhere and still integrate to the
right number. Cutter-geometry changes must be pinned by the per-quarter net in
`smoke_fillet_c3_3_varying_profile.mjs`, not by totals.

`opts._testCutterScale` is a **test-only** hook: scale the 2D cutter (e.g. 4×) to
pin the oversize guard. It deliberately neutralizes the sibling near-no-op guard
and skips the revolve fast path, so the coordinated probe reaches the intended
throw instead of the first one.

## 9. Viewport-side quality reporting

`filletQualityWatchRef` records the degenerate-tri count **before** Accept
(`countDegenerateTriangles`, `filletEdgeClass.js:682`); the next successful run
reports only the **delta**. Loft baselines carry their own needles, so an
absolute count false-triggered "zero-area faces" on every loft fillet (C3 fix).

Hard-path scrap-sheet needles loud-fail; Auto-Run restore keeps the prior solid
and Undo still works.
