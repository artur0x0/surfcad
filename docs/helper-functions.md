# Manifold Sandbox Helper Functions

The Manifold Sandbox provides several helper functions in addition to the core Manifold API. These functions are available in all user scripts and simplify common CAD operations.

## Official puzzle vocabulary (Slice 01)

Match-the-part puzzles are expected to stay inside this allowlist. Prefer these
names over hand-rolled cylinders for fastener features so scripts stay
comparable and train-able.

| Helper | Role |
|---|---|
| `filletEdges(part, edges, r, opts?)` | Circular fillet on convex edges (C6) |
| `chamferEdges(part, edges, c)` | Equal-leg chamfer (C4) |
| `hole` / `holeSpan` / `holePattern` | Generic through-holes |
| `clearanceHole(part, frame, u, v, size, span?, fit?)` | Clearance hole by fastener size |
| `tapDrillHole(part, frame, u, v, size, span?)` | Tap-drill hole by fastener size |
| `cboreHole` / `cskHole` | Counterbore / countersink |
| `convexEdges` / `facesByNormal` / `workplaneFromFace` / `planarFaceAt` / `edgesByOrientation` / `placeInFrame` / `transformByFrame` | Selection / frame |
| `shell`, `hollow`, `cut`, `move`, `rotateAbout`, `moveFace`, `deleteFace`, `addDraft`, `draftFaces`, `tube`, `rectTube`, `hexPrism`, `roundedBox`, `mirror`, `array3D`, `polarArray`, `center`, `align` | Solids / layout |
| `loft`, `makeLoft`, `offsetPlaneFrame`, `sweep`, `sweepPoints`, `makeExtrude`, `makeRevolve` | Profiles / paths |
| `profileCircle` / `profileRectangle` / `profilePolygon` / `makeCrossSection` | Cross-section substrate (Slice 21) |
| `makeSweepPath(edges, opts?)` | Ordered sweep path / wire from edges (Slice 22) |
| `filletAlongPath(part, path, r, opts?)` | Dihedral fillet/chamfer swept along a path → subtract |
| `edge(part, id)` / `edgesBetween(part, faceA, faceB)` / `boundaryEdges(part)` | Fillet-mode face/edge ids (re-pick if the mesh changes) |
| `faceNames(part)` / `facesNamed(part, name)` / `edgesOf(part, name)` / `surfaceOf(face)` | Face identity: names the helpers stamped at construction (`cube1.top`, `boss.side`, `extrude2.wall[3]`), stable across edits and rebuilds; `edgesOf` is the convex edges around one named face |
| `edgesNamed(part, ...names)` | The one stable edge reference: the segments between two named faces (`plate.top~boss.side`, `[k]` for one chain of a pair, `*` glob), for `makeSweepPath` / `filletAlongPath`. Fillet and chamfer surfaces are named too (`<block>.round`, `<block>.bevel`), uploads `import@1.f<k>`, freehand runs `<block>.f<k>` |

**Loud failure rule:** feature helpers throw named `Error`s on bad inputs,
degenerate cutters, non-manifold / empty results, or (for `filletEdges`) when
*every* requested edge is skipped. Silent “success” with an unchanged solid is
not allowed for puzzle vocabulary ops.

**Supported / unsupported (honest):**
- **Supported:** straight convex edges; closed circular rims via `filletEdges`
  closed-run detection; **sweep fillet** via `filletAlongPath` for compound /
  curved-adjacent chains (post-fillet seams, circular rims as Path); metric +
  common UNC clearance/tap sizes below.
- **Unsupported (planar `filletEdges`):** curved-face singleton fillets; open
  (partial-arc) curved runs under C6; concave edges (it throws, pass
  `convexEdges()` output). **Strategy=sweep** / `filletAlongPath` is
  the default Fillet path, and it **does** blend concave edges (C4): a concave
  run adds material as a filler, and a chain may mix convex and concave runs.
  A concave filler stops flush at an open end that meets air (a corner a
  previous fillet rounded) and is clipped to the face the edge ends on
  otherwise. Still unsupported: variable-radius
  / rolling-ball industrial fillets; arbitrary non-table fastener sizes.

Lookup helpers (also injected): `fastenerClearanceDia(size, fit?)`,
`fastenerTapDrillDia(size)`, `fastenerMajorDia(size)`, `listFastenerSizes()`,
`resolveFastenerSize(size)`.


## Face-select feature placement (Slice 11)

In **game mode**, tapping a face in the viewport then a face-aware palette
feature (Hole, Clearance, Cbore, Csk, Hole grid, Fillet, Chamfer) opens a
param sheet seeded from that face. Generated code resolves the face with
`facesByNormal(body, normal, tolDeg?)` + closest-center pick, then
`workplaneFromFace` — never an illegal bare `top` identifier.

**Face classification** (from Viewport `selectedFace`):

| Type | How detected | Param sheet |
|---|---|---|
| Planar | single-click `coplanar` (or small angular walk) | u/v, dia/depth/through, optional n×m pattern |
| Cylindrical | double-click `angular-tolerance` with ≥8 tris | angle°, axial height, dia/depth/through |
| Irregular | triple-click `all-connected` | **refused** with a clear message (v1 — no best-fit) |

Fillet/Chamfer with a face filters `convexEdges(body)` to edges whose `n0`/`n1`
aligns with the face normal (`edgeScope: face`); fallback `allConvex` uses
all convex edges.

Without a selected face, palette v2 behavior is unchanged (default +Z
`topFace` workplane / body selector).

**Sweep path (Slice 22):** palette **Path** builds an ordered wire from
Edge selection (open chain or closed loop). Consume with **Fillet → Strategy=sweep**
(`filletAlongPath`) or `sweepPoints`.

**Sweep fillet (Slice 23+):** same **Fillet** control — **Strategy=sweep** is the
universal default (and **auto** resolves to sweep). **planar** is an explicit
manual override for classic `filletEdges` (planar–planar / closed-run C6).
**sweep** builds `makeSweepPath` + `filletAlongPath` (dihedral fillet or
equal-leg chamfer swept along the edge wire, boolean subtract). Fillet-mode
**Accept** emits `edge(part, id)` / `edgesBetween(part, faceA, faceB)` when
the viewport has boundary ids (`eN` / `fN` labels).
Disconnected / branched selections loud-fail (path stays visible) — never a
wrong solid.

**Fillet mode (Slice 27):** tapping **Fillet** enters edge-pick mode with no
prior selection required (no soft-fail / no pre-select). The chip is Tangent
(default-on) / Clear / **Undo** / **Accept**. **Undo** drops the last edge
pick only (not the CAD script Undo). There is no hard-edge warning. Live
sweep-blend preview updates as edges accumulate. While Fillet mode is open
the viewport labels each merged face `fN` and each boundary edge `eN`.
**Accept** writes `makeSweepPath` + `filletAlongPath` in a marked block, with
`edgesBetween` / `edge` instead of a `va`/`vb` dump when those ids are
present, and Auto-Runs; second Accept replaces that same block. **X** exits
with no commit. Strategy default stays **sweep**.

**Cross-section (Slice 21):** `makeCrossSection(plane, profile)` is the reusable
plane + 2D profile substrate (planar face via `workplaneFromFace`, or default
+Z). Cylindrical / irregular faces are refused. Does **not** extrude, sweep,
or fillet — substrate only.

**Contour mode (Slice 24/25/26/28):** in game mode, tapping **Extrude**, **Revolve**,
**Loft**, or **Profile** enters a shared contour shell — the part stays on
screen but is ghosted, the left rail swaps to circle / rect / polygon /
polyline + **Back**, and a chip (Edge-pick pattern) holds plane + profile params.
Live preview uses `makeCrossSection`. **Profile** and **Workplane** live on the
**Advanced** rail with Extrude / Revolve / Sweep / Loft. Saved
`makeCrossSection` contours show in the contour-pick menu and as viewport
wires; entering Extrude / Revolve / Sweep / Loft auto-picks the latest one.
**Profile** Confirm writes or updates the in-mode Profile only. **Extrude** /
**Revolve** / **Loft** / **Sweep** Confirm commit the profile plus a solid via
`placeInFrame`. When `part` already exists, Confirm unions
(`part = part.add(placeInFrame(...))`) so prior geometry stays. New parts
start empty (no seed cube). An empty script still uses
`let part = placeInFrame(...)` and does not call `placeOnFace`. Second Confirm updates the same marked block only. **Back**
exits with no additional solid commit. **Fillet** is its own edge-pick mode
(Slice 27), not a contour entry.
The one-shot Xform Extrude stub is gone — Extrude always enters contour mode.

**Loft plane model:** each Loft-card station follows the shared workplane
(selected planar face or default +Z) plus an offset along its normal, or
picks its own face, saved workplane, or sketch plane. Offset stations are
`makeCrossSection` on `offsetPlaneFrame(plane, offset)`. A station with its
own frame emits that frame. `makeLoft` maps each contour through its plane.
A 90° turn is carried on a spine between the planes so the sides do not fold.
Loud-fail on fewer than 2 profiles, coincident stations, or a turn tighter
than the profiles. Confirm places the solid with `placeInFrame` on the first
station when the planes are not parallel, and on the shared plane when every
station is an offset.
When `part` already exists that placement is unioned (`part.add`); an empty
script still assigns `let part = placeInFrame(...)` (no host box / no
`placeOnFace`).

## Core Manifold API

All standard Manifold functions are available:
- `Manifold.cube(size, center)` - Create a cube/box
- `Manifold.cylinder(height, radiusLow, radiusHigh, circularSegments)` - Create a cylinder
- `Manifold.sphere(radius, circularSegments)` - Create a sphere
- `Manifold.union(manifolds)` - Boolean union
- `Manifold.difference(manifolds)` - Boolean difference
- `Manifold.intersection(manifolds)` - Boolean intersection
- Plus many more - see Manifold.js documentation

