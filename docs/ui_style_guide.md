# SurfCAD UI style guide

Scannable rules for text, color, type, and chrome. Use this file — not
ad-hoc hex, Tailwind color utilities, or a second style doc.

This file replaces `docs/POPUP_STYLE.md`. Placement and “where is this on
screen?” stay in [UI_MAP.md](./UI_MAP.md). Runtime map:
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

Orange is never a status, sketch, or chrome colour.

### Semantic classes

Defined in `src/index.css`. Keep the set small.

| Class | Maps to | Pair with |
| --- | --- | --- |
| `surface-dark` | `--chrome-background` | `text-on-dark` |
| `surface-panel` | `--chrome-surface` | `text-on-dark` |
| `surface-light` | `--brand-paper` | `text-on-light` |
| `text-on-dark` | `--chrome-text` | dark surfaces |
| `text-on-light` | `--brand-ink` | light surfaces |
| `text-muted-on-dark` | `--chrome-text-secondary` | dark surfaces |
| `text-muted-on-light` | `--brand-grey` | light surfaces |
| `font-ui` | system UI stack | every chrome surface |
| `surface-success` | `--chrome-success` (hover `--chrome-success-hover`) | `text-on-dark`; Allow / positive icon buttons |
| `surface-quiet` | `--chrome-border` (hover `--chrome-background`) | `text-on-dark`; Deny / secondary icon buttons |

Existing frosted overlays (do not replace these with a flat slab):

| Class | Role |
| --- | --- |
| `surface-glass` | Panels and modal sheets over the 3D view (`chrome-surface` @ 82%) |
| `surface-glass-chip` | Small viewport overlays — frost only; supply your own tint |
| `surface-scrim` | Modal backdrop |

They share `--surface-blur`. `@supports not (backdrop-filter)` goes more
opaque so text stays legible. Never put a flat `bg-chrome-surface` /
`bg-[#1e1e1e]` slab over the viewport. Exception: native `<select>` /
`<option>` — the OS list is unreadable when translucent.

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

Popup type (`POPUP_TEXT` in `popupUI.jsx`): title `text-sm font-semibold`,
subtitle `text-xs`, caption `text-[11px] font-semibold uppercase
tracking-wide`, value `text-[13px]`, note `text-xs`. Prefer those
tokens inside feature popups. Parts inputs use
`PARTS_TEXT_INPUT_*` (≥16px).

`formatDisplayNumber` (`src/utils/displayUnit.js`) is the one formatter
for calculated numbers: at most four decimals, trailing zeros removed.
Displaying a field does not rewrite the script.

## Copy

