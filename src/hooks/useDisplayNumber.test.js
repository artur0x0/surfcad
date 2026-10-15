import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDisplayNumber, isFormattedDisplayEcho } from '../utils/displayUnit.js';

/**
 * Mirrors `useDisplayNumber` shown value after onChange (focused).
 * Guards the clear-then-type-0 path where an echo match must drop a stale `''` draft.
 */
function shownAfterChange(value, draft, raw, focused = true) {
  let nextDraft = draft;
  if (raw === '' || raw === '-' || raw === '.') {
    if (focused) nextDraft = raw;
  } else if (isFormattedDisplayEcho(value, raw)) {
    if (focused) nextDraft = null;
  } else if (focused) {
    nextDraft = raw;
  }
  const partial = value === '' || value === '-' || value === '.';
  const formatted = partial
    ? value
    : (Number.isFinite(Number(value)) ? formatDisplayNumber(value) : (value ?? ''));
  return nextDraft != null ? nextDraft : (formatted ?? '');
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
