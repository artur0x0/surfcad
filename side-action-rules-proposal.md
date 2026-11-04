# Side actions: redesign

Status 2026-11-04: built on this branch and pinned by
`npm run golden:mold-side-action-block` (`scripts/golden/smoke_mold_side_action_block.mjs`,
fixture `scripts/golden/fixtures/flanged_box_side_action.txt`). Measured on
the vault part, pull +Z:

| Fixture | Result |
| --- | --- |
| Flanged_Box as modelled | 1 slide along +Y, window x ±20, z −1.2 to 19.3, span −3.2 to 19.3, face ≈1,367 mm² (plate, both bosses, the wall shadow, the flange underside above the bosses); 1 unresolved undercut (the slot); no lifter |
| Flanged_Box with a straight slot | exactly 1 slide along +Y, window x ±20, z −7 to 19.3, the slot inside it |
| two Ø5 holes 40 mm apart on one wall | 1 slide through both |

The slot is unresolved as modelled because `roundedBox([24, 6, 14], 3)` is
a stadium in plan: its ends are quarter-cylinders about the Z axis, so the
slot narrows by about a millimetre toward the outer face of the wall. That
is a real lip; no straight pull frees it. Cutting the slot with a straight
`cube([24, 6, 14])` gives the one slide the sketch shows. The model should
change; the tool is right to refuse to invent a direction.

Goal: on Flanged_Box, one slide along +Y whose face is the block Artur drew
(the plate, its bosses, the slot, the wall the plate shadows up to the
flange, and the flange underside above the bosses), without rules written
for this part. Measured 2026-11-04 on the prototype branch, pull +Z, with an
offline prototype of the rules below run on the real mesh
(`slide_block_proto.mjs`, repro scratch).

## What a side action is, physically

The two main halves move along ±pull. A face that looks toward one half but
has part material in the way along that direction is trapped: no main half
can form it. A side action is one block of steel that forms a set of
trapped faces and withdraws along one lateral direction before the halves
open. The block has a cross-section in the plane perpendicular to its
direction, and within that cross-section it forms every part surface it can
reach along its direction, trapped or not: the plate's flat face is not
trapped, but the block that forms the wall above the plate and the slot
cannot avoid forming the plate too. That block face is what a toolmaker
calls the side action, and it is what the sketch shows.

So the tool should answer three questions in order: which faces are
trapped, which single direction frees a set of them, and what block face
that direction implies. Today it answers the first per modelling triangle,
the second per region with no memory, and never asks the third.

## What the tool does today on this part

| Group | Area | Direction | Extent | What it is |
| --- | --- | --- | --- | --- |
| slide 0 | 826 mm² | +Y | x ±46, z 0 to 19 | back wall above the plate, painted full width |
| slide 1 | 286 mm² | +X | x ±46, z 18.8 | flange underside shadowed by the bosses |
| slide 2 | 193 mm² | +Y | x ±20 | the two boss cylinders |
| slide 3 | 26 mm² | +X | x ±20, z 8 | plate top face, trapped under the flange |
| lifter 4, 5 | 76 mm² each | (0, −0.94, −0.35) | x ±12 | slot rounded corners, upper and lower halves |

(The 0.4 mm² lifter from the first screenshot was a fold artifact on the inner
shell; those are excluded since commit 1ff86475.)

Mechanisms, each verified:

1. **Per-triangle classification.** The back wall is three triangles; the
   centroid of a full-width one is in the plate's shadow, so the whole
   triangle is trapped out to x ±46. Sampling the same wall on a 1 mm grid
   and testing each sample gives the true trapped footprint: x ±20,
   z 8 to 18.8, the plate's shadow exactly.
2. **First clear direction wins, per region.** The flange underside and the
   plate top have no in-plane normal, so a ring of twelve samples is tried
   from a fixed start and +X clears first. Neighbouring regions are not
   consulted.
3. **Groups split on the sign of the face normal against the pull**, which
   cuts the slot in two.
4. **Clearance rays block on grazing hits.** A +Y ray from a slot corner runs
   parallel to the slot walls, touches the next corner facet, and reads as
   blocked. The fallback tilts 20° toward the core and produces a direction
   that points through the wall into the cavity.
5. **Slide versus lifter** is a heuristic: slide if some in-plane direction
   clears; lifter if only a direction tilted 20° toward the core clears, or
   the least-blocked tilted direction when nothing clears (`clear: false`).

## The rules

### R1. Classify at analysis resolution

Before the occlusion test, split any triangle whose longest edge exceeds the
occlusion raster cell (about 3 mm on this part) into sub-triangles, and
classify those. Regions then follow shadows, not the modelling tessellation.
Keep a map from sub-triangle to source triangle for painting (see R6).

Evidence: the sampled wall footprint above is x ±20 instead of x ±46.

### R2. Trapped faces, as today, minus artifacts

Visibility along the pull on the face's own side, with the artifact
exclusion already in place (needles under 5 µm, folds within 5° of 180°).

### R3. One direction per set, by cover

Candidate directions: the in-plane part of each trapped region's normal, the
normals of the planar stamped faces the regions touch (the wall gives +Y),
and the four in-plane axes. For each candidate, count the trapped area it
frees when every region moves together (R4 clearance). Take the best,
assign those regions, remove them, repeat until nothing is left. Ties go to
the direction normal to the largest touched planar face, then to an axis.

On this part every trapped region clears along +Y, so one direction.

### R4. Clearance means entering material

A sample ray along the candidate direction is blocked only when it enters a
triangle facing against it (normal · direction below −sin 3°), and the
triangle is not in the set being moved. Faces parallel to the motion and
faces of the same feature never block. Rays start a skin off the surface and
must leave the part's bounding box.