## Extended Helper Functions

### hollow(manifold, thickness, opening) / shell(manifold, thickness, opening)

Hollows a solid out to a **uniform wall thickness**, leaving an opening at the
face you choose. `hollow()` returns the finished walls; `shell()` returns the
cavity so the older `part.subtract(shell(part, 2, 'z'))` still works.

Every boundary vertex is placed on the inward offset of each face meeting it, so
the wall measures `thickness` perpendicular to every face and corners stay sharp.
(The pre-2026 version scaled the solid by one ratio, which gave a 60x20 box a
2.5mm wall on Y and a 7.5mm wall on X.)

```javascript
// Uniform 2mm wall, open at the top
const box = Manifold.cube([50, 30, 40], true);
return hollow(box, 2, 'z');

// Opening on a face you picked in the viewport, or queried
let part = Manifold.cylinder(40, 20, 20, 64);
part = hollow(part, 2.5, facesByNormal(part, [0, 0, 1])[0]);

// Closed hollow (a sealed void), and two openings at once
const sealed = hollow(Manifold.cube([30, 30, 30], true), 3, 'none');
const openBoth = hollow(Manifold.cube([30, 30, 30], true), 3, ['z', '-z']);
```

**Parameters:**
- `manifold` - The input manifold
- `thickness` - Wall thickness in mm
- `opening` - which face(s) the cavity breaks through (default `'z'`, the +Z face):
  - a signed axis: `'z'`, `'-z'`, `'x'`, `'-x'`, `'y'`, `'-y'`
  - `'none'` for a fully closed hollow
  - a face object from `facesByNormal()` / `planarFaceAt()`
  - a viewport face pick: `{ center: [...], normal: [...] }`
  - an array mixing any of the above

**Returns:** `hollow()` the shelled solid; `shell()` the cavity to subtract

**Notes:**
- Picking a face that is no longer on the body throws and tells you to re-pick,
  rather than silently shelling the wrong side.
- A thickness the body cannot take throws instead of returning a fold.
- Curved and lofted walls are supported; the offset follows the tessellation.

---

### draftFaces(manifold, faces, angleDeg, opts) / addDraft(manifold, draftDeg, axis)

Tilts the faces you select by a **true constant angle**, pivoting about where
each face meets a reference plane. Essential for injection moulding and casting,
where parts must release from the mould.

`addDraft` is the whole-part form (every side wall, bottom stays put);
`draftFaces` lets you name the faces, the pull direction, the reference plane and
the sign. The angle now comes out the same on every wall — the pre-2026 taper
scaled perpendicular coordinates, so only the narrowest wall hit the requested
angle.

```javascript
// Whole part: 2° on every side wall, bottom fixed
const box = Manifold.cube([60, 20, 30], false);
return addDraft(hollow(box, 2, 'z'), 2, 'z');

// One picked face, pivoting about the top instead of the bottom
let part = Manifold.cube([60, 20, 30], false);
part = draftFaces(part, facesByNormal(part, [1, 0, 0])[0], 3,
  { pull: 'z', reference: 'max' });

// Several faces at once (what a shift-click multi-pick emits), flaring outward
part = draftFaces(part, [
  { center: [60, 10, 15], normal: [1, 0, 0] },
  { center: [0, 10, 15], normal: [-1, 0, 0] },
], -3, { pull: 'z', reference: 'min' });
```

**Parameters:**
- `manifold` - The manifold to draft
- `faces` - which faces tilt: a viewport pick `{center, normal}`, a face from
  `facesByNormal()`, a signed axis like `'-x'`, `'sides'` for every side wall, or
  an array mixing those
- `angleDeg` - **signed** draft angle in degrees. Positive tapers inward going
  along the pull (the usual mould-release sense); negative flares outward.
  Typical: 1-2° for smooth surfaces, 3-5° for textured.
- `opts.pull` - pull / draw direction (default `'z'`; accepts `'-z'`, `[x,y,z]`)
- `opts.reference` - the neutral plane that does not move: `'min'` (default),
  `'mid'`, `'max'` along the pull, a number (coordinate along pull), or a
  face / plane whose center defines it
- `opts.sense` - `'taper'` makes every selected wall lean the same way round the
  pull axis, so a hollow part keeps its wall thickness; `'face'` honours each
  face's own outward normal, which is the mould-core sense on a cavity wall.
  Defaults to `'taper'` for `'sides'` and `'face'` for named faces.

**Returns:** The drafted manifold

**Notes:**
- Drafting a face perpendicular to the pull (a cap) throws — it has no direction
  to tilt in. Pick the side walls, or change `opts.pull`.
- Vertices shared by two selected faces are solved once against both, so drafted
  corners stay sharp instead of doubling up.
- An angle the body cannot take throws instead of returning a folded solid.

---

### rotateAbout(manifold, axis, angleDeg, center, opts)

Turns one body by `angleDeg` degrees (right-hand rule) about the line through `center` along `axis`. `axis` is `'x'`, `'y'`, `'z'` (a leading `-` flips it) or a vector `[ax, ay, az]`. `center` is `[x, y, z]` in mm, or `null` for that body's own vertex centroid. The body is named the way `move()` names it: `{ bodies: [{ at }] }` with the centroid from the Rotate card's double-click or `list_bodies`. The named body turns; every other body stays. Volume is unchanged and the bounding box follows the turn. A zero angle returns the input. The Rotate button (below Move) writes this call inside `// --- rotate begin --- / end ---` markers, so the strip shows a Rotate chip with edit, delete, and undo.

```javascript
part = rotateAbout(part, 'z', 90, null, { bodies: [{ at: [40, 0, 0] }] });       // quarter turn about its own centre
part = rotateAbout(part, [0, 1, 0], -15, [0, 0, 10], { bodies: [{ at: [40, 0, 0] }] }); // about a line through [0, 0, 10]
```

A point that is not a body centroid, a zero-length axis, or a missing `bodies` entry throws with a `rotateAbout:` message.

### moveFace(manifold, faces, distance, opts)

Offsets each selected face along its own normal by `distance`. Adjacent faces stay on their planes, so they extend or trim and the solid stays closed. This is not `move()`, which translates a whole body.

```javascript
let part = Manifold.cube([40, 30, 20], true);
part = moveFace(part, [{ center: [0, 0, 10], normal: [0, 0, 1] }], 5);
part = moveFace(part, [{ center: [0, 0, 10], normal: [0, 0, 1] }], 5, { flip: true });
```

**Parameters:**
- `manifold` - The solid
- `faces` - a viewport pick `{ center, normal }`, a face from `facesByNormal()`, or an array of those
- `distance` - millimetres along each selected face normal
- `opts.flip` - reverse each face normal

**Returns:** The solid with those faces offset.

**Notes:**
- A distance the walls cannot absorb throws. It does not return a folded mesh.
- A picked face that is no longer on the body throws.

---

### deleteFace(manifold, faces)

Removes the selected faces and heals the solid by extending or trimming the neighboring faces. A face is `{ center, normal }`, the same pick `moveFace` uses. If the neighbors cannot meet in a closed solid, this throws. It does not return an open or non-manifold mesh.

```javascript
let part = Manifold.cube([10, 10, 10], true);
part = deleteFace(part, [{ center: [0, 0, 5], normal: [0, 0, 1] }]);
```

**Parameters:**
- `manifold` - The solid
- `faces` - a viewport pick `{ center, normal }`, a face from `facesByNormal()`, or an array of those

**Returns:** The healed solid.

**Notes:**
- Deleting one face of a cube throws: the side walls do not meet.
- A planar chamfer whose two neighbors can meet is healed back to the sharp edge.

---

### cut(manifold, plane, opts)

Splits every selected body with a plane, then optionally deletes pieces. The
cut is Manifold's `splitByPlane`: the `'+'` piece is the side the normal
points to, and `'-'` is the other side. Pieces you keep stay separate bodies
(`decompose()` returns them one by one). A body that does not cross the plane
is left alone — same solid, same volume, still one body.

```javascript
// Mid plane z = 0, keep both halves
let part = Manifold.cube([40, 30, 20], true);
part = cut(part, { normal: [0, 0, 1], originOffset: 0 });

// Same cut, keep only the +Z half
part = cut(part, { normal: [0, 0, 1], originOffset: 0 }, { keep: '+' });

// The plane is the face you picked — not a guessed world axis.
// Offset 0 keeps this shape. A nonzero offset is along the face normal.
part = cut(part, { center: [0, 0, 10], normal: [0, 0, 1] });
part = cut(part, { center: [0, 0, 10], normal: [0, 0, 1], offset: -10 });
```

**Parameters:**
- `manifold` - The solid, or several solids grouped by `Manifold.compose`
- `plane` - a face `{ center, normal }`, or an explicit `{ normal, originOffset }`.
  `offset` on a face is added along the normal (positive in the normal
  direction). Offset 0 is omitted and the call stays `{ center, normal }`.
  A world-axis name such as `'z'` is rejected.
- `opts.keep` - `'both'` (default), `'+'`, or `'-'`
- `opts.bodies` - which bodies to cut, each `{ at }` near that body's centroid.
  Omit to cut every body. Bodies you skip are unchanged.
- `opts.drop` - pieces to delete when you are not dropping a whole side:
  `{ at, side: '+' | '-' }`

**Returns:** The kept pieces. One piece is that solid. Several pieces are one
composed manifold whose `decompose()` length is the number of pieces.

**Notes:**
- A body that only touches the plane is not cut.
- Deleting every piece throws.
- Pass `keep` or `drop`, not both.

