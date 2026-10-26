// Width of the feature card: the measured gap between the side rails,
// the same helper the sheet-metal chip uses, with a 10px side gap and
// a 22rem cap. Before the first measure, CSS uses a fallback width.
// Desktop left-aligns to the mounted left rail, or to the pane edge when
// that rail is absent. Phone (`compact`) still centers in the gap.
// `fullLeft` means the measure does not wait for a left rail. On desktop a
// rail that is mounted still sets the left edge. On a phone `fullLeft`
// ignores that rail and pins the left edge to the pane inset.
import { sheetChipBetweenRails } from './sheetMetal/sheetChipLayout.js';

export const FEATURE_SHEET_MAX_REM = 22;
export const FEATURE_SHEET_SIDE_GAP_PX = 10;

/**
 * Home-pill stack: 30px pill, its safe-area padding, and the old 10px gap.
 * The open feature card does not use this. The home-indicator golden still
 * names the formula. Fillet, chamfer, and the edge card dock with the shell.
 */
export const FEATURE_SHEET_BOTTOM_PHONE =
  'calc(30px + max(8px, env(safe-area-inset-bottom, 0px)) + 10px)';

/**
 * Phone, while the card is open. The stage switcher is hidden and the card's
 * bottom edge sits on the switcher's bottom edge. That edge is the pane
 * bottom: both are anchored there.
 */
export const FEATURE_SHEET_BOTTOM_PHONE_DOCKED = '0px';

/** Desktop: no bottom switcher. 10px, or the safe area when that is larger. */
export const FEATURE_SHEET_BOTTOM_DESKTOP =
  'max(10px, env(safe-area-inset-bottom, 0px))';

export function featureSheetBottom(compact) {
  return compact ? FEATURE_SHEET_BOTTOM_PHONE_DOCKED : FEATURE_SHEET_BOTTOM_DESKTOP;
}

/**
 * @param {Element} pane  the viewport shell
 * @param {number} [rootPx]  computed root font size, for the 22rem cap
 * @param {{ fullLeft?: boolean, compact?: boolean }} [options]
 *   `compact` is the phone shell. It keeps the old gap: centered when the
 *   gap is wider than 22rem, the whole gap when it is narrower. `fullLeft`
 *   on a phone skips the left rail and pins the left edge to the 10px pane
 *   inset.
 *   Desktop (`compact` false) left-aligns. The left edge is 10px to the
 *   right of the mounted `[data-rail-pair="left"]` box, or 10px from the
 *   pane when that rail is not mounted. `fullLeft` only means the measure
 *   does not wait for a left rail; a rail that is mounted still wins.
 *   Width is min(22rem, the space before the right rail minus 10px).
 * @returns {{ left: number, width: number }|null}
 */
export function measureFeatureSheetWidth(pane, rootPx = 16, { fullLeft = false, compact = false } = {}) {
  if (!pane || typeof pane.getBoundingClientRect !== 'function') return null;
  const right = pane.querySelector?.('[data-rail-pair="right"]');
  if (!right || typeof right.getBoundingClientRect !== 'function') return null;
  const paneBox = pane.getBoundingClientRect();
  const root = Number(rootPx);
  const maxWidth = (Number.isFinite(root) && root > 0 ? root : 16) * FEATURE_SHEET_MAX_REM;
  const rightBox = right.getBoundingClientRect();

  if (compact) {
    let leftBox;
    if (fullLeft) {
      leftBox = { left: paneBox.left, right: paneBox.left, width: 0 };
    } else {
      const left = pane.querySelector?.('[data-rail-pair="left"]');
      if (!left || typeof left.getBoundingClientRect !== 'function') return null;
      leftBox = left.getBoundingClientRect();
    }
    const placed = sheetChipBetweenRails(
      paneBox,
      leftBox,
      rightBox,
      { maxWidth, clearance: FEATURE_SHEET_SIDE_GAP_PX },
    );
    if (!placed || !fullLeft) return placed;
    // The gap is already capped, so pinning the left edge keeps the right
    // edge at least FEATURE_SHEET_SIDE_GAP_PX clear of the right rail.
    return { left: FEATURE_SHEET_SIDE_GAP_PX, width: placed.width };
  }

  const left = pane.querySelector?.('[data-rail-pair="left"]');
  const leftBox = left && typeof left.getBoundingClientRect === 'function'
    ? left.getBoundingClientRect()
    : { left: paneBox.left, right: paneBox.left, width: 0 };
  const placed = sheetChipBetweenRails(
    paneBox,
    leftBox,
    rightBox,
    { maxWidth, clearance: FEATURE_SHEET_SIDE_GAP_PX },
  );
  if (!placed) return null;
  // Live rail box only. No stored rail width. `fullLeft` is unused here:
  // a mounted left rail sets the edge, and a missing one is the pane inset.
  const gapLeft = (leftBox.right - paneBox.left) + FEATURE_SHEET_SIDE_GAP_PX;
  return { left: gapLeft, width: placed.width };
}
