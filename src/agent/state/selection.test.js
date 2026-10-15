import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSelection } from './selection.js';

test('buildSelection serializes face, edges, and contour ids', () => {
  const row = buildSelection({
    activePartId: 'part-a',
    cadPartId: 'part-b',
    face: {
      type: 'planar',
      center: [1, 2, 3],
      normal: [0, 0, 1],
      area: 12.5,
    },
    edges: [{
      a: 1,
      b: 4,
      va: [0, 0, 0],
      vb: [1, 0, 0],
      mid: [0.5, 0, 0],
      length: 1,
      n0: [0, 0, 1],
      n1: [0, 1, 0],
      partId: 'part-a',
    }],
    armedContourId: 'c1',
    selectedPlaneId: 'xy',
  });
  assert.equal(row.activePartId, 'part-a');
  assert.equal(row.cadPartId, 'part-b');
  assert.equal(row.face.key.area, 12.5);
  assert.equal(row.edges[0].key, '1-4');
  assert.equal(row.contour.armedId, 'c1');
});