---

### sweep(profile, path, options)

Sweeps a 2D cross-section along a parametric 3D path using Frenet-Serret frames.
```javascript
// Sweep a circle along a helix
const profile = CrossSection.circle(2, 32);
const helix = {
  position: (t) => [20 * Math.cos(t), 20 * Math.sin(t), 5 * t],
  tMin: 0,
  tMax: 4 * Math.PI
};
return sweep(profile, helix);
```

**Parameters:**
- `profile` - CrossSection to sweep (should be centered at origin)
- `path` - Parametric path object:
  - `position(t)` - Function returning [x, y, z] at parameter t (required)
  - `derivative(t)` - Function returning first derivative (optional, computed numerically if omitted)
  - `secondDerivative(t)` - Function returning second derivative (optional)
  - `tMin` - Start parameter (default: 0)
  - `tMax` - End parameter (default: 1)
- `options` - Optional settings:
  - `arcSamples` - Samples for arc-length table (default: 1000)
  - `extrudeSegments` - Segments along extrusion (default: 64)
  - `epsilon` - Delta for numerical derivatives (default: 1e-5)

**Example - Trefoil Knot:**
```javascript
const scale = 5;
const profile = CrossSection.circle(1, 32);
const trefoil = {
  position: (t) => [
    scale * (Math.sin(t) + 2 * Math.sin(2 * t)),
    scale * (Math.cos(t) - 2 * Math.cos(2 * t)),
    scale * (-Math.sin(3 * t))
  ],
  derivative: (t) => [
    scale * (Math.cos(t) + 4 * Math.cos(2 * t)),
    scale * (-Math.sin(t) + 4 * Math.sin(2 * t)),
    scale * (-3 * Math.cos(3 * t))
  ],
  tMin: 0,
  tMax: 2 * Math.PI
};
return sweep(profile, trefoil, { arcSamples: 2000, extrudeSegments: 128 });
```

---

### sweepPoints(profile, points, options)

Sweeps a profile along a path defined by an array of points using Catmull-Rom spline interpolation.
```javascript
// Sweep along a curved path
const profile = CrossSection.circle(2, 16);
const points = [
  [0, 0, 0],
  [20, 10, 0],
  [40, 0, 20],
  [60, -10, 20],
  [80, 0, 0]
];
return sweepPoints(profile, points);
```

**Parameters:**
- `profile` - CrossSection to sweep
- `points` - Array of [x, y, z] coordinates defining the path (minimum 2 points)
- `options` - Optional settings:
  - `closed` - If true, creates a closed loop (default: false)
  - Plus all options from `sweep()`

**Example - Closed Loop:**
```javascript
const profile = CrossSection.square([3, 3], true);
const ring = [
  [30, 0, 0],
  [0, 30, 10],
  [-30, 0, 0],
  [0, -30, 10]
];
return sweepPoints(profile, ring, { closed: true });
```

---

### Vector Helpers

These utility functions are available for advanced path calculations:

| Function | Description |
|----------|-------------|
| `vecAdd(a, b)` | Add two 3D vectors |
| `vecSub(a, b)` | Subtract b from a |
| `vecMul(s, v)` | Multiply vector by scalar |
| `vecDot(a, b)` | Dot product |
| `vecCross(a, b)` | Cross product |
| `vecNorm(v)` | Vector magnitude/length |
| `vecNormalize(v)` | Normalize to unit vector |
```javascript
// Example: compute a point offset along a normal
const normal = vecNormalize(vecCross(tangent, up));
const offsetPoint = vecAdd(point, vecMul(5, normal));
```

---

### tube(outerRadius, innerRadius, height, segments) / rectTube(outer, inner, height, opts)

Creates a tube/pipe shape — round or **rectangular**. Passing an array as the
first argument switches to the rectangular form (and the 4th argument becomes its
options object rather than a segment count).

```javascript
// Round: 10mm outer radius, 8mm inner radius, 30mm tall
const pipe = tube(10, 8, 30, 32);

// Rectangular 40 x 20, uniform 2.5mm wall, 60mm tall
const box = tube([40, 20], 2.5, 60);

// Explicit inner size, and rounded corners (the wall stays uniform round them)
const a = tube([40, 20], [30, 10], 60);
const b = tube([40, 20], 2.5, 60, { cornerRadius: 4 });

// Square tube, 3mm wall
const sq = rectTube(30, 3, 20);
```

**Parameters:**
- `outerRadius` - Outer radius, or `[width, depth]` for a rectangle (a single
  number in `rectTube` means a square)
- `innerRadius` - Inner radius. For a rectangle: a **number** is read as a
  uniform wall thickness, `[width, depth]` as an explicit inner size.
- `height` - Height of the tube (z = 0 .. height)
- `segments` - Number of circular segments (default: 32). For a rectangle this
  slot is the options object instead:
  - `cornerRadius` - outer corner radius (default 0, i.e. sharp)
  - `innerCornerRadius` - defaults to `cornerRadius - wall`, keeping the wall
    uniform around the corner
  - `segments` - segments per full circle for the corner arcs (default 32)
  - `center` - center the extrusion on z instead of starting at z = 0

---

### hexPrism(radius, height)

Creates a hexagonal prism (6-sided cylinder).

```javascript
// Create a hex nut shape
const hex = hexPrism(10, 5);
return hex;
```

**Parameters:**
- `radius` - Circumradius (center to vertex)
- `height` - Height

---

### mirror(manifold, plane, keepOriginal, opts)

Mirrors a manifold across a plane. A named body is mirrored on its own; every other body stays. With no `bodies`, the whole solid is mirrored (older scripts).

```javascript
// Symmetric part across the YZ plane through the origin
const half = Manifold.cube([20, 10, 10]);
const full = mirror(half, 'yz', true);
return full;

// One body across a workplane, keeping the original
part = mirror(part, { center: [30, 0, 0], normal: [1, 0, 0] }, true, { bodies: [{ at: [20, 0, 0] }] });
```

**Parameters:**
- `manifold` - The manifold to mirror
- `plane` - `'xy'`, `'xz'`, or `'yz'` (through the origin), or `{ center, normal }` for a workplane or a planar face. `{ normal, originOffset }` is the same plane.
- `keepOriginal` - If true, unions the copy with the original (default: true). A third argument that is an object is `opts`, and the copy is kept.
- `opts.bodies` - One body, `{ at }` its centroid, the same point `move()` uses. Overlap throws instead of dropping the original.

---

### array3D(manifold, counts, spacing)

Creates a 3D rectangular array of copies.

```javascript
// Create a 3x3x2 grid of cubes
const cube = Manifold.cube([5, 5, 5], true);
const grid = array3D(cube, [3, 3, 2], [10, 10, 10]);
return grid;
```

**Parameters:**
- `manifold` - The manifold to array
- `counts` - [nx, ny, nz] number of copies in each direction
- `spacing` - [dx, dy, dz] spacing between copies

---

### polarArray(manifold, count, radius, axis)

Copies a solid equally spaced around an axis. The radius offset is perpendicular to that axis (+Y when the axis is x, +X for y and z) so the copies orbit; radius 0 leaves every copy on the axis. The result is only those copies. The input solid is not kept as an extra body.

`insert_polar_array` writes this call. `boreRadius` 0 (the default) copies the body. `boreRadius` greater than 0 subtracts that many centered holes of `boreRadius` by `boreHeight` on the circle and does not copy the body; `boltCircleRadius` must then be greater than 0. `boltCircleRadius` defaults to 0 (on the axis). That is the bolt-circle hole pattern. Do not record it as a FEATURE-GAP.

```javascript
// Create 6 cylinders in a circle
const cylinder = Manifold.cylinder(20, 5, 5, 32);
const circle = polarArray(cylinder, 6, 30, 'z');
return circle;
```

**Parameters:**
- `manifold` - The manifold to array
- `count` - Number of copies
- `radius` - Orbit radius. 0 leaves the copies on the axis. The offset is perpendicular to `axis`
- `axis` - Rotation axis: 'x', 'y', or 'z' (default: 'z')

---

### patternOnPoints(manifold, points, opts)

One copy of the body at every point, turned so its `up` axis follows the point's `axis` when the point has one. The hardware helper: a bolt onto the hole centers and axes of the part it fastens.

```javascript
// Four bolts, one per hole; each hole gives its center and axis
const bolt = Manifold.cylinder(12, 2.5, 2.5, 24);
let part = patternOnPoints(bolt, [
  { at: [-20, -15, 6], axis: [0, 0, 1] },
  { at: [20, -15, 6], axis: [0, 0, 1] },
  { at: [-20, 15, 6], axis: [0, 0, 1] },
  { at: [20, 15, 6], axis: [0, 0, 1] },
], { up: [0, 0, 1] });
return part;
```

**Parameters:**
- `manifold` - The body to copy (one instance)
- `points` - Array of `[x, y, z]` or `{ at: [x, y, z], axis?: [nx, ny, nz] }` in mm; a point with no axis is a plain translate
- `opts.up` - The body axis that follows each point's axis (default `[0, 0, 1]`)
- `opts.keepOriginal` - Also keep the source where it is (default `false`)
- `opts.merge` - Union the copies (default `true`); `false` composes them as separate bodies

Throws a plain error on an empty list, a point that is not three numbers, or a zero axis. The palette item is **Points** (`patternPoints`, Array Type=Points); the agent tool is `insert_pattern_points { points, up?, keepOriginal?, merge? }`.

---

### center(manifold, axes)

Centers a manifold at the origin.

```javascript
// Center on all axes
const box = Manifold.cube([20, 30, 10]);
const centered = center(box, [true, true, true]);
return centered;

// Center only on X and Y
const partCentered = center(box, [true, true, false]);
```

