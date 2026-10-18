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

test('buildPartsState keeps vaultLayout and missing rows', () => {
  assert.deepEqual(buildPartsState({
    activeId: 'p1',
    assemblyName: 'Gearbox',
    vaultLayout: 'legacy',
    parts: [{ id: 'p1', name: 'Missing gear', visible: true, missing: true }],
  }), {
    activeId: 'p1',
    assemblyName: 'Gearbox',
    vaultLayout: 'legacy',
    parts: [{ id: 'p1', name: 'Missing gear', visible: true, missing: true }],
  });
  assert.equal(Object.hasOwn(buildPartsState({ vaultLayout: 'other' }), 'vaultLayout'), false);
});