On this part the slot walls clear along +Y under this test; the slot's
rounded ends do not (see Status above), which is correct.

### R4b. A feature is one problem

Trapped regions whose source triangles share a vertex form one feature. If
any region of a feature is unresolved (R7), no steel can form that feature as
modelled, and a lifter on one of its facets would be a fiction. The whole
feature is reported as one unresolved undercut. Without this the stadium
slot came out as one slide for its straight walls plus two lifters for its
rounded ends.

### R5. One block per direction and connected surface

A slide is a moving part; every one adds complexity and cost to the mould,
so a toolmaker combines every feature that can share one pull direction and
is connected into one slide, whatever the distance between the features.
The rule follows that. Take all faces reachable along the direction (R4
test from the surface), and their connected components over mesh adjacency.
Trapped regions assigned to the direction that lie in the same component
belong to one block. Features on one wall are always connected through the
wall; a feature on the back wall and one behind a rib that a +Y ray cannot
leave are not. Gap size plays no part: two Ø5 holes 60 mm apart on one wall
are one slide, and the block face between them is the wall it forms.

Evidence on this part: the wall shadow, the plate top, the flange underside
strip, both bosses and the slot all sit on the back wall's reachable
component along +Y, so one block, window x ±20, z −7 to 19.

### R6. The block face

Within a block's window, the candidate surface is every analysis cell that
is reachable along the block's direction (R4 test from the surface) and
whose centroid projects into the window. The face is the flood from the
block's trapped source triangles over adjacent candidate sources: the block
can only form surface it touches, and a face that is reachable only through
an opening (the far inside wall of the shell, seen through the slot) is not
adjacent to the trapped faces inside the window and stays out. A stamped
face that the flood reaches and that is at least 80% inside the window is
taken whole, provided it is smaller than the window, so the plate's flat
face and the boss cylinders come in complete and the flange band and the
rest of the flange underside do not. An unresolved undercut has no block;
its face is its trapped cells. Paint that face set; report its
area and its span along the pull; list the stamped features it carries
(`cube2`, `cylinder1`, `cylinder2`, `roundedBox3`) and the faces it frees
(`cube1.back` shadow, `roundedBox1.bottom` strip).

Evidence: the reachability fill inside the merged window picks up the wall
shadow, the flange underside strip, the plate faces, both bosses, and the
slot walls, about 2,000 mm² in total, and nothing of the open wall. With the
80% rule the flange band (50% inside) stays out.

Painting at analysis resolution needs the side-action skin to draw the
sub-triangles from R1 as its own overlay geometry rather than colouring whole
part triangles; the core/cavity colours stay per part triangle.

### R7. Lifters

Only when R3 finds no in-plane direction for a set. Try directions tilted
15° to 25° toward the core; accept one only if its samples leave the
bounding box without entering material. If none does, report the set as an
unresolved undercut, not a lifter, and apply R4b so the feature it belongs
to is unresolved as a whole. Never invent a direction into the part. The
unresolved group still carries the least-blocked direction so the pane can
show where it would have gone.

### R8. Lifters and slides do not merge; same-direction blocks are separate actions

Each block is one action with one direction. The count that goes to the
tooling estimate is the number of blocks, unresolved undercuts included: an
undercut with no straight withdraw direction costs at least a slide.

Without a mesh (unit tests feed synthetic regions) R4 cannot run, so a
region clears a direction when the direction lies within 10° of its own
in-plane normal, and every region shares one connected surface.

## Test matrix

| Fixture | Expected |
| --- | --- |
| Flanged_Box (vault, stadium slot) | one slide, +Y, window x ±20, span to the flange underside, no lifter; the slot is one unresolved undercut (pinned) |
| Flanged_Box with a straight slot | exactly one slide, +Y, window x ±20, z −7 to 19 (pinned) |
| box with one horizontal through-hole | one slide along the hole axis, face = the bore (unit test `occludedWall`) |
| box with two Ø5 side holes 40 mm apart on one wall | one slide, face spanning both and the wall between (pinned) |
| box with a +Y feature on the back wall and a +Y-facing trapped face behind an internal rib | two slides (not yet pinned) |
| snap hook (existing fixture) | one lifter, direction leaving the part |
| shelf plus tilted wall (existing fixture) | one action if both clear the same direction on one connected surface, else two; pin what the geometry says |
| Shell_Fillet_Test (existing fixture) | no side actions |
| drafted box with a fold and a needle (existing test) | no undercuts |

## Where the code is

- `pullDirection.js`: R1 is `refineTriangles` (barycentric grid, at most 24
  splits per edge, each cell keeps its `source` triangle); R2 is
  `undercutsAlong` over the refined cells, `clusterRefinedRegions` groups
  them; `finishMoldQuery` recomputes the regions refined.
- `sideActions.js`: `blockingField` is R4; the cover loop in
  `groupSideActions` is R3; R4b is the feature union-find; R5 is
  `reachableComponents`; R6 is the window plus flood; R7 is the tilt list
  `LIFTER_TILTS_DEG`; R8 is the output with `window`, `span`, `features`,
  `frees`, `trappedArea`, `face`.
- `partingSkin.js`: `sideOverlays` draws each block face from `group.face`
  as its own overlay mesh; core and cavity stay per part triangle.
- `moldReport.js`, `dfmReport.js`: `count` is blocks; `unresolvedCount` is
  reported.
- Agent output `mold_parting.sideActions.groups[]` carries `kind`
  (`slide`, `lifter`, `unresolved`), `pull`, `area`, `trappedArea`, `span`,
  `features`, `frees`.
- Cost on Flanged_Box in headless Chrome: core/cavity on went from about
  9 s to about 11 s; the refinement and the block faces are the difference.
