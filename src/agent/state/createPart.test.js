import assert from 'node:assert/strict';
import test from 'node:test';
import { createdPartFromDocs, scriptRequestsRun } from './createPart.js';

test('scriptRequestsRun waits only for a non-blank script', () => {
  assert.equal(scriptRequestsRun(undefined), false);
  assert.equal(scriptRequestsRun(null), false);
  assert.equal(scriptRequestsRun(''), false);
  assert.equal(scriptRequestsRun('   \n'), false);
  assert.equal(scriptRequestsRun('let part = Manifold.cube([10, 10, 10], true);\nreturn part;\n'), true);
});

test('createdPartFromDocs returns the new row when activeId stayed on the old part', () => {
  const before = {
    activeId: 'old',
    parts: [{ id: 'old', name: 'Base' }],
  };
  const after = {
    activeId: 'old',
    parts: [
      { id: 'old', name: 'Base' },
      { id: 'new-part', name: 'Cube' },
    ],
  };
  const created = createdPartFromDocs(before, after);
  assert.equal(created?.id, 'new-part');
  assert.notEqual(created?.id, after.activeId);
});

test('createdPartFromDocs returns the new row when it was activated', () => {
  const before = { parts: [{ id: 'old' }] };
  const after = { activeId: 'new-part', parts: [{ id: 'old' }, { id: 'new-part' }] };
  assert.equal(createdPartFromDocs(before, after)?.id, 'new-part');
});

test('createdPartFromDocs does not guess when no single new row exists', () => {
  const before = { parts: [{ id: 'old' }] };
  assert.equal(createdPartFromDocs(before, before), null);
  assert.equal(createdPartFromDocs(before, { parts: [] }), null);
  assert.equal(createdPartFromDocs(null, null), null);
  const two = {
    parts: [{ id: 'old' }, { id: 'a' }, { id: 'b' }],
  };
  assert.equal(createdPartFromDocs(before, two), null);
});
