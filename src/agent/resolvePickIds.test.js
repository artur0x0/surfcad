import assert from 'node:assert/strict';
import test from 'node:test';
import { faceToAgentPick, resolveEdgeKeys, resolveFaceKeys } from './resolvePickIds.js';

const TOP = { at: [0, 0, 10], n: [0, 0, 1], area: 1200, tris: [0, 1] };

test('resolveFaceKeys matches one fingerprint', () => {
  const out = resolveFaceKeys([TOP], [{ at: [0, 0, 10], n: [0, 0, 1], area: 1200 }]);
  assert.equal(out.error, undefined);
  assert.equal(out.picks.length, 1);
  assert.deepEqual(out.picks[0].center, [0, 0, 10]);
});

test('resolveFaceKeys reports unknown face', () => {
  const out = resolveFaceKeys([TOP], [{ at: [99, 0, 10], n: [0, 0, 1], area: 1200 }]);
  assert.equal(out.error?.code, 'unknown_face');
});

test('faceToAgentPick copies triangle indices', () => {
  const pick = faceToAgentPick({ at: [0, 0, 10], n: [0, 0, 1], area: 1200, tris: [4, 5] });
  assert.deepEqual(pick.indices, [4, 5]);
  assert.equal(pick.area, 1200);
});

test('resolveEdgeKeys matches adjacent face keys from list_faces', () => {
  const fingerprints = [
    { at: [20, 0, 0], n: [1, 0, 0], area: 600, tris: [0] },
    { at: [0, 0, 10], n: [0, 0, 1], area: 1200, tris: [1] },
  ];
  const edge = {
    key: '1-2',
    mid: [0, 0, 0],
    length: 1,
    tri0: 0,
    tri1: 1,
    n0: [1, 0, 0],
    n1: [0, 0, 1],
  };
  const out = resolveEdgeKeys([edge], [{
    faceKeyA: { at: [20, 0, 0], n: [1, 0, 0], area: 600 },
    faceKeyB: { at: [0, 0, 10], n: [0, 0, 1], area: 1200 },
  }], null, fingerprints);
  assert.equal(out.edges.length, 1);
});

test('resolveEdgeKeys matches packed key', () => {
  const edge = { key: '1-2', a: 1, b: 2, mid: [0, 0, 0], n0: [0, 0, 1], n1: [1, 0, 0], va: [0, 0, 0], vb: [1, 0, 0] };
  const out = resolveEdgeKeys([edge], ['1-2']);
  assert.equal(out.edges.length, 1);
});
