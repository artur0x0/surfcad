import assert from 'node:assert/strict';
import test from 'node:test';
import { editedPartIdsSinceSnapshot, snapshotPartScripts } from './editedSinceLoad.js';

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
