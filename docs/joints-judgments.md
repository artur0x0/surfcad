# Joints — judgment calls

Artur asked for the recommended default on every open question, with no separate review. Each item below is that default. It is locked for the implementation. The pull request column is where the behavior lands.

The word is joints. Part scripts stay untouched. The file stays version 1.

| # | Call | Where |
| --- | --- | --- |
| 1 | File version stays 1. `joints` and `placement` are optional keys. Unknown keys are still rejected. | PR 1 |
| 2 | Omit `placement` when the quaternion is identity and no joint names the part. Always keep `position` equal to the translation. A pre-joints file stays byte-identical. `position` is written when `t` is not `[0, 0, 0]`, and also when a legacy row already stored `[0, 0, 0]`. `placement` is written when `q` is not identity, or when a joint names the part, including a grounded part at the origin. On load, a row with `position` and no `placement` is identity in memory (`partPlacement`). It is not rewritten until another edit saves. | PR 1 |
| 3 | The part key on a joint is the surf id only. Confirm is refused when the part has no surf id. A path is not stored on the joint. | PR 1 stores the surf id. PR 4 refuses confirm. |
| 4 | `fixed` is one reference: the part. No geometry key, no `value`, no `b`. The grounded pose is the row's placement at confirm. | PR 1 schema. PR 2 keeps that pose. PR 4 creates it. |
| 5 | Distance is two planar faces, forced parallel, with a signed gap in millimetres. The sign is `sense` (`1` or `-1`). Coincident is the opposed zero-gap joint. It is not distance 0. | PR 1 schema. PR 2 equations. PR 4 field. |
| 6 | Angle is degrees in the file and on the card. | PR 1 schema. PR 4 card. |
| 7 | Move Body has no special case. A move past the paint tolerance breaks the joint and keeps the last placement. The script is the only thing Move writes. | PR 4 |
| 8 | A conflict names the newest single joint whose removal makes the rest succeed. If none does, it names the newest, with "conflicts with more than one joint". Placements roll back to the last success. The write is all or nothing. The message is `Joint "<name>" conflicts`. | PR 2 names the joint and rolls back. PR 4 shows the message. |
| 9 | There is no hidden ground. The solver damps toward the current placement (the trust region starts at the current pose). | PR 2 |
| 10 | An ambiguous match is `broken`, the same as a missing reference, with a different sentence. The resolver does not pick the nearest. | PR 3 |
| 11 | Strip Undo uses the assembly history while `cadPartId` is null, and the part script history otherwise. Redo is session-only. Reload does not restore joint undo. The undo title distinguishes (`Undo joint` vs `Undo`). | PR 4 |
| 12 | The desktop and mobile CAD strips show joints. The script-stage strip stays on part features. | PR 4 |
| 13 | An empty click clears `cadPartId` and the geometric selection. It leaves `activeId`. | PR 4 |
| 14 | `fixed` is created from the type picker after one tap, or from a Ground control. The two-face flow never suggests it. | PR 4 |
| 15 | A joint still needs two parts, except `fixed`. The file rejects a same-part pair with `A joint needs two parts`. A second face on a part already picked is kept and grouped with that part. | PR 1 rejects a same-part pair. Later picks group by part. |
| 16 | A hidden part is still solved when its last success resolves. A failed run breaks the joint. The solver does not use a leftover mesh. | PR 3 |
| 17 | The rigid body is the part, not a body inside the part. | PR 2 and PR 3 |
| 18 | The joints solver is `solveResiduals`. It stays separate from the contour solver. SolveSpace is not used. The core does not import `src/joints/`. The contour solver is not an adapter of this core. | PR 2 owns the core. The contour solver stays its own. |
| 19 | Joints owe FEA a current `matrixWorld` and nothing else. They do not write `contacts`. Bonded contact keeps discovering pairs. If a study needs the `.surf.json` `placement` field without a live mesh, that change belongs to the FEA owner. `feaPartFrame` already copies `matrixWorld`. | PR 3 writes the pose onto the meshes. No FEA files change. |
| 20 | A cross-part Boolean whose either pose is rotated refuses the confirm and writes nothing. `externalBody` stays translational. | PR 3 |
| 21 | A failed part run marks every joint that names that part `broken`. The solver does not run against the leftover mesh. | PR 3 |
| 22 | Re-resolution keeps the confirmed key. The matcher absorbs the tolerance. The new centroid is not stored back into the joint. | PR 3 |
| 23 | Deleting a part drops every joint that names it. A broken joint is not left behind. | PR 1, in `serializeAssembly` |
| 24 | Copy to this assembly does not copy joints onto the new surf id. Same as colors. The dangling prune drops a joint whose surf id left. | PR 1 |
| 25 | Joint names are `Coincident 1` via `nextNumberedName`. The card can rename. The id stays the surf id from `mintSurfId`. | PR 4 mints and names. PR 1 stores the id and the name. |
| 26 | The pick-and-apply flow is shared with contour: sticky-pick 1–2 faces, lines, or points, then a suggested property, then apply. `StickyPickApply` merged in #349. The joints create card is that component. The parallel card (`JointModeChip`) is removed. The viewport and the card share the rich pick list; `useStickyPick` is not the source of truth, because that hook keeps only id, kind, and label. | PR 4 shipped the parallel card. The follow-up adopts `StickyPickApply`. |
| 27 | The page does not scroll. `html`, `body`, and `#root` stay `overflow: hidden` after the card closes and the inline sheet lock drops. A descendant that sticks out of the shells does not grow `scrollHeight`. `window.scrollY` stays 0. The left rail scrolls its tool list and still receives taps. A drag at the end of that list does not chain to the page. | Page-scroll follow-up. |
| 28 | While the joint card is open the camera slides like every other feature card. A second face pick keeps the first face highlighted until Add or X. Two cylindrical faces or circular edges suggest concentric. Two planar faces suggest coincident. Parallel planar faces more than 5 mm apart suggest distance. The type buttons override the suggestion. The apply button says Add. Add writes the joint, shows it on the strip, clears the picks, and leaves the card open. X exits. There is no floating joint tag. The empty joints caption is the same height as a chip. Contour tags stay. | Playtest follow-up. |
| 29 | Parallel and Perpendicular sit in the same type-button group as Coincident, Concentric, Distance, Angle, Symmetric, and Fixed. They are not stored types. Each writes an angle joint at 0° or 90° in one tap. There is no angle field on that path. Parallel's sense follows the current normals. Reopening the chip shows that angle on the card. | This follow-up. |
| 30 | Symmetric stores four planar faces, two on each part (`a`, `a2`, `b`, `b2`). The center plane between one pair is made coincident with the center plane between the other. It stores no value. | This follow-up. |
| 31 | Picks group by part in any order (`P1 P1 P2 P2`, `P1 P2 P1 P2`, and the rest). Two planar faces on each of two parts suggest symmetric. One reference on each part keeps the concentric, coincident, and distance rules. | This follow-up. |
| 32 | A pick on a third part opens a popup titled `Change one of the parts?` with Discard last pick, Replace part 1, and Replace part 2. The new pick is not kept until one of those is chosen. | This follow-up. |
| 33 | With no part selected, a joint chip tap reopens that joint in the card. The card shows the stored picks highlighted, the type, and the value, plus Delete and X. This covers every type, including symmetric and an angle written by Parallel or Perpendicular. | #362 returned null for `mode === 'edit'` and only toggled a chip popup, so the card never opened. |
| 34 | A joint opened from a strip chip uses the feature-sheet edit row. Delete is the red danger button opposite Confirm. There is no Add button. Confirm saves that joint and closes. X closes and writes nothing. Create mode still says Add and stays open. | Edit-row follow-up. |
| 35 | A sheet-metal face resolves with the pick's face graph. Face ids restart on each flange box and bend zone. The catalog keeps the Manifold run id, so a reused id does not glue a bend onto a flange. Face and axis references use that graph for every joint type. `fixed` names the part only. A miss still says `Face not found on <part>`. | Sheet-metal face follow-up. |
| 36 | A plane is a joint reference: the origin planes XY, YZ, and ZX, a script workplane, or a sketch plane with a literal frame. It is picked like a face. The key is a stable id (`origin:xy`, `workplane:<name>`, `contour:<id>`), a point, and a unit normal. Resolution is that id. A missing plane is `Plane not found on <part>`, and the joint is broken. The solve reads the plane's current frame and leaves the stored key. Coincident, distance, angle, parallel, perpendicular, and symmetric accept a plane. A plane suggests coincident, or parallel when the references are already parallel and more than 5 mm apart. While the Joints card is open, plane overlays turn on and revert when it closes, unless the user toggled them during that time. | Plane reference follow-up. |

Distance on the card uses the global display unit (`src/utils/displayUnit.js`). The file and the script stay millimetres. That field is PR 4.

The joint card leaves `fullLeft` off. It sits between the rails, like Measure.
