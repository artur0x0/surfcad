import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importJsx } from '../../../test/jsxTestModule.js';
import {
  MOLD_PANE_GESTURES,
  bindMoldPaneGestures,
  moldPaneEventOnControl,
  stopMoldPaneGesture,
} from './moldPaneScroll.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const PANES = [
  ['src/components/molding/WallLegend.jsx', 'data-wall-legend'],
  ['src/components/molding/PartingLegend.jsx', 'data-parting-legend'],
  ['src/components/molding/MoldDraftLegend.jsx', 'data-mold-draft-legend'],
  ['src/components/molding/MoldReportPanel.jsx', 'data-mold-report'],
];

test('mold pane gestures stop wheel, touch, and pointer without cancelling scroll', () => {
  for (const type of ['wheel', 'touchmove', 'pointerdown', 'gesturechange']) {
    let stopped = false;
    let prevented = false;
    stopMoldPaneGesture({
      type,
      stopPropagation() { stopped = true; },
      preventDefault() { prevented = true; },
    });
    assert.equal(stopped, true, type);
    assert.equal(prevented, false, type);
  }
  const button = {
    closest(sel) { return sel.includes('button') ? this : null; },
  };
  let controlStopped = false;
  stopMoldPaneGesture({
    target: button,
    stopPropagation() { controlStopped = true; },
  });
  assert.equal(controlStopped, false);
  assert.equal(moldPaneEventOnControl({ target: button }), true);
  assert.equal(moldPaneEventOnControl({ target: null }), false);
  assert.equal(stopMoldPaneGesture(null), undefined);

  const listeners = [];
  const element = {
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
    removeEventListener(type, fn, capture) {
      const index = listeners.findIndex((row) => row.type === type && row.fn === fn && row.capture === capture);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  const unbind = bindMoldPaneGestures(element);
  for (const type of MOLD_PANE_GESTURES) {
    const row = listeners.find((item) => item.type === type);
    assert.ok(row, type);
    assert.equal(row.capture, true, type);
    assert.equal(row.fn, stopMoldPaneGesture);
  }
  assert.equal(bindMoldPaneGestures(null)(), undefined);
  unbind();
  assert.equal(listeners.length, 0);
});

test('phone molding panes cap height and keep the scroll off the canvas', () => {
  const css = read('src/index.css');
  const pane = read('src/components/molding/MoldAnalysisPane.jsx');
  const block = css.slice(css.indexOf('Phone molding results pane'), css.indexOf('Order-flow sheets'));
  assert.match(pane, /bindMoldPaneGestures\(ref\.current\)/);
  assert.match(pane, /useModalViewport\(\)/);
  assert.match(pane, /mold-analysis-pane/);
  assert.match(pane, /data-mold-analysis-pane/);
  assert.match(block, /@media \(max-width: 768px\)/);
  assert.match(block, /100dvh/);
  assert.match(block, /var\(--modal-vvh, 100dvh\)/);
  assert.match(block, /var\(--modal-vv-top, 0px\)/);
  assert.match(block, /var\(--safe-area-top\)/);
  assert.match(block, /var\(--safe-area-bottom\)/);
  assert.match(block, /--mold-pane-bottom-reserve: calc\(30px \+ max\(8px, var\(--safe-area-bottom\)\) \+ 10px\)/);
  assert.match(block, /var\(--feature-strip-offset-mobile\)/);
  assert.match(block, /overflow-y: auto/);
  assert.match(block, /overscroll-behavior: contain/);
  assert.match(block, /touch-action: pan-y/);
  assert.match(block, /pointer-events: auto/);
  assert.match(block, /@supports not \(height: 100dvh\)/);
  assert.doesNotMatch(block, /dfm-report-shifted/);
  const shell = read('src/components/molding/MoldResultsPane.jsx');
  assert.match(shell, /measureFeatureSheetWidth/);
  assert.match(shell, /MoldAnalysisPane/);
  assert.match(shell, /feature-sheet-card/);
  assert.match(shell, /data-mold-results-pane/);
  assert.match(css, /\.mold-results-pane/);
  assert.match(css, /4rem/);
  assert.match(css, /22rem/);
  const card = css.slice(css.indexOf('.feature-sheet-card {'), css.indexOf('.feature-sheet-card[data-feature-field-edit]'));
  assert.match(card, /max-height:/);
  for (const [file, marker] of PANES) {
    const src = read(file);
    assert.match(src, /mold-results-section/, file);
    assert.match(src, new RegExp(marker), file);
    assert.match(src, /data-mold-pane-end/, file);
    assert.doesNotMatch(src, /wall-legend-anchor/, file);
    assert.doesNotMatch(src, /MoldAnalysisPane/, file);
  }
  const pull = read('src/components/molding/PullReference.jsx');
  assert.match(pull, /mold-results-section/);
  assert.match(pull, /data-mold-pull/);
  assert.doesNotMatch(pull, /wall-legend-anchor/);
});

test('each molding pane renders the scroll container and its last control', async () => {
  const { default: WallLegend } = await importJsx(new URL('./WallLegend.jsx', import.meta.url));
  const { default: PartingLegend } = await importJsx(new URL('./PartingLegend.jsx', import.meta.url));
  const { default: MoldDraftLegend } = await importJsx(new URL('./MoldDraftLegend.jsx', import.meta.url));
  const { default: MoldReportPanel } = await importJsx(new URL('./MoldReportPanel.jsx', import.meta.url));

  const wall = renderToStaticMarkup(React.createElement(WallLegend, {
    legend: { css: 'linear-gradient(black, white)', thinMm: 1, nominalMm: 2, thickMm: 4 },
  }));
  assert.match(wall, /mold-results-section/);
  assert.match(wall, /data-wall-legend/);
  assert.doesNotMatch(wall, /wall-legend-anchor/);
  assert.match(wall, /data-mold-pane-end/);

  const parting = renderToStaticMarkup(React.createElement(PartingLegend, {
    legend: {
      lineCount: 3,
      rows: [{ role: 'core', css: '#abc', label: 'Core', count: 2 }],
    },
  }));
  assert.match(parting, /data-parting-legend/);
  assert.match(parting, /data-mold-pane-end/);
  assert.match(parting, /Core/);
  assert.doesNotMatch(parting, /Parting line ·/);

  const sides = renderToStaticMarkup(React.createElement(PartingLegend, {
    legend: {
      rows: [
        { role: 'core', css: '#abc', label: 'Core' },
        { role: 'side', css: '#0a0', label: 'Side action' },
        { role: 'parting-line', css: '#ff0', label: 'Parting line' },
      ],
      groups: [{ id: 0, kind: 'slide', css: '#0a0', label: 'Slide', pull: '+X', areaLabel: '12 mm²', selected: true }],
    },
  }));
  assert.match(sides, /data-parting-legend/);
  assert.match(sides, /data-mold-side-action-group/);
  assert.match(sides, /data-ui-action="data-mold-side-action-group"/);
  assert.match(sides, /data-side-action-area/);
  assert.match(sides, /12 mm²/);
  assert.match(sides, /\+X/);
  assert.match(sides, /aria-pressed="true"/);
  assert.match(sides, /data-mold-pane-end/);
  assert.doesNotMatch(sides, /data-side-action-legend/);

  const draft = renderToStaticMarkup(React.createElement(MoldDraftLegend, {
    legend: {
      minDeg: 1,
      presets: [0.5, 1, 2, 3, 5],
      positiveAbove: { count: 8, area: 1048.1 },
      positiveBelow: { count: 4, area: 160 },
      negative: { count: 2, area: 36.2 },
      pins: 4,
      sleeves: 1,
    },
  }));
  assert.match(draft, /data-mold-draft-legend/);
  assert.match(draft, /data-mold-pane-end/);
  assert.match(draft, /data-mold-draft-threshold="1"/);
  assert.match(draft, /data-ui-action="data-mold-draft-threshold"/);
  assert.match(draft, /Positive ≥ 1°/);
  assert.match(draft, /Positive &lt; 1°/);
  assert.match(draft, /Negative/);
  assert.match(draft, /mold-draft-swatch-negative/);
  assert.match(draft, /8 · 1048 mm²/);
  assert.match(draft, /2 · 36.2 mm²/);
  assert.doesNotMatch(draft, /style=/);

  const report = renderToStaticMarkup(React.createElement(MoldReportPanel, {
    report: {
      framing: 'Mold report',
      disclaimer: 'Budgetary, not binding.',
      grade: 'PC/ABS',
      quantity: 1000,
      geometry: { volumeCm3: 0.8, projectedAreaMm2: 400, sideActionCount: 1 },
      estimates: { pressTons: 2.04 },
      notes: { mass: 'The resin library has no density, so part mass is not computed.' },
    },
    resins: [{ grade: 'ABS' }, { grade: 'PC/ABS' }],
    quoteState: {
      status: 'ready',
      selected: 'North shop',
      quote: { vendors: [{ anonLabel: 'North shop' }] },
      reviewPayable: true,
      reviewFeeUsd: 49,
    },
    onGrade() {},
    onQuantity() {},
    onExport() {},
    onFirmQuote() {},
    onHumanReview() {},
    onPayReview() {},
  }));
  assert.match(report, /data-mold-report/);
  assert.match(report, /mold-results-section/);
  assert.doesNotMatch(report, /wall-legend-anchor/);
  assert.match(report, /data-mold-report-break/);
  assert.match(report, /0\.800 cm/);
  assert.match(report, /400\.00 mm/);
  assert.match(report, /data-mold-report-field="sides"/);
  assert.match(report, /PC\/ABS/);
  assert.match(report, /data-mold-report-quantity="1000"/);
  assert.match(report, /no density/);
  assert.match(report, /data-mold-pay-review/);
  assert.match(report, /data-mold-pane-end/);
  const payAt = report.indexOf('data-mold-pay-review');
  const endAt = report.indexOf('data-mold-pane-end');
  assert.ok(payAt > 0 && endAt > payAt);

  const { default: MoldResultsPane } = await importJsx(new URL('./MoldResultsPane.jsx', import.meta.url));
  const { default: PullReference } = await importJsx(new URL('./PullReference.jsx', import.meta.url));
  const pane = renderToStaticMarkup(React.createElement(
    MoldResultsPane,
    { compact: true },
    React.createElement(PullReference, { mode: 'plane', plane: 'top' }),
    React.createElement(PartingLegend, {
      legend: {
        lineCount: 3,
        rows: [{ role: 'core', css: '#abc', label: 'Core', count: 2 }],
      },
    }),
  ));
  assert.equal((pane.match(/data-mold-analysis-pane/g) || []).length, 1);
  assert.match(pane, /data-mold-results-pane/);
  assert.match(pane, /mold-analysis-pane/);
  assert.match(pane, /feature-sheet-card/);
  assert.match(pane, /overflow-y-auto/);
  assert.match(pane, /data-mold-pull/);
  assert.match(pane, /data-parting-legend/);
  assert.match(pane, /Core and cavity/);
  const pullAt = pane.indexOf('data-mold-pull');
  const legendAt = pane.indexOf('data-parting-legend');
  assert.ok(pullAt > 0 && legendAt > pullAt);
});
