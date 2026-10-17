import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adoptSavedScript,
  editorMountSeedsHistory,
  emptyPartHistory,
  historyForPart,
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