**Parameters:**
- `manifold` - The manifold to center
- `axes` - [centerX, centerY, centerZ] which axes to center (default: all true)

---

### align(manifold, options)

Aligns a manifold to a specific position.

```javascript
// Align min-Z to the origin
const box = Manifold.cube([20, 20, 20], true);
const aligned = align(box, { min: [undefined, undefined, 0] });
return aligned;

// Center on X, align max-Y to 50
const positioned = align(box, { 
  center: [0, undefined, undefined],
  max: [undefined, 50, undefined]
});
```

**Parameters:**
- `manifold` - The manifold to align
- `options.min` - [x, y, z] align min bounds (use undefined to skip)
- `options.max` - [x, y, z] align max bounds
- `options.center` - [x, y, z] align center

---

### getDimensions(manifold)

Gets the dimensions and bounding box of a manifold.

```javascript
const box = Manifold.cube([20, 30, 10]);
const dims = getDimensions(box);
console.log(dims.size);   // [20, 30, 10]
console.log(dims.center); // [10, 15, 5]
console.log(dims.min);    // [0, 0, 0]
console.log(dims.max);    // [20, 30, 10]
```

**Returns:**
```javascript
{
  size: [x, y, z],    // Dimensions
  min: [x, y, z],     // Minimum corner
  max: [x, y, z],     // Maximum corner
  center: [x, y, z]   // Center point
}
```

---

### getScaleRatio(manifold, axis, thickness)

Legacy. Computes the uniform scale ratio the old scale-based `shell()` used.
Nothing calls it any more — `shell()` offsets each face instead, because one
scale ratio cannot give a non-cubic part a uniform wall. Kept so existing
scripts that call it still run.

**Parameters:**
- `manifold` - The input manifold
- `axis` - Axis index (0=x, 1=y, 2=z)
- `thickness` - Desired wall thickness

**Returns:** Scale ratio (0-1)

---

## Selection & Feature Helpers (C4)

These helpers add a geometric **selector layer** (Manifold has no native
face/edge API) plus parametric **features** (holes, counterbores,
countersinks, chamfers). They read a manifold's mesh via `getMesh()` and
operate in local 2D face frames, so a script can reason about "the top
face", "vertical edges", or "a hole pattern on this wall" the way a CAD
user does.

All of them take and return standard `Manifold` objects and validate the
result (`status() === 'NoError'`), throwing on failure.

### Face & edge selection

`c4MeshData` is the internal indexer (grouping triangles into BRep faces
via `faceID`, welding edges). The public selectors:

### facesByNormal(m, dir, tolDeg = 1)

**Parameters:**
- `m` - The input manifold
- `dir` - Target normal as `[x,y,z]` (e.g. `[0,0,1]` for `>Z`, `[0,0,-1]` for `<Z`)
- `tolDeg` - Angular tolerance in degrees (default 1)

**Returns:** Array of face objects `{ id, tris, normal, center, verts }`.

```javascript
const topFaces = facesByNormal(part, [0, 0, 1]);      // all upward faces
const wall     = facesByNormal(part, [1, 0, 0])[0];   // a +X face
```

### edgesNamed(part, ...names)

The one edge reference a script should hold. An edge is the pair of stamped faces it lies between, so the name survives every edit that keeps those faces, where `edge(part, 17)` renumbers after any earlier change and a literal `va/vb` wire breaks as soon as the geometry moves.

```javascript
const e1 = edgesNamed(part, 'plate.top~boss.side');            // every chain between those faces
const e2 = edgesNamed(part, 'plate.top~boss.side[1]');         // one chain of a pair that meets twice
const e3 = edgesNamed(part, 'cube1.top~cube1.front', 'cube1.top~cube1.right'); // several edges, one list
const e4 = edgesNamed(part, 'boss.top~boss.wall[*]');          // glob: the rim of a hex boss
part = filletAlongPath(part, makeSweepPath(e1), 2);
part = filletAlongPath(part, makeSweepPath(edgesNamed(part, 'plate.top~fillet-2.round')), 1, { profile: 'chamfer' });
```

- Face order inside a name does not matter (`a~b` is `b~a`). Names come from `faceNames(part)`, `list_feature_edges`, or the Fillet card.
- A bare pair returns every chain between those faces. `[k]` picks one chain and throws when the pair no longer has that many chains (the pieces changed): re-pick, or use the bare name. `*` globs either side.
- Returns the same segment rows `edge()` returns (`a`, `b`, `va`, `vb`, `length`, `mid`, plus `n0` / `n1` and `name`), so `makeSweepPath` and `filletAlongPath` are unchanged. `result.names` lists the chains it matched.
- Throws, listing the edges that exist, when a name matches nothing. It never substitutes a nearby edge.
- Every face has a name: helper roles (`cube1.top`), fillet and chamfer surfaces (`fillet1.round`, `chamfer2.bevel`, and the spherical corner balls of `filletEdges(..., { sphericalCorners: true })` as `fillet1.corner[k]`; the block id Accept mints, positional like `fillet-16` only on an older block with no `id=`, one piece per contiguous strip), uploads by coplanar group (`import@1.f3`), and freehand `Manifold.*` runs by their block (`snippet2.f7`, else `script.f7`).
- `filletAlongPath` also refuses a path whose knots are not on an edge of the solid (a stale literal wire), instead of sweeping a cutter through air.

### faceNames(part) / facesNamed(part, name) / edgesOf(part, name) / surfaceOf(face)

Faces by the name the helper that built them recorded (see [docs/architecture.md](architecture.md), Face identity). `Manifold.cube` / `cylinder` / `sphere`, `tube`, `hexPrism`, `roundedBox`, `makeExtrude`, `makeRevolve`, `sweep` / `sweepPoints` and a parallel `makeLoft` stamp every face with `feature.role`: `feature` is the id of the marked block the call ran in (`cube1`, `tapDrillHole-11`), else `<helper>@<n>` in script order; `role` is `top bottom left right front back`, `side top bottom inner`, `surface`, `wall[i]`, `band[i]` / `corner[i]`, `cap0 cap1 wall[g]` (extrude and sweep), `seg[g] end0 end1` (revolve), `cap0 cap1 span[i][j]` (loft: bottom edge `i`, station span `j`). A label in several pieces (a slot through a top, a union of two copies) gets `[k]`, ordered by centre.

```js
faceNames(part);                       // ['base.bottom', 'base.top', 'boss.side', …]
const top = facesNamed(part, 'base.top')[0];
const wp = workplaneFromFace(part, top);
part = hole(part, wp, 10, 0, 4, 6);
facesNamed(part, 'plate.top');         // every piece: plate.top[0], plate.top[1]
facesNamed(part, 'boss.wall[*]');      // glob
surfaceOf(top);                        // { kind: 'plane', origin, normal }
part = chamferEdges(part, edgesOf(part, 'boss.top'), 2);   // the edges around that face only
const e = edgesOf(part, 'plate.top'); e.skipped;           // concave edges left out, counted
```

`edgesOf(part, name, { includeConcave?, minAngleDeg? })` returns the convex feature edges that touch the named face, in the shape `convexEdges` returns, so they go straight into `filletEdges` / `chamferEdges`. Only edges on that face: four on a box top, never every edge on the body whose neighbour faces the same way. Concave edges are skipped and counted on `result.skipped` (pass `includeConcave: true` to blend them); it throws, naming the face and the concave count, when no convex edge is left.

`facesNamed` throws, naming the faces that exist, when nothing matches; it never picks a nearby face. The faces carry `center`, `normal`, `tris`, `verts`, `area`, `body`, `name`, `label { feature, role, ordinal }` and `record`, and work wherever a `facesByNormal` face does. `surfaceOf` is the record the helper wrote from its arguments (`plane`, `cylinder`, `cone`, `sphere`, else `mesh`), in the frame the helper built in: a later translate or rotate moves the face, not its record. A hull, a fillet cutter or a freehand `Manifold.*` call outside those primitives has no stamped faces.

### planarFaceAt(m, axis, value, tol = 1e-3)

The single planar face lying in the plane `axis == value` (axis `'x'|'y'|'z'`).
Returns `null` if none, throws if more than one.

```javascript
const top = planarFaceAt(part, 'z', 30);   // the face at z=30
```

### edgesByOrientation(m, axis, dir = null, tolDeg = 5)

Edges parallel to `axis` (`'x'|'y'|'z'`). `dir` of `1` / `-1` / `null`
selects one direction or both.

```javascript
const vEdges = edgesByOrientation(part, 'z');      // all vertical edges
```

### workplaneFromFace(m, face)

Builds a deterministic, axis-aligned local frame on a face (or a face index
into `m`). Returns `{ center, normal, x, y }` where `center` is the
area-weighted face centroid (coplanar connected triangles are merged even
when Manifold assigns per-triangle `faceID`s — so `hole(…, 0, 0, …)` hits
the true face center), `normal` is the outward face normal, and `(x, y)`
are the in-plane axes. Axes are aligned to world axes so `(u, v)` map to
predictable world directions:

- `+Z` face → `u→+X, v→+Y`   - `-Z` face → `u→+X, v→-Y`
- `+X` face → `u→+Y, v→+Z`   - `-X` face → `u→+Y, v→-Z`
- `+Y` face → `u→+X, v→-Z`   - `-Y` face → `u→+X, v→+Z`

```javascript
const fr = workplaneFromFace(part, facesByNormal(part, [0,0,1])[0]);
// fr.center, fr.normal, fr.x, fr.y
```

### placeInFrame(frame, solid, uvw = [0, 0, 0]) / transformByFrame(…)

