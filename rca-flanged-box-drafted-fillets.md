# RCA: Flanged_Box spikes and inner-corner crevices (draft + fillet + shell)

Part: `Flanged_Box` in `~/surfcad-vault`
(`parts/2026-11-02-13-16-55-0518-9529.js`). Date: 2026-11-03.

The script is a drafted box (80 × 86 × 37.5, `draftFaces('sides', -1, { pull:
'z', reference: 'max' })`), then `filletEdges` r = 4 with `sphericalCorners`
on the four vertical edges and the four bottom edges, then `hollow(1.85,
'z')`, then the flange and holes. Every defect below reproduces on the first
three steps alone, headless, with no flange.

## Summary

| Symptom in the screenshots | Measured | Root cause | Fix |
| --- | --- | --- | --- |
| Thin triangular spike at a bottom outside corner | A zero-thickness, double-sided sheet of 3.2 mm² at each of the four bottom corners, in the plane where the bottom-edge sail meets the spherical pocket. Its apex sits on the original sharp edge, 1.6 mm proud of the rounded surface. | The spherical-corner mesh builder derives the junction rings and the sphere grid from the edge directions. That is only right on an orthogonal corner. On a drafted corner the junction polygon becomes a non-planar fan; the pocket and the sail prism are each valid, but Manifold's union does not merge the two coincident fans, and the subtraction leaves both as a sheet. | Build the rings and grid on the inward normals of the opposite faces. Prototyped and verified. |
| Dark dotted crevice down each inside vertical corner, notch at the rim | Full-height (33 mm) inverted slivers, 0.04 to 0.5 mm wide, standing in the cavity's vertical corners. With caps on, also a 1.85 mm lump of uncut material in each bottom inside corner. | `filletEdges` on a drafted body leaves vertex pairs 0.4 to 1.3 µm apart where a sail generator ends on another cutter's face crossing. The hollow solves each vertex of a pair separately against different normal sets, and the two land up to one wall thickness apart; the 10 nm needle between them becomes the sliver. | Weld vertices closer than 2 µm into one offset solve. Prototyped and verified. |

Both fixes together, on the real script: zero-area triangles 165 → 0,
needle triangles 4,059 → 763 (the rest are correctly oriented rim slivers,
see Residuals), inverted triangles at the inner corners 13 → 0, outer and
inner deviation from the ideal rounded corner 1,608 µm and 1,851 µm → 0 µm.

## How this was measured

Headless, through `src/workers/sandboxWorker.js` the way the goldens run.
Variants of the first three steps were built and audited for zero-area
triangles, needles (longest edge over 1.5 mm with altitude under 20 µm),
near-duplicate vertex pairs, sections at fixed heights, signed deviation from
the ideal rounded drafted box (inset hexahedron plus ball), and protrusion of
the hollowed solid outside the pre-hollow solid.

| Variant | Zero-area | Needles | Duplicate pairs (< 2 µm) | Outside ideal > 5 µm |
| --- | --- | --- | --- | --- |
| fillet with caps, no draft | 0 | 38 (top-face long triangles) | 0 | 0 |
| draft −1°, fillet with caps | 0 | 998 (all at the four bottom corners) | 24 | 167 per corner, max 1,608 µm |
| draft −1°, fillet without caps | 6 | 737 | 111 | expected cusps only |
| draft −1°, caps, hollow 1.85 | 165 | 4,059 | — | inner lump 1,851 µm |
| draft −3°, caps requested | 1 | 671 | 7 | cusps: caps not applied above 1.15° |

The sheet does not scale with the angle. It is present at −0.01° (82 faces
per side, 2.3 mm²) and at +1°, and disappears only above the 0.02 rad gate in
`_c6TrihedralCorners` where corners stop being capped. The standalone
rebuild of one corner (pocket plus three trimmed prisms, same code, real
Manifold) shows the mechanism directly: at 0° the union of pocket and prism
has no junction faces; at −1° it keeps 74 faces on each side, and its volume
is exactly the sum of the two inputs. All 98 ring and apex vertices are
bit-identical in both inputs.

