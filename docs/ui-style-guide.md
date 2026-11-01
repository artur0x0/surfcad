# SurfCAD UI style guide

Scannable rules for text, color, type, and chrome. Use this file — not
ad-hoc hex, Tailwind color utilities, or a second style doc.

This file replaces `docs/POPUP_STYLE.md`. Placement and “where is this on
screen?” stay in [ui-map.md](./ui-map.md). Runtime map:
[architecture.md](./architecture.md).

## Hard rules

1. **Use the shared classes** for text color, background, and font
   (`surface-*`, `text-on-*`, `text-muted-on-*`, `font-ui`, `text-ui-*`).
   Do not put ad-hoc hex values or Tailwind color utilities
   (`text-black`, `bg-gray-900`, `text-[#16171D]`, `bg-blue-600`, …) in
   components.
2. **Never black or dark text on a dark surface.** Dark chrome, dark
   blue, and other dark brand surfaces use `text-on-dark` (or
   `text-muted-on-dark`). Light surfaces use `text-on-light` (or
   `text-muted-on-light`).
3. **Minimum contrast** is WCAG AA: **4.5:1** for body text, **3:1** for
   large text (≥18pt / 14pt bold) and icons.
4. **User-facing copy never says Microsoft Edge.** Say Chrome. Internal
   browser detection may still classify Edge; the string the user sees
   is Chrome.
5. **New color = token first, then a class.** Add a `--chrome-*` or
   `--brand-*` channel on `:root` in `src/index.css`, then a semantic
   class in `@layer components`. Do not start from a hex in a component.

The lint job runs `scripts/ci/check-ui-contrast.mjs`. It flags dark text
classes or `#000` / `#111`-style colors on the same element as a dark
brand surface. Allow a true exception with `ui-contrast-allow` on that
line or the line above.

Do not edit `src/fea/**` or `packages/surfcad-fea/**` for style.

## Colors