Places a solid on a **PlaneFrame** `{ center, normal, x, y }` (from
`workplaneFromFace` / `makeCrossSection.plane` / default +Z). The solid's
local origin lands at `center + u·x + v·y + w·normal`, axes aligned to
`(x, y, normal)`. **Frame-only** — never a Manifold / cube / scaffold.
Does not take a host part. A first body assigns `let part = placeInFrame(…)`.
Advanced Confirm (Extrude / Revolve / Sweep / Loft), when `part` already
exists, unions instead: `part = part.add(placeInFrame(…))`.
`transformByFrame` is the same helper.

```javascript
const fr = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const xs = makeCrossSection(fr, profileCircle(5, 32));
part = placeInFrame(xs.plane, makeExtrude(xs.contours, 10), [0, 0, 0]);
```

### placeOnFace(part, frame, builder)

Runs `builder` in the face's local frame. The builder receives
`{ Manifold, frame, put }` where `put(m, [u,v,w])` transforms a built
Manifold so its origin lands at `center + u·x + v·y + w·normal` (w is along
the outward normal; negative w goes into the solid). Lets scripts write
axis-aligned geometry for arbitrary face normals. Returns the builder's
Manifold. `part` is unused (legacy host arg). New-body Extrude / Revolve
Confirm uses `placeInFrame` and replaces `part` instead of `part.add`.

```javascript
const fr = workplaneFromFace(part, facesByNormal(part, [0,0,1])[0]);
const rib = placeOnFace(part, fr, ({ put, Manifold }) =>
  put(Manifold.cube([40, 4, 6], true), [0, 0, -3]));
return Manifold.union(part, rib);
```

### Features

### hole(part, frame, u, v, dia, span)

Cut a round through-hole on `frame` at local `(u, v)` (mm), diameter `dia`,
cut length `span` along the outward normal. Use `holeSpan()` for full
thickness.

```javascript
const fr = workplaneFromFace(part, facesByNormal(part, [0,0,1])[0]);
part = hole(part, fr, 10, 5, 6, holeSpan(part, fr));
```

### holeSpan(part, frame)

Full extent of the part along the frame normal (both directions) + 2 mm
overshoot — a safe full-through cut length from that face.

### cboreHole(part, frame, u, v, diaThru, diaCbore, cboreDepth, span)

Through hole `diaThru` plus a larger counterbore `diaCbore` to `cboreDepth`
from the face. (CadQuery `cboreHole`.)

### cskHole(part, frame, u, v, diaThru, diaCsk, cskDepth, span)

Through hole `diaThru` plus a cone countersink spanning `diaThru`→`diaCsk`
over `cskDepth`. (CadQuery `cskHole`.)

### chamferEdges(part, edges, c)

Equal-leg 45° chamfer on a **set** of straight convex edges. `c` is the
**leg length along each adjacent face** (CAD "C2" = 2 mm on both legs) —
the perpendicular face offset is derived from the face-to-face angle
(`offset = c·tan(θ/2)`; at a 90° corner they coincide, at a 120° hex-nut
corner C2 → 1.155 mm offset). `edges` come from `convexEdges()` /
`c4MeshData()` / other C4 selectors (they carry `faces: [i0, i1]`, from
which `chamferEdges` **auto-derives the adjacent face normals**) or a plain
`[{va, vb, n0, n1}]` array where `n0`/`n1` (outward normals of the two
adjacent faces) must be provided explicitly.

Cutters are applied **sequentially** (one boolean per edge) and every
intermediate result is checked, so a single degenerate edge (e.g. at a
triple-junction rib-base edge where the two "adjacent faces" are
coplanar) throws a named, actionable error instead of trapping the wasm
kernel. Cost: n differences instead of 1 — fine for the edge counts these
parts use (≤ ~30).

```javascript
part = chamferEdges(part, convexEdges(part), 2);
```

**Throws (named errors):** edge without va/vb; missing adjacent face
normals (pass `convexEdges()` output on THIS part, or explicit n0/n1);
coplanar adjacent faces (tessellation seam / wrong face pair); degenerate
cutter or failed boolean at a specific edge index; a result with more
bodies than the input (`split the solid into N bodies`) — the pieces are
not returned.

### convexEdges(m, minAngleDeg = 2)

Genuine straight convex edges: dihedral angle > `minAngleDeg` (filters
curved-face tessellation seams) and a ball-probe confirms the corner is
convex (not concave). Returns edge objects `{ va, vb, a, b, tris, tangent,
faces: [i0, i1], n0, n1 }` — `n0`/`n1` are the adjacent face normals and
`faces` the face indices, so the result is ready for `chamferEdges`
(normals auto-derived) and `filletEdges` as-is.

```javascript
const vConvex = convexEdges(part).filter(e => Math.abs(e.tangent[2]) > 0.99);
part = chamferEdges(part, vConvex, 0.5);   // chamfer only the vertical corners
```

### holePattern(part, frame, { n, m, spacingU, spacingV, dia, span, u0=0, v0=0 })

Linear grid of `n`×`m` through-holes (CadQuery `rarray`), centered on the
face center plus an optional `(u0, v0)` offset.

```javascript
const fr = workplaneFromFace(part, facesByNormal(part, [0,0,1])[0]);
part = holePattern(part, fr, { n: 3, m: 2, spacingU: 12, spacingV: 10, dia: 4 });
```

### holesOnContour(part, section, spec)

One hole at every sketch point of a centres contour, arc centres included.
`section` is a `makeCrossSection` of `solveContour({ centers: true, ... })`.
Construction lines are not centres. No centres returns `part`. `dia` is a raw
millimetre diameter and wins over fastener `size` and `fit`. `side: 1` cuts
toward −normal; `side: -1` or `flip: true` cuts the other way, so two calls
can share one section. `depth` is millimetres past the plane on that side.
`through: true` uses `holeSpan`. A far c-bore or c-sink requires a through hole.

```javascript
const c1 = makeCrossSection(plane, solveContour({
  centers: true,
  points: [{ id: 'p0', at: [10, 0] }, { id: 'c0', at: [0, 0] }],
  arcs: [{ id: 'a0', center: 'c0', radius: 10, full: true, sweep: 'ccw' }],
}));
part = holesOnContour(part, c1, { dia: 4, through: false, depth: 6, side: 1 });
part = holesOnContour(part, c1, { type: 'clearance', size: 'M3', fit: 'normal', through: true, side: -1 });
```


### clearanceHole(part, frame, u, v, size, spanOrOpts?, fit?)

Cut a **clearance** hole sized for fastener `size`. `size` accepts `'M3'`,
`3`, `'M2.5'`, `'#8-32'`, `'1/4-20'`, etc. `fit` is `'close'|'normal'|'loose'`
(aliases: tight/medium/coarse). `span` defaults to `holeSpan(part, frame)`.
You can also pass an options object as the 6th argument:
`{ fit: 'close', span: 12 }`.

```javascript
const fr = workplaneFromFace(part, facesByNormal(part, [0,0,1])[0]);
part = clearanceHole(part, fr, 10, 8, 'M3');                 // normal fit
part = clearanceHole(part, fr, -10, 8, 'M4', undefined, 'close');
part = clearanceHole(part, fr, 0, 0, 'M5', { fit: 'loose' });
```

Throws on unknown size/fit, non-positive derived diameter, bad frame, or empty /
non-manifold result.

### tapDrillHole(part, frame, u, v, size, span?)

Cut a **tap-drill** hole for fastener `size` (hole intended to be tapped).
`span` defaults to `holeSpan(part, frame)`.

```javascript
const fr = workplaneFromFace(part, facesByNormal(part, [0,0,1])[0]);
part = tapDrillHole(part, fr, 0, 0, 'M3');   // Ø2.5 for M3 coarse
part = tapDrillHole(part, fr, 12, 0, '#8-32');
```

### fastenerClearanceDia(size, fit = 'normal') / fastenerTapDrillDia(size)

Return the clearance or tap-drill diameter in **mm** without cutting. Useful
for custom patterns:

```javascript
const d = fastenerClearanceDia('M6', 'normal'); // 6.6
part = holePattern(part, fr, { n: 2, m: 2, spacingU: 20, spacingV: 20, dia: d });
```

`listFastenerSizes()` → `{ metric: ['M1.6','M2',…], unc: ['#4-40',…] }`.

---

## Fillet Helper (C6)

### filletEdges(part, edges, radius, opts)

Circular fillet of radius `r` on a **set** of straight convex edges
(Manifold has no native fillet; this is a geometric construction).
`edges` must come from `convexEdges()` (it needs the per-edge vertex
indices to recover the in-face directions — and the in-face geometry, not
just the normals, is what makes non-90° corners work). `radius` is a
number (same `r` for all edges) or a `number[]` parallel to `edges`
(per-edge radii). `opts` (optional): `{ sphericalCorners: true }`
(see below).

```javascript
// round all 12 box corners at r=3
part = filletEdges(part, convexEdges(part), 3);

// fillet only the 4 vertical corners, mixed radii per edge
const vert = convexEdges(part).filter(e => Math.abs(e.tangent[2]) > 0.99);
part = filletEdges(part, vert, [3, 3, 5, 5]);

// fully-rounded box corners: r=5 fillets + spherical corner patches
part = filletEdges(part, convexEdges(part), 5, { sphericalCorners: true });
```

