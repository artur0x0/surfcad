import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEdgeList, buildFaceList, buildGroupedEdgeList, buildNamedEdgeList } from './listPickables.js';

test('buildFaceList returns keys agents can pass to select_faces', () => {
  const out = buildFaceList([{
    at: [20, 0, 0],
    n: [1, 0, 0],
    area: 600,
    tris: [1, 2, 3],
  }]);
  assert.equal(out.faces.length, 1);
  assert.deepEqual(out.faces[0].key.at, [20, 0, 0]);
  assert.equal(out.faces[0].triangleCount, 3);
});

test('buildFaceList carries the face id, type, and cylinder axis and radius', () => {
  const out = buildFaceList([
    { faceId: 'f0', type: 'planar', at: [0, 0, 10], n: [0, 0, 1], area: 100, tris: [0, 1] },
    {
      faceId: 'f1',
      type: 'cylindrical',
      at: [0, 0, 5],
      n: [1, 0, 0],
      area: 250,
      tris: [2, 3, 4, 5],
      axis: { at: [0, 0, 5], dir: [0, 0, 1], radius: 4 },
    },
  ]);
  assert.deepEqual(out.faces.map((row) => [row.id, row.type]), [['f0', 'planar'], ['f1', 'cylindrical']]);
  assert.equal(out.faces[0].radius, undefined);
  assert.equal(out.faces[1].radius, 4);
  assert.deepEqual(out.faces[1].axis.dir, [0, 0, 1]);
});

test('buildEdgeList attaches adjacent face keys when tri0/tri1 are present', () => {
  const fingerprints = [
    { at: [20, 0, 0], n: [1, 0, 0], area: 600, tris: [0] },
    { at: [0, 0, 10], n: [0, 0, 1], area: 1200, tris: [1] },
  ];
  const edges = [{
    key: '1-2',
    a: 1,
    b: 2,
    mid: [20, 0, 10],
    length: 30,
    n0: [1, 0, 0],
    n1: [0, 0, 1],
    tri0: 0,
    tri1: 1,
  }];
  const out = buildEdgeList(edges, fingerprints);
  assert.equal(out.edges.length, 1);
  assert.equal(out.edges[0].key, '1-2');
  assert.equal(out.edges[0].faceKeyA.area, 600);
  assert.equal(out.edges[0].faceKeyB.area, 1200);
});

test('buildGroupedEdgeList returns short boundary keys', () => {
  const topo = {
    faces: [
      { id: 1, center: [0, 0, 10], normal: [0, 0, 1], area: 400 },
      { id: 2, center: [0, 10, 0], normal: [0, 1, 0], area: 400 },
    ],
    edges: [{
      id: 3,
      faceA: 1,
      faceB: 2,
      length: 40,
      mid: [0, 5, 5],
      segments: [{ key: '1-2', length: 40, mid: [0, 5, 5] }],
    }],
  };
  const out = buildGroupedEdgeList(topo);
  assert.equal(out.edges.length, 1);
  assert.equal(out.edges[0].key, 'e3');
  assert.equal(out.edges[0].faceKeyA.area, 400);
});

test('buildNamedEdgeList keys rows by edge name with the list_faces keys of both sides', () => {
  const table = {
    edges: [
      { name: 'plate.right~plate.top', base: 'plate.right~plate.top', faces: ['plate.right', 'plate.top'], ordinal: 0, chains: 1, length: 20, closed: false, center: [10, 0, 5], segments: [[0, 1]], tris: [[0, 1]] },
      { name: 'plate.front~plate.top[1]', base: 'plate.front~plate.top', faces: ['plate.front', 'plate.top'], ordinal: 1, chains: 2, length: 8, closed: false, center: [0, -5, 5], segments: [[2, 3]], tris: [[2, 1]] },
      // A coplanar seam between two names: no crease, so the pick graph has no row for it.
      { name: 'a.top~b.top', base: 'a.top~b.top', faces: ['a.top', 'b.top'], ordinal: 0, chains: 1, length: 4, closed: false, center: [0, 0, 5], segments: [[7, 8]], tris: [[5, 6]] },
    ],
  };
  const fingerprints = [
    { tris: [0, 2], at: [10, 0, 0], n: [1, 0, 0], area: 100 },
    { tris: [1], at: [0, 0, 5], n: [0, 0, 1], area: 400 },
    { tris: [5, 6], at: [0, 0, 5], n: [0, 0, 1], area: 50 },
  ];
  const featureEdges = [{ a: 0, b: 1 }, { a: 3, b: 2 }];
  const out = buildNamedEdgeList(table, fingerprints, featureEdges);
  assert.deepEqual(out.edges.map((e) => e.key), ['plate.right~plate.top', 'plate.front~plate.top[1]']);
  const right = out.edges[0];
  assert.equal(right.name, right.key);
  assert.deepEqual([right.faceNameA, right.faceNameB], ['plate.right', 'plate.top']);
  assert.deepEqual(right.faceKeyA.n, [1, 0, 0]);
  assert.deepEqual(right.faceKeyB.n, [0, 0, 1]);
  assert.equal(right.faceKeyB.area, 400);
  assert.deepEqual(right.mid, [10, 0, 5]);
  assert.equal(out.edges[1].chains, 2);
  assert.equal(out.edges[1].ordinal, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});
