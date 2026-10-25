import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkEdgeFilter,
  checkFaceFilter,
  checkPage,
  filterEdges,
  filterFaces,
  paginate,
  sameFaceKey,
  shapeListResult,
} from './listFilters.js';

const TOP = { id: 'f0', type: 'planar', kind: 'planar', key: { at: [0, 0, 10], n: [0, 0, 1], area: 1200 }, center: [0, 0, 10], normal: [0, 0, 1], area: 1200, triangleCount: 2 };
const TILTED = { id: 'f1', type: 'planar', kind: 'planar', key: { at: [0, 0, 9], n: [0, 0.0872, 0.9962], area: 400 }, center: [0, 0, 9], normal: [0, 0.0872, 0.9962], area: 400, triangleCount: 2 };
const SIDE = { id: 'f2', type: 'planar', kind: 'planar', key: { at: [20, 0, 0], n: [1, 0, 0], area: 600 }, center: [20, 0, 0], normal: [1, 0, 0], area: 600, triangleCount: 2 };
const BORE = { id: 'f3', type: 'cylindrical', kind: 'cylindrical', key: { at: [0, 0, 5], n: [1, 0, 0], area: 250 }, center: [0, 0, 5], normal: [1, 0, 0], area: 250, triangleCount: 48, axis: { at: [0, 0, 5], dir: [0, 0, 1], radius: 4 }, radius: 4 };
const FACES = [TOP, TILTED, SIDE, BORE];

test('filterFaces by kind, normal cone, area, and bbox', () => {
  assert.deepEqual(filterFaces(FACES, null).map((r) => r.id), ['f0', 'f1', 'f2', 'f3']);
  assert.deepEqual(filterFaces(FACES, {}).map((r) => r.id), ['f0', 'f1', 'f2', 'f3']);
  assert.deepEqual(filterFaces(FACES, { kind: 'cylindrical' }).map((r) => r.id), ['f3']);
  assert.deepEqual(filterFaces(FACES, { normalWithin: { n: [0, 0, 2], deg: 1 } }).map((r) => r.id), ['f0']);
  assert.deepEqual(filterFaces(FACES, { normalWithin: { n: [0, 0, 1], deg: 10 } }).map((r) => r.id), ['f0', 'f1']);
  assert.deepEqual(filterFaces(FACES, { kind: 'planar', minArea: 500 }).map((r) => r.id), ['f0', 'f2']);
  assert.deepEqual(filterFaces(FACES, { maxArea: 300 }).map((r) => r.id), ['f3']);
  assert.deepEqual(filterFaces(FACES, { bbox: { min: [-1, -1, 8], max: [1, 1, 11] } }).map((r) => r.id), ['f0', 'f1']);
  assert.deepEqual(filterFaces(FACES, { kind: 'planar', normalWithin: { n: [0, 0, 1], deg: 10 }, minArea: 1000 }).map((r) => r.id), ['f0']);
  // The input is not mutated.
  assert.equal(FACES.length, 4);
});

test('checkFaceFilter names the bad field', () => {
  assert.equal(checkFaceFilter(undefined), null);
  assert.equal(checkFaceFilter({ kind: 'planar', normalWithin: { n: [0, 0, 1], deg: 5 }, minArea: 1, bbox: { min: [0, 0, 0], max: [1, 1, 1] } }), null);
  assert.match(checkFaceFilter([]).message, /object/);
  assert.match(checkFaceFilter({ kind: 'flat' }).message, /filter\.kind/);
  assert.equal(checkFaceFilter({ feature: 'cube1' }), null, 'feature is a face identity filter');
  assert.match(checkFaceFilter({ feature: '' }).message, /filter\.feature/);
  assert.match(checkFaceFilter({ colour: 'red' }).message, /filter\.colour is not a face filter/);
  assert.match(checkFaceFilter({ normalWithin: { n: [0, 0, 0], deg: 5 } }).message, /normalWithin/);
  assert.match(checkFaceFilter({ normalWithin: { n: [0, 0, 1], deg: 200 } }).message, /deg/);
  assert.match(checkFaceFilter({ minArea: -1 }).message, /minArea/);
  assert.match(checkFaceFilter({ bbox: { min: [2, 0, 0], max: [1, 1, 1] } }).message, /bbox min/);
  assert.equal(checkFaceFilter({ kind: 'flat' }).code, 'bad_args');
});

const E1 = { key: 'e0', mid: [20, 0, 10], length: 30, faceKeyA: { at: [20, 0, 0], n: [1, 0, 0], area: 600 }, faceKeyB: { at: [0, 0, 10], n: [0, 0, 1], area: 1200 } };
const E2 = { key: 'e1', mid: [0, 15, 10], length: 40, faceKeyA: { at: [0, 0, 10], n: [0, 0, 1], area: 1200 }, faceKeyB: { at: [0, 15, 0], n: [0, 1, 0], area: 800 } };
const E3 = { key: 'e2', mid: [0, 0, 5], length: 25.13, faceKeyA: { at: [0, 0, 5], n: [1, 0, 0], area: 250, src: -3, ord: 0 }, faceKeyB: { at: [0, 0, 10], n: [0, 0, 1], area: 1200 } };
const EDGES = [E1, E2, E3];

