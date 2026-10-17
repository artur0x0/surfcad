import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  editorMountSeedsHistory,
  emptyPartHistory,
  pushPartHistory,
} from './partHistory.js';

test('a fresh part still seeds history from the editor mount', () => {
  assert.equal(editorMountSeedsHistory(null), true);
  assert.equal(editorMountSeedsHistory(emptyPartHistory()), true);
});

test('a remount does not stack the boot script on the live step', () => {
  const live = pushPartHistory(emptyPartHistory(), 'return bump;', 'Agent script');
  assert.equal(editorMountSeedsHistory(live), false);
  assert.equal(live.commits[live.head].message, 'Agent script');
});
