import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importJsx } from '../../test/jsxTestModule.js';
import { pressMoldTool } from './pressMoldTool.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const MOLD_MARKERS = [
  'data-wall-heatmap',
  'data-mold-parting',
  'data-mold-draft',
  'data-mold-dfm',
  'data-mold-quote',
];

/** Closed vertical rail, every CAD inspection tool shown, sketch normal hidden. */
function closedRailHeightPx({ normalToSketch = false } = {}) {
  const button = 36;
  const gap = 4;
  const pad = 16;
  const divider = 5;
  const pick = 2 * button + gap;
  const overlays = 3 * button + 2 * gap;
  const wrapper = pick + overlays + gap;
  const inspection = 4 * button + 3 * gap;
  const childCount = normalToSketch ? 7 : 6;
  const normal = normalToSketch ? button : 0;
  return pad + button + button + normal + divider + wrapper + divider + inspection + (childCount - 1) * gap;
}

/** Free height under the phone ribbon. 390px wide iPhone 14 is 844px tall. */
function phoneRailBudgetPx({ height = 844, joints = false } = {}) {
  const rem = 16;
  const offset = rem + 2 * (1.75 * rem + 2) + 2 * 0.25 * rem + 0.5 * rem;
  const strip = 2.875 * rem;
  const railGap = 0.625 * rem;
  const joint = joints ? strip : 0;
  return height - offset - strip - joint - railGap - railGap;
}

test('the molding drawer replaces the rail column and the triad', async () => {
  const panel = read('src/components/CrossSectionPanel.jsx');
  const drawer = read('src/components/MoldingToolsControl.jsx');
  const view = read('src/components/Viewport.jsx');
  assert.match(drawer, /data-mold-tools-popup/);
  assert.match(drawer, /w-max flex-nowrap/);
  assert.match(drawer, /gap-1/);
  assert.doesNotMatch(drawer, /gap-2/);
  assert.match(drawer, /absolute right-full/);
  assert.match(drawer, /top-1\/2 -translate-y-1\/2/);
  assert.match(drawer, /open \? <ArrowLeft size=\{20\} \/> : <Factory size=\{20\} \/>/);
  assert.doesNotMatch(panel, /Move3d/);
  assert.doesNotMatch(panel, /data-axis-helper-toggle/);
  assert.doesNotMatch(view, /onAxisHelperToggle/);
  assert.match(view, /new AxesHelper\(/);
  assert.match(view, /axisHelper\.visible = false/);
  assert.match(panel, /RAIL_NO_CLIP_CLASS/);
  assert.doesNotMatch(panel, /RAIL_SCROLL_CLASS/);

  const { default: CrossSectionPanel } = await importJsx(
    new URL('./CrossSectionPanel.jsx', import.meta.url),
  );
  const show = {
    showPaint: true,
    showAnalyze: true,
    showWall: true,
    showParting: true,
    showMoldDraft: true,
    showDfm: true,
    showQuote: true,
    onPickModeChange: () => {},
    onToggle: () => {},
    onZoomToFit: () => {},
    onSnapView: () => {},
    onMeasurementToggle: () => {},
    onWallToggle: () => {},
    onPartingToggle: () => {},
    onMoldDraftToggle: () => {},
    onDfmToggle: () => {},
    onQuoteToggle: () => {},
    verticalRail: true,
  };
  const closed = renderToStaticMarkup(React.createElement(CrossSectionPanel, show));
  assert.match(closed, /data-mold-tools-toggle/);
  assert.match(closed, /aria-label="Molding tools"/);
  assert.doesNotMatch(closed, /data-mold-tools-popup/);
  assert.doesNotMatch(closed, /Move3d/);
  assert.doesNotMatch(closed, /data-axis-helper-toggle/);
  for (const marker of MOLD_MARKERS) assert.doesNotMatch(closed, new RegExp(marker));
  assert.match(closed, /overflow-visible/);
  assert.doesNotMatch(closed, /overflow-y-auto/);
  const closedButtons = closed.match(/<button\b/g) || [];
  assert.equal(closedButtons.length, 11);

  const open = renderToStaticMarkup(React.createElement(CrossSectionPanel, {
    ...show,
    moldToolsOpen: true,
    wallActive: true,
  }));
  assert.match(open, /data-mold-tools-popup/);
  assert.match(open, /aria-label="Molding tools"/);
  const popup = open.slice(open.indexOf('data-mold-tools-popup'), open.indexOf('data-mold-tools-toggle'));
  for (const marker of MOLD_MARKERS) assert.match(popup, new RegExp(marker));
  assert.doesNotMatch(popup, /data-mold-side-actions/);
  assert.match(popup, /data-wall-heatmap-state="on"/);
  assert.match(open, /aria-expanded="true"/);

  const hidden = renderToStaticMarkup(React.createElement(CrossSectionPanel, {
    ...show,
    showWall: false,
    showParting: false,
    showMoldDraft: false,
    showDfm: false,
    showQuote: false,
  }));
  assert.doesNotMatch(hidden, /data-mold-tools-toggle/);
});

test('a molding tool press closes the drawer before it toggles the pane', () => {
  const drawer = read('src/components/MoldingToolsControl.jsx');
  const press = read('src/components/pressMoldTool.js');
  assert.match(drawer, /import \{ pressMoldTool \} from '\.\/pressMoldTool'/);
  assert.match(press, /export function pressMoldTool\(setOpen, toggle\)/);
  assert.match(press, /setOpen\(false\);\s*if \(typeof toggle === 'function'\) toggle\(\);/);
  assert.doesNotMatch(drawer, /A chosen tool stays in the menu/);
  for (const name of [
    'onWallToggle',
    'onPartingToggle',
    'onMoldDraftToggle',
    'onDfmToggle',
    'onQuoteToggle',
  ]) {
    assert.match(drawer, new RegExp(`onClick=\\{\\(\\) => pressMoldTool\\(setOpen, ${name}\\)\\}`));
  }
  const order = [];
  pressMoldTool(
    (value) => order.push(['open', value]),
    () => order.push('toggle'),
  );
  assert.deepEqual(order, [['open', false], 'toggle']);
  const closedOnly = [];
  pressMoldTool((value) => closedOnly.push(value), null);
  assert.deepEqual(closedOnly, [false]);
});

test('the closed rail fits a 390px iPhone without scrolling', () => {
  const plain = closedRailHeightPx();
  const withSketch = closedRailHeightPx({ normalToSketch: true });
  const budget = phoneRailBudgetPx();
  const withJoints = phoneRailBudgetPx({ joints: true });
  assert.ok(plain < budget, `rail ${plain}px exceeds phone budget ${budget}px`);
  assert.ok(withSketch < withJoints, `sketch rail ${withSketch}px exceeds joint budget ${withJoints}px`);
  assert.equal(plain, 470);
  assert.equal(budget, 686);
});