Tokens from [#461](https://github.com/artur0x0/surfcad/pull/461) (chrome)
and [#460](https://github.com/artur0x0/surfcad/pull/460) (brand). Do not
invent a palette.

### Chrome (CAD UI) — `#461`

| Token | RGB channels | Hex | Use |
| --- | --- | --- | --- |
| `--chrome-background` | `30 30 30` | `#1e1e1e` | App shell, viewport ground |
| `--chrome-surface` | `17 24 39` | `#111827` | Panels, menus, cards (gray-900) |
| `--chrome-text` | `243 244 246` | `#f3f4f6` | Text on dark chrome |
| `--chrome-text-secondary` | `156 163 175` | `#9ca3af` | Muted text on dark chrome |
| `--chrome-divider` / `--chrome-border` | `55 65 81` | `#374151` | Hairlines |
| `--chrome-success` | `4 120 87` | `#047857` | Allow / positive controls; `text-on-dark` ≥4.5:1 |
| `--chrome-success-hover` | `5 150 105` | `#059669` | Allow hover; `text-on-dark` ≥3:1 (icons) |

Tailwind `chrome-*` utilities (`bg-chrome-surface/80`) read those
channels. Prefer the semantic classes below in new markup.
`bg-chrome-surface` is a **dark blue-gray**. It is a dark surface.
`text-chrome-text` is the light text class. There is no
`text-chrome-text-secondary` utility — muted on dark is
`text-chrome-secondary` or `text-muted-on-dark`. A typo of
`text-chrome-text-secondary` paints default black on that blue and
fails the hard rule.

The viewport ground stays the literal `bg-[#1e1e1e]` on
`.viewport-shell` (Three.js clear is the same). Sketch status colours
are not these tokens (`src/utils/contourStatus.js`): free `#22d3ee`,
locked `#000000`, conflict `#f87171`, repeated `#fbbf24`, selected
`#ff9900`. Do not retint those.

### Brand — `#460`

| Token | RGB channels | Hex | Use |
| --- | --- | --- | --- |
| `--brand-paper` | `250 250 249` | `#FAFAF9` | Light surfaces, splash, partners |
| `--brand-ink` | `22 23 29` | `#16171D` | Text on Paper |
| `--brand-grey` | `107 110 120` | `#6B6E78` | Muted text on Paper |
| `--brand-orange` | `255 90 31` | `#FF5A1F` | Splash word “CAD” only, ≥24px |
| `--brand-navy` | `15 23 42` | `#0F172A` | Dark loading gate. Dark surface |
| `--brand-grey-on-navy` | `163 166 174` | `#A3A6AE` | Muted text on the dark loading gate |

Orange is never a status, sketch, or chrome colour.

### Semantic classes

Defined in `src/index.css`. Keep the set small.

| Class | Maps to | Pair with |
| --- | --- | --- |
| `surface-dark` | `--chrome-background` | `text-on-dark` |
| `surface-panel` | `--chrome-surface` | `text-on-dark` |
| `surface-light` | `--brand-paper` | `text-on-light` |
| `surface-splash-dark` | `--brand-navy` | `text-on-dark` / `text-muted-on-splash-dark`. Dark surface |
| `text-on-dark` | `--chrome-text` | dark surfaces |
| `text-on-light` | `--brand-ink` | light surfaces |
| `text-muted-on-dark` | `--chrome-text-secondary` | dark surfaces |
| `text-muted-on-light` | `--brand-grey` | light surfaces |
| `text-muted-on-splash-dark` | `--brand-grey-on-navy` | dark loading gate |
| `font-ui` | system UI stack | every chrome surface |
| `surface-success` | `--chrome-success` (hover `--chrome-success-hover`) | `text-on-dark`; Allow / positive icon buttons |
| `text-success` | `--chrome-success` (hover `--chrome-success-hover`) | outline Send / camera-on on a dark glass card |
| `surface-quiet` | `--chrome-border` (hover `--chrome-background`) | `text-on-dark`; Deny / secondary icon buttons |
| `tool-toggle` | idle rail toggle: Tailwind `text-blue-600`, hover `bg-gray-100`, active `bg-blue-100` | light right rail. Blue icon. Not a dark surface |
| `tool-toggle-on` | enabled rail toggle: Tailwind `text-green-600` on `bg-green-100` | add with `tool-toggle`. Light green wash, green icon |

Existing frosted overlays (do not replace these with a flat slab):

| Class | Role |
| --- | --- |
| `surface-glass` | Panels and modal sheets over the 3D view (`chrome-surface` @ 82%) |
| `surface-glass-chip` | Small viewport overlays — frost only; supply your own tint |
| `surface-scrim` | Modal backdrop. The border box stays out of `--safe-area-top` / `--safe-area-bottom` (`.modal-fit` insets its own box; a scrim inside it fills that box). Those insets are 0 while Safari's toolbars are showing. Safari 26 tints its status bar and toolbar from a fixed or sticky box about 4px in from the viewport edge, and a `backdrop-filter` on that hit replaces the tint (`--safari-edge-sample`, `golden:mobile-chrome-shade`). The element has no blur. An opaque `--chrome-background` band (`--scrim-band-top` / `--scrim-band-bottom`, 8px unless the safe area is already larger) covers that line; the dim and the blur are a `::before` that starts inside the band. The middle of the element stays transparent so the frost is the page, not a slab. `html` and `body` both use `--chrome-background`. |

They share `--surface-blur`. `@supports not (backdrop-filter)` goes more
opaque so text stays legible. Never put a flat `bg-chrome-surface` /
`bg-[#1e1e1e]` slab over the viewport. Exception: native `<select>` /
`<option>` — the OS list is unreadable when translucent. Exception: the
assembly-open overlay (`AssemblyOpenSpinner`) is an opaque `surface-dark`
panel, the same ground as the viewport, with `text-on-dark`. It does not
use `surface-scrim`, and it does not show the assembly that was already
on screen.

Mode-chip **accents** (cyan contour, amber fillet) stay the spelled-out
`ACCENTS` map in `src/components/controls/popupUI.jsx`. Tailwind purges
computed class names — extend that map, never interpolate. Those tints
are not body text on dark chrome.

### How to add a color

1. Add `--name: R G B;` on `:root` in `src/index.css` (comment the hex).
2. Add one semantic class that uses `rgb(var(--name))`.
3. Use the class. Do not add a one-off hex or a new Tailwind color
   utility in a component.
4. If the class is a dark surface, say so in this table and pair it
   with `text-on-dark`.

## Type

**Stack** (`.font-ui`): `ui-sans-serif, system-ui, -apple-system,
"Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`.
The wordmark is outlined Inter Tight 700 paths — no webfont load.

**Size scale**

| Class | Size | Use |
| --- | --- | --- |
| `text-ui-xs` | 11px | captions, chips, pairing hints |
| `text-ui-sm` | 12px | secondary / `text-xs` chrome |
| `text-ui` | 14px | body |
| `text-ui-lg` | 16px | titles; **number and select fields** (iOS will not zoom) |
| `text-ui-code` | 32px | server-relay join code |

Popup type (`POPUP_TEXT` in `popupUI.jsx`): title `text-sm font-semibold`,
subtitle `text-xs`, caption `text-[11px] font-semibold uppercase
tracking-wide`, value `text-[13px]`, note `text-xs`. Prefer those
tokens inside feature popups. Parts inputs use
`PARTS_TEXT_INPUT_*` (≥16px).

`formatDisplayNumber` (`src/utils/displayUnit.js`) is the one formatter
for calculated numbers: at most four decimals, trailing zeros removed.
Displaying a field does not rewrite the script.

## Feature strip height

The horizontal CAD feature ribbon (`FeatureStrip` under the viewer title on
desktop, under the CAD header on mobile) is **46px** in every state:
part features and empty (undo/redo only). Token
`--feature-strip-height: 2.875rem` on `:root`; class `feature-strip-bar` on
the strip root. Chips share `feature-strip-chip` (32px). Do not set a
per-state height. Switching part ↔ empty must not jump the bar
or shift the viewport.

The per-part joints row (`JointsRow`) is a second `feature-strip-bar` of the
same 46px directly under the ribbon, with no top border, so the two read as
one block with one hairline between them. Its chips are the same 32px
`feature-strip-chip` box with the type glyph and `text-ui-xs` text
(`Type · Other part`). Failed chips use `border-2 border-red-400` and
`feature-failed-ring` plus a red warning glyph, never colour alone. The
pane that mounts the row sets `data-joints-row-open`, which turns
`--joint-row-height` (0 by default) into the ribbon height; rails and the
script drawer add that token to their clearance.

On a phone the ribbon's top is `--feature-strip-offset-mobile`: the header's
`top-4`, two title pills, `--viewer-title-stack-gap` twice (once between
the pills, once under the assembly pill), plus `--rollback-mark-height`
(0.5rem, the rollback bar's triangle, `ROLLBACK_MARK` in `FeatureStrip.jsx`)
so the mark stands in that gap and never touches the assembly pill. Desktop
stays `--feature-strip-offset-desktop` (`top-14`).

Leave **10px** (`--feature-strip-rail-gap`) between the ribbon bottom (or
the joints row bottom when that row is mounted) and the
top of the left helper rail and the right view rail. Desktop full-length
left rail: class `rail-full-below-strip`. Mobile content-max left rail:
`rail-max-below-strip`. Right rail: `rail-right-below-strip` (same 10px
clearance, no 26rem cap). Rails keep a 10px bottom inset so they do not
overflow the pane. On a phone both rails are bottom-anchored and the left
rail takes the right rail's height as its minimum (`useLeftRailFit`), so
the two start on the same line; a left rail with more content than that
height scrolls inside it.

The Parts-header git branch chip (`data-parts-ribbon-branch`, class
`parts-branch-chip`) is a 1px `currentColor` outline, `rounded-lg`, on
`chrome-surface`. Text and border use the same `text-blue-400` as the Parts
header icons (`STRIP_ICON_BLUE`).

## Brand

- CAD header (`data-viewer-header-row`): paper-tile mark
  (`data-brand-mark="paper"`) + 16px Paper wordmark on a transparent
  lockup (`data-brand-header`, `data-brand-wordmark`), then a muted
  lowercase beta tag (`data-brand-beta`, `brand-beta`, `text-ui-xs`,
  `text-muted-on-dark`). The tag is `aria-hidden` and takes no pointer
  events, so the logo button still opens About. Surf and CAD are both
  Paper, **not orange**. Placement (rail inset, title pills) is
  [ui-map.md](./ui-map.md).
- `src/assets/brand/wordmark-ink.svg` is Ink-on-light.
- Orange (`#FF5A1F`) is only the splash word “CAD”, and only at 24px or
  taller. Loading gate (`data-app-loading`): wall-clock theme from
  `loadingThemeForHour` (dark 19:00–06:59 local, light 07:00–18:59),
  decided before first paint (`public/loading-theme.js`). Light: Paper
  surface, ink-tile mark, 40px `splash` wordmark, Grey tagline. Dark:
  `surface-splash-dark`, paper-tile mark, 40px `splash-dark` wordmark
  (Surf Paper, CAD orange), `text-muted-on-splash-dark`. No Privacy
  choices link on this gate.
- Parts and Script stages omit the brand. Favicon and PWA icons are the
  paper tile. `/partners` is Paper; orange only on splash CAD at 32px.
- `golden:brand-identity` checks the header at 360, 390, and 1280.

## Surfaces over the 3D view

Everything over the viewport is translucent glass (see classes above).
Rails may still use the light frost `bg-white/60 backdrop-blur-sm` —
that is a light surface; pair it with dark text (`text-on-light`).
Icon toggles on that rail do not use `text-on-light`. They use
`tool-toggle` (see below). Do not copy the frost idiom onto dark chrome.

## Right-rail tool toggles

A toggle tool button on the light right rail is blue when idle and green
when enabled. Cross section (`data-cross-section-toggle`, the
`FlipHorizontal` button) is the reference. It must keep this look.

Use `toolToggleClass(on)` from `src/components/toolToggle.js`. That sets
`tool-toggle`, and adds `tool-toggle-on` while the tool is on. Idle is a
blue icon with no fill. Enabled is a green icon on a light green wash.
Hover and press match Cross section: gray wash on hover, blue wash when
pressed, in both states.

Those classes name the utilities Cross section already used
(`text-blue-600`, `text-green-600`, `bg-green-100`, `hover:bg-gray-100`,
`active:bg-blue-100`). Do not add a colour token for this, and do not put
those utilities on the button yourself. `surface-success` is the solid
dark green Allow control. It is not a rail toggle. The wash is a light
surface, so the button does not take `text-on-dark` or `text-on-light`.

Mold draft swatches are `mold-draft-swatch-above`, `mold-draft-swatch-below`, and `mold-draft-swatch-negative` (`--mold-draft-above`, `--mold-draft-below`, `--mold-draft-negative`, `--mold-draft-hatch`). Positive draft is one blue ramp. Negative draft is an orange hatch, so a back-draft does not depend on red versus green.

Wall thickness, core and cavity, mold draft, and the report
are not a column on that rail. Side actions are part of core and cavity,
not their own flyout button. Those tools sit in the Molding
tools flyout (`data-mold-tools-popup`), opened by `data-mold-tools-toggle`.
Each tool calls `toolToggleClass(on)`. The trigger calls it while the
flyout is open or any of those tools is on. The flyout is the view-snap
pattern: one horizontal row, `w-max flex-nowrap`, to the left of the trigger.
The row uses `gap-1`. View snap uses `gap-2`; that wider gap lets the icons
cross the left rail on a 390px phone. A press on one of those tools closes the
flyout, then opens or toggles its pane. At 768px and under that pane is
`mold-analysis-pane`: a vertical scroller capped to the visible viewport
(`100dvh` or `visualViewport`), clear of the safe areas and the
home-indicator pill. The scroll stays in the pane. Every molding result is a section of
that one pane (`data-mold-results-pane`), a feature-sheet card between
the rails. Desktop keeps the feature-sheet card height cap.

## Popups

Mobile-first pattern for short-lived **mode chips** that sit over the 3D
viewport while the user picks geometry and tweaks params. Prefer this
shell over inventing a new modal layout.
`src/components/controls/popupUI.jsx` is the one type scale, field set,
and accent map. **Every number renders a slider AND a typed box**:
`NumberField` never gives you one without the other. Do not hand-roll
`<input type="range">`.

### References

- **`ContourModeChip.jsx`** — cyan glass card; plane editor + profile / Extrude /
  Revolve / **Loft** / Sweep / **Workplane** sections. Dimension, Arc, and
  Constraints use `StickyPickApply` on the same feature card
  (`data-contour-card`). Confirm writes the dimension, the corner, or the
  constraint and stays in contour mode. X drops the pick and writes nothing.
  A placed dimension is a floating tag. A placed constraint is a floating
  icon (`data-contour-icon`). The tag layer is portaled onto the document
  (`data-contour-tags`) so it stays visible on desktop and iPhone Safari.
  A point-to-point distance keeps the first point and moves the second.
  The tag is on the geometry while that value is typed, and after Confirm.
  Tap either for Delete and X. It does not reopen
  the card. A conflict note (`data-contour-conflict`) names the primary id on
  the open card and on the contour chip, in red. Repeated shows the word
  Repeated in amber (`data-contour-repeated`) and is not red. Free sketch
  geometry stays blue and draggable. Locked geometry is black and does not
  drag. The key is `data-contour-status-legend`. Reopening the feature shows
  that saved contour on the chip. A named dimension's tag leads with the name. The card title is the
  feature Confirm writes (Extrude, Revolve, Loft, Sweep, Workplane); the profile
  shape sits in the subtitle. A profile-only contour titles the plane card
  Contour. Loft (#94) and Workplane use the compact mobile
  max-height + internal scroll described below.
- **`FilletModeChip.jsx`** — the shared feature card (`FeatureSheet`); edge-pick
  Tangent / Clear / Undo, cyan Confirm, grey X dismiss. No hard-edge warning.
  Chamfer uses this chip. It passes `fullLeft` on phone and desktop, and so do
  shell, draft, move face, delete face, cut, move, rotate, mirror, boolean, and paint.
  `fullLeft` means the measure does not wait for a left rail. On desktop the
  left edge follows a rail that is mounted (10px to its right) and is 10px from
  the pane when that rail is hidden, which is the usual case for these chips.
  On a phone `fullLeft` ignores a left rail and pins the left edge to the 10px
  pane inset. The right edge stays clear of the right rail. The sheet metal
  picker and feature edit do not pass `fullLeft`. On desktop they sit 10px to
  the right of the mounted left rail. On a phone they stay centered between
  both rails.
- **`sheetMetal/SmControls.jsx`** — `SmPopup` is the shared feature card
  (`FeatureSheet`) for Sheet Metal: picker, plane and edit chip, base, bend,
  tab, hole, countersink, tapped, and Check. X and Esc write nothing.
  Confirm is a 44px button and saves that step. The mm|in toggle is in the
  header. The DFM list scrolls in the body. ≥16px number / select fields
  (`PARTS_TEXT_INPUT_*`). Hidden in game.
- **`ShellModeChip.jsx`** — the shared feature card (`FeatureSheet`); face-pick
  opening + Wall `NumberField` + Face/Closed segmented control. Taps add faces
  with no modifier (tap a selected face to remove it, same as the edge picker).
  Undo drops the last face; Clear drops all. Confirm writes one `hollow()`;
  X exits with no write. Hidden in game.
- **`DraftModeChip.jsx`** — the shared feature card (`FeatureSheet`); first tap
  is the neutral face (its normal is the pull), Flip reverses that normal,
  later taps are the faces to draft (tap again to remove). Undo drops only
  the last drafted face; Clear drops drafted faces and keeps the neutral.
  One angle, default 2°. Confirm writes one `draftFaces()`; X exits
  with no write. No shift-click. Hidden in game.
- **`CutModeChip.jsx`** — the shared feature card (`FeatureSheet`). The plane is a
  planar face or an explicit XY / YZ / ZX plane. Offset is along that normal
  for both. A face is written as `{ center, normal }`, plus `offset` when it
  is not 0 — not a world-axis name. Bodies use the Shell sticky picker: tap
  to add, tap again to remove, Undo drops the last pick, Clear drops that
  list. Pieces shows each resulting body in its own slightly translucent
  color; tap hides that piece, tap again brings it back, Undo drops the last
  hide, Clear unhides every piece and keeps the plane. No shift-click.
  Confirm writes one `cut()`; X exits with no write. Hidden in game.
- **`BooleanModeChip.jsx`** — the shared feature card (`FeatureSheet`). Union,
  Difference, or Intersect. Bodies use the Shell sticky picker: the first tap
  is the target, later taps are tools, tap again removes. Intersect opens
  Pieces: tap hides a leftover, tap again brings it back (the hidden piece
  stays in the scene at opacity 0 so it still hits). Undo and Clear follow
  Cut. No shift-click. Picks may span parts: the first tap is still the
  target and Confirm writes that target's part (it is loaded into the editor
  first). A tool on another part shows a yellow-edged line on the chip
  (`data-boolean-cross-part="1"`) and is copied into the target at Confirm.
  Confirm writes one `booleanBodies()` and replaces a previous Boolean
  block; X exits with no write. Undo drops the latest pick on any part.
  The card is not a scrim (`z-20` on `FeatureSheet`, `pointer-events-auto` on the card only).
  The cross-section panel stays at `z-40`, so section stays usable while
  picking. Hiding a part in the part manager does not clear that part's picks.
  `data-boolean-allow-section` and `data-boolean-survives-parts` mark that contract.
  Hidden in game.
- **Contour Add / Subtract** — Extrude, Revolve, Sweep, and Loft (not Profile
  or Workplane) show Add and Subtract on `ContourModeChip` (`data-contour-combine`).
  Block solids (cube, rounded box, cylinder, sphere, tube, hex prism) use the same Mode select on the helper card. Default is Add. The card also has Pos X Y Z and Rot X Y Z (degrees). While it is open the viewport shows that Manifold solid with the CAD flat normal shading, and edits update it live. Subtract draws the cutter translucent, in front of the host. Confirm writes size, pose, and Add or Subtract. Cancel and the grey X clear the preview and write nothing. An identity pose is left off the script.
- **`HelperParamModal.jsx`** — CAD uses the shared feature card for cube, round box, cylinder, sphere, tube, hex, hole, center, align, array, path, and refuse. The rail Mirror button opens `MirrorModeChip` instead. Fields stay in the body. Delete stays in the note when a feature edit is open. X and Esc write nothing. Confirm saves and closes. Refuse's footer says OK and writes nothing. There is no swipe and no click-outside. Game keeps the previous bottom-centre sheet: click-through, no scrim, no card, no slide.
- **`FeatureEditSheet.jsx`** — the fallback editor and the feature picker, on the shared feature card. Edit script stays in the body. Delete stays in the note. X and Esc write nothing. Confirm saves and closes. A stub kind has no Confirm. The picker has no Confirm. There is no swipe. Game mounts no card.
- **`JointCard.jsx`** — the create card is `StickyPickApply` (`data-sticky-pick-apply` and `data-joint-card`), `fullLeft` off. On desktop the left edge is 10px to the right of the mounted left rail. On a phone the card stays centered between the rails. Title Joint. Subtitle `Shaft · face  →  Housing · face`, with `×2` when a part has two faces. Body: name, the type property (`coincident`, `concentric`, `distance`, `angle`, `symmetric`, `fixed`, with Parallel and Perpendicular in that same group). Parallel and Perpendicular are not stored types; one tap writes an angle joint at 0° or 90°. a distance or angle field when that type needs one, Flip when the type has a sense, and Ground after one pick. A third part opens `Change one of the parts?` (`data-joint-part-change`) with Discard last pick, Replace part 1, and Replace part 2. The note names the suggested type. Footer Add. Add writes the joint, clears the picks, and leaves the card open. A chip tap reopens that joint here (`mode` edit) with the same picks, type, and value. Edit mode has no Add button: Confirm saves and closes, and the red Delete (`data-joint-delete`, feature-sheet danger style) sits opposite Confirm. X writes nothing. Create mode still says Add. `data-joint-card` carries `data-joint-id` and `data-joint-type`. Distance uses the global display unit; the file stays millimetres. Angles stay degrees. X and Esc write nothing and close the card. Game mounts no card.
- **Joints row chip** (`JointsRow.jsx`) — there is no floating joint tag and no joint chip on the feature strip. A chip tap reopens that joint in `JointCard` (picks highlighted, type, value, red Delete, Confirm, and X) and keeps the part selected. A broken or conflict chip uses `border-2 border-red-400` and `feature-failed-ring` with a red `triangle-alert` glyph. Contour dimension and constraint tags stay. Game mode and a feature session mount no joints row.
- **`MoveModeChip.jsx`** — the shared feature card (`FeatureSheet`). Double-click
  selects the body (one click still selects the full face and does not change
  the target). XYZ are `NumberField` deltas, slider and type-in. Cut (when the
  previous operation is a cut) and Face (a picked face) take one distance along
  that normal. The body is previewed at the new translation until Confirm. No
  viewport arrows. Confirm writes one `move()` and replaces a previous Move
  block; X exits with no write. Hidden in game.
- **`RotateModeChip.jsx`** — the shared feature card (`FeatureSheet`). Double-click
  selects the body (one click keeps the face and offers its normal as the Face
  axis). Axis is X, Y, Z, Face, or a typed Vector; Angle is a `NumberField` in
  degrees; Center is Body center (the body's own centroid) or a typed Point. The
  body is previewed at the new turn until Confirm. No viewport gizmo. Confirm
  writes one `rotateAbout()` and replaces a previous Rotate block; X exits with
  no write. Hidden in game.
- **`MirrorModeChip.jsx`** — the shared feature card (`FeatureSheet`). It passes
  `fullLeft`, same as Move. The left helper rail is hidden, so on desktop the
  left edge is 10px from the pane. On a phone `fullLeft` pins the left edge to
  that inset. Double-click selects the body (one click keeps the face and offers
  it as the mirror plane). The plane is XY, YZ, ZX, that face, or a user
  workplane. The copy is previewed until Confirm. Confirm writes one `mirror()`
  and replaces a previous Mirror block; X exits with no write. A refused confirm
  stays on the card and toasts the reason. Hidden in game.
- **`MoveFaceModeChip.jsx`** — the shared feature card (`FeatureSheet`). Tap adds a
  face, tap again removes it. Undo drops the last face. Clear drops the faces.
  Distance is along each face normal. Flip reverses that normal. No shift-click.
  A double click does not select the body. Confirm writes one `moveFace()` and
  replaces a previous Move Face block; X exits with no write. Live preview
  while the distance changes. This is not the body `move()` helper. Hidden in game.
- **`FeaStudyChip.jsx` / `FeaStudySheet.jsx`** — the shared feature card (`FeatureSheet`)
  on phone and desktop. Both pass `fullLeft`. The left tool rail is hidden, so on
  desktop the left edge is 10px from the pane. On a phone `fullLeft` pins the
  left edge to that inset. The right edge stays clear of the right rail.
  Material, Fix / Force / Pressure, and the load list stay in the body during setup. After a solve, the legend,
  the Stress / Displacement tabs, and Stage times scroll in the body. The footer is Run, or Back to Setup
  after a solve. It does not say Confirm. X and Esc close Analyze. Hidden in game.
- **`PaintModeChip.jsx`** — the shared feature card (`FeatureSheet`) with `fullLeft` on phone and desktop. The left helper rail is hidden, so on desktop the left edge is 10px from the pane. On a phone `fullLeft` pins the left edge to that inset. The right edge stays clear of the right rail. Eight swatches,
  a custom hex, Part, Undo, and Clear stay in the body. The color preview
  stays in the note. A tap paints the face immediately. Confirm writes the
  session and closes. X and Esc write nothing. There is no swipe. Hidden in game.
- **`DeleteFaceModeChip.jsx`** — the shared feature card (`FeatureSheet`). Tap adds a
  face, tap again removes it. The tap does not run `deleteFace`. Undo drops the
  last face. Clear drops the faces. No shift-click. A double click does not
  select the body. Confirm writes one `deleteFace()` for every picked face and
  replaces a previous Delete Face block; X exits with no write. A heal
  that cannot stay a closed solid throws when Confirm runs the script, not on
  the tap. Hidden in game.

### Error toasts

Errors use this same glass card. They are not a blue rounded pill.

- **`ErrorPopup.jsx`** — `rounded-lg`, `surface-glass-chip`, and a tinted border
  (`border-red-400/70`, `border-amber-400/70`, or `border-cyan-400/70`).
- Undo stays on the card when there is history to pop.
- Notice toasts (repo saved, upload notice) are the same
  card at one width: wrapper `w-[calc(100%-1.5rem)] max-w-md`, card
  `px-4 py-2`. They never shrink to the text.
- Soft-fail toasts are portaled at `fixed top-16 left-1/2 z-50` so they sit
  above the feature strip and the left rail.
- The execution-error toast is one card for every message: `fixed top-16
  inset-x-3 z-50` (most of the viewport width, the same card on desktop). It
  does not shrink to the text. The first line is the word `Error`, left
  justified, with Undo and the dismiss X right justified and a wider gap
  between those two controls. The description is the second line.

### Placement

| Context | Classes (chip root) |
| --- | --- |
| Desktop | measured `left` and `width` from `measureFeatureSheetWidth`. The left edge is 10px to the right of the mounted `[data-rail-pair="left"]` box, or `left-[10px]` from the pane when that rail is not mounted. Width is `min(22rem, space before the right rail minus 10px)`. Before the first measure the fallback is `left-[10px] w-[min(22rem,calc(100%-9.5rem))]` |
| Mobile (`compact`) | still centered in the gap between the rails. A gap under 22rem fills that gap, so the left edge is 10px right of the left rail. `fullLeft` pins the left edge to the 10px pane inset and ignores a left rail. Before the first measure the fallback stays `left-1/2 w-[min(22rem,calc(100%-9.5rem))] -translate-x-1/2` |

Bottom corners belong to the helper / cross-section rails (`ui-map.md`).

Contour, Fillet, Chamfer, the standalone edge card, Shell, Draft, Move Face,
Delete Face, Cut, Boolean, Move, Rotate, Mirror, Paint, and Analyze share the feature card.
On desktop the left edge is 10px to the right of the mounted left rail, or 10px
from the pane when that rail is hidden. On a phone the card stays in the gap
between the rails. Analyze's footer is Run or Back to Setup.
Boolean stays `z-20`, under the section rail.

### Popup chrome

- Tint + frost: `bg-cyan-950/80` (contour) or `bg-amber-950/80` (fillet) **plus**
  `surface-glass-chip` (frost only — supply your own tint).
- Border: `border border-cyan-400/70` / `border-amber-400/70`.
- Type: `text-xs` / `text-[13px]` controls; title in accent (`text-cyan-200`).
- z-index: `z-20` (with other overlays; see `ui-map.md` ladder).
- Text on those dark tints is the light accent (`text-cyan-100`,
  `text-on-dark`), never `text-black` / `text-gray-900`.

### Mobile height + scroll

Keep the chip **below the feature strip** and leave finger clearance to pick
faces/edges in the viewport:

- Cap height: `max-h-[calc(100dvh-12rem)]` on the chip root (or scroll region).
- Put the long body in an inner `overflow-y-auto rail-scroll` region
  (`data-contour-chip-scroll` on Contour). Keep title + Confirm / Accept
  **outside** the scroll so actions stay visible.
- Prefer `flex flex-col min-h-0` on the root so the scroll child can shrink.
- A list whose rows end in an action column (trash, order, edit icons) adds
  `list-scroll` next to `rail-scroll`: `scrollbar-gutter: stable` reserves the
  8 px bar's width so it never lands on the icons.

### Controls

- Numbers: **`NumberField`** from `src/components/controls/popupUI.jsx` — slider
  **and** typed box, one accent (`cyan` / `amber` / `slate`). Do not hand-roll
  `<input type="range">`.
- Segmented presets (X / Y / Z / Face, Out / In / Both): small rounded buttons
  with `aria-pressed`, active = filled accent, idle = `bg-*-950/80` border.
- Selects: opaque `bg-*-950/80` (native option lists are not translucent).
- Primary action: accent **Confirm** / **Accept** with lucide `Check`.
- Cancel: grey lucide **X** on the left rail (`ContourModeRail`) and/or chip
  corner (`FilletModeChip` `onDismiss`). Cancel must exit **without** writing
  script.

### Behaviour contract

1. Enter mode from the left rail (do not dump a one-shot insert when an
   interactive chip exists).
2. Live preview in the viewport (workplane overlay, profile ghost, blend
   preview, …).
3. Confirm writes / updates the marked feature block and exits.
4. Grey X / Back dismisses with no write.

When adding a new tool, reuse this shell and `popupUI` rather than a slightly
different card. Game mounts no card.

## Agents

Cloud and repo agents follow this file. Do not add a second style guide.
`AGENTS.md`, `.cursor/rules/ui-style.mdc`, and `docs/agent/SKILL.md` point
here.
