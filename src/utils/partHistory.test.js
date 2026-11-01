import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adoptSavedScript,
  editorMountSeedsHistory,
  emptyPartHistory,
  historyForPart,
  openedPartHistory,
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

test('openedPartHistory keeps a matching head and drops a different branch', () => {
  const opened = 'return part;\n';
  const fresh = openedPartHistory(null, opened);
  assert.equal(fresh.commits[fresh.head].code, opened);
  const same = openedPartHistory(fresh, opened);
  assert.equal(same, fresh);
  const other = pushPartHistory(emptyPartHistory(), 'return other;\n', 'Other branch');
  const replaced = openedPartHistory(other, opened);
  assert.equal(replaced.commits[replaced.head].code, opened);
  assert.equal(replaced.commits.some((row) => row.code === 'return other;\n'), false);
});

test('adoptSavedScript records a new Save head and is a no-op for the same text', () => {
  const raw = 'return Manifold.cube([8, 8, 8], true);\n';
  const saved = `// --- code begin ---\n${raw}// --- code end ---\n`;
  const before = historyForPart({}, 'p', raw);
  assert.equal(before.commits[before.head].code, raw);
  const adopted = adoptSavedScript(before, saved);
  assert.equal(adopted.commits[adopted.head].code, saved);
  assert.ok(adopted.head > before.head);
  const again = adoptSavedScript(adopted, saved);
  assert.equal(again.head, adopted.head);
  assert.equal(again.commits.length, adopted.commits.length);
  const fresh = adoptSavedScript(emptyPartHistory(), saved);
  assert.equal(fresh.commits[fresh.head].code, saved);
});
