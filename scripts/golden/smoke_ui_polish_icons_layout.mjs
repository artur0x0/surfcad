#!/usr/bin/env node
/**
 * UI polish: distinct selector icons, one orientation menu, quieter edge chip,
 * and a desktop that matches the phone shell.
 *
 * - Face / Plane / Sketch each own one icon: skinny rectangle, three planes,
 *   pencil-and-paper. No icon does double duty inside the right rail.
 * - Iso lives inside the view-snap popup; the trigger is a pure toggle and turns
 *   into an arrow pointing at the menu it just unfurled.
 * - The standalone edge chip waits for a real selection.
 * - CAD chrome is the editor mid-strip in BOTH shells, both viewport rails are
 *   vertical, and the two rails share one size — the larger of the old two.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('ui polish: icons, view snaps, edge chip, desktop shell');

const panel = read('../../src/components/CrossSectionPanel.jsx');
const snap = read('../../src/components/ViewSnapControl.jsx');
const view = read('../../src/components/Viewport.jsx');
const editor = read('../../src/components/CodeEditor.jsx');
const toolbar = read('../../src/components/Toolbar.jsx');
const palette = read('../../src/components/HelperInsertPalette.jsx');
const contourRail = read('../../src/components/ContourModeRail.jsx');

// ── AC1: one icon per selector, no duplicates in the rail ──
{
  check(
    'face pick uses the skinny rectangle',
    /aria-label="Face pick mode"[\s\S]{0,300}?<RectangleHorizontal size=\{20\} \/>/.test(panel),
  );
  check(
    'plane display uses the three-planes icon',
    /data-overlay-toggle="plane"[\s\S]{0,80}?<Layers3 size=\{20\} \/>/.test(panel),
  );
  check(
    'sketch display uses the pencil-and-paper icon',
    /data-overlay-toggle="contour"[\s\S]{0,80}?<NotebookPen size=\{20\} \/>/.test(panel),
  );
  check(
    'the retired duplicates are gone from the rail',
    !/BoxSelect/.test(panel) && !/SquareDashed/.test(panel),
  );
  // Every <Icon size={20} /> in the collapsed rail must be a different glyph.
  const railStart = panel.indexOf('if (isCollapsed || !enabled)');
  const railEnd = panel.indexOf('bg-white/50 backdrop-blur-sm rounded-lg shadow-lg p-3');
  const rail = panel.slice(railStart, railEnd > railStart ? railEnd : undefined);
  const glyphs = [...rail.matchAll(/<([A-Z][A-Za-z0-9]*) size=\{20\} \/>/g)].map((m) => m[1]);
  check(
    'no icon is used twice in the right rail',
    glyphs.length > 6 && new Set(glyphs).size === glyphs.length,
    glyphs.join(','),
  );
  // Playtest correction: zoom-fit under view-change; XYZ triad (Move3d) stays;
  // Lucide Frame (# / auto-fit) removed — it duplicated zoom-to-fit.
  const zoomAt = rail.indexOf('data-zoom-to-fit');
  const viewAt = rail.indexOf('<ViewSnapControl');
  check(
    'zoom-to-fit directly under view-snap',
    viewAt >= 0 && zoomAt > viewAt && /data-zoom-to-fit=""/.test(rail)
      && glyphs[0] === 'Maximize2',
  );
  check(
    'triad (Move3d) kept; Frame (#) auto-fit gone; one zoom-fit',
    glyphs.includes('Move3d')
      && !glyphs.includes('Frame')
      && !/data-auto-fit/.test(rail)
      && glyphs.filter((g) => g === 'Maximize2').length === 1,
  );
}

// ── AC2: iso moved into the popup; trigger became a labelled toggle ──
{
  check("iso is one of the popup's views", /key: 'iso'/.test(snap));
  check(
    "iso is not the trigger's hidden second tap",
    !/onSnap\?\.\('iso'\)/.test(snap),
  );
  check(
    'the trigger only opens and closes the menu',
    /onClick=\{\(\) => setOpen\(\(v\) => !v\)\}/.test(snap),
  );
  check(
    'the trigger becomes an arrow toward the open menu',
    /open \? <ArrowLeft size=\{20\} \/> : <Box size=\{20\} \/>/.test(snap),
  );
  check(
    'the popup unfurls leftwards, so the arrow points at it',
    /absolute right-full/.test(snap) && !/bottom-full/.test(snap),
  );
  check(
    'the leftwards popup is centred on its trigger',
    /top-1\/2 -translate-y-1\/2/.test(snap),
  );
  check('popup is addressable from tests', /data-view-snap-popup/.test(snap));
}

// ── AC3: edge chip needs a real selection ──
{
  check(
    'standalone edge chip requires at least one selected edge',
    /pickMode === 'edge' && !contourMode && !filletMode && selectedEdges\.length > 0 && \(/.test(view),
  );
  check('edge chip keeps its test hook', /'data-edge-selector': 'standalone'/.test(view));
  const edgeBlock = view.slice(view.indexOf("'data-edge-selector': 'standalone'"));
  const edgeEnd = edgeBlock.indexOf('edgeModeToast');
  const edgeChip = edgeEnd > 0 ? edgeBlock.slice(0, edgeEnd) : edgeBlock.slice(0, 1800);
  check(
    'standalone edge chip Undo removes the last edge',
    />\s*Undo\s*</.test(edgeChip)
      && /title="Undo last selected edge"/.test(edgeChip)
      && /aria-label="Undo last selected edge"/.test(edgeChip)
      && /popLastEdgeSelection/.test(edgeChip)
      && !/>\s*Back\s*</.test(edgeChip),
  );
}

// ── AC4: desktop shell matches the phone shell ──
{
  check('no CAD overlay toolbar survives', !/variant="overlay"/.test(view));
  check('Toolbar has no collapse state left', !/isCollapsed/.test(toolbar));
  check(
    'CAD strip is portaled in both shells',
    /mode !== 'game' && cadToolbarHost && createPortal\(/.test(view),
  );
  check(
    'editor hosts the strip in both shells',
    /showCadStrip = !isGame && typeof onCadToolbarHost === 'function'/.test(editor),
  );
  check('right rail is vertical unconditionally', /\n\s+verticalRail\n/.test(view));
  check(
    'bottom-left readouts clear the wider left rail',
    !/left-16 lg:left-\[4\.75rem\]/.test(view)
      && /left-\[4\.5rem\] lg:left-\[5\.25rem\]/.test(view),
  );
}

// ── AC5: both viewport rails are one size, the larger one ──
{
  for (const [name, src] of [['helper rail', palette], ['contour rail', contourRail]]) {
    check(`${name} icon size matches the right rail (20)`, /const iconSize = 20;/.test(src));
    check(`${name} button padding matches the right rail (p-2)`, /const pad = 'p-2';/.test(src));
    check(`${name} shell padding matches the right rail (p-2)`, /\n\s+p-2`\}/.test(src));
    check(
      `${name} no longer shrinks on phones`,
      !/compact \? 'p-1/.test(src) && !/compact \? 16/.test(src),
    );
  }
  check(
    'right rail is still the 20px / p-2 reference the others copy',
    /size=\{20\}/.test(panel) && /p-2 rounded/.test(panel),
  );
}

// ── AC6: loft reads as a pyramid, and the left rail's scrollbar is rounded ──
{
  const css = read('../../src/index.css');
  check('loft uses the pyramid glyph', /makeLoft: Pyramid,/.test(palette));
  const filletIcon = read('../../src/components/icons/SquareRoundCorner.jsx');
  check('fillet uses the one-rounded-corner square', /filletEdges: SquareRoundCorner,/.test(palette));
  check(
    'the vendored fillet glyph carries lucide\'s own paths',
    /M21 11a8 8 0 0 0-8-8/.test(filletIcon)
      && /M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4/.test(filletIcon),
  );
  // Boolean wears lucide `rectangle-circle` (vendored: not in lucide-react 0.469).
  const boolIcon = read('../../src/components/icons/RectangleCircle.jsx');
  const strip = read('../../src/components/FeatureStrip.jsx');
  const sheet = read('../../src/components/FeatureEditSheet.jsx');
  check('boolean uses RectangleCircle on the rail, strip, and sheet',
    /boolean: RectangleCircle,/.test(palette) && /boolean: RectangleCircle,/.test(strip)
      && /boolean: RectangleCircle,/.test(sheet)
      && ![palette, strip, sheet].some((src) => /\bCombine\b/.test(src.replace(/onCombine\w*/g, ''))));
  check(
    'the vendored boolean glyph carries lucide\'s own paths',
    /M14 4v16H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z/.test(boolIcon)
      && /<circle cx="14" cy="12" r="8" \/>/.test(boolIcon)
      && /lucide-rectangle-circle/.test(boolIcon),
  );
  check('the vendored glyph takes lucide\'s size prop', /size = 24/.test(filletIcon));
  check('the retired stacked-layers glyph is gone', !/\bLayers\b/.test(palette));
  check(
    'Pyramid is imported and used once in the helper rail',
    (palette.match(/\bPyramid\b/g) || []).length === 2,
  );
  // Scrolling now comes from RAIL_SCROLL_CLASS (left rails only) — the right
  // rail must NOT take it, or its overflow box clips the view-snap flyout.
  const railPair = read('../../src/utils/railPair.js');
  check('the rounded gutter lives in RAIL_SCROLL_CLASS',
    /RAIL_SCROLL_CLASS = 'overflow-y-auto overflow-x-hidden rail-scroll'/.test(railPair));
  for (const [name, src] of [['helper rail', palette], ['contour rail', contourRail]]) {
    check(`${name} takes the scroll class`, /RAIL_SCROLL_CLASS/.test(src));
  }
  check('the right rail never scrolls', !/RAIL_SCROLL_CLASS/.test(panel)
    && /RAIL_NO_CLIP_CLASS/.test(panel));
  check('height and scrolling are separate concerns',
    /RAIL_PAIR_HEIGHT_CLASS = 'max-h-\[min\(26rem,calc\(100%-5\.5rem\)\)\]'/.test(railPair));
  check('the no-clip class is overflow-visible',
    /RAIL_NO_CLIP_CLASS = 'overflow-visible'/.test(railPair));
  check('rail-scroll gives the thumb a pill radius', /\.rail-scroll::-webkit-scrollbar-thumb[\s\S]{0,200}?border-radius: 9999px/.test(css));
  check('rail-scroll leaves the track transparent', /\.rail-scroll::-webkit-scrollbar-track[\s\S]{0,160}?background: transparent/.test(css));
  check('rail-scroll covers Firefox too', /\.rail-scroll \{[\s\S]{0,160}?scrollbar-width: thin/.test(css));
}

