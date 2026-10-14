# L1 slider defaults

Locked with Artur's answers. This file is the contract. PR A lands the characteristic length, the curve, and the snap, and does not change a slider's visible range. FEA files are inventoried and left alone. No PR edits `src/fea/**` or `src/components/fea/**`.

Scripts and the kernel stay millimetres. The global `surfcad.displayUnit` (`src/utils/displayUnit.js`) wins everywhere a length is shown, including sheet metal. The thumb snaps in that unit. The typed box does not snap. Confirm writes the typed number.

Empty part, and any part with no finite bounds: characteristic length **L = 100 mm**. A default written as `0.40 L` is 40 mm on an empty part, which is today's cube width.

## Decisions

1. **Fillet and chamfer do not use L.** The default is `0.10 ×` the length of the adjacent edge perpendicular to the picked edge, or the neighbor closest to perpendicular. The slider max is `0.20 ×` that length, also capped by `sweepBlendHardMax`. On the stock cube 40 × 30 × 20, a pick whose perpendicular neighbor is the 20 mm edge defaults to 2 mm. See the fillet section for which neighbor that is.
2. **The global inch/mm toggle wins everywhere, including sheet metal.** Sheet-metal values load in SCS native units (millimetres) and convert for display. Gauge numbers stay on screen for reference where the picker already shows them. PR D removes `surfcad.sheetMetal.displayUnit`. The sheet reads `surfcad.displayUnit`. A leftover sheet key does not override the global unit.
3. **Counts and segments stay linear.** Step 1. They do not use `shape`.
4. **Cylinder hole angle is ±90° at a 1° snap.** It is an angle, not a length.
5. **One L per part**, the longest side of that part's overall extents. Gaps between bodies in the same part are included. Per-body L is not a second number.
6. **Joint angle is ±90° at a 1° snap.** Joints have shipped (`#341`–`#348`, `#352`, `#360`–`#362`, `#365`). Stored types are coincident, concentric, distance, angle, symmetric, and fixed. Parallel and Perpendicular are one-tap buttons that write an angle joint at 0° or 90°. Symmetric stores no value. Distance and angle are typed fields. The feature-card PR adds the sliders. The angle slider is ±90° on the create card and on the strip chip that edits an angle joint. Coincident, concentric, symmetric, and fixed have no value slider.
7. **Typed values do not snap.** The thumb snaps. A typed 12.5 mm stays 12.5 mm. Shown in inches, that is 12.5 mm converted, not a forced 1/16.
8. **Move and pose measure `D_off` when the slider is pressed.** Orbiting while the thumb is down does not live-update the end.
9. **Quote infill stays 10…100 step 5**, default 20. It is a percent. It is not in these PRs.
10. **Clearance and tap diameters stay on the fastener table.** Free diameters scale. Tap-drill does not grow a second slider.
11. **An untouched thumb is re-seeded when L changes.** A touched thumb is kept, and the range grows to include it. That matches `radiusTouched` / `sizeTouched` on the fillet chip.
12. **Static helper `default` fields stay the L = 100 numbers** so an empty-buffer golden keeps today's script literal. The modal scales by `L/100` when the sheet opens.

## Characteristic length

### Where it is computed and cached

`characteristicLengthMm` in `src/utils/characteristicLength.js`.

On a cache miss, `featureGraphFor` (`src/utils/partSolidCache.js`) stores `characteristicLengthMm` on the geometry cache entry after `buildCoherentEdges` returns. A part switch that hits the cache reuses it. A mesh with no feature edges (a sphere) still gets a box, so L does not depend on the edge list.

The viewport also calls `rememberCharacteristicLength` next to `setModelBounds` in `executeScript`, keyed by the mesh object and by the part id. `shouldClearViewportScript` calls `forgetCharacteristicLength`. Readers then use 100 mm. The number is not persisted. Assembly save drops unknown fields, and a saved L would lie after the next edit.

### Formula

```
L = max(dx, dy, dz)     when that max is finite and > 0
L = 100                 otherwise
```

Longest side of the overall extents, in millimetres. Not the diagonal. Not volume^(1/3). Not the median edge.

### Candidates

