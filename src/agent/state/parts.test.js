import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPartsState } from './parts.js';

test('buildPartsState normalizes part rows', () => {
  assert.deepEqual(buildPartsState({
    activeId: 'p1',
    assemblyName: 'Asm',
    parts: [{ id: 'p1', name: 'Part 1', visible: false }],
  }), {
    activeId: 'p1',
    assemblyName: 'Asm',
    parts: [{ id: 'p1', name: 'Part 1', visible: false }],
  });
});
