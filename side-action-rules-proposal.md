# Side actions: redesign

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

On this part the slot clears along +Y under this test; today it does not.

### R5. One block per connected window

Project the trapped regions assigned to a direction onto the plane
perpendicular to it and take each region's rectangle. Two rectangles belong
to one block when the gap between them is no larger than the smaller
rectangle's size (its larger side). Repeat transitively. A block reaches
across a gap no wider than the feature beside it; it does not reach across a
wall.

Evidence on this part, all along +Y, rectangles in (x, z): wall and plate top
and flange strip x ±20, z 4 to 19; each boss x 13 to 20, z −1.3 to 3.5; slot
bottom x ±12, z −7 to −4. The boss to slot-bottom gap is 2.9 mm against a
boss size of 7; the boss to top-window gap is 0.5 mm. All four merge into one
window, x ±20, z −7 to 19. A fixed 2% of the part's diagonal (2.5 mm) was
also tried and missed the 2.9 mm gap; the relative rule is the right one.
Two Ø5 holes 60 mm apart stay two blocks; two Ø5 holes 8 mm apart become
one, which is how a toolmaker would build them.

### R6. The block face

Within a block's window, the side action's face is every part surface that
is reachable along the block's direction (R4 test from the surface) and
whose centroid projects into the window. A stamped face that is at least 80%
inside is taken whole, provided it is smaller than the window, so the plate's
flat face and the boss cylinders come in complete and the flange band and
the rest of the flange underside do not. Paint that face set; report its
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
unresolved undercut, not a lifter. Never invent a direction into the part.

### R8. Lifters and slides do not merge; same-direction blocks are separate actions

Each block is one action with one direction. The count that goes to the
tooling estimate is the number of blocks.

## Test matrix

| Fixture | Expected |
| --- | --- |
| Flanged_Box (vault) | one slide, +Y, window x ±20, z −7 to 18.75, span to the flange underside, no lifter |
| box with one horizontal through-hole | one slide along the hole axis, face = the bore |
| box with two Ø5 side holes 60 mm apart | two slides, same direction |
| box with two Ø5 side holes 8 mm apart | one slide |
| snap hook (existing fixture) | one lifter, direction leaving the part |
| shelf plus tilted wall (existing fixture) | two actions as today, or one if R5 merges them; pin whichever the geometry says |
| Shell_Fillet_Test (existing fixture) | no side actions |
| drafted box with a fold and a needle (existing test) | no undercuts |

## Where the code changes

- `pullDirection.js`: R1 subdivision in `prepareTriangles` (keep a
  `source` index per sub-triangle); R2 is `undercutsAlong` as now.
- `sideActions.js`: R3 replaces `escapeForRegion`'s first-clear loop with the
  cover loop; R4 changes `sampleExits`; R5 and R6 replace the union-find in
  `groupSideActions`; R7 replaces the tilted fallback; R8 is the output.
- `sideActionSkin.js` / `partingSkin.js`: paint the block face from the
  sub-triangle list.
- `moldReport.js`, `dfmReport.js`: the count is blocks; the report lists the
  features per block.
- Agent output `mold_parting.sideActions.groups[]`: add `window`, `span`,
  `features`, `frees`; keep `kind`, `pull`, `area`.
- Goldens for the matrix above; the vault part as the headline golden.
