# Fillet kernel internals

Cutter construction, framing, and the complete guard table. Read this before
editing any of it. The map, the flow and the invariants are in `../SKILL.md`.

---

## 0. Finding the edges — `signedFeatureEdges`

**Face groups are per original.** `c4MeshData` groups triangles by Manifold
`faceID` *within one original* (`runOriginalID` from the run tables). `faceID`
restarts at 0 for every input of a boolean, so after a fillet a box triangle
and the sail triangle beside it can both carry id 8; grouped by id alone they
fused across their shared 90° edge and that edge was no feature edge. On a
40×30×20 box the bottom rim lost two arc segments after the vertical fillets
(the top kept all 100), `makeSweepPath` saw a broken loop, kept the largest
piece, and the next fillet missed a corner by 138 mm³. The coplanar re-merge
that follows still joins same-plane components of one body.

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

Fallbacks, all load-bearing:
- A **degenerate sliver triangle** has no usable normal → its group normal
  stands in. Tessellated lofts carry hundreds (218 on the playtest loft).
- A **folded sliver** (`_c6UnfoldedNormal`): a planar face bounded by a dense
  arc (a 96-step fillet, then `hollow`) can carry ~1 mm² slivers that
  Manifold wound against their own face, each with its own faceID, so the
  group normal is the sliver's own. Among the triangle and its coplanar or
  folded neighbours the largest one is the surface; a sliver borrows that
  normal. Signing a concave crease from such a sliver called it convex and
  the next fillet cut instead of filled.
- A **fold pair's shared edge** (two triangles with `n0·n1 < −0.9`) is a
  fin, not a crease; it is skipped. `dropPlanarFins` removes the same fins
  before drawing.
- The sweep-path **endpoint weld** (`_weldCoincidentEnds`, 0.05 mm) now
  stays under 0.4 × the shortest edge of the set: the first chord of a dense
  arc is a quarter chord long, and welding its far end onto the straight it
  starts from turned a closed rim into eight junctions.
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
or the contour collapses.