| Shape | Box (mm) | Diagonal | volume^(1/3) | Median edge | L (longest side) |
| --- | --- | --- | --- | --- | --- |
| Reference / empty | — | — | — | — | 100 |
| Stock cube | 40 × 30 × 20 | 53.9 | 28.8 | 30 | 40 |
| 100 mm cube | 100 × 100 × 100 | 173.2 | 100 | 100 | 100 |
| Thin plate | 100 × 60 × 2 | 116.6 | 22.9 | 60 | 100 |
| Long rod | 10 × 10 × 400 | 400.2 | 34.2 | 10 | 400 |
| Sheet | 100 × 60 × 1.5 | 116.6 | 20.8 | 60 | 100 |

**Diagonal.** On a 100 mm cube it is 173.2, so it misses the reference the defaults were written against. Rejected.

**volume^(1/3).** A thin plate and a sheet collapse toward the thickness (~23 mm and ~21 mm). A 400 mm rod reads ~34 mm. Rejected.

**Median feature-edge length.** The plate's median is 60. The rod's median is 10. A sphere has no long sharp edges. Rejected as L. The fillet rule below uses one adjacent edge, not this median.

**Longest side.** A 100 mm cube is L = 100. A plate and a sheet take L from the planform. A rod takes L from its length. Disjoint bodies: the longest side includes the gap.

## Response curve

One function for every length slider. Angles, counts, segments, and unitless values stay linear.

The thumb is a unit fraction. HTML range is linear, so the input's `min` / `max` / `step` are a thumb index `0 … 1000` (`THUMB_COUNT`), not the millimetre ends. `lengthFromThumb` maps the index through `shape`. `thumbFromLength` places the thumb from a typed value and does not snap.

Signed lengths use `u ∈ [-1, 1]`, `value = sign(u) · R · shape(|u|)`. One-sided lengths use `s ∈ [0, 1]`, `value = min + (max − min) · shape(s)`.

```
function shape(s) {
  // s in [0, 1]
  if (s <= 0.5) return (2 / 3) * s;
  const t = (s - 0.5) / 0.5;
  return (1 / 3) + (1 / 3) * t + (1 / 3) * t * t;
}
```

| s | shape(s) | slope |
| --- | --- | --- |
| 0 | 0 | 2/3 |
| 0.5 | 1/3 | 2/3 on both sides |
| 2/3 | 13/27 ≈ 0.481 | rising |
| 1 | 1 | 2 |

Inverse: if `v ≤ 1/3`, `s = 1.5 v`. If `v > 1/3`, `t = (−1 + sqrt(12v − 3)) / 2`, `s = 0.5 + 0.5 t`.

Move calibration uses the 2/3 point. `D_off` is the world distance that carries the part's box just outside the current view along that axis. `offscreenRange` sets the value end so two-thirds of the thumb equals `D_off`:

```
R = D_off / shape(2/3) = D_off * 27/13
```

`D_off` is measured on slider press, not on every camera tick. Project the eight bbox corners with the current camera. Along the slider axis, `D_off` is the smallest translation that puts every corner outside NDC `[-1, 1]`. With no camera, `fallbackOffscreenDistance` is `1.5 L`.

## Snap

`lengthSnap` / `snapMm`, applied to the slider thumb only:

```
snapMm = displayUnit === 'in' ? (1/16) * 25.4 : 0.1
```

`25.4 / 16 = 1.5875`. The typed box is exact. If `max − min` is shorter than four snaps, `snapMmForSpan` divides the snap by 10 once.

Angle snaps are fixed. They do not scale with L.

| Angle slider | Range | Snap |
| --- | --- | --- |
| Draft | −45…45 | 0.5° |
| Plane angle, pose rotation, revolve, sheet bend | unchanged | 1° |
| Cylinder hole angle | −90…90 | 1° |
| Joint angle | −90…90 | 1° |
| Countersink angle | not a slider (82° constant) | |

## What was searched

Range inputs: `NumberField` in `popupUI.jsx`, `SmSlider` in `SmControls.jsx`, the position slider in `CrossSectionPanel.jsx`, the infill slider in `QuoteModal.jsx`.

`NumberField` is the shared slider. The range input and the typed box share `onChange`. Fallback when a caller omits an end: `min` 0 (or `2 × default` when default is negative), `max` 100, `step` 0.5.

