# Slice 01 golden cases (in-repo)

Authoritative geometry regression lives in **cadgen-workspace** (`npm run verify`).
These files are the in-repo puzzle vocabulary smoke + copy-paste scripts for
review while the private harness may be unavailable.

| File | What it proves |
|---|---|
| `smoke_slice01.mjs` | Fastener diameter tables + clearance/tap/cbore/csk/fillet/chamfer loud-fail via `manifold-3d` (npm) |
| `puzzle_clearance_plate.js` | Copy-paste SurfCAD script: plate + M3 clearance + M4 cbore + chamfer |
| `puzzle_fillet_box.js` | Copy-paste SurfCAD script: filleted box (convexEdges) |

Run smoke (no cadgen-workspace required):

```bash
node scripts/golden/smoke_slice01.mjs
```

Note: npm `manifold-3d` ≠ bundled `built/manifold.wasm`. Gate acceptance still
requires `test_real_worker.mjs` via `npm run verify` once the harness is present.

| `smoke_slice21_cross_section.mjs` | Slice 21 cross-section substrate: plane from planar face, profiles, preview, compose |
| `smoke_slice23_fillet_via_sweep.mjs` | Slice 23 sweep fillet: wedge contours, palette Strategy=sweep, closed-rim + post-fillet geometry via worker |
| `smoke_slice24_contour_mode.mjs` | Slice 24 contour-mode shell: plane refuse, Profile-in-mode compose (no Extrude), update-in-place, #30 fillet sweep default |
| `smoke_slice25_extrude.mjs` | Slice 25 Extrude solid: live preview params, Confirm compose (makeExtrude + placeInFrame replace), update-in-place, Back/no-orphan, #30 fillet sweep default |
| `smoke_slice26_revolve.mjs` | Slice 26 Revolve solid: identity (u,v)→(radial,height) remap (centered circle → sphere; washer → torus), live preview params, Confirm compose (makeRevolve + placeInFrame replace), update-in-place, Back/no-orphan, Extrude/Profile/Loft unchanged, #30 fillet sweep default |
| `smoke_slice28_loft.mjs` | Slice 28 Loft: named contours, station offset along the contour normal, block id, rewrite versus append, Extrude and Revolve leave the loft, #30 fillet sweep default |
| `smoke_hotfix_frame_only_plane_undo_autorun.mjs` | Hotfix: empty Confirm is frame-only (no host cube / no part.add); existing part unions; Undo/Redo Auto-Run via setTextOnly + handleGameRun |
| `smoke_hotfix_contour_picker_additive.mjs` | Hotfix: saved contours list + ghosts, auto-pick last, Profile/Workplane in Advanced, additive Confirm keeps cube volume |
| `smoke_polish_adv_ux.mjs` | Polish: loft circle↔rect sharp corners + view-aligned default, Confirm exits contour mode, Sweep path selector inside the popup, Workplane is a plane (no host cube), blank/plane-only script clears the viewport |
| `smoke_slice27_fillet_mode.mjs` | Slice 27 Fillet-in-mode: enter without edges, live blend preview as edges accumulate, Accept compose (makeSweepPath + filletAlongPath) + replace-in-place, Back/no-commit, disjoint edges → independent fillets (2+ components), #27–#30 sweep stack |
| `smoke_fillet_followup.mjs` | Fillet follow-up: loft overlay stays bounded, blend strips are not candidates, sequential sharp-edge Accept appends, blend-only Accept fails loud |
| `smoke_fillet_easy_hard.mjs` | Slice B: box / extrude edges easy (no warn reason); circle↔square loft generator hard with a stable reason; Accept stays allowed; huge radius and long chains warn |
| `smoke_fillet_box_corners.mjs` | Four vertical corners of a plain box: picker Accept and a script fillet both run, and fail if `no boundary between faces` would toast |
| `smoke_edge_contour_identity.mjs` | Edge and contour graphs: same chains, edge counts, and contour counts on Artur's mesh and on the pre-#154 dense mesh |
| `smoke_fillet_kernel_spike_c.mjs` | Slice C/C2: hard kernel recommendation + production flag; hard Accept emits filletEdges+relaxPlanar; pick-mode restore + selector gap |
| `smoke_fillet_c2_rolling_ball.mjs` | Slice C2/C3: hard loft Accept path + scrap guard; C3 supersedes rolling-ball with variableProfile; known-scrap relaxPlanar loud-fails /sliver scraps/ |
| `smoke_fillet_c3_variable_sweep.mjs` | Slice C3: tangency field G1 vs zig-zag; loft Tangent-on human-scale; hard Accept → variableProfile sweep; R≈1.6 no zero-area banner delta; easy cube clean |
| `smoke_fillet_c3_1_along_path_tangency.mjs` | Slice C3.1: along-path frame transport; gut transport → staircase RED; hard loft WASM transport meta + C3 volume pin |
| `smoke_fillet_c3_2_tighter_continuity.mjs` | Slice C3.2: single-run variableProfile cutter + denser/curvature densify + tighter damp; loft-like θ-run staircase pin; hard loft WASM runCount=1 |
| `smoke_fillet_c3_3_varying_profile.mjs` | Slice C3.3: per-knot varying cross-section for hard variableProfile; **distribution net** — removed volume per quarter must follow the dihedral ramp (total-only guards cannot tell a median-θ gouge from a correct blend) |
| `smoke_fillet_c4_signed_concave.mjs` | Slice C4: signed local convexity (no per-edge CSG ball probe), per-knot sign, concave = material-ADD filler; mixed-sign chain splits into cutter + filler runs; zero face-group normal fallback |
| `smoke_cad_palette_overlays.mjs` | CAD Model section promotes Profile/Workplane/Extrude/Revolve/Sweep/Loft (game Advanced rail unchanged); Plane/Contour toggles default off and gate overlay paint and picking |
| `smoke_overlay_visibility.mjs` | Plane/sketch overlays default off; Extrude forces both on (toggles show ON); X, Esc, and Paint restore; an already-on choice stays; a tap off during the tool stays off |
| `smoke_cad_mobile_chrome.mjs` | CAD phone shell matches puzzle: viewport top, Monaco bottom budget, keyboard pin, mid-strip actions, vertical right rail |