**The legs end exactly on the faces between two planes** (`exactLegs`,
`faceEps` 0, decided per run from `seg.planar`: both walls of every segment
are true planes, from `signedFeatureEdges`' `planar0`/`planar1`). The leg
then rises from the pad at `(t, −e)` straight to the tangency `(t, 0)`, so
the cutter touches the face only along that line and the arc's first facet
is tangent to the face, as the planar kernel's is. The default 2.5 µm nudge
of the setback endpoints off the face kinks that facet by about 1.5°; a
later `hollow` then moved the tangency vertex along the wall normal and the
first arc vertex along the kinked facet normal, reordered them, and folded
the wall's slivers once arc chords were under ~0.05 mm. On a curved wall
(a bend, a loft) the nudge stays: a facet grazing a curved face leaves
sliver sheets in the boolean (artur-bend-fillet, c3.3). The mesh-built
corner pocket needs the exact tangent points too. The floor/cap pair is an unvalidated
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

**Seating a concave run** (`_s23SeatConcaveKnots`, run right after the knot
probe and before `buildVariableProfileFrames`). A filler's section starts at
the knot and its legs run along the two walls, so a knot in the air beside a
wall carries the leg out with it: the filler stands proud and ends at the
tangency in a flat ledge as wide as the knot was proud. A cutter does not
care, its legs are meant to be in the air.

The knots get into the air on every tessellated curve, because
`densifySweepArcTurns` resamples the path onto a fitted arc:

| Crease | Fitted circle | In the air by |
| --- | --- | --- |
| 64-facet post r 8 on a plate | through the vertices, r 8 | 9.6 µm at each facet middle (the full sag) |
| 64-facet blind bore r 10, wall to floor | r 9.9907 | 9.2 µm at each facet corner |
| planar pair (box, L) | on the crease | 0, not moved |

Measured on the post with a 2 mm fillet before the fix: 159 convex edges of
88° in a ring at the tangency, each a step a few µm wide. They are real
edges, so `convexEdges` listed them, and the next no-selection blend failed:
`filletEdges` threw "edge is concave" (its ball probe reads a micron step as
flat) and `chamferEdges` cut through. After: 0 ledge triangles, the convex
and concave edge counts of the part are what they were minus the filleted
crease, and the default fillet and chamfer remove the same volume as on the
plain post (90.773 and 210.398 mm³).

The rule:

1. Wall planes come from the two **triangles** of the mesh edge each segment
   matched (`segmentEdges` from `_s23ProbeKnotNormals`). A face-group normal
   is an average and is no plane on a curved group. A sliver triangle has no
   usable normal and borrows the group's. Wall A and wall B are told apart
   along the run by continuity, because n0 / n1 order is arbitrary per edge.
2. A knot is measured only against an edge it projects onto
   (`_s23KnotOverEdge`). A segment is matched at its midpoint, so a knot at
   its end can sit past the end of that edge, over the next facet. On a bore
   the plane of the facet it left then read 22 µm, more than twice the truth.
3. `lift[w]` is the largest proudness of any knot over wall `w`. Under
   `_S23_SEAT_MIN_MM` (0.1 µm) it is 0, which covers every path that lies on
   its crease. Over a tenth (`_S23_SEAT_MAX_FRAC`) of the fill's thickness at
   the crease, `r(1/sin(θ/2) − 1)` for the thinnest segment of the run, it is
   0 too: sinking the section that far buys a clean edge with a fillet
   visibly smaller than asked for, or means the path is off its crease
   altogether. At θ 90° and r 2 the cap is 83 µm against 9.6 µm of sag.
4. Every knot whose segments are all concave moves by `−lift[w] · n` for each
   wall, with `n` its own local wall normal. That is an offset of the curve:
   no turn angle changes, so the run stays one tube. Knots of a mixed-sign
   chain that touch a convex segment do not move.
5. The seat never adds a corner. `_s23PathCorners` counts the knots that turn
   past `_S23_RUN_CORNER_DEG` before and after. If the offset path has more,
   the direction field is smoothed along the run (`_s23SmoothDirs`, weights
   1 2 1, renormalised) with 2, 8, then 32 passes, and if it still has more
   the run is not moved. No smoothing is tried first, so an even field (a
   post, a bore) is offset exactly as rule 4 says.

Rule 5 and the cap came from one part, a 64-facet post (r 6) under a sphere
(r 9), fillet r 1, θ 131.8°, fill 95 µm thick:

| Seat | Runs | Added mm³ (ideal about 1.0) | Convex / concave edges after |
| --- | --- | --- | --- |
| none | 1 | 1.070 | 298 / 446 |
| per-knot normals, lift up to r | 20 | 0.526 | 727 / 929 |
| smoothed, lift up to r | 1 | 0.529 | 97 / 57 |
| smoothed, lift capped (shipped): one wall at 7.3 µm, the other (18 µm) refused | 1 | 0.890 | 183 / 253 |

The facets under that crease are cut by the boolean and point every way, so
the per-knot normals jitter; 18 µm along them took a 4.93° path past the 5°
gate.

**What the seat does not fix: a wall that curves along the leg.** The legs
of the section lie in the plane of the facet at the crease. A sphere bends
away from that plane (r 9: 11 µm over a 0.45 mm leg, more with the next row
of facets), so the far end of the leg stands proud whatever the knot does.
After the fillet above, 33 convex edges remain on the sphere side and the
no-selection `filletEdges` still throws "edge is concave". Edges there are
picked by name. Seating the leg end against the real surface needs a
point-to-mesh query per knot and is not built.

**The path under the seat** (`densifySweepArcTurns`, `_arcFit` in
`src/utils/filletAlongPath.js`). The same part showed the path was wrong
before any seat: a closed loop was fitted through its first, middle and last
sample, and the last sample of a loop is the first one's neighbour. The plane
hung on that one chord. The crease wobbles by 31 µm in z, the circle tilted
4.4°, and the knots ran from z 36.85 to 37.80 around a crease at 37.31. Main
built the filler there and passed every guard (added 0.945 mm³, 215 convex
and 760 concave edges after). Two rules now:

- `_arcFit`: when a run wraps (its ends are closer than half its
  first-to-middle span) and its samples are more than `ARC_FIT_NOISE_MM`
  (1 µm) off the first / middle / last circle, thirds of the run are tried
  and the closer circle wins. An exact rim never gets there, so its knots
  are what they were, bit for bit.
- A closed loop whose samples are all within max(0.05, 0.01·R) of one circle
  and which has no designed corner (no turn over 50°) is resampled as that
  whole circle, whichever of its vertices passed the arc test. Uneven chords
  (0.2 to 1.6 mm on that crease) leave some vertices under the turn limit,
  the loop came out as one run with raw samples between its ends, and the
  ends stay on their samples: 30 µm off next to a 0.5 mm chord is an 8.7°
  kink and the fillet was cut as 24 tubes.

Tests: `src/utils/filletArcFit.test.js` (the two noisy-loop tests fail on
the old fit; an exact rim and a rounded rectangle are unchanged).

Per-knot snapping (each proud knot onto its own facet) was tried first and is
wrong. It turns the arc back into the polygon; the 5.6° corners of a 64-gon
clear `_S23_RUN_CORNER_DEG` (5°), the run splits there, and the fillet comes
out as 14 tubes with a radial 90° step at every split.

What the offset costs: a knot that was on the wall ends up inside it by the
sag, so the arc meets the wall just below its tangency in a shallow concave
crease (5.6° on the 64-facet post), under `FEATURE_EDGE_MIN_DEG`. The fill is
under the ideal Pappus volume by 0.8% at 96 facets, 1.7% at 64, 3.8% at 32.
The meta (`__filletVariableProfileMeta`) carries `seatedKnots` and
`seatMaxMm`. Tests: `src/lib/surfcad/concaveFilletSeat.test.js`.

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

## 4b. Edge sets — `_s23FilletEdgeSet`

`makeSweepPath` on several chains (or a pick with junctions, split into
chains at every vertex of degree ≥ 3) returns `components`. `filletAlongPath`
then runs each component in **collect mode** (`opts._collect`): the component
takes its usual route (runs mode, dihedral, variable-profile, legacy RMF) up
to the point where it would subtract, and returns its cutters, fillers and
expected volumes instead. All cutters are built against the untouched solid,
so a chain sharing a vertex with an earlier chain still finds it; filleting
components one after another failed the stale-wire guard on the second chain.
Then one n-way `difference`, fillers unioned, and the set guards: removed
within [2 %, 8×] of the summed expectation, open-path scrap rule, weld,
sliver count. Fillet mode writes one `makeSweepPath` + `filletAlongPath`
pair per Accept for this reason; the per-component clamp of the radius stays
in the Accept gate.

**Junction pockets** (`_s23JunctionPockets`). Before the components are
collected, every vertex where exactly three chains end is tested the way
the planar kernel tests a corner: directions orthogonal (1e-4), each end
segment's probed dihedral 90° within 1e-4, every chain convex, each chain
long enough for its caps (r per trimmed end). Such a corner gets the same
`_c6CornerPocket` as `filletEdges`, with one difference: the pocket's three
boundary arcs are the chains' own end rings, the dihedral contour with
`faceEps: 0` (legs exactly on the faces) placed through the probed frame at
the junction knot `P + r·d`. Each chain is trimmed to that knot, its draft
end extension is skipped there (`trimStart` / `trimEnd` through
`_s23CuttersFromSegs` to `_s23ExtendOpenRunEnds`), and its contour runs
with exact legs for the whole chain. The pocket ids go to `_blendCornerIDs`
so the face is `<block>.corner[k]`. Measured on the 40×30×20 r=5 box through
`makeSweepPath(convexEdges(part))`: 5.2k triangles, 0 needles, 12 sail
patches + 8 corner patches, 0.11 s, volume 4.7 mm³ under analytic (the
24-step arc removes a little more than the circle). Chamfer, variable-profile,
`initialNormal` and raw-point paths keep the cusp.

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
- **Cutter corners sit outside the faces** (`_C6_FACE_PUSH_RATIO`, 0.02·r).
  Manifold keeps a solid's planes in doubles but hands JS a float32 mesh: a
  box 68.7 wide has its face at 34.35 while its vertices read 34.349998. A
  cutter face laid exactly in the part's face from those vertices sat two
  microns inside it and the subtract left the strip between the edge and the
  tangency as a two-micron skin of the old face over the fillet (genus +1 per
  edge, inward-facing wall of triangles, a shell that offset the skin the
  wrong way). Every corner point (the edge point of a prism, a pocket's apex,
  the rim point of a closed-run quad, the v1 corner box's on-face corners)
  moves 0.02·r out of each face it lies on; the tangency rings stay exact, so
  the face-lying side runs from air to the tangency and crosses the face
  plane like the sweep kernel's legs. A **free** edge end (a face of the part
  caps it: some face at the vertex has normal along the edge) is overrun by
  the same amount; an end that runs into other material (a boss edge on a
  plate) stays flush (`freeA/freeB` in `_c6EdgeGeom`). Expected cutter
  volumes carry the push: prism section `r²(1−π/4) + push·r`, pocket
  `r³(1−π/6) + 2·push·r²`. Measured at r = 4: 0.01 mm still left a 0.6 µm fin
  along the tangency, 0.03 mm and up none, 0.3 mm broke the pocket check.
  Test: `src/lib/surfcad/filletFacePush.test.js`.
- **Union then subtract once**, so shared-corner overlaps are counted once
  (matches analytic inclusion–exclusion).
- **Zero cutters with a non-empty edge list is a loud failure.** An empty edge
  list is a no-op. The old `console.warn` hid missed hole rims.
- `sphericalCorners`: where three filleted edges meet, the sphere of radius
  `r` about the trihedral incenter replaces the cusp. The incenter is
  equidistant `r` from all three faces (patch tangent to each face) *and* lies
  on each fillet cylinder's axis at the same radius (patch tangent to each sail
  along a circle ⇒ C1 junction). Applied only to box-like ~90° equal-radius
  triple vertices; other corners keep the cusp.
  - **Exact corners are mesh-built, never a boolean between tangent
    surfaces.** `_c6TrihedralCorners` finds the corners before any cutter
    exists. For an exact one (edge directions orthogonal and dihedrals 90°
    within `_C6_EXACT_CORNER_TOL = 1e-5`, every edge long enough to hold its
    caps) each edge cutter is `_c6TrimmedEdgeCutter`: the square-minus-
    quarter-circle section extruded as a mesh, stopping at the junction plane
    `r` from the vertex. Each corner is one `_c6CornerPocket`: the r-cube at
    the vertex minus the sphere octant, as a mesh. The pocket's far faces are
    the same polygons as the prisms' end faces, computed through the same
    expressions (`_c6CornerSpherePoint`, `_c6CornerArc`), so the cutter union
    merges them and the sail meets the sphere on a shared ring. One subtract,
    as before.
  - **Why.** v1 cut `(cornerBox ∩ cyl₁ ∩ cyl₂ ∩ cyl₃) − ball`. The ball is
    tangent to each sail along the junction circle, and a boolean between
    tangent surfaces zig-zags. On a 40×30×20 r=5 box: 44k triangles, 1390
    needles, `rim.round` split into 226 patches, 1.33 s. v2: 12k triangles,
    0 needles, 12 sail patches + 8 corner patches, 0.38 s. A rotated box went
    from 19 s / 76k triangles to 0.65 s / 13.6k.
  - **Octant grid.** Barycentric grid with `FILLET_EDGES_CORNER_SEGMENTS/4`
    steps per side (128 → 32), weights `sin(w·π/2)` so each boundary arc is
    uniform in angle, every boundary step split `384/128 = 3` times to the
    sail's 96-per-quarter ring. Corner triangles of the grid are merged with
    their inner neighbour and fanned from its far vertex, so no fan triangle
    lies along one arc. `FILLET_EDGES_CORNER_SEGMENTS` must divide
    `FILLET_EDGES_CIRCLE_SEGMENTS` (asserted at load).
  - **Near-90° corners** (edges within 0.02 rad of 90° but not orthogonal,
    such as a 1° drafted box) take the same mesh. The incenter solves the
    three face-distance equations; `P + r(n1+n2+n3)` is that point only for
    orthonormal normals, and checking `|O−P|` against `r√3` rejected a
    drafted corner (3.4239 vs 3.4641 at r = 2). The arc weights are
    normalized onto the sphere when the edge directions are not orthonormal.
    The v1 ball cut remains only when an edge cannot hold its caps.
  - **Identity.** Each pocket's run id goes into `_blendCornerIDs` (read from
    `getMesh().runOriginalID`: a mesh-built solid reports `originalID() === -1`)
    so `_stampRunsInRange` names it `<block>.corner[k]` instead of `.round`.
    The face graph needed one rule for this: a mesh-built pocket and a
    mesh-built prism both number their triangles from 0, so equal Manifold
    face ids meet across the shared ring. `buildPartGraphPatches` no longer
    joins two triangles into one atom across a stamped-face boundary.

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

**`chamferEdges` has one guard of this family**: after each edge's cut it
counts bodies and throws "split the solid into N bodies" when the count grew.
It counts through `_chamferBodies`, which drops components of volume ≤
`_SEAM_DUST_MM3` (1e-8 mm³, shared with the closed-path rule above) and
continues from the cleaned solid. The specks are zero thick and come from a
cutter closing a loop: 7e-11 mm³ on the top rim of a 64-facet post, six of
5e-11 to 3.5e-15 mm³ on the rim face of a shelled cup (128 edges, 2 mm wall).
Before the rule that cup's rim chamfer was refused at every leg length. A
real cut-through (a 2 mm chamfer on a 1 x 1 neck between two blocks) still
throws.

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