Helper sheets do not draw their own thumbs. `HelperParamModal` paints a `NumberField` for every `type: 'number'` param. Omitted `max` becomes `max(100, 4·|default|, 40)`. `slider: true` on a param is ignored.

No numeric slider: Boolean, Delete Face, Paint, Center, Align, Mirror, Path, contour polyline, Sweep path, sheet export, cross-section normal (three number boxes), quote quantity (stepper), the FEA progress bar. Layout drags are not value sliders.

## Slider table

Proposed length numbers are millimetres at the current L. `snap` for a length means 0.1 mm or 1/16 in. `curve` is `shape` unless the row says linear. Kernel caps stay. Fillet and chamfer slider ends do not exceed `sweepBlendHardMax` (`selectEdge.js`). The preview has to keep matching the commit. Do not restate the kernel threshold. Import it.

### Contour card

Painted by `ContourModeChip.jsx`. Profile fields are hidden on Workplane. Extrude, revolve, and loft fields show only for that entry. Plane angles always show. Loft station offset already converts through `displayUnit`.

| Slider | Where | Current | Proposed | Curve, units, edge cases |
| --- | --- | --- | --- | --- |
| Circle radius | `numField` in `ContourModeChip.jsx`. Seed in `contourMode.js` | 0.1…80, default 5, step 0.5 | 0.1…0.80 L, default 0.05 L, length snap | shape, length. At L=100 this is 0.1…80, default 5. |
| Circle segments | same chip | 3…128, default 64, step 1 | unchanged | linear, count. |
| Rectangle width | same chip | 0.1…120, default 20, step 0.5 | 0.1…1.20 L, default 0.20 L, length snap | shape, length. |
| Rectangle height | same chip | 0.1…120, default 12, step 0.5 | 0.1…1.20 L, default 0.12 L, length snap | shape, length. |
| Polygon radius | same chip | 0.1…80, default 8, step 0.5 | 0.1…0.80 L, default 0.08 L, length snap | shape, length. Preset is a select. |
| Plane angle X, Y, Z | same chip | −180…180, default 0, step 1 | unchanged, snap 1° | linear, angle. |
| Workplane offset | same chip | −80…80, default 0, step 0.5 | −L…L, default 0, length snap | shape, signed length. Only for the workplane entry. |
| Revolve angle | same chip | 0.1…360, default 360, step 1 | unchanged, snap 1° | linear, angle. |
| Loft station offset | same chip | −80…80, default 0 on P1 and 20 on P2, step 0.5 | −L…L, default 0 and 0.20 L, length snap | shape, signed length. Per selected station. |
| Extrude distance | same chip | 0.1…80, default 10, step 0.5 | 0.1…L, default 0.10 L, length snap | shape, length. |

### Fillet and chamfer

L does not drive these. `Ladj` is the length of the adjacent edge perpendicular to the picked edge.

Among edges that share a vertex with the picked edge, are not that edge, and are not collinear with it (`|dot|` of the unit tangents under 0.999), choose the one whose direction is closest to 90° (`|dot|` closest to 0). If several are equally close, choose the shorter one.

On the stock cube every corner is 90°. The shorter neighbor wins:

| Picked edge | Neighbors | Ladj | Default 0.10 × | Max 0.20 × |
| --- | --- | --- | --- | --- |
| 40 mm | 30 and 20 | 20 | 2 mm | 4 mm |
| 30 mm | 40 and 20 | 20 | 2 mm | 4 mm |
| 20 mm | 40 and 30 | 30 | 3 mm | 6 mm |

The "stock cube → 2 mm" case is a pick of the 40 mm or 30 mm edge. A pick of the 20 mm height edge is 3 mm, because the shorter perpendicular neighbor is 30 mm.

A tangent chain uses one radius. `Ladj` is the shortest of those neighbor lengths across the picked edges, so the chain is limited by the tightest neighbor. Edge count does not otherwise scale the radius.

No adjacent edge: use `0.10 ×` the picked edge's `effectiveBlendEdgeLength`, then 2 mm if there is no edge length. The slider max is `min(0.20 ×` the same length, `sweepBlendHardMax(path))`. The default is clamped into `[slider min, slider max]`. The existing chip minimum stays 0.1 mm unless the max is smaller. A typed radius still applies to every part in a multi-part pick.

