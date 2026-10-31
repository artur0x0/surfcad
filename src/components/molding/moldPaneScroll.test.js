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
  stopMoldPaneGesture,
} from './moldPaneScroll.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const PANES = [
  ['src/components/molding/WallLegend.jsx', 'data-wall-legend'],
  ['src/components/molding/PartingLegend.jsx', 'data-parting-legend'],
  ['src/components/molding/SideActionLegend.jsx', 'data-side-action-legend'],
  ['src/components/molding/MoldDraftLegend.jsx', 'data-mold-draft-legend'],
  ['src/components/molding/DfmReportPanel.jsx', 'data-mold-dfm-report'],
  ['src/components/molding/MoldQuotePanel.jsx', 'data-mold-quote-panel'],
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
  const block = css.slice(css.indexOf('Phone molding panes'), css.indexOf('Order-flow sheets'));
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
  assert.match(block, /- 12rem/);
  assert.match(block, /@supports not \(height: 100dvh\)/);
  const desktop = css.slice(css.indexOf('.dfm-report-panel,'), css.indexOf('.dfm-report-shifted'));
  assert.match(desktop, /max-height: min\(32rem, 70vh\)/);
  for (const [file, marker] of PANES) {
    const src = read(file);
    assert.match(src, /MoldAnalysisPane/, file);
    assert.match(src, new RegExp(marker), file);
    assert.match(src, /data-mold-pane-end/, file);
  }
  for (const file of PANES.slice(0, 4).map(([file]) => file)) {
    assert.match(read(file), /pointer-events-none/, file);
  }
});

test('each molding pane renders the scroll container and its last control', async () => {
  const { default: WallLegend } = await importJsx(new URL('./WallLegend.jsx', import.meta.url));
  const { default: PartingLegend } = await importJsx(new URL('./PartingLegend.jsx', import.meta.url));
  const { default: SideActionLegend } = await importJsx(new URL('./SideActionLegend.jsx', import.meta.url));
  const { default: MoldDraftLegend } = await importJsx(new URL('./MoldDraftLegend.jsx', import.meta.url));
  const { default: DfmReportPanel } = await importJsx(new URL('./DfmReportPanel.jsx', import.meta.url));
  const { default: MoldQuotePanel } = await importJsx(new URL('./MoldQuotePanel.jsx', import.meta.url));

  const wall = renderToStaticMarkup(React.createElement(WallLegend, {
    legend: { css: 'linear-gradient(black, white)', thinMm: 1, nominalMm: 2, thickMm: 4 },
  }));
  assert.match(wall, /data-mold-analysis-pane/);
  assert.match(wall, /mold-analysis-pane/);
  assert.match(wall, /data-wall-legend/);
  assert.match(wall, /pointer-events-none/);
  assert.match(wall, /data-mold-pane-end/);

  const parting = renderToStaticMarkup(React.createElement(PartingLegend, {
    legend: {
      lineCount: 3,
      rows: [{ role: 'core', css: '#abc', label: 'Core', count: 2 }],
    },
  }));
  assert.match(parting, /data-parting-legend/);
  assert.match(parting, /data-mold-pane-end/);
  assert.match(parting, /Parting line · 3/);

  const sides = renderToStaticMarkup(React.createElement(SideActionLegend, {
    legend: {
      more: 0,
      rows: [{ id: 'a', kind: 'slide', css: '#abc', label: 'Slide', pull: '[0, 0, 1]' }],
    },
  }));
  assert.match(sides, /data-side-action-legend/);
  assert.match(sides, /data-mold-pane-end/);

  const draft = renderToStaticMarkup(React.createElement(MoldDraftLegend, {
    legend: { minDeg: 1, violations: 2, pins: 4, sleeves: 1, css: '#abc' },
  }));
  assert.match(draft, /data-mold-draft-legend/);
  assert.match(draft, /data-mold-pane-end/);

  const dfm = renderToStaticMarkup(React.createElement(DfmReportPanel, {
    report: {
      framing: 'Budgetary analysis',
      disclaimer: 'Not a binding supplier DFM.',
      fitLabel: 'OK',
      undercutCount: 0,
      pull: [0, 0, 1],
      pullSource: 'search',
      wall: { nominalKnown: true, nominal: 2, nominalMethod: 'median', thinCount: 0, thickCount: 0, max: 3 },
      draft: { violationCount: 0, minDeg: 1, minDraftDeg: 2 },
      sideActions: { slideCount: 0, lifterCount: 0, groups: [] },
      ejectors: { pinCount: 1, sleeveCount: 0 },
      naming: { stamped: false, note: 'Face names are not available.' },
    },
  }));
  assert.match(dfm, /data-mold-dfm-report/);
  assert.match(dfm, /mold-analysis-pane/);
  assert.match(dfm, /overflow-y-auto/);
  assert.match(dfm, /data-mold-pane-end/);
  assert.match(dfm, /Face names are not available/);

  const quote = renderToStaticMarkup(React.createElement(MoldQuotePanel, {
    state: {
      quantity: 10,
      cavityCount: 1,
      status: 'ready',
      selected: 'North shop',
      quote: {
        framing: 'Budgetary quote',
        disclaimer: 'Budgetary, not binding.',
        vendors: [{
          anonLabel: 'North shop',
          region: 'US',
          machineCount: 2,
          aluminumUsd: 1.5,
          steelUsd: 3,
          range: { lowUsd: 10, highUsd: 20 },
          steelCheaperAt: 500,
          grade: 'ABS',
          grades: [{ grade: 'ABS', usdPerKg: 2 }],
        }],
      },
      reviewPayable: true,
      reviewFeeUsd: 49,
    },
    onQuantity() {},
    onCavity() {},
    onGrade() {},
    onSelect() {},
    onFirmQuote() {},
    onHumanReview() {},
    onPayReview() {},
  }));
  assert.match(quote, /data-mold-quote-panel/);
  assert.match(quote, /mold-analysis-pane/);
  assert.match(quote, /overflow-y-auto/);
  assert.match(quote, /data-mold-pay-review/);
  assert.match(quote, /data-mold-pane-end/);
  const payAt = quote.indexOf('data-mold-pay-review');
  const endAt = quote.indexOf('data-mold-pane-end');
  assert.ok(payAt > 0 && endAt > payAt);
});
