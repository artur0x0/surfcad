import assert from 'node:assert/strict';
import test from 'node:test';
import { assemblyRows } from './assemblyRows.js';

const A = '2026-10-18-02-50-00-0001-aa01';
const B = '2026-10-18-02-50-00-0002-bb02';

test('saved v2 rows keep their order and mark the open one', () => {
  const rows = assemblyRows({ v2: [{ id: A, name: 'Gearbox' }, { id: B, name: 'Pi5 Case' }], open: { id: B, name: 'Pi5 Case' } });
  assert.deepEqual(rows, [
    { id: A, name: 'Gearbox', open: false },
    { id: B, name: 'Pi5 Case', open: true },
  ]);
});

test('an open assembly that is not saved yet is listed (fresh repo, no marker)', () => {
  const rows = assemblyRows({ v2: [], open: { id: A, name: 'Pi5 Case Acceptance' } });
  assert.deepEqual(rows, [{ id: A, name: 'Pi5 Case Acceptance', open: true }]);
});

test('a local working copy lists only the open assembly', () => {
  assert.deepEqual(assemblyRows({ open: { id: A, name: 'Assembly' } }), [{ id: A, name: 'Assembly', open: true }]);
  assert.deepEqual(assemblyRows({}), []);
});

test('name-only folder rows are not listed', () => {
  const rows = assemblyRows({ v2: [{ id: A, name: 'New' }], open: null });
  assert.deepEqual(rows, [{ id: A, name: 'New', open: false }]);
  assert.equal(rows.some((row) => row.legacy || row.id == null), false);
});

test('a v2 row without a name falls back to its id, and duplicates collapse', () => {
  const rows = assemblyRows({ v2: [{ id: A }, { id: A, name: 'twice' }], open: { id: A, name: '' } });
  assert.deepEqual(rows, [{ id: A, name: A, open: true }]);
});
