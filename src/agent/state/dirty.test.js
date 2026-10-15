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
  });
});
