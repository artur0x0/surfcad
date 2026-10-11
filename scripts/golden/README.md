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
| `smoke_slice28_loft.mjs` | Slice 28 Loft multi-profile: same workplane + offsets, live preview, Confirm compose (makeCrossSection × N + makeLoft + placeInFrame replace), update-in-place, Back/no-orphan, Extrude/Revolve/Fillet unchanged |
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
| `smoke_sketch_face_camera.mjs` | Sketch-on-face at 390px: Start drawing aims along the picked face normal and frames the face, the highlight is off, and Back undoes one polyline point while X still exits |
| `smoke_contour_entry.mjs` | Contour entry at 390px and 1280px: the plane card slides the part up and is titled Contour, Start drawing aims normal to the plane and closes the card with the rail still up, Back undoes one point then reopens the plane card, and Confirm finishes |
| `smoke_joints_blocks.mjs` | Joints button: Lucide Blocks is the last Move-rail button at 390px and 1280px, it opens the StickyPickApply joint card, a tap with nothing selected selects the part, and the strip stays on assembly joints while nothing is selected |
| `smoke_contour_dimension_drive.mjs` | Dimension values drive the polyline: a point distance keeps the first point and moves the second, length angle offset and radius re-solve live, and a 390px page shows the portaled tag |
| `smoke_contour_reopen.mjs` | Reopen restores a named `solveContour` and an old point list, loft stations stay separate, an unchanged Confirm is byte-identical, a dimension name is not a script binding |
| `smoke_named_contour.mjs` | A contour is `const c1 = makeCrossSection(frame, profile); // @contour id=c1`. The id survives a byte shift, a second Confirm appends c2, rename updates references, and Confirm at 390 and 1280 writes that statement |