**How it works (per edge).** In the cross-section perpendicular to the
edge, the two faces meet at interior angle θ. The fillet arc of radius `r`
is tangent to both faces at distance `t = r/tan(θ/2)` from the corner,
centered on the interior angle bisector at `r/sin(θ/2)`. The removed
cross-section is the sliver `r·t − ½·r²·(π−θ)` (= `r²(1−π/4)` at 90°).
The cutter is exactly `parallelepiped(t·f0, t·f1, edge) − cylinder(r)` —
both are exact primitives, so the result is geometrically exact for any
θ. The in-face boundary directions `f0`/`f1` come from the adjacent
triangles' third vertices (robust to Manifold's `faceID` grouping, which
can merge faces from different planes into one). All cutters for the set
are unioned and subtracted once, so shared-corner interactions resolve
through the boolean — matching analytic inclusion-exclusion for adjacent
edges (two cutters at a corner, three at a box corner).

**Closed circular rims (v2, 2026-09-08).** A curved surface (a cylinder
wall, a hole wall) meeting a planar face tessellates as a LOOP of many
short straight mesh edges — e.g. a Ø12 hole rim at 48 segments has
~0.78mm segments. In v1 this loop was filleted PER SEGMENT, and any
segment failing the size guard below was silently skipped — for a real
fillet radius (r=1 on that Ø12 rim, t=1 > 0.45·0.78mm) EVERY segment
failed, so the whole rim's fillet silently vanished with no error. v2
detects a maximal chain of input edges that (a) share consecutive mesh
vertices, (b) turn ≤30° at each shared vertex (a genuine polygon corner
turns 60-180°; a tessellated circle turns 360/segs°, well under 30° for
any segs≥12), and (c) keep the same interior angle θ (within 3°) and the
same radius. If that chain closes into a loop AND fits an exact circle
(3-point circumcircle, verified against every other vertex in the run),
the WHOLE rim is filleted as one exact revolved cutter — the same 2D
corner-sliver cross-section swept a full 360° around the rim's own axis
— instead of per-segment boxes, so the old per-segment size guard does
not apply to it at all. `convexEdges(part)` (unfiltered, or filtered only
by position/orientation — do NOT filter out short segments) is the
correct input; a "filter out the tiny seam edges" workaround is no longer
necessary or correct for a genuine curved rim. If a chain doesn't close,
or doesn't fit a clean circle (mixed/non-circular topology), filletEdges
falls back to the v1 per-edge construction for every edge in that chain,
including the size guard below — so isolated straight edges and
non-circular chains behave exactly as before.

**Constraints (v1 per-edge path — still the fallback for singleton edges
and non-circular chains).**
- **Planar faces only** — each adjacent face must be planar at the edge
  (checked: all same-face neighbor triangles coplanar within 1e-3). A
  fillet touching a curved face **throws** for a SINGLETON edge. (A
  successfully-fit closed circular run skips this check entirely — the
  circle fit plus per-vertex on-circle verification is a strictly more
  specific validity proof for "this chain is one smooth curved feature"
  than the singleton check, which was never designed to look past one
  edge.)
- **Convex edges only** — concave corners (rounding = adding material)
  throw. `convexEdges()` already filters these out; passing them directly
  also throws via the ball probe. (Applies to every edge, run or not.)
- **Size guard** — for a SINGLETON edge (or an edge in a chain that didn't
  qualify as a closed circular run), `r` must satisfy `t < 0.45·L` where
  `L` is the edge length; individual edges that FAIL this guard are
  **skipped** when other edges still produce cutters. If **every** requested
  edge is skipped / rejected, `filletEdges` **throws** (no silent unchanged
  part). Closed-circular-run members are exempt — their per-segment `L` is a
  tessellation artifact, not a signal that the feature is too small.
- **Arc tessellation** — a SINGLETON edge's fillet arc is an inscribed
  384-gon: the result volume sits at most `L·(π−(n/2)·sin(2π/n))·r²` BELOW
  the circle-exact value per edge. A closed run's revolve resolution is
  tied to the rim's own mesh segment count exactly (verified necessary
  for a numerically clean boolean: Manifold's boolean difference between
  the original n-segment part and a cutter revolved at a DIFFERENT
  segment count — even a clean integer multiple of n — silently removes
  LESS than the cutter's own volume), with a separately-tunable, finer
  resolution for the small fillet arc itself.
- **Known gaps** — an OPEN curved run (a fillet on a less-than-360° arc)
  does not get the closed-run treatment and can still lose short segments
  to the size guard; not exercised by any part in the current corpus
  (every curved surface here comes from a full-revolution primitive). A
  closed-run cutter throws (rather than silently clipping) if `r` is so
  large the fillet would revolve through the rim's own axis.

**Spherical corner caps** (`opts.sphericalCorners: true`). Three fillets
meeting at a box corner converge to a sharp cusp point — the plain
result is a valid but pointy corner. With this option the cusp is
replaced by the sphere of radius `r` centered on the trihedral incenter
(equidistant `r` from all three faces and lying ON all three fillet
cylinder axes): a spherical corner patch that is tangent to each
fillet sail along a circle (C1 junction) and to each face at one point —
i.e. the true CAD r/r/r rounded corner. An exact right-angle corner is
built as meshes (each edge cutter stops at the junction plane and one
pocket solid holds the sphere octant) that share their ring vertices, so
nothing is cut between tangent surfaces: on a 40×30×20 box each sail is
one face, each corner is one face (`<block>.corner[k]`, see
[architecture.md](architecture.md) → Face graph walls), and the result
has no needle triangles. v1 scope: applies only at vertices where exactly
THREE filleted edges meet at ~90° with EQUAL radii; other corners keep
the cusp, and non-triple corners are unaffected (the option is a no-op
on an edge set whose corners have fewer than three fillets). A corner a
fraction of a degree off square keeps the older ball cut.

**Verified** against analytic volumes: single edge, 4 top edges, all 12
box edges (pair + triple corner overlaps), an obtuse wedge (90°/116°/153°
corners), and mixed per-edge radii — see `cadgen-workspace/reports/c6-report.md`.

---


---

## Cross-section substrate (Slice 21)

Reusable **plane + 2D profile** value for later edge→sweep path,
fillet-via-sweep, then extrude/revolve/loft siblings. This slice ships the
substrate only — those followers are **not** started here.

Plane comes from `workplaneFromFace` (primary mobile path: selected planar
face). Profile is a light 2D shape in plane UV. The returned value is a plain
object (no class inheritance):

```javascript
{
  kind: 'crossSection',
  plane: { center, normal, x, y },  // workplaneFromFace frame
  profile: { type: 'circle'|'rectangle'|'polygon', ... },
  contours: [ [[u,v], ...] ],       // ready for makeExtrude / sweep later
}
```

### profileCircle(radius, segments = 32)

Circle centered at UV origin.

```javascript
const p = profileCircle(5, 32);
```

### profileRectangle(width, height, centered = true)

Axis-aligned rectangle in UV.

```javascript
const p = profileRectangle(20, 12, true);
```

### profilePolygon(points)

Simple closed polyline / polygon (≥ 3 `[u,v]` points; explicit close optional;
winding normalized CCW). Enough for a quarter-circle fillet profile:

```javascript
const r = 3;
const filletProf = profilePolygon([
  [0, 0], [r, 0],
  [r * Math.cos(Math.PI / 4), r * Math.sin(Math.PI / 4)],
  [0, r],
]);
```

### solveContour(spec)

Solve a constrained contour in plane UV. Lengths are millimetres. Angles are
degrees. A dimension name is a string on that dimension and is not a script
binding. Horizontal is constant `v`. Vertical is constant `u`. Both are the
workplane frame, not the screen.

```javascript
const contour = solveContour({
  points: [
    { id: 'p0', at: [0, 0] },
    { id: 'p1', at: [40, 0] },
    { id: 'p2', at: [40, 20] },
    { id: 'p3', at: [0, 20] },
  ],
  lines: [
    { id: 'e0', a: 'p0', b: 'p1' },
    { id: 'e1', a: 'p1', b: 'p2' },
    { id: 'e2', a: 'p2', b: 'p3' },
    { id: 'e3', a: 'p3', b: 'p0' },
  ],
  arcs: [],
  dimensions: [
    { id: 'd0', kind: 'length', edge: 'e0', value: 40, name: 'width' },
  ],
  constraints: [
    { id: 'k0', kind: 'horizontal', items: ['e0'] },
    { id: 'k1', kind: 'fix', items: ['p0'], at: { p0: [0, 0] } },
  ],
});
const xs = makeCrossSection(fr, contour);
```

**Returns:** `{ type:'contour', contours, points, lines, arcs, dimensions, constraints, dof, status, conflict, repeated, open }`.
`status` is `under`, `full`, or `conflict`. `repeated` lists constraints
whose removal does not change the rank, each with `warning: 'repeated'`.
That warning is not a failure. More than 128 points throws. An open chain
of three or more points is closed with one more line before the solve.
A contour may hold more than one chain. A vertex with more than two
edges throws.

**Loud failures:** unknown id, unknown kind, equal of a line and an arc,
a name that is not an identifier or is used twice on the contour, a bare
identifier where a number belongs.

### makeCrossSection(plane, profile)

```javascript
let part = Manifold.cube([40, 30, 20], true);
const topFace = facesByNormal(part, [0, 0, 1])[0];
const fr = workplaneFromFace(part, topFace);
const xs = makeCrossSection(fr, profileCircle(5, 32));
// xs.plane / xs.profile / xs.contours — consume in later slices
return part;
```

**Parameters:**
- `plane` — frame from `workplaneFromFace` (`center`, `normal`, `x`, `y`)
- `profile` — `profileCircle` / `profileRectangle` / `profilePolygon` result,
  a `{ type, ... }` descriptor, or a contours / point list (same rules as
  `makeExtrude`)

**Returns:** `{ kind:'crossSection', plane, profile, contours }`

**Loud failures:** missing plane axes; non-positive sizes; < 3 polygon points;
degenerate (zero-area) profile.