test('sameFaceKey tolerates float noise and ignores src/ord', () => {
  assert.equal(sameFaceKey({ at: [20, 0, 0], n: [1, 0, 0], area: 600 }, { at: [20.0004, 0, 0], n: [0.99999, 0.0001, 0], area: 600.3, src: -1, ord: 2 }), true);
  assert.equal(sameFaceKey({ at: [20, 0, 0], n: [1, 0, 0], area: 600 }, { at: [20, 0, 0], n: [1, 0, 0], area: 601 }), false);
  assert.equal(sameFaceKey({ at: [20, 0, 0], n: [1, 0, 0], area: 600 }, { at: [20, 0, 0.01], n: [1, 0, 0], area: 600 }), false);
  assert.equal(sameFaceKey(null, { at: [0, 0, 0], n: [1, 0, 0], area: 1 }), false);
});

test('filterEdges by between (either order), length, and bbox', () => {
  const top = { at: [0, 0, 10], n: [0, 0, 1], area: 1200 };
  const side = { at: [20, 0, 0], n: [1, 0, 0], area: 600 };
  assert.deepEqual(filterEdges(EDGES, { between: [top, side] }).map((r) => r.key), ['e0']);
  assert.deepEqual(filterEdges(EDGES, { between: [side, top] }).map((r) => r.key), ['e0']);
  assert.deepEqual(filterEdges(EDGES, { between: [top, { at: [0, 0, 5], n: [1, 0, 0], area: 250 }] }).map((r) => r.key), ['e2']);
  assert.deepEqual(filterEdges(EDGES, { minLength: 30 }).map((r) => r.key), ['e0', 'e1']);
  assert.deepEqual(filterEdges(EDGES, { maxLength: 26 }).map((r) => r.key), ['e2']);
  assert.deepEqual(filterEdges(EDGES, { bbox: { min: [-1, -1, 0], max: [1, 1, 20] } }).map((r) => r.key), ['e2']);
  assert.deepEqual(filterEdges(EDGES, {}).length, 3);
});

test('checkEdgeFilter and checkPage name the bad field', () => {
  assert.equal(checkEdgeFilter({ between: [E1.faceKeyA, E1.faceKeyB], minLength: 1 }), null);
  assert.match(checkEdgeFilter({ between: ['f1', 'f2'] }).message, /two face keys/);
  assert.match(checkEdgeFilter({ between: [E1.faceKeyA] }).message, /two face keys/);
  assert.match(checkEdgeFilter({ kind: 'planar' }).message, /not an edge filter/);
  assert.equal(checkPage(undefined), null);
  assert.equal(checkPage({ offset: 0, limit: 5 }), null);
  assert.match(checkPage({ offset: -1 }).message, /offset/);
  assert.match(checkPage({ limit: 0 }).message, /limit/);
  assert.match(checkPage({ limit: 2.5 }).message, /limit/);
  assert.match(checkPage({ size: 10 }).message, /page\.size/);
  assert.match(checkPage(5).message, /page must be/);
});

test('paginate and shapeListResult report total and returned', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(paginate(rows, null), { rows, total: 5, returned: 5 });
  assert.deepEqual(paginate(rows, { offset: 1, limit: 2 }), { rows: ['b', 'c'], total: 5, returned: 2, offset: 1, limit: 2 });
  assert.deepEqual(paginate(rows, { offset: 4 }), { rows: ['e'], total: 5, returned: 1, offset: 4 });
  assert.deepEqual(paginate(rows, { offset: 9, limit: 2 }), { rows: [], total: 5, returned: 0, offset: 9, limit: 2 });

  const host = { partId: 'p1', faces: FACES, raw: true };
  const shaped = shapeListResult(host, 'faces', filterFaces(FACES, { kind: 'planar' }), { offset: 1, limit: 1 });
  assert.equal(shaped.partId, 'p1');
  assert.equal(shaped.raw, true);
  assert.deepEqual(shaped.faces.map((r) => r.id), ['f1']);
  assert.equal(shaped.total, 3);
  assert.equal(shaped.returned, 1);
  assert.equal(shaped.frame, 'local');
  assert.equal(shaped.offset, 1);
  assert.equal(shaped.limit, 1);
  assert.equal(host.faces.length, 4, 'host rows untouched');
  const plain = shapeListResult(host, 'faces', filterFaces(FACES, null), undefined);
  assert.equal(plain.total, 4);
  assert.equal(plain.returned, 4);
  assert.equal('offset' in plain, false);
});
