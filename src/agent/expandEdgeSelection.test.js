import assert from 'node:assert/strict';
import test from 'node:test';
import { expandResolvedEdgesForHelper } from './expandEdgeSelection.js';

test('expandResolvedEdgesForHelper expands boundaryId to coherent chain', () => {
  const coherent = [
    {
      key: 'coh-0-0',
      a: 1,
      b: 2,
      va: [0, 0, 0],
      vb: [10, 0, 0],
      length: 10,
      n0: [0, 0, 1],
      n1: [0, 1, 0],
      boundaryId: 0,
    },
    {
      key: 'coh-0-1',
      a: 2,
      b: 3,
      va: [10, 0, 0],
      vb: [20, 0, 0],
      length: 10,
      n0: [0, 0, 1],
      n1: [0, 1, 0],
      boundaryId: 0,
    },
  ];
  const thin = { key: '1-2', mid: [5, 0, 0], length: 10, boundaryId: 0 };
  const out = expandResolvedEdgesForHelper([thin], { coherent });
  assert.equal(out.length, 2);
  assert.ok(out[0].va);
});