**UI:** Advanced rail → **Profile** (with **Workplane**) → contour mode
(circle / rectangle / polygon / polyline). Face select feeds the plane.
Saved contours stay pickable for Extrude / Revolve / Sweep / Loft. Preview
overlays the profile on the plane while editing.

**Non-goals (wait for Product brief):** fillet-via-sweep;
extrude/revolve/loft from this value.
(Edge→sweep path is Slice 22 — see below.) A constrained contour
uses `solveContour`.

---

## Edge → sweep path (Slice 22)

Ordered **sweep path / wire** from the current edge selection (including
tangent-prop chains). Later slices consume this value to sweep a cross-section
cutter along it. This slice ships the path value only — fillet-via-sweep is
**not** started here (wait for Product brief).

```javascript
{
  kind: 'sweepPath',
  closed: false,                 // true for circular / loop selections
  points: [ [x,y,z], ... ],      // ordered polyline (closed: first ≠ last)
  length: 40,                    // total path length
  edgeCount: 3,
}
```

### Ordering

Selection is walked on the feature-edge graph (`buildEdgeVertexAdj` /
selection keys):

- **Open chain** — exactly two degree-1 endpoints; walk from an endpoint on
  the first-selected edge (stable direction).
- **Closed loop** — all vertices degree 2 (e.g. tangent-prop circular rim);
  walk from the first-selected edge.
- **Soft-fail** (toast, no broken JS): empty selection, disconnected
  components, or branched (Y/T) junctions.

### makeSweepPath(edges, opts?)

```javascript
let part = Manifold.cube([40, 30, 20], true);
const top = facesByNormal(part, [0, 0, 1])[0];
const fr = workplaneFromFace(part, top);
// Script path: pass convexEdges (or a filtered subset) — UI emits mid-matched selection.
const rim = convexEdges(part); // or selected edges from Edge pick + Tangent
const path = makeSweepPath(rim); // { kind:'sweepPath', closed, points, length, edgeCount }
// Later: sweepPoints(profile, path.points, { closed: path.closed })
return part;
```

**Parameters:**
- `edges` — array of feature edges `{ a, b, va, vb, length?, key? }` (from
  `convexEdges` / Edge pick selection)
- `opts.reverse` — optional; reverse polyline direction

**Returns:** `{ kind:'sweepPath', closed, points, length, edgeCount }`

**Edge sets.** The edges need not form one chain. Every connected chain or
loop is a component; a vertex where three or more edges meet (a box corner)
splits its component into chains that end there. One component is returned
as the plain path. Several come back as the longest component (so
`sweep` / `sweepPoints` keep a usable path) with `components` listing every
chain, `edgeCount` and `setLength` over the whole set, and `junctions`. The
box's twelve edges are twelve chains and eight junctions; four vertical
edges plus the top rim are eight chains and four junctions.
`filletAlongPath` fillets every component. Nothing is dropped: an earlier
version kept the largest piece of a broken loop and filleted that.

**Loud failures (script):** empty / unusable edges; walk failure.

**UI:** FEAT rail → **Path** → param popup (Body, Reverse). Uses current Edge
selection + Tangent chip. Viewport preview shows order/direction (green→magenta
gradient polyline, chevron arrows, start/end markers) — distinct from the
orange #20 selection halo. Auto-Run unchanged.

**Non-goals (Slice 22):** fillet-via-sweep shipped in Slice 23; extrude/revolve/loft
still wait for Product brief; Profile API changes; full sketcher; C6 soft counters.


---

## Fillet via swept cross-section (Slice 23)

Unlock fillets on **compound / curved-adjacent** edges (cases where C6
`filletEdges` throws `curved-face fillet not supported`, e.g. post-fillet seams
or when you prefer Path-driven construction) by sweeping a cutter along
`makeSweepPath` and boolean-subtracting.

### filletAlongPath(part, path, radius, opts?)

```javascript
let part = Manifold.cube([40, 30, 20], true);
// Planar–planar (unchanged):
const e = convexEdges(part).filter(/* … */);
part = filletEdges(part, e, 3, { sphericalCorners: true });

// Sweep fillet (curved-adjacent / closed rim / post-fillet seam):
const rim = /* Edge pick + Tangent → selection, or convexEdges subset */;
const path = makeSweepPath(rim); // { kind:'sweepPath', closed, points, length, edgeCount }
part = filletAlongPath(part, path, 2);           // dihedral fillet
// part = filletAlongPath(part, path, 2, { profile: 'chamfer' }); // equal-leg chamfer
return part;
```

**Parameters:**
- `part` — manifold body
- `path` — `makeSweepPath` result, `{ points, closed }`, or `points[]` (+ `opts.closed`).
  A `makeSweepPath` result with `components` (an edge set: disjoint edges,
  several loops, a pick with junctions) fillets every component: each builds
  its cutter against the untouched solid, with its own frames, then one
  n-way subtract and the set-level guards (removed volume against the summed
  expectation, scrap components, degenerate triangles). Chains meeting at a
  vertex are cut from the same solid, so the shared vertex is still there
  when the second chain is probed. A vertex where exactly three convex
  chains end at right angles gets the spherical corner patch (one face,
  `<block>.corner[k]`), built as a mesh on the chains' own end rings; any
  other junction keeps the cusp. `filletAlongPath(part,
  makeSweepPath(convexEdges(part)), r)` on a box is the fully rounded box.
