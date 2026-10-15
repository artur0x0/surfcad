import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitDisplayLength,
  formatDisplayNumber,
  finiteStoredNumber,
  isFormattedDisplayEcho,
  isPartialNumberEntry,
} from '../utils/displayUnit.js';

/**
 * Mirrors `useDisplayNumber` shown value after onChange (focused).
 * Guards the clear-then-type-0 path where an echo match must drop a stale `''` draft.
 */
function shownAfterChange(value, draft, raw, focused = true) {
  let nextDraft = draft;
  if (isPartialNumberEntry(raw)) {
    if (focused) nextDraft = raw;
  } else if (isFormattedDisplayEcho(value, raw)) {
    if (focused) nextDraft = null;
  } else if (focused) {
    nextDraft = raw;
  }
  const partial = isPartialNumberEntry(value);
  const formatted = partial
    ? value
    : (Number.isFinite(finiteStoredNumber(value)) ? formatDisplayNumber(value) : (value ?? ''));
  return nextDraft != null ? nextDraft : (formatted ?? '');
}

/** Mirrors `LengthNumberField` commit + parent state update. */
function applyLengthChange(valueMm, raw, unit) {
  const next = commitDisplayLength(raw, valueMm, unit);
  if (!isPartialNumberEntry(raw) && next === valueMm) return valueMm;
  return next;
}

function shownAfterBlur(value, draft, unit = 'mm') {
  let stored = value;
  if (draft != null && !isPartialNumberEntry(draft) && !isFormattedDisplayEcho(stored, draft)) {
    stored = applyLengthChange(stored, draft, unit);
  }
  const partial = isPartialNumberEntry(stored);
  const n = finiteStoredNumber(stored);
  const formatted = partial
    ? stored
    : (Number.isFinite(n) ? formatDisplayNumber(n) : '');
  return formatted ?? '';
}

test('typing 0 after clearing shows 0 when the stored value is still 0', () => {
  assert.equal(shownAfterChange(0, '', '0'), '0');
});

test('typing 0 after clearing shows 0 for a sub-millimetre stored length', () => {
  const storedMm = 0.00004;
  const display = storedMm;
  assert.equal(shownAfterChange(display, '', '0'), '0');
});

test('partial drafts still show while editing', () => {
  assert.equal(shownAfterChange(5, '-', '-'), '-');
  assert.equal(shownAfterChange(5, '.', '.'), '.');
  assert.equal(shownAfterChange(5, '', ''), '');
});

test('clear, type 0, then blur keeps 0 mm stored and visible', () => {
  let widthMm = 40;
  widthMm = applyLengthChange(widthMm, '', 'mm');
  assert.equal(widthMm, '');
  widthMm = applyLengthChange(widthMm, '0', 'mm');
  assert.equal(widthMm, 0);
  assert.equal(shownAfterBlur(widthMm, null), '0');
  assert.equal(shownAfterBlur('', '0'), '0');
});
