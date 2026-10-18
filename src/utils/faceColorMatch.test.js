import assert from 'node:assert/strict';
import test from 'node:test';
import { listDroppedFacePaints, matchFaceKeys } from './faceColorMatch.js';

const SURF = '2026-10-18-07-19-33-0215-1e48';

function face(id, at, extra = {}) {
  return {
    id,
    at,
    n: [0, 0, 1],
    area: 100,
    ...extra,
  };
}

const keyOf = (faceRow, extra = {}) => ({
  at: faceRow.at.slice(),
  n: faceRow.n.slice(),
  area: faceRow.area,
  ...extra,
});

test('a unique geometric hit matches when the feature index moved', () => {
  const row = face(1, [0, 0, 10], { src: -3, ord: 0 });
  const saved = keyOf(row, { src: -1, ord: 0 });
  const hit = matchFaceKeys([row], [{ key: saved, color: '#1a1a1a' }]);
  assert.equal(hit.matched.length, 1);
  assert.equal(hit.matched[0].face.id, 1);
  assert.equal(hit.missing.length, 0);
  assert.equal(hit.ambiguous.length, 0);
});

test('a stored feature index still wins when another face is also in tolerance', () => {
  const kept = face(1, [0, 0, 10], { src: -1, ord: 0 });
  const other = face(2, [0.4, 0, 10], { src: -2, ord: 0 });
  const saved = keyOf(kept, { src: -1, ord: 0 });
  const hit = matchFaceKeys([kept, other], [{ key: saved, color: '#333333' }]);
  assert.equal(hit.matched.length, 1);
  assert.equal(hit.matched[0].face.id, 1);
});

test('several geometric hits and no feature hit are ambiguous', () => {
  const a = face(1, [0, 0, 10], { src: -3, ord: 0 });
  const b = face(2, [0.4, 0, 10], { src: -4, ord: 0 });
  const saved = keyOf(a, { src: -1, ord: 0 });
  const hit = matchFaceKeys([a, b], [{ key: saved, color: '#aa1122' }]);
  assert.equal(hit.matched.length, 0);
  assert.equal(hit.ambiguous.length, 1);
  assert.equal(hit.missing.length, 0);
});

test('listDroppedFacePaints names the color and skips a whole-part color', () => {
  const row = face(1, [0, 0, 10]);
  const colors = {
    [SURF]: {
      part: '#1a1a1a',
      faces: [{ color: '#aa1122', key: { at: [0, 0, 20], n: [0, 0, 1], area: 100 } }],
    },
  };
  const dropped = listDroppedFacePaints([{ surfId: SURF, faces: [row] }], colors);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].surfId, SURF);
  assert.equal(dropped[0].color, '#aa1122');
  assert.equal(dropped[0].reason, 'missing');
  const kept = listDroppedFacePaints(
    [{ surfId: SURF, faces: [row] }],
    { [SURF]: { part: '#1a1a1a', faces: [{ color: '#aa1122', key: keyOf(row) }] } },
  );
  assert.deepEqual(kept, []);
});
