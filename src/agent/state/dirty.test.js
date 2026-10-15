import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDirtyState } from './dirty.js';

test('buildDirtyState copies part ids and flags', () => {
  assert.deepEqual(buildDirtyState({
    workspaceDirty: true,
    partIds: ['a', 'b'],
    assemblyDirty: true,
    renamePending: true,
  }), {
    workspaceDirty: true,
    assemblyDirty: true,
    renamePending: true,
    legacyCleanup: false,
    partIds: ['a', 'b'],
    unsaved: false,
    editedSinceLoad: [],
  });
});

test('buildDirtyState folds undoStackDirty into workspaceDirty', () => {
  assert.deepEqual(buildDirtyState({ undoStackDirty: true }), {
    workspaceDirty: true,
    assemblyDirty: false,
    renamePending: false,
    legacyCleanup: false,
    partIds: [],
    unsaved: true,
    editedSinceLoad: [],
    undoStackDirty: true,
  });
});

test('buildDirtyState sets unsaved from editedSinceLoad', () => {
  assert.deepEqual(buildDirtyState({ editedSinceLoad: ['p1'] }), {
    workspaceDirty: false,
    assemblyDirty: false,
    renamePending: false,
    legacyCleanup: false,
    partIds: [],
    unsaved: true,
    editedSinceLoad: ['p1'],
  });
});