## Defect 1: the cap junction sheet

Code: `src/lib/surfcad/runtime.js`, `_c6CornerSpherePoint`, `_c6CornerArc`,
`_c6CornerEdgePoint`, `_c6TrihedralCorners`, `_c6TrimmedEdgeCutter`,
`_c6CornerPocket`. Introduced by #843 (caps on drafted corners from the
face-distance incenter), which fixed the centre but kept the orthogonal
construction around it.

The sphere point is `O − r · normalize(u1·d1 + u2·d2 + u3·d3)` with `d` the
unit edge directions. On an orthogonal corner `d_k` equals the inward normal
of the face opposite edge k, so the ring of edge k, spanned by `d_i` and
`d_j`, lies in the plane through O perpendicular to `d_k`, its ends are the
sphere's tangent points on the two faces that meet along edge k, and the
apex Q (the foot of O on the edge) lies in the same plane. The prism's end
face and the pocket's far face are one planar polygon, and Manifold merges
them in the cutter union.

On a drafted corner `d_i · d_k` is about sin(1°). The ring plane tilts by the
draft angle, its ends sit 0.07 mm from the true tangent points and 0.6 µm
inside the faces, and Q is off the ring plane. The junction face is then a
fan of triangles with slightly different normals. Both solids are still built
from those same vertices, and both pass their volume checks, but the union
treats the two non-planar fans as touching rather than shared. The
difference keeps the double sheet, which is what renders as a spike: a
2.9 × 3.4 mm sheet whose apex is the uncut sharp edge.

Fix. Carry the opposite-face inward normals on the corner record,
`n = [m[1], m[2], m[0]]` in `_c6TrihedralCorners`, and use `c.n` instead of
`c.d` in `_c6CornerSpherePoint` and for the push directions in
`_c6CornerEdgePoint`. The two normals of the faces meeting along edge k are
both perpendicular to that edge, so the ring is the true tangency circle in
the plane perpendicular to the edge, its ends are the exact tangent points,
and the junction polygon is planar again. Orthogonal corners are unchanged
because `n` equals `d` there, and `_s23JunctionPockets` in the sweep kernel
is unaffected: it only runs on orthogonal corners and passes its own arcs.

Verified: junction faces 0 at −1°, +1° and −0.01° in the standalone test;
on the real part no vertex at any bottom corner deviates more than 5 µm from
the ideal rounded box (before: 167 vertices per corner, max 1.6 mm); needles
998 → 88, all remaining ones are the long top-face triangles that also exist
without draft. `draftedCornerIncenter.test.js`, `filletFacePush.test.js`,
`filletBoxCorners.test.js`, `filletSweepJunctions.test.js`,
`filletEdgeSets.test.js` and `draftFilletTangency.test.js` pass (16 tests).
Goldens `smoke_fillet_box_corners`, `smoke_fillet_three_corner_wrap`,
`smoke_draft_fillet_tangency` pass.

Follow-ups for the real PR:

- `_c6TrimmedEdgeCutter` and `_c6CornerPocket` use a 6% volume tolerance for
  drafted corners against the orthogonal formula. With planar rings the prism
  section is the exact kite minus sector, `r²·(1/tan(θ/2) − (π − θ)/2)`, so
  the tolerance can go back to 1% with that formula. The pocket can keep 6%.
- Add a golden: drafted box, caps, assert no face with normal along an edge
  within 0.1 mm of a junction station, and max deviation from the ideal
  rounded box under 5 µm. The sweep (0.01°, 1°, −1°) matters more than one
  angle.
- `docs/helper-functions.md` and `kernel-internals.md` describe the drafted
  cap as built "on the incenter". Say that the rings are built on the face
  normals.

## Defect 2: the hollow inflates micron vertex pairs