- `radius` — fillet radius, or chamfer leg length (> 0)
- `opts.profile` — `'fillet'` (default) or `'chamfer'`
- `opts.segments` — arc segments for the fillet profile (default 96, the planar kernel's density)
- `opts.initialNormal` — optional. When set, keeps the legacy 90° wedge and a single start-frame RMF. Leave unset for the dihedral cutter.
- `opts.arcSamples` / `opts.extrudeSegments` — legacy RMF sweep quality only

**Path / cutter:** open chains sweep the wedge along a **linear polyline** of the
edge wire (not Catmull-Rom — spline bulge left purple scraps). Closed paths that
fit a circle use a **revolved meridian wedge** (C6-style, phase-locked to the
tessellation). **Fillet-on-fillet / path on a prior blend:** keep the full wire,
including tessellated micro rim arcs — do **not** skip those segments (skipping
left a gap instead of wrapping the prior fillet). The quarter-circle / chamfer
cutter origin is pushed into a rear exterior bumper `(−e,−e)` plus thickness-`e`
strips so the boolean consumes coincident sliver sheets **without growing the
requested blend** (realized first-quadrant extent stays at `r`). Mixed-radius /
tighter follow-on sweeps use a deeper rear pad than the original 4%·r sliver.
Disconnected cutter scraps are dropped via `decompose` when present.
Loud-fail if the kept solid is still scrap-sheet dirty.

**Dihedral cutter:** each path segment is probed from the two adjacent triangles
(in-face rays from the third vertices — not face normals, not faceID groups).
`N` lies in one face, `B = T×N` points toward the other, and the profile is built
for that interior angle θ: fillet setback `t = r/tan(θ/2)`, removed area
`r·t − ½·r²·(π−θ)` (at 90° this is `r²(1−π/4)`); chamfer area `½·c²·sin θ`
(at 90° this is `½·c²`). Segments whose θ stays within 3° share one profile and
are swept with those per-segment frames. A smooth segment that is not a convex
edge keeps the neighboring frame, so a compound chain can still sweep. A closed run that fits a circle is
revolved. `opts.initialNormal` is the only path that still uses a 90° wedge and
one start-frame RMF. The exterior bumper still keeps cutter legs off the faces;
at 90° it matches the old `(−e,−e)` pad.

### edge(part, id) / edgesBetween(part, faceA, faceB) / boundaryEdges(part)

Fillet-mode labels and Accept use these instead of tessellation keys like
`"1268-1269"`.

```javascript
let part = Manifold.cube([40, 30, 20], true);
const cat = boundaryEdges(part); // [{ id, faceA, faceB, mid, length }, ...]
const one = cat[0];
const selEdges = edgesBetween(part, one.faceA, one.faceB);
// partial chain: [id, id].flatMap((id) => edge(part, id))
const path = makeSweepPath(selEdges);
part = filletAlongPath(part, path, 2);
return part;
```

**How ids are assigned (current mesh only):**
- A **face id** is the minimum Manifold `faceID` in a coplanar connected group
  (normals within 0.1°, plane offset within 1e-3). Shown as `fN`.
- A **boundary edge id** groups triangle segments that share one unordered face
  pair and connect through vertices. One CAD edge that was tessellated collinearly
  is one id (`eN`). A curved rim, where each facet is its own face, stays many ids.
- Ids are sorted by `(min face, max face, midpoint)` so a fresh cube is stable.
- `edge(part, id)` and `edgesBetween(part, faceA, faceB)` return
  `{ key, a, b, va, vb, mid, length }` segments for `makeSweepPath`.
  `edgesBetween` throws when that pair has more than one boundary — use `edge`.

**Rematch limits:** ids are not a CAD feature tree. Manifold `faceID` is
provenance and can merge or split after a boolean, and two disconnected regions
can share one minimum faceID. `edge` / `edgesBetween` throw `re-pick edges`
when the id or pair is missing. Re-running a script from scratch is stable only
while the solid *before* the fillet is deterministic. After geometry changes,
re-pick in Fillet mode (the labels update) rather than editing a stale id.

**Loud failures (script):** bad/empty path; radius ≤ 0; cannot orient
cutter; sweep/boolean failure; ~0 volume removed (wrong orientation); near-no-op vs
expected wedge volume; empty result. Never silent wrong solid.

**Soft-fail (UI):** empty / disconnected / branched edge selection — same messages
as Path; no broken JS inserted.

### UI — Fillet Strategy

FEAT rail → **Fillet** → param popup:

| Strategy | Emits | When |
|---|---|---|
| **sweep** (default) | `makeSweepPath` + `filletAlongPath` | Universal fillet — opening Fillet without override |
| **auto** | same as **sweep** | Kept for older sheets; always resolves to sweep |
| **planar** | `filletEdges(…)` | Manual override for classic planar–planar / C6 closed-run |

**Radius slider:** defaults / max / step use the **effective** min edge length
(outliers dropped: short edges &lt;25% of median are ignored) so multi-edge /
tangent sets are not stuck near r≈0.03. The **0.45·L size guard is planar-only**
(`filletEdges` / Strategy=planar) — Strategy=sweep / `filletAlongPath`
uses path-length defaults (e.g. r≈6 on box-scale perimeters) and does **not**
clamp typed values under 0.45·L (tessellated prior-fillet rims would otherwise
pin the slider near ~0.04). Opening Fillet without override uses the sweep
slider (no 0.45·L clamp).

Sweep mode shows the Path order/direction preview (green→magenta). Auto-Run
unchanged. Keep using **Path** alone when you only need the wire value.

**Non-goals (wait for Product brief):** full industrial rolling-ball /
variable-radius fillets; Profile/Path API redesign.

## Revolve & Extrude Helpers (C8)

### makeRevolve(contours, segments = 96, degrees = 360)

Revolve a 2D profile around its **Y** axis → result axis = **Z**.
`contours` = `[[x,y]...]` outer first + optional hole contours after;
winding is **auto-normalized** (outermost CCW, holes CW) — do NOT hand-roll
`new CrossSection(...).revolve()` and fight winding yourself (wrong winding
fails silently in raw CrossSection). Profile: **x = radial distance (≥ 0),
y = height along the axis**. If a polygon crosses the Y-axis, only the
positive-X side is used (Manifold clip). `degrees` is the sweep (default
360, must be > 0 and ≤ 360). Throws a named error on an invalid profile
instead of returning a silent empty manifold.

```javascript
// revolved flange ⌀90×10 + boss ⌀30 base, 30 tall — one closed silhouette
let part = makeRevolve([ [[0,0],[45,0],[45,10],[15,10],[15,30],[0,30]] ], 96);

// hollow tube OD40 ID28 × 30: outer contour + inner (through) contour
const tube = makeRevolve([ [[0,0],[20,0],[20,30],[0,30]],
                           [[14,0],[14,30],[20,30],[20,0]] ], 64);
```

### makeExtrude(contours, height)

Extrude a 2D profile by `height` along +Z. Same contour rules as
makeRevolve (outer + optional holes, winding auto-fixed).

```javascript
const plate = makeExtrude([ [[-40,-15],[40,-15],[40,15],[-40,15]] ], 3);
```

**Contour-mode Extrude (Slice 25):** game-mode **Extrude** builds a profile on
the workplane, then Confirm emits:

```javascript
const fr = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const xs = makeCrossSection(fr, profileCircle(5, 32));
part = placeInFrame(xs.plane, makeExtrude(xs.contours, 10), [0, 0, 0]);
// when part already exists, Confirm unions instead of replacing:
// part = part.add(placeInFrame(xs.plane, makeExtrude(xs.contours, 10), [0, 0, 0]));
```

`height` is always > 0. When `part` already exists, Advanced Confirm is
additive (`part.add` of the placed solid). An empty script still uses
`let part = placeInFrame(...)`. The Extrude card labels Out / In / Both as
Direction. **In** uses `w = −height`; **Both** uses `w = −height/2`. The axis
defaults to the plane normal; a world axis is
refused unless it is parallel to that normal. Loud-fail on a bad plane,
profile, or distance.

**Contour-mode Revolve (Slice 26):** game-mode **Revolve** builds a profile on
the workplane, then Confirm emits `makeCrossSection` + `makeRevolve` placed
so the axis lies **on the profile plane** (default: along V). The profile
is remapped with identity `(u,v)→(radial,height)` in the axis/radial basis
(axis through the workplane origin). A centered circle therefore revolves
about a diameter — a sphere. Profiles that cross the axis are clipped to
+radial (`makeRevolve` / Manifold); on-axis, zero-width, and entirely
−radial profiles loud-fail.

```javascript
const fr = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const xs = makeCrossSection(fr, profileCircle(5, 32));
part = placeInFrame({
  center: xs.plane.center,
  x: xs.plane.x, y: xs.plane.normal, normal: xs.plane.y,
}, makeRevolve(xs.contours.map((ring) => ring.map(([u, v]) => [u, v])), 96, 360));
```

`angle` is always > 0 and ≤ 360 (default 360). Sense **In** starts at
`−angle`; **Both** starts at `−angle/2`. Axis defaults to plane **V**; a
world axis is refused unless it lies on the profile plane. Loud-fail on a
bad plane, profile, angle, or an on-axis / zero-width / entirely-negative
radial profile.

### makeLoft(sections, opts?) / offsetPlaneFrame(plane, offset)

Loft ≥2 `makeCrossSection` values into a solid. **Parallel planes** (same
workplane + per-profile offset along the normal, normals within about 8°)
use the polar warp. `offsetPlaneFrame(plane, offset)` copies a PlaneFrame
and translates `center` by `offset * normal`. That solid is **local** (XY =
station UV, Z along the shared normal, z=0 at the lowest station) — Confirm
places it with `placeInFrame`. **Angled planes** keep input order. Each
contour is mapped through its own frame, arc-length resampled, and
shift-aligned, then carried on a Hermite spine so a right-angle elbow does
not fold. That solid is local to the **first** profile's plane
(`placeInFrame` on that plane). The legacy `loft({ topCS, bottomCS, height })`
cup helper is unchanged.

```javascript
const fr = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };
const xs0 = makeCrossSection(fr, profileCircle(5, 32));
const xs1 = makeCrossSection(offsetPlaneFrame(fr, 20), profileCircle(8, 32));
part = placeInFrame(fr, makeLoft([xs0, xs1]));
```

**Contour-mode Loft:** game-mode **Loft** builds a multi-profile list (min 2,
default circle r=5 @ 0 and circle r=8 @ 20 on the shared workplane). Circle /
rect / polygon / polyline edit the selected profile. Each station can stay on
that plane with an offset, or pick a face, a saved workplane, or a saved
sketch's plane. Confirm emits one `makeCrossSection` per station plus
`makeLoft`, then `placeInFrame`. Offset-only stations still use
`offsetPlaneFrame`. A station with its own frame emits that frame, and the
placement frame is the first station. Second Confirm replaces the same marked
block. **Back** exits with no commit. Live preview skins the stations as
offsets, planes, or shapes change.

**Loud failures:** < 2 profiles; coincident stations (zero-length loft);
degenerate / empty contours; a turn tighter than the profiles
(self-intersection); empty result volume. Never a silent wrong solid.

`opts.align` (default true) matches cornered stations by their outermost
vertex angle (a 45° copy of the same rectangle un-rotates back to a prism).
A nearly circular station does **not** spin the other profile — that was
the off-angle circle↔rectangle default. Parallel rings and the slices
between stations follow a chordal tolerance, 0.0005 of the part's bounding
diagonal, clamped to 0.01–0.25 mm. A vertex drops only when it sits within
that tolerance of a chord and the corner turns less than 25°. A span that
is straight is one slice; a twisted span is split until the quad's twist
stays inside the same tolerance. `opts.resolution`, when set, is the
maximum polar gap `2π / N` (clamped to 8–256) and only adds samples.
Omitting it does not fall back to a uniform 128-ray table. Rectangle
corners stay in the table, so a circle's chords do not bite them. Legacy
`loft({ topCS, bottomCS, height })` is unchanged.

**Default contour plane** (no face and no saved workplane) is world **+Z**
with **X/Y** axes — the standard views. A picked face or construction
workplane still supplies the frame. Angle sliders in the contour chip rotate
that frame; Confirm uses the edited plane.

**Workplane** (Advanced) inserts a literal PlaneFrame
`{ center, normal, x, y }` — a rendered, selectable construction plane.
It does **not** create a host cube. Tapping it on an empty script leaves
the viewport empty of solids (the plane overlay remains).

**Blank run:** an empty, whitespace, or comment-only script (and a
construction-plane-only script) clears the 3D view. Undo back to a blank
buffer does not keep the previous solid. A failed non-empty script still
restores the last good mesh.

**Rules for both:**
- `contours` is an **array of contours** `[outer, hole1, ...]`; a single
  solid can be written as `[...pts]` (bare point list) — both accepted.
- Every contour needs **≥ 3 distinct points**, closed polygon (auto-closed
  if first ≠ last). Open polylines / 2-point lists throw.
- For a **hollow** part: outer contour + inner contour (through-hole).
- Invalid profile → **named throw** (never a silent empty).

---

## Example: Complex Part

```javascript
// Create a flanged tube with mounting holes

// Main tube
const mainTube = tube(15, 12, 40, 64);

// Bottom flange
const flange = Manifold.cylinder(5, 25, 25, 64);

// Mounting holes in flange
const bore = Manifold.cylinder(10, 3, 3, 32);
const holes = polarArray(bore, 4, 20, 'z');

// Combine
let part = mainTube.add(flange);
part = part.subtract(holes);

// Center and align bottom to Z=0
part = center(part, [true, true, false]);
part = align(part, { min: [undefined, undefined, 0] });

return part;
```

## Security Notes

Scripts run in an isolated Web Worker sandbox with:
- No network access (fetch, XMLHttpRequest, WebSocket blocked)
- No storage access (indexedDB, localStorage blocked)
- No worker spawning
- Memory limits enforced
- Execution timeout enforced

Imported models are available via `window.__importedManifolds['filename']`.