`scripts/golden/smoke_fillet_default_radius.mjs` currently pins a fixed 2 mm (thin parts clamp by `0.45 ×` the thinnest extent). The feature-card PR rewrites it to this neighbor rule. The "edge count does not grow the radius" check stays.

| Slider | Where | Current | Proposed | Curve, units, edge cases |
| --- | --- | --- | --- | --- |
| Fillet radius (mode card) | `FilletModeChip.jsx`. Max from `sweepBlendHardMax` passed by the viewport. Seed `defaultFilletRadius` in `filletMode.js` | min 0.1, max = kernel cap or 40. Default 2, or `0.45 ×` min extent when that is smaller | default and max from `Ladj` above. Length snap | shape, length. Not scaled by L. |
| Chamfer size (mode card) | same chip, `kind === 'chamfer'`. Seed `enterChamferState` | min 0.1, max grows with the current size. Default `defaultEdgeBlendSize` or 2 | same neighbor rule as fillet | shape, length. |
| Fillet radius (helper sheet) | palette param in `helperPaletteSnippets.js`, face and edge overrides in `faceFeaturePlacement.js` | palette default 3, overwritten to 2 when the edge sheet resolves sweep | one seed with the mode card | shape, length. |
| Chamfer size (helper sheet) | palette param and the face/edge overrides | default 2, modal max from the omitted-max formula unless `blendMax` is set | same as the mode card | shape, length. |
| Fillet radius (feature edit fallback) | `FeatureEditSheet.jsx` | 0.01…40, step 0.25, parse fallback 2 | same neighbor rule, including the kernel cap | shape, length. |

### Shell, draft, cut, move, move face

| Slider | Where | Current | Proposed | Curve, units, edge cases |
| --- | --- | --- | --- | --- |
| Shell wall (card and helper) | `ShellModeChip.jsx`, palette param | min 0.1, card max `max(20, current)`, step 0.25, default 2.5 | min 0.1, max `min(0.25 L, 0.45 × min extent)`, default 0.025 L, length snap | shape, length. L=100 on a thick part: max 25, default 2.5. A 2 mm plate caps the wall near 0.9 mm. |
| Draft angle (card and helper) | `DraftModeChip.jsx`, palette param | −45…45, default 2, step 0.5 | unchanged, snap 0.5° | linear, angle. |
| Cut offset | `CutModeChip.jsx` | ±`max(80, abs(offset))`, default 0, step 1 | ±R along the plane normal. `D_off` is the distance from the plane to just past the far side of the box. Default 0. Length snap | shape, signed length. |
| Move distance, X, Y, Z | `MoveModeChip.jsx`. Helper twins in the palette | −1000…1000, default 0, step 0.5 | ±R with `D_off` from the camera on that axis, default 0, length snap | shape, signed length. Card and helper share one range helper. |
| Move face distance (card and helper) | `MoveFaceModeChip.jsx`, palette param | card ±`max(20, abs(distance))`, default 2. Helper min falls back to 0, max 100 | ±`min(0.50 L, 0.45 × min adjacent extent)`, default 0.02 L, length snap | shape, signed length. The helper must go negative. Flip stays a bool. |

Boolean, Delete Face, and Paint: no slider.

### Feature edit fallback

| Slider | Where | Current | Proposed | Curve, units, edge cases |
| --- | --- | --- | --- | --- |
| Extrude distance | `FeatureEditSheet.jsx` | 0.1…120, step 0.5, fallback 10 | same as the contour extrude row | shape, length. |
| Revolve angle | `FeatureEditSheet.jsx` | 0.1…360, step 1, fallback 360 | unchanged, snap 1° | linear, angle. |

### Helper sheets

All number params render in `HelperParamModal`. Static `default` fields stay the L=100 numbers. The modal scales them by `L/100` when the sheet opens. Pose is `BLOCK_POSE_PARAMS` in `blockSolid.js`, spread onto cube, round box, cylinder, sphere, tube, and hex.