- Product name is SurfCAD. Tagline: “Don't do CAD. SurfCAD.”
- User-facing text says **Chrome**, never Microsoft Edge (or “Edge”).
- Errors use the glass card in [Popups](#popups), not a blue pill.

## Brand

- CAD header (`data-viewer-header-row`): paper-tile mark
  (`data-brand-mark="paper"`) + 16px Paper wordmark on a transparent
  lockup (`data-brand-header`, `data-brand-wordmark`). Surf and CAD are
  both Paper, **not orange**. Placement (rail inset, title pills) is
  [UI_MAP.md](./UI_MAP.md).
- `src/assets/brand/wordmark-ink.svg` is Ink-on-light.
- Orange (`#FF5A1F`) is only the splash word “CAD”, and only at 24px or
  taller on Paper. Loading gate (`data-app-loading`): Paper surface,
  ink-tile mark, 40px splash wordmark, tagline and status in Grey.
- Parts and Script stages omit the brand. Favicon and PWA icons are the
  paper tile. `/partners` is Paper; orange only on splash CAD at 32px.
- `golden:brand-identity` checks the header at 390 and 1280.

## Surfaces over the 3D view

Everything over the viewport is translucent glass (see classes above).
Rails may still use the light frost `bg-white/60 backdrop-blur-sm` —
that is a light surface; pair it with dark text (`text-on-light`).
Do not copy that idiom onto dark chrome.

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
  shell, draft, move face, delete face, cut, move, boolean, and paint: the left
  helper rail is hidden, so the left edge is 10px from the pane and the right
  edge stays clear of the right rail. The sheet metal picker and feature edit
  stay centered between both rails.
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
- **`HelperParamModal.jsx`** — CAD uses the shared feature card for cube, round box, cylinder, sphere, tube, hex, hole, mirror, center, align, array, path, and refuse. Fields stay in the body. Delete stays in the note when a feature edit is open. X and Esc write nothing. Confirm saves and closes. Refuse's footer says OK and writes nothing. There is no swipe and no click-outside. Game keeps the previous bottom-centre sheet: click-through, no scrim, no card, no slide.
- **`FeatureEditSheet.jsx`** — the fallback editor and the feature picker, on the shared feature card. Edit script stays in the body. Delete stays in the note. X and Esc write nothing. Confirm saves and closes. A stub kind has no Confirm. The picker has no Confirm. There is no swipe. Game mounts no card.
- **`JointCard.jsx`** — the create card is `StickyPickApply` (`data-sticky-pick-apply` and `data-joint-card`), `fullLeft` off, between the rails. Title Joint. Subtitle `Shaft · face  →  Housing · face`, with `×2` when a part has two faces. Body: name, the type property (`coincident`, `concentric`, `distance`, `angle`, `symmetric`, `fixed`, with Parallel and Perpendicular in that same group). Parallel and Perpendicular are not stored types; one tap writes an angle joint at 0° or 90°. a distance or angle field when that type needs one, Flip when the type has a sense, and Ground after one pick. A third part opens `Change one of the parts?` (`data-joint-part-change`) with Discard last pick, Replace part 1, and Replace part 2. The note names the suggested type. Footer Add. Add writes the joint, clears the picks, and leaves the card open. A chip tap reopens that joint here (`mode` edit) with the same picks, type, and value. Edit mode has no Add button: Confirm saves and closes, and the red Delete (`data-joint-delete`, feature-sheet danger style) sits opposite Confirm. X writes nothing. Create mode still says Add. `data-joint-card` carries `data-joint-id` and `data-joint-type`. Distance uses the global display unit; the file stays millimetres. Angles stay degrees. X and Esc write nothing and close the card. Game mounts no card.
- **Feature strip joint chip** — there is no floating joint tag. A chip tap reopens that joint in `JointCard` (picks highlighted, type, value, red Delete, Confirm, and X). A broken or conflict chip uses `border-2 border-red-400` and `feature-failed-ring`. Contour dimension and constraint tags stay. Game mode and a feature session mount no joint chips.
- **`MoveModeChip.jsx`** — the shared feature card (`FeatureSheet`). Double-click
  selects the body (one click still selects the full face and does not change
  the target). XYZ are `NumberField` deltas, slider and type-in. Cut (when the
  previous operation is a cut) and Face (a picked face) take one distance along
  that normal. The body is previewed at the new translation until Confirm. No
  viewport arrows. Confirm writes one `move()` and replaces a previous Move
  block; X exits with no write. Hidden in game.
- **`MoveFaceModeChip.jsx`** — the shared feature card (`FeatureSheet`). Tap adds a
  face, tap again removes it. Undo drops the last face. Clear drops the faces.
  Distance is along each face normal. Flip reverses that normal. No shift-click.
  A double click does not select the body. Confirm writes one `moveFace()` and
  replaces a previous Move Face block; X exits with no write. Live preview
  while the distance changes. This is not the body `move()` helper. Hidden in game.
- **`FeaStudyChip.jsx` / `FeaStudySheet.jsx`** — the shared feature card (`FeatureSheet`)
  on phone and desktop. Both pass `fullLeft`: the left tool rail is hidden, so the
  left edge is 10px from the pane and the right edge stays clear of the right rail.
  Material, Fix / Force / Pressure, and the load list stay in the body during setup. After a solve, the legend,
  the Stress / Displacement tabs, and Stage times scroll in the body. The footer is Run, or Back to Setup
  after a solve. It does not say Confirm. X and Esc close Analyze. Hidden in game.
- **`PaintModeChip.jsx`** — the shared feature card (`FeatureSheet`) with `fullLeft` on phone and desktop: the left helper rail is hidden, so the left edge is 10px from the pane and the right edge stays clear of the right rail. Eight swatches,
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
| Desktop | `absolute bottom-2.5 left-1/2 -translate-x-1/2 max-w-[16rem]` (Loft / Sweep / Workplane may use `max-w-[18rem]`) |
| Mobile (`compact`) | `bottom-14 left-1/2 -translate-x-1/2 max-w-[min(16rem,calc(100%-9rem))]` — raised above the home-indicator stage pill; leave room for left/right rails |

Bottom-**centre** is reserved for mode chips. Bottom corners belong to the
helper / cross-section rails (`UI_MAP.md`).

Contour, Fillet, Chamfer, the standalone edge card, Shell, Draft, Move Face,
Delete Face, Cut, Boolean, Move, Paint, and Analyze share the feature card
(bottom center, between the rails). Analyze's footer is Run or Back to Setup.
Boolean stays `z-20`, under the section rail.

### Popup chrome

- Tint + frost: `bg-cyan-950/80` (contour) or `bg-amber-950/80` (fillet) **plus**
  `surface-glass-chip` (frost only — supply your own tint).
- Border: `border border-cyan-400/70` / `border-amber-400/70`.
- Type: `text-xs` / `text-[13px]` controls; title in accent (`text-cyan-200`).
- z-index: `z-20` (with other overlays; see `UI_MAP.md` ladder).
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
