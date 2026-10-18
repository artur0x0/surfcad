import assert from 'node:assert/strict';
import test from 'node:test';
import { editedPartIdsSinceSnapshot, liveEditorOverride, snapshotPartScripts } from './editedSinceLoad.js';

test('snapshotPartScripts folds the live editor buffer for the active part', () => {
  assert.deepEqual(snapshotPartScripts({ a: 'old' }, { liveId: 'a', liveScript: 'new' }), { a: 'new' });
});

test('editedPartIdsSinceSnapshot lists changed and new parts', () => {
  const snap = snapshotPartScripts({ a: 'one', b: 'two' });
  const edited = editedPartIdsSinceSnapshot(snap, { a: 'one!', b: 'two', c: 'three' }, {
    partIds: ['a', 'b', 'c'],
  });
  assert.deepEqual(edited, ['a', 'c']);
});

test('open_assembly snapshot ignores a stale editor buffer until the editor is live', () => {
  const opened = { a: 'return cube;' };
  const staleEditor = 'return previous assembly;';
  const poisoned = snapshotPartScripts(opened, liveEditorOverride({
    editorLive: true,
    activeId: 'a',
    script: staleEditor,
  }) || {});
  assert.equal(poisoned.a, staleEditor);
  assert.deepEqual(
    editedPartIdsSinceSnapshot(poisoned, opened, { liveId: 'a', liveScript: opened.a }),
    ['a'],
  );

  assert.equal(liveEditorOverride({
    editorLive: false,
    activeId: 'a',
    script: staleEditor,
  }), null);
  const clean = snapshotPartScripts(opened, liveEditorOverride({
    editorLive: false,
    activeId: 'a',
    script: staleEditor,
  }) || {});
  assert.equal(clean.a, opened.a);
  assert.deepEqual(
    editedPartIdsSinceSnapshot(clean, opened, liveEditorOverride({
      editorLive: true,
      activeId: 'a',
      script: opened.a,
    }) || {}),
    [],
  );
});