| Slider | Where | Current | Proposed | Curve, units, edge cases |
| --- | --- | --- | --- | --- |
| Pos X, Y, Z | `blockSolid.js` | −500…500, default 0, step 1 | ±R, `D_off` along that axis, default 0, length snap | shape, signed length. |
| Rot X, Y, Z | `blockSolid.js` | −360…360, default 0, step 1 | unchanged, snap 1° | linear, angle. |
| Cube width, depth, height | palette | defaults 40, 30, 20. Modal max `4 × default` | 0.1…2 L, defaults 0.40 L, 0.30 L, 0.20 L, length snap | shape, length. |
| Round box X, Y, Z | palette | defaults 50, 30, 20 | 0.1…2 L, defaults 0.50 L, 0.30 L, 0.20 L | shape, length. |
| Round box edge R | palette | default 4, min 0 | 0…`min(0.5·min(sx,sy,sz), 0.50 L)`, default 0.04 L | shape, length. |
| Round box segments | palette | min 1, default 16, modal max 100 | 1…64, default 16, step 1 | linear, count. |
| Cylinder height, radius | palette | defaults 20 and 10 | height 0.1…2 L default 0.20 L; radius 0.1…L default 0.10 L | shape, length. |
| Cylinder segments | palette | 3…256 default 64 | 3…128, default 64, step 1 | linear, count. |
| Sphere radius, segments | palette | radius default 15; segments 3…128 default 64 | radius 0.1…L default 0.15 L. Segments unchanged | shape for the radius, linear for the count. |
| Tube outer R, inner R, height | palette | defaults 15, 10, 40 | outer 0.1…L default 0.15 L; inner 0…outer−snap default 0.10 L; height 0.1…2 L default 0.40 L | shape, length. Inner stays under the live outer. |
| Tube segments | palette | 3…128 default 64 | unchanged | linear, count. Round section only. |
| Tube width, depth, wall, corner R | palette | width 40, depth 20, wall 2.5, corner 0 | width and depth 0.1…2 L; wall 0.1…`0.45·min(width, depth)` default 0.025 L; corner 0…half the shortest side, default 0 | shape, length. Rectangular section. |
| Hex radius, height | palette | defaults 12 and 8 | radius 0.1…L default 0.12 L; height 0.1…2 L default 0.08 L | shape, length. |

Center, Align, Mirror, Path: no number param.

### Hole sheet

`holeFeatureParamDefs` in `faceFeaturePlacement.js`. U and V are hidden while placement is center. Depth is hidden while Through is on. Pattern fields are hidden until n×m is on. Near/far end fields are hidden until that end is c-bore or c-sink. Cylindrical faces add angle and axial and drop planar U/V.

Do not scale clearance or tap-drill diameters.

| Slider | Where | Current | Proposed | Curve, units, edge cases |
| --- | --- | --- | --- | --- |
| Hole U, V | `holeFeatureParamDefs` | default 0, step 0.5, modal min 0, max 100 | face `u0…u1` and `v0…v1`, default 0, length snap | shape, signed length. The thumb has to go negative. Range is the face, not L. |
| Hole depth | same | min 0.1, default 12, modal max 100 | 0.1…remaining thickness, default `min(0.12 L, thickness)`, length snap | shape, length. Hidden when Through is on. |
| Pattern count U, V | same | defaults 3 and 2, modal max 100 | 1…32, step 1 | linear, count. |
| Spacing U, V | same | defaults 18 and 14, modal max 100 | 0.1…face span, defaults 0.18 L and 0.14 L, length snap | shape, length. Clamp the default to the face. |
| Near/far c-bore and c-sink Ø | same | default 6.5, modal max 100 | min = thru diameter, max = `0.50·min(face span, L)`, default `max(thru, 0.065 L)`, length snap | shape, length. |
| Near/far c-bore depth, c-sink depth | same | defaults 3.5 and 2 | 0.1…hole depth, defaults 0.035 L and 0.02 L, length snap | shape, length. |
| Cylinder angle | cylindrical face params | default 0, step 1, modal min 0, max 100 | −90…90, snap 1°, default from the pick | linear, angle. |
| Cylinder axial | same | default 0, modal min 0, max 100 | the cylinder's axial span, default from the pick, length snap | shape, signed length. |
| Grid diameter | hidden hole-grid id | default 4, modal max 100 | 0.1…`0.50·min(face span, L)`, default 0.04 L, length snap | shape, length. The unified hole uses the fastener size select. |
| C-bore thru / Ø / depth | hidden id | thru 5.5, Ø 10, depth 4 | thru 0.055 L, Ø 0.10 L, depth 0.04 L, same caps as the unified end fields | shape, length. |
| C-sink thru / Ø / depth | hidden id | thru 3.4, Ø 6.5, depth 2 | thru 0.034 L, Ø 0.065 L, depth 0.02 L | shape, length. |
| Clearance / tap U, V, depth | hidden ids | U/V modal min 0. Depth 12 | same as Hole U, V, depth | shape, length. Diameters stay on the fastener select. |

