import assert from 'node:assert/strict';
import test from 'node:test';
import { getManifoldModule, runScript } from '../lib/surfcad/index.js';

const PLANE = '{ center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }';
const TOP = '{ center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }';

function plate(body) {
  return `let part = Manifold.cube([40, 40, 20], true);\n${body}\nreturn part;\n`;
}

function section(plane, contour) {
  return `const c1 = makeCrossSection(${plane}, solveContour(${contour}));`;
}

async function cut(plane, contour, spec) {
  const src = plate(`${section(plane, contour)}\npart = holesOnContour(part, c1, ${spec});`);
  const ran = await runScript(src);
  assert.equal(ran.status, 'NoError', ran.featureSkip ? JSON.stringify(ran.featureSkip) : ran.status);
  return ran.manifold;
}

function volumeNear(solid, at, size = 0.5) {
  const { Manifold } = getManifoldModule();
  const box = Manifold.cube([size, size, size], true).translate(at);
  const hit = Manifold.intersection(solid, box);
  const volume = hit.volume();
  hit.delete();
  box.delete();
  return volume;
}

function assertVoid(solid, at, label, size = 0.5) {
  const volume = volumeNear(solid, at, size);
  assert.ok(volume < 1e-4, `${label} expected a void, volume ${volume}`);
}

function assertSolid(solid, at, label, size = 0.5) {
  const volume = volumeNear(solid, at, size);
  assert.ok(volume > size ** 3 * 0.4, `${label} expected solid, volume ${volume}`);
}

const TWO = `{
  centers: true,
  points: [{ id: 'p0', at: [-8, 0] }, { id: 'p1', at: [8, 0] }],
  lines: [{ id: 'e0', a: 'p0', b: 'p1', construction: true }],
}`;

const ONE = `{
  centers: true,
  points: [{ id: 'p0', at: [0, 0] }],
}`;

const ARC = `{
  centers: true,
  points: [{ id: 'p0', at: [10, 0] }, { id: 'c0', at: [0, 0] }],
  lines: [{ id: 'e0', a: 'c0', b: 'p0', construction: true }],
  arcs: [{ id: 'a0', center: 'c0', radius: 10, full: true, sweep: 'ccw' }],
}`;

test('a blind hole enters the chosen side and a shared contour can cut the other way', async () => {
  const down = await cut(PLANE, ONE, '{ dia: 4, through: false, depth: 6, side: 1 }');
  assertVoid(down, [0, 0, -3], 'side 1 at -3');
  assertSolid(down, [0, 0, -8], 'side 1 past the depth');
  assertSolid(down, [0, 0, 3], 'side 1 leaves the other side');

  const up = await cut(PLANE, ONE, '{ dia: 4, depth: 6, flip: true }');
  assertVoid(up, [0, 0, 3], 'flip at +3');
  assertSolid(up, [0, 0, -3], 'flip leaves the first side');
  assertSolid(up, [0, 0, 8], 'flip past the depth');

  const both = await runScript(plate(`
    ${section(PLANE, ONE)}
    part = holesOnContour(part, c1, { dia: 4, depth: 6, side: 1 });
    part = holesOnContour(part, c1, { dia: 4, depth: 6, side: -1 });
  `));
  assert.equal(both.status, 'NoError');
  assertVoid(both.manifold, [0, 0, -3], 'shared side 1');
  assertVoid(both.manifold, [0, 0, 3], 'shared side -1');
});

test('centres are sketch points and arc centres, and a construction line is not a hole', async () => {
  const row = await cut(PLANE, TWO, '{ dia: 4, depth: 6, side: 1 }');
  assertVoid(row, [-8, 0, -3], 'first point');
  assertVoid(row, [8, 0, -3], 'second point');
  assertSolid(row, [0, 0, -3], 'midpoint of the construction line');

  const arc = await cut(PLANE, ARC, '{ dia: 4, depth: 6, side: 1 }');
  assertVoid(arc, [0, 0, -3], 'arc centre');
  assertVoid(arc, [10, 0, -3], 'point on the arc');
  assertSolid(arc, [0, 10, -3], 'arc rim that is not a point');

  const rings = await runScript(plate(`
    ${section(PLANE, ARC)}
    if (c1.contours.length !== 0) throw new Error('centres contour tessellated');
    if (!c1.profile.centers) throw new Error('centers flag dropped');
    if (c1.profile.points.length !== 2) throw new Error('points dropped');
  `));
  assert.equal(rings.status, 'NoError');
});

test('fastener size and raw dia both cut, and through reaches the far side', async () => {
  const clearance = await cut(PLANE, ONE, "{ type: 'clearance', size: 'M3', fit: 'normal', depth: 8, side: 1 }");
  assertVoid(clearance, [1.5, 0, -3], 'M3 normal clearance covers r 1.5', 0.2);
  assertSolid(clearance, [1.9, 0, -3], 'M3 normal clearance stops before r 1.9', 0.2);

  const tap = await cut(PLANE, ONE, "{ type: 'tapDrill', size: 'M3', depth: 8, side: 1 }");
  assertSolid(tap, [1.5, 0, -3], 'M3 tap drill is inside r 1.5', 0.2);

  const raw = await cut(PLANE, ONE, "{ dia: 8, size: 'M3', fit: 'normal', depth: 8, side: 1 }");
  assertVoid(raw, [3, 0, -3], 'explicit dia wins over the fastener', 0.4);

  const thru = await cut(PLANE, ONE, '{ dia: 4, through: true, side: 1 }');
  assertVoid(thru, [0, 0, -8], 'through reaches the far side of the plate');
  assertSolid(thru, [0, 0, 5], 'through does not leave the entry side');
});

test('a near c-bore and a far c-sink sit on opposite faces', async () => {
  const solid = await cut(TOP, ONE, `{
    dia: 4, through: true, side: 1,
    near: { kind: 'cbore', dia: 10, depth: 3 },
    far: { kind: 'csk', dia: 10, depth: 3 },
  }`);
  assertVoid(solid, [4, 0, 8.5], 'near c-bore');
  assertSolid(solid, [4, 0, 0], 'c-bore does not run through');
  assertVoid(solid, [0, 0, 0], 'through hole');
  assertVoid(solid, [3, 0, -9], 'far c-sink');
  assertSolid(solid, [3, 0, -5], 'c-sink stays on the exit face');
});

test('no centres is a blank feature, and a bad spec throws', async () => {
  const blank = await runScript(plate(`
    const c1 = makeCrossSection(${PLANE}, solveContour({ centers: true, points: [] }));
    part = holesOnContour(part, c1, { dia: 4, depth: 6 });
  `));
  assert.equal(blank.status, 'NoError');
  assert.ok(Math.abs(blank.volume - 32000) < 1, `blank volume ${blank.volume}`);

  const bad = [
    `{ dia: 4, through: true, depth: 6 }`,
    `{ dia: 4, depth: 6, far: { kind: 'cbore', dia: 8, depth: 2 } }`,
    `{ dia: 4, depth: 6, side: 2 }`,
    `{ dia: 4, through: true, near: { kind: 'cbore', dia: 4, depth: 2 } }`,
    `{ through: true }`,
  ];
  for (const spec of bad) {
    await assert.rejects(cut(PLANE, ONE, spec), /holesOnContour:/, spec);
  }
});
