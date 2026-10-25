import assert from 'node:assert/strict';
import test from 'node:test';
import { jointPlanesFromScript } from './jointPlanes.js';
import { matchJointAxis, matchJointEdge, matchJointFace, matchJointPlane } from './jointResolve.js';

const FACE = { at: [0, 0, 0.5], n: [0, 0, 1], area: 1 };

test('a face key matches a 0.4 mm shift and a 3 degree tilt', () => {
  const tilt = 3 * Math.PI / 180;
  const moved = {
    at: [0.4, 0, 0.5],
    n: [Math.sin(tilt), 0, Math.cos(tilt)],
    area: 1,
  };
  const before = FACE.at.slice();
  assert.equal(matchJointFace([moved], FACE).status, 'ok');
  assert.deepEqual(FACE.at, before);
});

test('a face 5 mm away is missing and is not the nearest', () => {
  const far = { at: [5, 0, 0.5], n: [0, 0, 1], area: 1 };
  const near = { at: [2, 0, 0.5], n: [0, 0, 1], area: 1 };
  assert.equal(matchJointFace([far, near], FACE).status, 'missing');
});

test('two faces in tolerance are ambiguous and neither is chosen', () => {
  const a = { at: [0.2, 0, 0.5], n: [0, 0, 1], area: 1 };
  const b = { at: [-0.2, 0, 0.5], n: [0, 0, 1], area: 1 };
  const hit = matchJointFace([a, b], FACE);
  assert.equal(hit.status, 'ambiguous');
  assert.equal(hit.face, undefined);
});

test('an axis matches within 8 degrees, 1 mm, and 25 percent radius', () => {
  const tilt = 4 * Math.PI / 180;
  const axis = {
    at: [0.4, 0, 0],
    dir: [Math.sin(tilt), 0, Math.cos(tilt)],
    radius: 1.1,
  };
  const key = { at: [0, 0, 0], dir: [0, 0, 1], radius: 1 };
  assert.equal(matchJointAxis([axis], key).status, 'ok');
  assert.equal(matchJointAxis([
    axis,
    { at: [0.2, 0, 0], dir: [0, 0, 1], radius: 1 },
  ], key).status, 'ok');
  assert.equal(matchJointAxis([
    { at: [0, 0, 0], dir: [0, 0, 1], radius: 2 },
  ], key).status, 'missing');
});

test('pattern copies of one cylinder are one axis, a face id is never ambiguous, and a real tie returns candidates', () => {
  const key = { at: [0, 0, 0], dir: [0, 0, 1], radius: 4 };
  const copies = [
    { id: 'f1', at: [0, 0, 0], dir: [0, 0, 1], radius: 4 },
    { id: 'f2', at: [0, 0, 30], dir: [0, 0, 1], radius: 4 },
  ];
  assert.equal(matchJointAxis(copies, key).status, 'ok');
  const left = { id: 'f3', at: [0.4, 0, 0], dir: [0, 0, 1], radius: 4 };
  const right = { id: 'f4', at: [-0.4, 0, 0], dir: [0, 0, 1], radius: 4 };
  assert.equal(matchJointAxis([left, right], { ...key, faceId: 'f3' }).status, 'ok');
  const tie = matchJointAxis([left, right], key);
  assert.equal(tie.status, 'ambiguous');
  assert.deepEqual(tie.candidates.map((row) => row.id).sort(), ['f3', 'f4']);
  for (const row of tie.candidates) {
    assert.deepEqual(row.direction, [0, 0, 1]);
    assert.equal(row.origin.length, 3);
    assert.equal(row.radius, 4);
  }
  const tube = matchJointAxis([
    { id: 'f5', at: [0, 0, 0], dir: [0, 0, 1], radius: 10 },
    { id: 'f6', at: [0, 0, 0], dir: [0, 0, 1], radius: 8 },
  ], { at: [0, 0, 0], dir: [0, 0, 1], radius: 10 });
  assert.equal(tube.status, 'ok');
});

test('a plane matches its id and uses the current frame', () => {
  const script = [
    'const deck = { center: [0, 0, 4], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };',
    'const deck = { center: [0, 0, 12], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };',
    'const c1 = makeCrossSection({ center: [1, 2, 3], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, profileCircle(5, 16)); // @contour id=c1',
  ].join('\n');
  const shifted = `${'// padding line\n'.repeat(4)}${script}`;
  const planes = jointPlanesFromScript(script);
  const again = jointPlanesFromScript(shifted);
  assert.deepEqual(again.map((plane) => plane.id), planes.map((plane) => plane.id));
  const deck = planes.find((plane) => plane.id === 'workplane:deck');
  assert.deepEqual(deck.at, [0, 0, 12]);
  const sketch = planes.find((plane) => plane.id === 'contour:c1');
  assert.deepEqual(sketch.at, [1, 2, 3]);
  assert.equal(planes.filter((plane) => plane.id.startsWith('origin:')).length, 3);
  const hit = matchJointPlane(planes, { id: 'origin:yz', at: [9, 9, 9], n: [0, 1, 0] });
  assert.equal(hit.status, 'ok');
  assert.deepEqual(hit.key.n, [1, 0, 0]);
  assert.deepEqual(hit.key.at, [0, 0, 0]);
  assert.equal(matchJointPlane(planes, { id: 'workplane:gone', at: [0, 0, 0], n: [0, 0, 1] }).status, 'missing');
  assert.equal(matchJointPlane(undefined, { id: 'origin:xy', at: [0, 0, 0], n: [0, 0, 1] }).status, 'unresolved');
});

test('an edge matches midpoint, direction, length, and both faces', () => {
  const top = { at: [0, 0, 1], n: [0, 0, 1], area: 1 };
  const side = { at: [0.5, 0, 0.5], n: [1, 0, 0], area: 1 };
  const key = {
    at: [0, 0, 0.5],
    dir: [0, 1, 0],
    length: 2,
    faces: [top, side],
  };
  const edge = {
    at: [0.4, 0, 0.5],
    dir: [0, 1, 0],
    length: 2.1,
    faces: [
      { at: [0.2, 0, 1], n: [0, 0, 1], area: 1 },
      { at: [0.5, 0.2, 0.5], n: [1, 0, 0], area: 1 },
    ],
  };
  assert.equal(matchJointEdge([edge], key).status, 'ok');
  assert.equal(matchJointEdge([{ ...edge, faces: [top] }], key).status, 'missing');
});