// ── AC7: one preview aesthetic, and it is unlit ──
{
  const style = read('../../src/utils/previewStyle.js');
  check('there is a shared preview recipe', /makePreviewSkinMaterial/.test(style)
    && /makePreviewOutlineMaterial/.test(style));
  check('the shared skin is unlit', /new MeshBasicMaterial\(/.test(style)
    && !/MeshLambertMaterial|MeshStandardMaterial|MeshPhongMaterial/.test(style));
  // The darkness bug: Extrude was the one preview painted with a lit material.
  const paints = view.slice(
    view.indexOf('const paintExtrudePreview'),
    view.indexOf('const clearFilletBlendPreview'),
  );
  check(
    'no preview paints with a lit material any more',
    !/MeshLambertMaterial|MeshStandardMaterial|MeshPhongMaterial/.test(paints),
  );
  // Skins are the DoubleSide translucent surfaces; point/marker materials are
  // a different thing and keep their own definitions.
  const handRolledSkin = /new MeshBasicMaterial\(\{[^}]*side: DoubleSide/.test(paints);
  check('no preview hand-rolls its own skin material', !handRolledSkin);
  for (const paint of ['Extrude', 'Revolve', 'Loft', 'Sweep']) {
    const body = paints.slice(paints.indexOf(`const paint${paint}Preview`));
    check(`${paint} preview uses the shared skin`, /makePreviewSkinMaterial\(/.test(
      body.slice(0, body.indexOf('const clear') > 0 ? body.indexOf('const clear') : undefined),
    ));
  }
  check('Extrude gained Loft-style outline rings', /Start and end loops/.test(paints)
    && /makePreviewOutlineMaterial\(/.test(paints));
}

// ── AC8: the param popup docks bottom-centre of the viewport, click-through ──
{
  const modal = read('../../src/components/HelperParamModal.jsx');
  check(
    'popup is positioned against the viewport, not the screen',
    /absolute inset-0 z-50 flex items-end justify-center/.test(modal)
      && !/fixed inset-0/.test(modal),
  );
  check('popup sits bottom-centre', !/sm:items-center/.test(modal));
  check('no dimming scrim over the viewport', !/bg-black\/\d+/.test(modal));
  check('overlay is click-through, panel is not', /pointer-events-none/.test(modal)
    && (modal.match(/pointer-events-auto/g) || []).length === 2);
  check(
    'the dead click-outside handler is gone with the scrim',
    !/onMouseDown/.test(modal),
  );
}

// ── AC9: the editor/viewport seam is draggable in both shells ──
{
  const app = read('../../src/App.jsx');
  const divider = read('../../src/components/SplitDivider.jsx');
  check('divider uses pointer capture so a drag can leave the element',
    /setPointerCapture/.test(divider) && /releasePointerCapture/.test(divider));
  check('divider opts out of touch scrolling', /touch-none/.test(divider));
  check('divider announces itself to AT', /role="separator"/.test(divider)
    && /aria-orientation/.test(divider));
  check('desktop drags left/right', /<SplitDivider orientation="vertical"/.test(app));
  check('mobile drags up/down', /<SplitDivider orientation="horizontal"/.test(app));
  check('desktop columns are no longer hard-coded halves',
    /style=\{\{ width: `\$\{splitPct\}%` \}\}/.test(app) && !/className="w-1\/2/.test(app));
  check('split is clamped so neither pane can collapse',
    /Math\.min\(80, Math\.max\(20, pct\)\)/.test(app));
  check('an open keyboard still wins over a dragged mobile height',
    /keyboardOpen\s*\?[\s\S]{0,200}mobileEditorPxOverride != null/.test(app));
}

// ── AC10: rename the part from the title chip ──
{
  check('the chip becomes an input on double-click', /data-title-chip="input"/.test(view)
    && /data-title-chip="button"/.test(view)
    && /renameOnDoubleClick/.test(view)
    && /onChipDoubleClick/.test(view));
  check('Enter commits and Escape reverts',
    /if \(e\.key === 'Enter'\)[\s\S]{0,60}commit\(\)/.test(view)
      && /if \(e\.key === 'Escape'\)[\s\S]{0,60}setEditing\(false\)/.test(view));
  check('blur commits too', /onBlur=\{commit\}/.test(view));
  check('typing does not leak to viewport hotkeys', /e\.stopPropagation\(\)/.test(view));
  // sanitizePartName moved to utils/assembly.js (shared with the Parts feed row rename).
  const asm = read('../../src/utils/assembly.js');
  check('names are path-safe and bounded',
    /export function sanitizePartName/.test(asm) && /slice\(0, 60\)/.test(asm)
      && /import \{[^}]*sanitizePartName[^}]*\} from '\.\.\/utils\/assembly\.js'/.test(view));
  check('an empty name is not committed', /if \(next && next !== \(value \|\| ''\)\) onRename\(next\)/.test(view));
}

// ── AC11: view snaps keep clear of the viewport edges ──
{
  const css = read('../../src/index.css');
  check('flyout gap is 10px', /mr-2\.5/.test(snap));
  // It must NOT wrap: with only `right` set inside a ~36px parent, shrink-to-fit
  // is near zero, so flex-wrap collapses the row into a vertical stack.
  const popupClass = snap.slice(snap.indexOf('className="view-snap-popup'));
  check('flyout stays one horizontal row',
    /flex w-max flex-nowrap/.test(popupClass)
      && !/flex-wrap/.test(popupClass.slice(0, popupClass.indexOf('"', 12))));
  check('viewport shell is a size container', /\.viewport-shell[\s\S]{0,80}container-type: inline-size/.test(css));
  // The clamp measures the pane (100cqw, not 100vw — the viewport is half the
  // window on desktop) AND leaves room for the left rail, or the snap buttons
  // slide underneath the helper palette instead of wrapping.
  check('flyout is clamped to the pane, not the window',
    /\.view-snap-popup[\s\S]{0,400}max-width: calc\(100cqw - 5\.25rem - 20px\)/.test(css));
  check('the clamp accounts for the left rail', /Clear the LEFT rail too/.test(css));
}

// ── AC12: one translucent surface everywhere, nothing opaque over the part ──
{
  const css = read('../../src/index.css');
  check('there is a shared glass surface', /\.surface-glass\b/.test(css)
    && /\.surface-glass-chip\b/.test(css) && /\.surface-scrim\b/.test(css));
  check('every layer shares one blur token', /--surface-blur/.test(css));
  check('there is a no-backdrop-filter fallback',
    /@supports not \(backdrop-filter/.test(css));

  const panels = [
    'LoginModal', 'AccountModal', 'QuoteModal', 'OrderModal', 'TermsModal',
    'PuzzlePickerModal', 'GameHintsModal', 'HelperParamModal',
  ];
  for (const name of panels) {
    const src = read(`../../src/components/${name}.jsx`);
    check(`${name} panel is glass`, /surface-glass/.test(src));
    // Panel-level slabs only. Native <select>/<option> keep an opaque
    // background on purpose — the OS renders the option list, and a
    // translucent one is unreadable.
    check(`${name} has no opaque slab left`,
      !/bg-\[#1e1e1e\] (?:rounded-2xl|rounded-lg shadow-2xl)/.test(src)
        && !/rounded-(?:lg|2xl) bg-gray-900\b/.test(src));
  }
  check('Contour card is frosted', /surface-glass-chip/.test(read('../../src/components/FeatureSheet.jsx')));
  check('FilletModeChip uses the frosted feature card',
    /<FeatureSheet\b/.test(read('../../src/components/FilletModeChip.jsx'))
      && /surface-glass-chip/.test(read('../../src/components/FeatureSheet.jsx')));
  const errorPopup = read('../../src/components/ErrorPopup.jsx');
  // ErrorPopup consolidates execution/soft-fail/scrap toast frosting (was ≥8
  // inline surface-glass-chip hits in Viewport alone).
  check('viewport chips and toasts are frosted',
    /surface-glass-chip/.test(errorPopup) &&
      ((view.match(/surface-glass-chip/g) || []).length
        + (errorPopup.match(/surface-glass-chip/g) || []).length) >= 6);
  check('no fully opaque toast survives in the viewport',
    !/bg-(?:amber-600|amber-700|cyan-700) text-white/.test(view));
}

// ── AC13: mode chips are centred; the right cluster clears the edge by 10px ──
{
  const featureCard = read('../../src/components/FeatureSheet.jsx');
  check('Contour card is bottom-centre, not right-justified',
    /left-1\/2/.test(featureCard) && /-translate-x-1\/2/.test(featureCard)
      && !/bottom-4 right-2/.test(featureCard));
  {
    const src = read('../../src/components/FilletModeChip.jsx');
    check('FilletModeChip is the shared bottom-centre card, not right-justified',
      /<FeatureSheet\b/.test(src)
        && !/bottom-4 right-2/.test(src));
  }
  check('right-hand cluster sits 10px off both edges',
    (panel.match(/bottom-2\.5 right-2\.5/g) || []).length === 2
      && !/right-2 lg:right-4/.test(panel));
}

// ── AC14: one popup design system; every number has a slider AND a box ──
{
  const ui = read('../../src/components/controls/popupUI.jsx');
  check('there is a shared popup module', /export const NumberField/.test(ui)
    && /export const SelectField/.test(ui) && /export const PopupButton/.test(ui));
  check('one type scale for every popup', /export const POPUP_TEXT/.test(ui));
  // The rule that motivated the module: a slider alone can't hit 12.5, a box
  // alone can't be nudged. NumberField must render both, unconditionally.
  const numberField = ui.slice(ui.indexOf('export const NumberField'), ui.indexOf('export const ChoiceRow'));
  check('NumberField always renders a slider', /type="range"/.test(numberField));
  check('NumberField always renders a typed box', /type="number"/.test(numberField));
  check('neither input is behind a condition',
    !/\{\s*\w+\s*&&\s*\(?\s*<input/.test(numberField));
  check('accent classes are written out, not interpolated',
    !/bg-\$\{/.test(ui) && /export const ACCENTS/.test(ui));

  for (const name of ['ContourModeChip', 'FilletModeChip', 'HelperParamModal']) {
    const src = read(`../../src/components/${name}.jsx`);
    check(`${name} uses the shared fields`, /from '\.\/controls\/popupUI'/.test(src));
    check(`${name} hand-rolls no range input`, !/type="range"/.test(src));
  }
  // Helper sheets used to show a slider only when an item set `slider: true`.
  const modal = read('../../src/components/HelperParamModal.jsx');
  check('no param can opt out of its slider any more', !/p\.slider/.test(modal));
  check('popup text is a notch bigger', !/text-\[10px\]/.test(read('../../src/components/ContourModeChip.jsx')));
}

// ── AC15: 64 segments is the default everywhere ──
{
  const snippets = read('../../src/utils/helperPaletteSnippets.js');
  const contour = read('../../src/utils/contourMode.js');
  check('no palette item still defaults to 32 segments',
    !/name: 'segments'[^}]*default: 32/.test(snippets));
  check('no build falls back to 32 segments', !/num\(p\.segments, 32\)/.test(snippets));
  check('contour profile defaults to 64', /radius: 5, segments: 64/.test(contour));
  check('starter snippets emit 64 too',
    !/profileCircle\(\d+, 32\)/.test(snippets) && !/Manifold\.cylinder\([^)]*, 32\)/.test(snippets));
  check('the segments slider can reach past the new default',
    /'Segments', \{ min: 3, step: 1, max: 128 \}/.test(read('../../src/components/ContourModeChip.jsx')));
}

// ── AC16: the CAD strip has a green Run, first, in its own section ──
{
  const strip = toolbar.slice(toolbar.indexOf("data-toolbar-variant=\"strip\""));
  const runAt = strip.indexOf('data-cad-run');
  check('CAD strip has a Run button', runAt > 0);
  // First means first: no other button may open before it.
  check('Run is the first button in the strip',
    (() => {
      const first = strip.indexOf('<button');
      return first > 0 && strip.slice(first, first + 500).includes('data-cad-run');
    })());
  check('Account left the strip for the viewport profile chip (G9)',
    !/onClick=\{onAccount\}/.test(strip) && !/title="Account"/.test(strip));
  check('Run is green', /text-green-400 disabled:opacity-60/.test(strip));
  // Run's section holds Run + Select all (both editor actions), then a divider.
  // Model Upload and Download live on the Parts ribbon.
  check('Run shares its section with Select all, then a divider',
    /data-cad-run[\s\S]{0,900}?data-cad-select-all[\s\S]{0,300}?<\/button>\s*<div className=\{divider\} \/>/.test(strip));
  check('Select all is at Run\'s icon size, not its old 16',
    /data-cad-select-all[\s\S]{0,120}<SquareDashedBottomCode size=\{icon\} \/>/.test(strip));
  check('Select all left the editor strip',
    !/SquareDashedBottomCode/.test(read('../../src/components/CodeEditor.jsx')));
  check('Select all is driven through the editor ref',
    /selectAll: \(\) => selectAll\(\)/.test(read('../../src/components/CodeEditor.jsx'))
      && /codeEditorRef\.current\?\.selectAll/.test(read('../../src/App.jsx')));
  check('Run becomes a spinner while executing',
    /isExecuting \? \(\s*<span[\s\S]{0,200}animate-spin/.test(strip));
  check('Run is disabled and marked busy mid-run',
    /disabled=\{isExecuting\}/.test(strip) && /aria-busy=\{isExecuting\}/.test(strip));
  check('CAD Run is wired to the live buffer, not the game handler',
    /onRunScript={runCadScript}/.test(view) && /const runCadScript/.test(view));
  check('game Run keeps its own handler', /onRun={onRun}/.test(view));
}

// ── AC17: cross-section buttons say what they do ──
{
  const cut = read('../../src/components/icons/TrianglesCenterlineDashedVertical.jsx');
  check('the section-cut glyph is vendored', /lucide-triangles-centerline-dashed-vertical/.test(cut)
    && /M12 14v2/.test(cut) && /M20\.288 16\.703/.test(cut));
  check('opening the options shows a section cut, not a chevron',
    /<TrianglesCenterlineDashedVertical size=\{20\} \/>/.test(panel));
  check('closing the options is a checkmark', /<Check size=\{20\} \/>/.test(panel));
  check('both chevrons are gone from the cross-section panel',
    !/ChevronUp|ChevronDown/.test(panel));
  check('the labels match the new glyphs',
    /title="Cross-section options"/.test(panel)
      && /title="Done — close cross-section options"/.test(panel));
}

// ── AC19: the feature card header survives a narrow phone ──
{
  const sheet = read('../../src/components/FeatureEditSheet.jsx');
  const card = read('../../src/components/FeatureSheet.jsx');
  const header = card.slice(card.indexOf('data-feature-sheet-header'), card.indexOf('data-feature-sheet-body'));
  check('the edit sheet uses the shared card header',
    /<FeatureSheet\b/.test(sheet) && /data-feature-sheet-header/.test(card));
  check('the title block may shrink so truncate can fire',
    /min-w-0 flex-1/.test(header) && /truncate/.test(header));
}

// ── AC18: nothing between the flyout and the viewport may clip it ──
// Regression guard. The view-snap popup is positioned OUTSIDE the rail box
// (`absolute right-full`), so any `overflow` on an ancestor rail erases it.
// That is exactly what happened when the paired-height class carried
// `overflow-y-auto`: the flyout stopped appearing and the rail grew a
// scrollbar it never needed.
{
  const railPair = read('../../src/utils/railPair.js');
  check('the shared height class carries no overflow',
    !/overflow/.test(railPair.split('RAIL_PAIR_HEIGHT_CLASS =')[1].split('\n')[0]));
  const collapsed = panel.slice(panel.indexOf('if (isCollapsed || !enabled)'));
  const railDiv = collapsed.slice(0, collapsed.indexOf('<ViewSnapControl'));
  check('the rail that hosts the flyout does not scroll',
    !/overflow-y-auto|overflow-hidden/.test(railDiv), railDiv.slice(-200));
  check('the flyout still escapes to the left of its trigger',
    /absolute right-full/.test(snap));
}

// ── AC20: left rail content-max height; narrows when buttons fit ──
// Supersedes the earlier full-length desktop rail: content-sized max-h yields
// viewport space, and useLeftRailFit switches to w-14 when nothing scrolls.
{
  const railPair = read('../../src/utils/railPair.js');
  check('left rail height is content-max (max-h)',
    /max-h-\[min\(26rem,calc\(100%-5\.5rem\)\)\]/.test(railPair)
      && /RAIL_PAIR_HEIGHT_ATTR = 'content-max'/.test(railPair));
  check('fit hook narrows width when buttons fit',
    /useLeftRailFit/.test(railPair)
      && /RAIL_PAIR_WIDTH_FIT_CLASS = 'w-14'/.test(railPair));
  for (const [name, src] of [['helper rail', palette], ['contour rail', contourRail]]) {
    check(`${name} uses fit hook + content-max height`,
      /useLeftRailFit/.test(src)
        && /RAIL_PAIR_HEIGHT_CLASS/.test(src)
        && /data-rail-fit=\{fits \? 'fits' : 'scroll'\}/.test(src));
    check(`${name} still scrolls when the tools overflow`, /RAIL_SCROLL_CLASS/.test(src));
  }
  // Part-name chip sits at top-4; content-max caps below it via calc(100%-5.5rem).
  check('the rail stops below the part-name chip, not over it',
    /top-4 left-1\/2 -translate-x-1\/2/.test(view));
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll UI polish checks passed.');
