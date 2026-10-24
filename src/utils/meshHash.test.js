import test from 'node:test';
import assert from 'node:assert/strict';
import { meshContentHash } from './meshHash.js';

const cube = (scale = 1, extra = {}) => ({
  numProp: 3,
  vertProperties: new Float32Array([0, 0, 0, scale, 0, 0, 0, scale, 0, 0, 0, scale]),
  triVerts: new Uint32Array([0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2]),
  numRun: 1,
  runIndex: new Uint32Array([0, 12]),
  runOriginalID: new Uint32Array([7]),
  faceID: new Uint32Array([0, 1, 2, 3]),
  faceStamps: [{ label: 'cube.top', originalID: 7 }],
  ...extra,
});

test('two mesh objects with the same content hash the same', () => {
  const a = cube();
  const b = cube();
  assert.notEqual(a, b);
  assert.equal(meshContentHash(a), meshContentHash(b));
  assert.match(meshContentHash(a), /^[0-9a-f]{16}:4:4$/);
});

test('a plain-array mesh hashes like its typed-array twin', () => {
  const typed = cube();
  const plain = {
    ...typed,
    vertProperties: Array.from(typed.vertProperties),
    triVerts: Array.from(typed.triVerts),
    runIndex: Array.from(typed.runIndex),
    runOriginalID: Array.from(typed.runOriginalID),
    faceID: Array.from(typed.faceID),
  };
  assert.equal(meshContentHash(plain), meshContentHash(typed));
});

test('one vertex, one triangle or one face id changes the hash; the run tables do not', () => {
  const base = meshContentHash(cube());
  const moved = cube();
  moved.vertProperties[3] = 1.0001;
  assert.notEqual(meshContentHash(moved), base);
  const rewound = cube();
  rewound.triVerts[1] = 2;
  rewound.triVerts[2] = 1;
  assert.notEqual(meshContentHash(rewound), base);
  const relabelled = cube();
  relabelled.faceID[0] = 9;
  assert.notEqual(meshContentHash(relabelled), base);
  // originalIDs are numbered per run: a rerun with the same triangles but
  // other ids and stamp rows is the same GPU content.
  const renumbered = cube(1, { runOriginalID: new Uint32Array([41]), faceStamps: [{ label: 'cube.top', originalID: 41 }] });
  assert.equal(meshContentHash(renumbered), base);
  const sheet = cube(1, { sheetMetal: true });
  assert.notEqual(meshContentHash(sheet), base);
});

test('the hash is memoised per object and null without a mesh', () => {
  const a = cube();
  assert.equal(meshContentHash(a), meshContentHash(a));
  assert.equal(meshContentHash(null), null);
  assert.equal(meshContentHash({}), null);
  assert.equal(meshContentHash({ vertProperties: new Float32Array(0) }), null);
});
