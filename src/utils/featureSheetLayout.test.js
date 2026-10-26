import assert from 'node:assert/strict';
import test from 'node:test';
import { measureFeatureSheetWidth } from './featureSheetLayout.js';

function box(left, right, top = 0, bottom = 800) {
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

function pane({ width, paneLeft = 0, leftRail = null, rightRail = null }) {
  const paneBox = box(paneLeft, paneLeft + width);
  const nodes = [];
  if (leftRail) nodes.push({ attr: 'left', getBoundingClientRect: () => leftRail });
  if (rightRail) nodes.push({ attr: 'right', getBoundingClientRect: () => rightRail });
  return {
    getBoundingClientRect: () => paneBox,
    querySelector(sel) {
      const which = sel.includes('"left"') ? 'left' : (sel.includes('"right"') ? 'right' : '');
      return nodes.find((node) => node.attr === which) || null;
    },
  };
}

test('on desktop the card sits 10px right of the left rail, capped at 22rem', () => {
  const placed = measureFeatureSheetWidth(pane({
    width: 1200,
    leftRail: box(16, 80),
    rightRail: box(1138, 1190),
  }), 16);
  assert.equal(placed.width, 352);
  assert.equal(placed.left, 90);
  assert.ok(1138 - (placed.left + placed.width) >= 10);
});

test('on desktop a missing left rail pins the left edge 10px from the pane', () => {
  const placed = measureFeatureSheetWidth(pane({
    width: 1200,
    paneLeft: 40,
    rightRail: box(40 + 1138, 40 + 1190),
  }), 16);
  assert.equal(placed.left, 10);
  assert.equal(placed.width, 352);
  assert.ok((40 + 1138) - (40 + placed.left + placed.width) > 10);
});

test('on desktop fullLeft follows a mounted left rail instead of the pane edge', () => {
  const placed = measureFeatureSheetWidth(pane({
    width: 1200,
    leftRail: box(16, 80),
    rightRail: box(1138, 1190),
  }), 16, { fullLeft: true });
  assert.equal(placed.left, 90);
  assert.equal(placed.width, 352);
});

test('a phone card stays centered in a wide gap', () => {
  const placed = measureFeatureSheetWidth(pane({
    width: 1200,
    leftRail: box(16, 80),
    rightRail: box(1138, 1190),
  }), 16, { compact: true });
  assert.equal(placed.width, 352);
  assert.equal(placed.left, 90 + (1038 - 352) / 2);
});

test('a phone gap under 22rem uses the whole gap between the rails', () => {
  const placed = measureFeatureSheetWidth(pane({
    width: 390,
    leftRail: box(8, 64),
    rightRail: box(328, 380),
  }), 16, { compact: true });
  assert.equal(placed.left, 74);
  assert.equal(placed.width, 244);
  assert.ok(328 - (placed.left + placed.width) >= 10);
});

test('fullLeft on a phone pins the left edge at 10px and stays clear of the right rail', () => {
  const phone = measureFeatureSheetWidth(pane({
    width: 390,
    rightRail: box(328, 380),
  }), 16, { fullLeft: true, compact: true });
  assert.equal(phone.left, 10);
  assert.equal(phone.width, 308);
  assert.equal(328 - (phone.left + phone.width), 10);

  const wide = measureFeatureSheetWidth(pane({
    width: 1200,
    paneLeft: 40,
    rightRail: box(40 + 1138, 40 + 1190),
  }), 16, { fullLeft: true, compact: true });
  assert.equal(wide.left, 10);
  assert.equal(wide.width, 352);
  assert.ok((40 + 1138) - (40 + wide.left + wide.width) > 10);
});

test('fullLeft on a phone ignores a left rail that is still in the pane', () => {
  const placed = measureFeatureSheetWidth(pane({
    width: 390,
    leftRail: box(8, 64),
    rightRail: box(328, 380),
  }), 16, { fullLeft: true, compact: true });
  assert.equal(placed.left, 10);
  assert.equal(placed.width, 308);
});

test('a missing right rail returns null; a phone still waits for the left rail', () => {
  const rightOnly = pane({ width: 390, rightRail: box(328, 380) });
  const leftOnly = pane({ width: 390, leftRail: box(8, 64) });
  const wideRightOnly = pane({ width: 1200, rightRail: box(1138, 1190) });
  assert.equal(measureFeatureSheetWidth(rightOnly, 16, { compact: true }), null);
  assert.equal(measureFeatureSheetWidth(leftOnly, 16, { fullLeft: true }), null);
  assert.equal(measureFeatureSheetWidth(leftOnly, 16, { fullLeft: true, compact: true }), null);
  assert.equal(measureFeatureSheetWidth(rightOnly, 16, { fullLeft: true, compact: true }).left, 10);
  const desktop = measureFeatureSheetWidth(wideRightOnly, 16);
  assert.equal(desktop.left, 10);
  assert.equal(desktop.width, 352);
  assert.equal(measureFeatureSheetWidth(wideRightOnly, 16, { fullLeft: true }).left, 10);
});
