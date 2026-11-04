# Side actions: what the tool does on Flanged_Box, and rules to generalize

Measured 2026-11-04 on the prototype branch, pull +Z, headless through
`moldFitFromGeometry`. The phone showed 4 slides and 1 lifter; headless shows
4 slides and 3 lifters on the same part (the extra two are the slot corners,
which fall either side of a tie). Same mechanisms.

## What the part needs

One side action in +Y: the 0.8 mm plate on the back wall, its two bosses,
the rectangular slot through plate and wall, the wall surface the plate
shadows up to the flange, and the flange underside above the bosses. All of
it releases along +Y as one slide.

## What the tool produced

| Group | Area | Direction | Extent | What it is |
| --- | --- | --- | --- | --- |
| slide 0 | 826 mm² | +Y | x ±46, z 0 to 19 | back wall above the plate, plus flange band and hole faces |
| slide 1 | 286 mm² | +X | x ±46, z 18.8 | flange underside shadowed by the bosses |
| slide 2 | 193 mm² | +Y | x ±20 | the two boss cylinders |
| slide 3 | 26 mm² | +X | x ±20, z 8 | plate top face, trapped under the flange |
| lifter 4, 5 | 76 mm² each | (0, −0.94, −0.35) | x ±12 | slot rounded corners, upper and lower halves |
| lifter 6 | 0.4 mm² | (−0.94, 0, −0.34) | x 35.4 | a micron needle on the inner shell rim |

## Why, mechanism by mechanism

1. **Undercuts are classified per modelling triangle.** The back wall is three
   triangles. The occlusion raster samples each triangle at its centroid;
   the centroid of a full-width wall triangle lies inside the plate's shadow,
   so the whole triangle is flagged and painted, out to x ±46 although only
   |x| ≤ 20 is shadowed. Probing points on the wall outside the plate's width
   finds nothing below them. The region outline is the modelling tessellation,
   not the shadow. That is the "expands outward past the flat".
2. **Each region picks the first escape that clears, in a fixed order.** The
   in-plane part of the region's own normal is tried first, then a ring of
   twelve samples. The flange underside and the plate top have no in-plane
   normal, so the ring is tried from an arbitrary start and +X clears first.
   Directions are chosen per region with no knowledge of the neighbours, so
   one feature gets two directions and therefore two slides.
3. **Groups are split by the sign of the face normal against the pull.** The
   slot's rounded corners straddle that sign and become two groups.
4. **The clearance ray is too strict.** A ray from a slot corner along +Y runs
   parallel to the slot walls and grazes the neighbouring corner facets, so
   +Y is "blocked" and the fallback tilts 20° into the core. The resulting
   direction points through the wall into the cavity, which no steel can do.
5. **No noise floor.** A 0.4 mm² needle becomes a lifter.
6. **Slide versus lifter is a heuristic**: slide when some in-plane direction
   clears; lifter when only a direction tilted 20° toward the core clears, or
   when nothing clears and the least-blocked tilted direction is reported with
   `clear: false`. Nothing checks that a lifter direction leaves the part.

## Proposed rules

1. **Analysis resolution, not modelling resolution.** Before the undercut
   raster, split any triangle whose longest edge exceeds the raster cell (about
   3 mm here) on faces larger than a few cells. Regions then follow shadows.
   Cost: a few thousand extra triangles on a part like this.
2. **One direction per feature set, by set cover.** Collect candidate
   directions: the in-plane normals of the regions, the normals of the planar
   stamped faces the regions touch (the wall gives +Y), and the two in-plane
   axes. Score each by the undercut area it clears when all those regions move
   together; take the best, assign, remove, repeat. Ties go to the direction
   normal to the largest touched wall, then to an axis. The plate, bosses,
   slot, shadowed wall and flange underside all clear along +Y and become one
   slide.
3. **Clearance means entering material.** A hit counts only when the ray
   enters a triangle facing against it, is not grazing (|n · dir| above a few
   degrees), and the triangle is not part of the same feature set. Faces
   parallel to the motion never block.
4. **Group by direction and connectivity, never by normal sign.** Regions that
   share the direction and touch, or sit within one cell of each other in the
   projection along that direction, are one action.
5. **Artifacts are never candidates.** Not a size floor: a triangle whose
   normal cannot be trusted is excluded before the undercut test. Two kinds.
   A needle under 5 µm across has no measurable normal (float32 positions on
   a part this size are good to a few µm). A fold meets a larger
   edge-neighbour within 5° of 180°, a zero-thickness fin wound into the
   surface it lies on; no real part has one and no steel can touch it. The
   0.4 mm² "lifter" on this part is one of each: a 22 µm strip wound into the
   inside wall at a fillet tangency plus a 2 µm needle beside it. Both are
   still painted and still count as cover for what lies under them.
   Implemented as `markArtifacts` in `pullDirection.js`.
6. **A lifter must leave the part.** Only accept a tilted direction whose
   samples exit the bounding box without entering material; otherwise report
   the undercut as unresolved rather than invent a lifter.
7. **Report the feature set.** Each action lists the stamped faces it carries
   (`cube2`, `cylinder1`, `cylinder2`, `roundedBox3`), the locked faces it
   frees (wall shadow, flange underside), its span along the pull, and one
   direction. That is what a quote needs, and it reads as one line per side
   action.

Rules 2, 4 and 5 are small edits to `groupSideActions` and
`escapeForRegion`. Rule 1 touches `prepareTriangles` in `pullDirection.js`.
Rule 3 is in `sampleExits`. Each needs a golden: this part should come out as
exactly one slide along +Y spanning z from the plate to the flange underside,
with no lifter.
