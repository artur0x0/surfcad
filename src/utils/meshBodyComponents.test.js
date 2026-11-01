import assert from 'node:assert/strict';
import test from 'node:test';
import { listedBodies } from './meshBodyComponents.js';
import { omitMeshBodyFields } from './meshShip.js';

test('list_bodies follows kernel centroids, so a shell is one body', () => {
  const listed = listedBodies(
    [[0, 0, 0]],
    [
      { at: [0, 0, 0], triangles: [0, 1, 2] },
      { at: [0, 0, 0], triangles: [3, 4] },
    ],
  );
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0].at, [0, 0, 0]);
  assert.equal(listed[0].triangleCount, 5);
});

test('two kernel centroids stay two bodies', () => {
  const listed = listedBodies(
    [[0, 0, 0], [40, 0, 0]],
    [
      { at: [0, 0, 0], triangles: [0] },
      { at: [40, 0, 0], triangles: [1, 2] },
    ],
  );
  assert.equal(listed.length, 2);
  assert.deepEqual(listed.map((row) => row.at), [[0, 0, 0], [40, 0, 0]]);
  assert.deepEqual(listed.map((row) => row.triangleCount), [1, 2]);
});

test('with no kernel centroids each mesh island is a body', () => {
  const listed = listedBodies(null, [
    { center: [1, 2, 3], triangles: [0] },
    { at: [4, 5, 6], triangles: [1] },
  ]);
  assert.equal(listed.length, 2);
  assert.deepEqual(listed[0].at, [1, 2, 3]);
});

test('a warm omit-mesh result reports every cached centroid', () => {
  const fields = omitMeshBodyFields({
    bodyCentroids: [[0, 0, 0], [40, 0, 0]],
    baseCentroid: [0, 0, 0],
  });
  assert.equal(fields.bodyCount, 2);
  assert.deepEqual(fields.bodyCentroids, [[0, 0, 0], [40, 0, 0]]);
  const one = omitMeshBodyFields({ baseCentroid: [1, 2, 3] });
  assert.equal(one.bodyCount, 1);
  assert.deepEqual(one.bodyCentroids, [[1, 2, 3]]);
});