Code: `src/lib/surfcad/runtime.js`, `_c4OffsetCavity`.

`filletEdges` on a drafted box leaves near-duplicate vertices. Without caps:
111 pairs, 0.01 to 1.3 µm apart, almost all where the vertical sails meet
the bottom cusps. With caps: 24 pairs at the top rim before the cap fix, 37
after it (13 at the rim, 24 at the junction stations), 0.03 to 0.4 µm apart.
An undrafted box has none. The pairs are the two ends of one sail generator:
the cutters' face-lying sides cross the part faces at about 1.1° (the
0.02·r face push), and on a drafted body the crossings of two cutters that
meet at a corner no longer coincide, so Manifold emits both intersection
vertices. Each pair spans a triangle 33 mm long and about 10 nm wide.

`_c4OffsetCavity` clusters facet normals per vertex index and solves each
vertex on its own. The two vertices of a pair see different clusters: one has
the sail only, the other the sail plus a bottom-sail or junction facet. The
solves disagree by a fraction of the wall thickness, and `_c4RepairFlippedTriangles`
cannot help because this is not a diagonal choice. The needle becomes a
full-height inverted sliver in the cavity corner, which is the dotted crevice
in the screenshots. With the junction sheet from defect 1 also present, the
sheet's two faces are each offset inward, cross, and leave the 1.85 mm lump
at each bottom inside corner.

Fix. Before clustering, map every vertex to a representative within 2 µm
(`_c4WeldRepresentatives`, a cell hash over `md.V`). Clusters, the AABB-face
normals and the exact planes accumulate on the representative; after the
solve every member takes the representative's position. The needle collapses
to zero area and Manifold drops it in the rebuild. The threshold is absolute:
2 µm is below any real feature the tessellation produces (fillet chords are
30 µm and up) and above the pairs seen here. `_c4RequireNoFold` is unaffected
because a welded needle's new cross product is zero, not negative.

Verified on the real script: zero-area triangles 165 → 0; inverted
triangles crossing mid-height at the inner corner 13 → 0; sections at z = 0,
10 and −10 show the 2.15 mm inner arc with no sheet; bottom inside corners
within 5 µm of the ideal. Goldens `smoke_artur_playtest_shell_after_fillets`
(22 checks) and `smoke_multi_face_shell` pass.

## Residuals and related findings

- About 750 needle triangles remain in the final part, all at the cavity
  rim corners and the outside top rim corners, correctly oriented and within
  the surface. They come from the final `part − cavity` subtraction: the
  cavity's sail quads cross the open top plane, and each quad yields a
  generator crossing and a diagonal crossing about 1 µm apart. They are
  invisible but they are mesh noise for anything that walks the mesh later
  (face graph, wall-thickness probe, a second hollow). Options: a hygiene
  pass after `hollow` and `filletEdges` that welds within a micron and drops
  degenerate triangles, or `Manifold.setTolerance` if the bundled build's
  semantics collapse colinear triangles. Not prototyped.
- Fillet then draft (the opposite order from this script) has its own bug:
  `_c4DraftBlendFaces` keeps every blend facet out of the draft, which is
  right for a blend between the neutral plane and a wall but wrong for a
  blend whose axis runs along the pull. The vertical fillets stay where they
  were while both walls tilt, leaving a 0.33 mm ledge at mid-height and
  0.65 mm at the bottom on this box. Separate issue.
- The molding-tool symptoms were not analysed. Both the wall-thickness probe
  and the draft classifier read the mesh, so the needles and the sheets
  above are the first thing to re-check once the kernel fixes are in.

## Prototype

Branch `proto/drafted-corner-shell-fixes` from `main`, one commit touching
`src/lib/surfcad/runtime.js` (+79 −6). It is a prototype: no golden, no doc
update, volume tolerances untouched. The repro scripts are not in the repo;
they build the variants in the table above through the sandbox worker and
can be turned into the golden.