| `smoke_fillet_chamfer_rounded_wrap.mjs` | Fillet-on-fillet rounded-rect wrap + path chamfer quality |
| `smoke_block_pose_preview.mjs` | Block pop: position and rotation on all six solids, preview mesh matches the script, identity pose is omitted, Subtract preview is the cutter and does not replace the cached solid; Add and Subtract paint with the previewStyle cyan skin + crease outline (Loft's look), never the CAD normal material |
| `smoke_cross_part_clone.mjs` | Edit-touch C: cross-part Boolean (union / difference / intersect with piece delete) and Subtract Block copies via `externalBody`, frozen and posed into the target frame; yellow external chip; copy deleted with the feature; one undo step per written part |
| `smoke_part_script_restore.mjs` | New part keeps its own script across IDB/draft restore: draft bound to part id; stale other-part draft cannot clobber active row; App epoch bump + immediate draft rebind on New/Select |
| `smoke_fillet_three_corner_wrap.mjs` | Three-fillet corner wrap (r=3.73 variable-profile chain through three r=2 fillets): true ~90° per-knot θ, one genus-0 body, volume window, no nested shell inside, every picked edge rounded, flat walls solid |
| `smoke_multi_part_easy_fillet.mjs` | Multi-part easy fillet: each part of a multi-part Fillet Accept matches its solo Fillet (untouched seed 2 mm, a 4 mm plate clamps to 1.8, radius + class from its own solid unless typed; volume, area, tris, genus), both active directions, plate + rim, typed radius |
| `smoke_part_overlays_stick.mjs` | Contours and work planes stick to their part: per-part sources (editor = live buffer, hidden skipped), per-part anchors (pick mesh / own solid / row), A's plane + contour stay on A across a switch and follow A's move; editor-only picks |
| `smoke_feature_failed_chip.mjs` | Failed feature → red strip chip border: worker `scriptLine` of the failing call, mapped to that marked block only; no frame / outside a block marks nothing; edit clears; red-400 wins over yellow; successful tones unchanged |
| `smoke_feature_failed_chip_safari.mjs` | Failed chip without a V8 stack frame (WebKit-shaped stack): worker tracks the open marked block (`featureId`), maps to exactly the failing chip; no mark for syntax / bad return / outside blocks; V8 line path still works; renders FeatureStrip (both layouts) + FeatureSheet (identity, picker) red via react-dom/server; WebKit `feature-failed-ring` CSS |
| `smoke_failed_part_outline.mjs` | Failing part in the viewer: red-400 outline + tint + glow rim on its last good solid, no raycast, rebuilt / disposed with geometry; same failed ids as the Parts feed; App → viewport wiring |
| `smoke_fillet_default_radius.mjs` | Fillet default radius from the adjacent edge (stock cube long edge stays 2 mm as edges accumulate; a 2 mm sheet seeds 0.2 mm), typed radius shared; seed / Accept wiring |
| `smoke_feature_sliders.mjs` | Feature-card length sliders are shaped thumbs; joint angle is ±90° at 1°. 390 and 1280 |
| `smoke_part_rename_target.mjs` | Two-part rename: title rename lands on the part the title shows (viewer pick, not activeId), feed row renames its own id, stale/blank/unknown no-ops; App / title chip / feed row wiring |
| `smoke_empty_part_pill.mjs` | No part selected: the title is the assembly name only. The part-name pill is not drawn (desktop and 390). Selecting the part shows it; an empty canvas click hides it again |
| `smoke_multi_part_block_drop.mjs` | Two parts, B picked, editor on A: Block Confirm writes B only (script, strip, volume), Undo/Redo on B's stack, A untouched; `featureWriteTarget` rules; stale sheet offsets refused (`liveSheetFeature`); `focusWritePart` wiring on every writer, Undo/Redo, sheets, palette open, session start, commit `partId`s |
| `smoke_fillet_chamfer_multi_rotation.mjs` | FilletKiller chain that turns 360° through four R=2 arcs (fixtures `artur_playtest_chamfer_multi_rotation.txt`, `artur_playtest_fillet_three_corner_wrap.txt`): chamfer r=2 has no lip/step on the y=−10 top leg (ball probes, −x and vertical-leg controls); fillet r=3.73 has θ 88°..92°, no inverted top facets, volume window; sliver-safe ray / planar normal / tight-arc split wiring |
| `smoke_merge_bodies_toggle.mjs` | Merge bodies toggle: on by default on every Block and Shape (hidden in Subtract); off writes `part.add(x, { merge: false })` (compose). FilletKiller + overlapping Block: off → 2 bodies, Boolean union → 1, on → 1; viewer body split, face/edge graphs, Pieces; per-body subtract/add/hollow/draft/Move Face/Delete Face, fillet/chamfer/cut/move/cross-part clone on the 2-body part; strip separate-body marker from live bodyCount (clears after Boolean union) |
| `smoke_assembly_open_spinner.mjs` | Assembly open spinner: delayed vault open shows a centered `Opening <name>…` / `part 3 of 7` spinner then clears; failure and the safety timeout clear it and show the Retry toast; a fast open does not flash; reduced motion stops the ring |
| `smoke_contour_solve.mjs` | Constrained contour solver: full rectangle, under-defined is not a conflict, repeated horizontal warning, parallel+perpendicular names both, 128 point cap, close at the third point, circle tessellation, two- and three-segment corner arc, name stays inside the call, angle branch |
| `smoke_contour_dimension.mjs` | Dimension and Arc: suggestion table, inch at the field, name stays a string, Confirm writes the profile and keeps an extrude distance, arc corner, loft station isolation, sticky pick, rail order, number input with no slider |
| `smoke_contour_constraints.mjs` | Constraints: suggestion bands at 15° and 20°, all eight kinds, equal of a line and an arc is refused, tangent stores side, icons, Confirm stays |
| `smoke_contour_status.mjs` | Status colours, conflict note, repeated word, nullspace drag, script write on pointer-up only, saved ghost colour |
| `smoke_sketch_status_colours.mjs` | Touch at 390 and 1280: an unconstrained rectangle is blue and draggable, a fully dimensioned one is black and not, a half-constrained one is mixed |
| `smoke_sketch_face_camera.mjs` | Sketch-on-face at 390px: Select plane aims along the picked face normal and frames the face, the highlight is off, and Back undoes one polyline point while X still exits |
| `smoke_contour_tap_offset.mjs` | Touch taps at 390 and 1280 place a polyline point within 2px of the finger, at the corners and the center, with the plane card open and closed, and with the part posed. The plane card draws no circle, and a tap where that rim sat still selects the face |
| `smoke_contour_normal.mjs` | Contour drag and Normal to sketch at 390 and 1280: dragging a point leaves the camera quaternion unchanged, an empty-space drag still orbits, and Normal to sketch aims along the plane and zoom-fits |
| `smoke_contour_keep_edit.mjs` | Touch taps at 390 and 1280: the plane card says Select plane, circle rectangle and polygon handles edit their sizes, a dimensioned polyline stays draggable after a tool change, a fixed point does not move, and a distance on the negative side of an edge displays positive while typing positive keeps that side |
| `smoke_contour_strip.mjs` | Touch taps at 390 and 1280: the plane card draws no circle, after Select plane the pressed tool is Cursor and the strip reads No sketch entities, choosing Circle adds that chip and Cursor keeps it, an empty polyline reads No sketch entities, a dimension or constraint chip opens its edit card, a canvas tap selects the same line, a two-pick dimension clears the chip, double-tap removal leaves a broken constraint chip, a geometry chip deletes at once or confirms Delete along with N as one sketch undo, Undo follows sketch history, and Redo stays disabled |
| `smoke_contour_legend.mjs` | At 390 and 1280 the status legend is centred on the part-in-assembly pill within 1px, the pill is hidden in contour mode and returns on exit, and the perpendicular sketch chip uses Lucide `angle` |
| `smoke_contour_entry.mjs` | Contour entry at 390px and 1280px: the plane card slides the part up and is titled Contour, Select plane aims normal to the plane and closes the card with the rail still up, Back undoes one point then reopens the plane card, and Confirm finishes |
| `smoke_joints_blocks.mjs` | Joints button: Lucide Blocks is the last Move-rail button at 390px and 1280px, it opens the StickyPickApply joint card, a tap with nothing selected selects the part, and the strip stays on assembly joints while nothing is selected |
| `smoke_contour_dimension_drive.mjs` | Dimension values drive the polyline: a point distance keeps the first point and moves the second, length angle offset and radius re-solve live, and a 390px page shows the portaled tag |
| `smoke_contour_distance_drag.mjs` | Touch at 390 and 1280: a distance on two points leaves both blue, dragging one moves the other, and the distance holds |
| `smoke_contour_reopen.mjs` | Reopen restores a named `solveContour` and an old point list, loft stations stay separate, an unchanged Confirm is byte-identical, a dimension name is not a script binding |
| `smoke_named_contour.mjs` | A contour is `const c1 = makeCrossSection(frame, profile); // @contour id=c1`. The id survives a byte shift, a second Confirm appends c2, rename updates references, and Confirm at 390 and 1280 writes that statement |
| `smoke_sheet_contour_delete.mjs` | Unused contour inside a Sheet Metallica-like sheet block, with edge refs: Delete at 390 and 1280 shows no refuse toast, an Undo toast, and Undo restores the contour and the sheet block |
| `smoke_sheet_contour_refs.mjs` | Sheet Metallica: touch taps at 390 and 1280 dimension a point to a flange edge and constrain a line parallel to it. Lengthening that flange rewrites the reference instead of breaking it. |
| `smoke_sheet_extrude.mjs` | Extrude on a sheet part whose study follows `return part`, and on a regular cube: Confirm at 390 and 1280 writes the block before that return, outside the sheet span, and the volume and triangle count both increase |
| `smoke_loft_by_reference.mjs` | Loft Confirm names contours and writes `makeLoft` by those names inside `id=loft1`. A second Confirm appends `loft2`. The id survives a prepended comment. Confirm at 390 and 1280 writes that block |
| `smoke_contour_plane_dim.mjs` | Plane preview and dimension placement at 390 and 1280. Workplane quads show on the plane card and hide after Select plane. A chip move under 6px opens edit. Dragging a length chip and an angle chip stores `placement` on the dimension, and reopen keeps both with the preview still hidden |
| `smoke_feature_slot_open.mjs` | Extrude, Revolve, Loft, and Sweep open the slot card from the shape rail and from a strip chip. Touch taps at 390 and 1280. Confirm, Pick a contour as plain text, saved contours plus New contour. Picking one highlights only that button. No Select plane, plane fields, or No contour row |
| `smoke_slot_preview.mjs` | Touch at 390 and 1280: after the rail checkmark returns a new contour to Extrude, the extrude preview mesh is in the scene, and a one-finger drag on the canvas rotates the camera while that card is open |
| `smoke_contour_cursor.mjs` | Cursor, polyline, and arc icons, point drag, and double-tap point removal at 390 and 1280. Cursor does not add a point. A drag on a line does not move that line. A point drag moves one point. A second tap removes one dot, and the next removal under three points deletes the shape as one undo |
| `smoke_polyline_entity.mjs` | Touch at 390 and mouse at 1280: Select plane leaves Cursor pressed on an empty sketch with no circle chip, a polyline stays one strip chip across Cursor and Dimension, a segment tap inserts a point, a fast double-tap removes one, a point drag moves only that point, a cursor line drag does not, and the polyline chip Delete clears the chain |
