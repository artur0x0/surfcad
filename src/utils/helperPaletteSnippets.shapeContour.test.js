/**
 * insert_make_extrude / insert_make_revolve reference a saved contour: the
 * one named by `contour`, else the newest saved contour no feature uses yet
 * (the sketch the agent just committed). The 40x30 rectangle seed is only
 * for a part with no such contour (2026-11-01 Android playtest: the insert
 * ignored the committed flange contour and seeded the rectangle).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { composeHelperInsert, shapeContourSource } from './helperPaletteSnippets.js';

const PLANE = '{ center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }';
const CUBE = `// --- cube begin id=cube1 ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
`;
const C1 = `const c1 = makeCrossSection(${PLANE}, solveContour({ points: [{ id: 'p0', at: [-30, -20] }, { id: 'p1', at: [30, -20] }, { id: 'p2', at: [30, 20] }, { id: 'p3', at: [-30, 20] }], lines: [{ id: 'e0', a: 'p0', b: 'p1', seq: 1 }, { id: 'e1', a: 'p1', b: 'p2', seq: 2 }, { id: 'e2', a: 'p2', b: 'p3', seq: 3 }, { id: 'e3', a: 'p3', b: 'p0', seq: 4 }] })); // @contour id=c1
`;
const FLANGE = `const flange = makeCrossSection(${PLANE}, profileRectangle(60, 40, true)); /* @contour id=sk2 */
`;

test('shapeContourSource picks the newest unused saved contour, honours an explicit id or name, and reports a missing one', () => {
  assert.equal(shapeContourSource(CUBE), null);
  assert.deepEqual(shapeContourSource(CUBE + C1), { name: 'c1', id: 'c1', explicit: false });
  assert.deepEqual(shapeContourSource(CUBE + C1 + FLANGE), { name: 'flange', id: 'sk2', explicit: false });
  assert.deepEqual(shapeContourSource(CUBE + C1 + FLANGE, 'c1'), { name: 'c1', id: 'c1', explicit: true });
  assert.deepEqual(shapeContourSource(CUBE + C1 + FLANGE, 'sk2'), { name: 'flange', id: 'sk2', explicit: true });
  assert.deepEqual(shapeContourSource(CUBE + C1 + FLANGE, 'flange'), { name: 'flange', id: 'sk2', explicit: true });
  assert.deepEqual(shapeContourSource(CUBE + C1, 'nope'), { missing: 'nope' });
  const used = `${CUBE}${C1}part = part.add(placeInFrame(c1.plane, makeExtrude(c1.contours, 5), [0, 0, 0]));\n`;
  assert.equal(shapeContourSource(used), null, 'a contour an extrude already names is not picked again');
  assert.deepEqual(shapeContourSource(used + FLANGE), { name: 'flange', id: 'sk2', explicit: false });
});

test('insert_make_extrude after a committed sketch extrudes that contour instead of seeding a rectangle', () => {
  const out = composeHelperInsert(CUBE + C1 + 'return part;\n', 'makeExtrude', null, { height: 5 });
  assert.ok(out, 'composed');
  assert.match(out, /makeExtrude\(c1\.contours, 5\)/);
  assert.match(out, /placeInFrame\(c1\.plane/);
  assert.doesNotMatch(out, /profileRectangle\(40, 30, true\)/);
  assert.equal((out.match(/@contour id=/g) || []).length, 1, 'no second contour statement');
  assert.match(out, /part = part\.add\(/);
});

test('an explicit contour wins over the newest one, and an unknown contour refuses the insert', () => {
  const script = CUBE + C1 + FLANGE + 'return part;\n';
  const out = composeHelperInsert(script, 'makeExtrude', null, { height: 8, contour: 'c1' });
  assert.match(out, /makeExtrude\(c1\.contours, 8\)/);
  assert.doesNotMatch(out, /flange\.contours/);
  const byName = composeHelperInsert(script, 'makeExtrude', null, { height: 8, contour: 'flange' });
  assert.match(byName, /makeExtrude\(flange\.contours, 8\)/);
  assert.equal(composeHelperInsert(script, 'makeExtrude', null, { height: 8, contour: 'c9' }), null);
});

test('with no saved contour, or every contour used, the extrude still seeds its placeholder rectangle', () => {
  const fresh = composeHelperInsert(CUBE + 'return part;\n', 'makeExtrude', null, { height: 10 });
  assert.match(fresh, /const c1 = makeCrossSection\(.*profileRectangle\(40, 30, true\)\); \/\/ @contour id=c1/);
  assert.match(fresh, /makeExtrude\(c1\.contours, 10\)/);
  const used = composeHelperInsert(fresh, 'makeExtrude', null, { height: 3 });
  assert.match(used, /const c2 = makeCrossSection\(.*profileRectangle\(40, 30, true\)\); \/\/ @contour id=c2/);
  assert.match(used, /makeExtrude\(c2\.contours, 3\)/);
  const empty = composeHelperInsert('', 'makeExtrude', null, { height: 10 });
  assert.match(empty, /profileRectangle\(40, 30, true\)/);
  assert.match(empty, /return part;/);
});

test('insert_make_revolve follows the same rule', () => {
  const out = composeHelperInsert(CUBE + C1 + 'return part;\n', 'makeRevolve', null, { segments: 48 });
  assert.match(out, /makeRevolve\(c1\.contours\.map/);
  assert.doesNotMatch(out, /profilePolygon\(/);
  const seeded = composeHelperInsert(CUBE + 'return part;\n', 'makeRevolve', null, { segments: 48 });
  assert.match(seeded, /profilePolygon\(/);
  assert.equal(composeHelperInsert(CUBE + C1 + 'return part;\n', 'makeRevolve', null, { contour: 'zz' }), null);
});
