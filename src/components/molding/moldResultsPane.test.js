import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_SHEET_SIDE_GAP_PX, measureFeatureSheetWidth } from '../../utils/featureSheetLayout.js';

function el(rect, query = {}) {
  return {
    getBoundingClientRect() { return rect; },
    querySelector(sel) { return query[sel] || null; },
  };
}

function overlaps(a, b) {
  return a.left < b.right - 0.01
    && a.right > b.left + 0.01
    && a.top < b.bottom - 0.01
    && a.bottom > b.top + 0.01;
}

/**
 * Viewport at `width`×`height` with a left rail and a right rail that share
 * the pane's vertical band. Insets match left-2 / lg:left-4 and right-2.5.
 * Rail width is the w-16 toolbar.
 */
function hostAt(width, height, { leftInset, rightInset, railW }) {
  const pane = { left: 0, top: 0, right: width, bottom: height, width, height };
  const left = {
    left: leftInset,
    top: 112,
    right: leftInset + railW,
    bottom: height - 10,
    width: railW,
    height: height - 122,
  };
  const rightLeft = width - rightInset - railW;
  const right = {
    left: rightLeft,
    top: 112,
    right: rightLeft + railW,
    bottom: height - 10,
    width: railW,
    height: height - 122,
  };
  return {
    pane,
    left,
    right,
    host: el(pane, {
      '[data-rail-pair="left"]': el(left),
      '[data-rail-pair="right"]': el(right),
    }),
  };
}

function assertClear(name, width, height, compact, insets) {
  const { pane, left, right, host } = hostAt(width, height, insets);
  const frame = measureFeatureSheetWidth(host, 16, { fullLeft: false, compact });
  assert.ok(frame && frame.width > 0, name);
  const box = {
    left: pane.left + frame.left,
    right: pane.left + frame.left + frame.width,
    top: 140,
    bottom: Math.min(height - 40, 520),
  };
  assert.equal(overlaps(box, left), false, `${name} left rail`);
  assert.equal(overlaps(box, right), false, `${name} right rail`);
  assert.ok(
    box.left >= left.right + FEATURE_SHEET_SIDE_GAP_PX - 0.01,
    `${name} left gap ${box.left - left.right}`,
  );
  assert.ok(
    box.right <= right.left - FEATURE_SHEET_SIDE_GAP_PX + 0.01,
    `${name} right gap ${right.left - box.right}`,
  );
}

test('the molding results pane misses both toolbars at 1280×800 and 390×844', () => {
  assertClear('1280x800', 1280, 800, false, { leftInset: 16, rightInset: 10, railW: 64 });
  assertClear('390x844', 390, 844, true, { leftInset: 8, rightInset: 10, railW: 64 });
  assertClear('narrow desktop', 420, 800, false, { leftInset: 8, rightInset: 10, railW: 64 });
});
