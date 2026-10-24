import assert from 'node:assert/strict';
import test from 'node:test';
import { contourFromRectangle } from './contourSolve.js';
import {
  CONTOUR_ITEM_ID_RE,
  emitSolveContour,
  isContourItemId,
  parseSolveContour,
} from './contourScript.js';

const HOSTILE_ID = '"><img src=x onerror=alert(1)>';

test('generated contour ids match the SVG-safe pattern', () => {
  assert.equal(CONTOUR_ITEM_ID_RE.test('d0'), true);
  assert.equal(isContourItemId('my_dim-1'), true);
  assert.equal(isContourItemId(HOSTILE_ID), false);
  assert.equal(isContourItemId('a'.repeat(65)), false);
  assert.equal(isContourItemId(''), false);
  const spec = parseSolveContour(emitSolveContour(contourFromRectangle(40, 20, true)));
  for (const item of [...spec.points, ...spec.lines, ...spec.dimensions, ...spec.constraints]) {
    assert.equal(isContourItemId(item.id), true, item.id);
  }
});

test('parseSolveContour rejects a hostile dimension id', () => {
  const src = [
    'solveContour({',
    "  points: [{ id: 'p0', at: [0, 0] }, { id: 'p1', at: [10, 0] }],",
    "  lines: [{ id: 'e0', a: 'p0', b: 'p1' }],",
    '  arcs: [],',
    `  dimensions: [{ id: '${HOSTILE_ID}', kind: 'length', edge: 'e0', value: 10 }],`,
    '  constraints: []',
    '})',
  ].join('\n');
  assert.throws(() => parseSolveContour(src), /dimension id must match/);
});

test('a committed sketch keeps its dimensions and constraints: emit → parse round-trips both (sketch_edit, improvements §4)', () => {
  const spec = contourFromRectangle(40, 20, true);
  spec.dimensions = [
    { id: 'd0', kind: 'length', edge: spec.lines[0].id, value: 40 },
    { id: 'd1', kind: 'length', edge: spec.lines[1].id, value: 20, name: 'H' },
  ];
  spec.constraints = [
    { id: 'c0', kind: 'horizontal', line: spec.lines[0].id },
    { id: 'c1', kind: 'perpendicular', a: spec.lines[0].id, b: spec.lines[1].id },
  ];
  const src = emitSolveContour(spec);
  assert.match(src, /dimensions: \[\{ id: 'd0'/);
  assert.match(src, /constraints: \[\{ id: 'c0'/);
  const back = parseSolveContour(src);
  assert.deepEqual(back.dimensions.map((d) => [d.id, d.kind, d.value]), [['d0', 'length', 40], ['d1', 'length', 20]]);
  assert.equal(back.dimensions[1].name, 'H');
  assert.deepEqual(back.constraints.map((c) => [c.id, c.kind]), [['c0', 'horizontal'], ['c1', 'perpendicular']]);
  // Idempotent: a second emit of the parsed spec is byte-identical.
  assert.equal(emitSolveContour(back), src);
});
