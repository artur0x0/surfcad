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
