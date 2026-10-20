import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPartsState, partRunState } from './parts.js';

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

test('buildPartsState carries runState for every part and the crash record when there is one', () => {
  const out = buildPartsState({
    activeId: 'p1',
    assemblyName: 'Bike',
    parts: [
      { id: 'p1', name: 'Frame', visible: true, runState: 'ok' },
      { id: 'p2', name: 'Clamps', visible: true, runState: 'failed', crash: { reason: 'out_of_memory', workerRestarted: true, message: 'ran out of memory', wasmHeapMB: 4096, extra: 'dropped' } },
      { id: 'p3', name: 'Later', visible: false, runState: 'not_run_yet' },
      { id: 'p4', name: 'Odd', visible: true, runState: 'bogus', crash: 'nope' },
    ],
  });
  assert.equal(out.parts[0].runState, 'ok');
  assert.equal(out.parts[1].runState, 'failed');
  assert.deepEqual(out.parts[1].crash, { code: 'geometry_worker_crashed', reason: 'out_of_memory', workerRestarted: true, message: 'ran out of memory', wasmHeapMB: 4096 });
  assert.equal(out.parts[2].runState, 'not_run_yet');
  assert.equal('runState' in out.parts[3], false);
  assert.equal('crash' in out.parts[3], false);
});

test('partRunState reads a recorded run', () => {
  assert.equal(partRunState(undefined), 'not_run_yet');
  assert.equal(partRunState({ ok: true, mesh: {} }), 'ok');
  assert.equal(partRunState({ ok: false, empty: true }), 'ok');
  assert.equal(partRunState({ ok: false, skipped: true }), 'not_run_yet');
  assert.equal(partRunState({ ok: false, missing: true, error: 'missing' }), 'not_run_yet');
  assert.equal(partRunState({ ok: false, error: 'boom' }), 'failed');
  assert.equal(partRunState({ ok: false, error: 'crashed', crash: { reason: 'timeout' } }), 'failed');
});