### Array

| Slider | Where | Current | Proposed | Curve, units, edge cases |
| --- | --- | --- | --- | --- |
| Count X, Y, Z | palette array params | defaults 2, 2, 1, modal max 100 | 1…32, step 1 | linear, count. |
| Spacing X, Y, Z | same | defaults 45, 35, 0, modal min 0 | −5 L…5 L, defaults 0.45 L, 0.35 L, 0, length snap | shape, signed length. The thumb has to go negative. |
| Polar count | same | default 4, modal max 100 | 1…64, step 1 | linear, count. |
| Bolt circle R | same | default 20 | 0…2 L, default 0.20 L, length snap | shape, length. |
| Bore R, bore height | empty-part polar only | defaults 3 and 10 | bore R 0.1…bolt circle default 0.03 L; height 0.1…2 L default 0.10 L | shape, length. |

### One-shot contour fallbacks

Scale these the same way as the contour card so a golden and the card do not diverge. Profile radius, width, height, and segments; fallback extrude height; fallback revolve segments (3…128, default 64, linear); fallback loft offset (one-sided, otherwise the station row).

### Sheet metal

Painted by `SmMmSlider` / `SmSlider` from `SheetMetalFlow.jsx`. Stored millimetres. SKU floors and ceilings stay hard clamps (`bendLimits`, `defaultBaseDims`, DFM). L scales the seed and the soft end, then the SKU clamp wins.

PR D deletes the sheet-local unit key. Display conversion uses `displayUnit.js`. Gauge labels stay.

| Slider | Where | Current | Proposed | Curve, units, edge cases |
| --- | --- | --- | --- | --- |
| Base X | `SheetMetalFlow.jsx`. Defaults in `sheetMetalMode.js` | min 1 mm, max `max(300, current)`, step 1. Default 100, raised to the SKU minimum flat. Hard cap 1200 is a caption, not the thumb | min = SKU min flat (else 1), max = 1200, default = `max(L, SKU min)`, length snap | shape, length. At L=100 an empty sheet stays 100 unless the SKU is larger. Thickness is the SKU, not a slider. |
| Base Y | same | default 60 | min as X, max 1200, default `max(0.60 L, SKU min)`, length snap | shape, length. |
| Bend angle | same. Limits from `bendLimits` | SKU min…max, step 1. Default `min(90, max)` | same ends, snap 1° | linear, angle. Do not scale degrees by L. |
| Bend flange length | same | SKU min flange … max(side of the parent), step 0.5. Default about 1/4 of the side it leaves | same SKU ends, default stays `0.25 ×` that side, length snap | shape, length. |
| Tab width | same | 1…edge span, default `min(25, 0.4×span)` | 1…span, default `min(0.25 L, 0.4×span)`, length snap | shape, length. At L=100 the 25 mm cap and `0.25 L` match. |
| Tab depth | same | 0.5…`max(50, current)`, default 10 | 0.5…`max(0.50 L, current)`, default 0.10 L, length snap | shape, length. |
| Tab offset | same | 0…span−width. Shown when Centered is off | same ends, length snap, default stays centered | shape, length. |
| Hole diameter | same | SKU min … `max(40, current)`. Default `max(5, 2×min hole)` | min stays the SKU floor, max `max(0.40 L, current, min)`, default `max(0.05 L, 2×SKU min)`, length snap | shape, length. Hidden for tapped (thread select). |
| Countersink Ø | same | hole Ø … `max(3×hole, current)`. Default `2×` hole. 82° is fixed | same, length snap. Default stays `2×` the hole | shape, length. |
| Hole position U, V | `holeRange` | panel span, step 0.5, default the tapped point | same ends, length snap | shape, length. |

