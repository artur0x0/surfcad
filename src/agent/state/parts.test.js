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

test('buildPartsState copies assemblyId and omits path', () => {
  const out = buildPartsState({
    assemblyId: '2026-10-18-02-50-00-0001-aa01',
    activeId: 'p1',
    assemblyName: 'Gearbox',
    parts: [{ id: 'p1', name: 'Bracket', visible: true, path: 'parts/p1.js' }],
  });
  assert.equal(out.assemblyId, '2026-10-18-02-50-00-0001-aa01');
  assert.equal('path' in out.parts[0], false);
  assert.deepEqual(out.parts[0], { id: 'p1', name: 'Bracket', visible: true });
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
