import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newPartRowPosition } from './assembly.js';

test('newPartRowPosition staggers UI parts and keeps agents at the origin', () => {
  assert.equal(newPartRowPosition(0, {}), undefined);
  assert.deepEqual(newPartRowPosition(2, {}), [80, 0, 0]);
  assert.equal(newPartRowPosition(1, { fromAgent: true }), undefined);
  assert.deepEqual(newPartRowPosition(3, { fromAgent: true, position: [5, 0, 0] }), [5, 0, 0]);
});