Tapped hole: no diameter slider. Thread is a select. Tap-drill diameter comes from `TAP_SIZES`.

### Cross-section, quote, analyze

| Slider | Where | Current | Proposed | Curve, units, edge cases |
| --- | --- | --- | --- | --- |
| Section position | `CrossSectionPanel.jsx` | before bounds: −100…100. After bounds: the bbox projected on the plane normal, default the center, step 0.5 | the stored end is `center ± (halfExtent / shape(2/3))`, so the outer third of the thumb continues past the box. Default stays the center. Length snap | shape, signed length. Rotation stays three number boxes. |
| Quote infill | `QuoteModal.jsx` | 10…100, default 20, step 5 | unchanged | linear, percent. Out of these PRs. |
| Analyze force, pressure, E, ν, yield | `FeaStudyControls.jsx`, `FeaMaterialPicker.jsx` | today's ranges | no change | linear. Do not edit FEA. |

### Joints

Shipped through `#365`. Stored types: coincident, concentric, distance, angle, symmetric, fixed (`src/joints/jointUi.js`, `JointCard.jsx`). Symmetric stores two faces on each part and no value. Parallel and Perpendicular are buttons, not stored types: each writes an angle joint at 0° or 90° in one tap (`quickAngleCard`). The strip chip edits that angle later.

The card is `StickyPickApply` (`data-joint-card`), opened from Joints (Lucide `Blocks`, `data-joints-button`) at the end of Move. Add writes the joint and leaves the card open. Distance is a typed input (`data-joint-value`) converted with `displayToMm` / `lengthCaption`. Angle is a typed input (`data-joint-angle`) stored in the same `valueMm` field as degrees. The strip popup (`data-joint-chip-angle` in `FeatureStrip.jsx`) edits that same degree value. Do not run the angle through `displayToMm`. Flip toggles `sense` ±1. The file stores `value` in millimetres for distance and in degrees for angle (`docs/joints-judgments.md`).

The feature-card PR adds two sliders and no others:

| Slider | Where | Current | Proposed | Curve, units, edge cases |
| --- | --- | --- | --- | --- |
| Joint distance | `JointCard.jsx` `data-joint-value` | typed number, no range | ±R, `D_off` from the two parts and the view, default 0, length snap | shape, signed length. With no camera, L of the pair is `max(L_a, L_b)`. |
| Joint angle | `JointCard.jsx` `data-joint-angle` and the strip chip `data-joint-chip-angle` | typed number, no range | −90…90, default 0, snap 1° | linear, angle. Stored as degrees in `value`. Parallel (0°) and Perpendicular (90°) use this same slider when the chip edits them. |

Coincident, concentric, symmetric, and fixed: no value slider.

## Implementation split

Each PR starts from latest `origin/main` after the previous one has merged. Sequential.

| PR | What | Leaves alone |
| --- | --- | --- |
| A. Length, curve, snap | `characteristicLength.js`, `sliderMap.js`, the `featureGraphFor` cache field, the viewport map. This plan. `docs/architecture.md` and `docs/UI_MAP.md` describe the cache and the curve. Tests: empty, 100 mm cube, plate, rod, sheet, a mesh with no feature edges, a disjoint gap in the longest side, the curve, the snap. | Every slider still shows today's numbers. |
| B. Feature cards | `NumberField` takes an optional map (thumb index → curved mm). Contour, fillet, chamfer, shell, draft, cut, move, move face, the feature-edit fallbacks, and the joint distance and angle sliders. Fillet and chamfer use the adjacent-edge rule. Rewrite `smoke_fillet_default_radius.mjs`. | FEA `NumberField`s stay linear. Fillet kernel files stay imported, not edited. |
| C. Helper sheets | Scale seeds in the modal from the static L=100 defaults. Fix min-0 on U/V, axial, cylinder angle (±90°), spacing, and move-face distance. Segment and count ends in the table. | Fastener selects. Empty-buffer goldens keep today's literals. |
| D. Sheet metal and section | Global snap on `SmMmSlider`. Base thumb reaches 1200. SKU clamps stay. Cross-section uses `shape` past the box. Remove `surfcad.sheetMetal.displayUnit`. Gauge numbers stay. | Tapped-hole table. Quote infill. FEA. |
