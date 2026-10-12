import assert from 'node:assert/strict';
import test from 'node:test';
import { dragContourPoint } from './contourDrag.js';
import {
  buildConstraint,
  deleteContourDimension,
  deleteContourRef,
  specFromSolved,
} from './contourGesture.js';
import {
  removeContourConstraint,
  validateContourProfile,
} from './contourMode.js';
import { writeContourProfileBlock } from './contourProfileWrite.js';
import { emitSolveContour, parseSolveContour } from './contourScript.js';
import { contourFromRectangle, solveContour } from './contourSolve.js';
import { deleteContourEntity } from './contourStrip.js';

function stateOf(contour, extra = {}) {
  return { params: { contour }, entry: 'crossSection', ...extra };
}

function squareWith(extra = {}) {
  const base = contourFromRectangle(40, 30, true);
  return {
    ...base,
    dimensions: extra.dimensions || base.dimensions,
    constraints: extra.constraints || base.constraints,
    refs: extra.refs || [],
    points: extra.points || base.points,
  };
}

test('a one-target coincident is broken, stays, and does not throw', () => {
  const contour = squareWith({
    constraints: [
      ...contourFromRectangle(40, 30, true).constraints,
      { id: 'kBad', kind: 'coincident', items: ['p1'] },
    ],
  });
  const solved = solveContour(contour);
  const bad = solved.constraints.find((item) => item.id === 'kBad');
  assert.equal(bad.broken, true);
  assert.deepEqual(bad.items, ['p1']);
  assert.ok(solved.contours.length >= 1);

  const dangling = solveContour(squareWith({
    constraints: [
      ...contour.constraints.filter((item) => item.id !== 'kBad'),
      { id: 'kBad', kind: 'coincident', items: ['p1', 'gone'] },
    ],
  }));
  assert.equal(dangling.constraints.find((item) => item.id === 'kBad').broken, true);

  const pair = solveContour(squareWith({
    constraints: [
      ...contour.constraints.filter((item) => item.id !== 'kBad'),
      { id: 'kBad', kind: 'coincident', items: ['e0', 'e1'] },
    ],
  }));
  assert.equal(pair.constraints.find((item) => item.id === 'kBad').broken, true);

  const text = emitSolveContour(specFromSolved(solved));
  assert.match(text, /broken: true/);
  assert.match(text, /items: \['p1'\]/);
  const again = solveContour(parseSolveContour(text));
  assert.equal(again.constraints.find((item) => item.id === 'kBad').broken, true);
});

test('deleting a malformed coincident, dimension, or ref keeps the delete and the remainder solves', () => {
  const base = contourFromRectangle(40, 30, true);
  const coincident = squareWith({
    constraints: [
      ...base.constraints,
      { id: 'kBad', kind: 'coincident', items: ['p1'] },
    ],
  });
  const removed = removeContourConstraint(stateOf(coincident, {
    gesture: 'constraints',
    constraintEdit: 'kBad',
  }), 'kBad');
  assert.equal(removed.error, null);
  assert.equal(removed.warning ?? null, null);
  assert.equal(removed.state.constraintEdit, null);
  assert.equal(removed.state.params.contour.constraints.some((item) => item.id === 'kBad'), false);
  assert.equal(removed.state.params.contour.constraints.some((item) => item.id === 'k0'), true);
  const solved = solveContour(removed.state.params.contour);
  assert.ok(solved.contours.length >= 1);

  const viaStrip = deleteContourEntity(stateOf(coincident), 'kBad');
  assert.deepEqual(viaStrip.removed, ['kBad']);
  assert.equal(viaStrip.state.params.contour.constraints.some((item) => item.id === 'kBad'), false);
  assert.doesNotThrow(() => solveContour(viaStrip.state.params.contour));

  const dimension = squareWith({
    dimensions: [
      ...base.dimensions,
      { id: 'dBad', kind: 'length', edge: 'missing', value: 4 },
    ],
  });
  assert.equal(solveContour(dimension).dimensions.find((item) => item.id === 'dBad').broken, true);
  const droppedDim = deleteContourDimension(stateOf(dimension, { dimensionEdit: 'dBad' }), 'dBad');
  assert.equal(droppedDim.error, null);
  assert.equal(droppedDim.warning ?? null, null);
  assert.equal(droppedDim.state.dimensionEdit, null);
  assert.equal(droppedDim.state.params.contour.dimensions.some((item) => item.id === 'dBad'), false);
  assert.equal(droppedDim.state.params.contour.dimensions.some((item) => item.id === 'd0'), true);
  assert.ok(solveContour(droppedDim.state.params.contour).contours.length >= 1);

  const ref = squareWith({
    refs: [{ id: 'r0' }],
    dimensions: [
      ...base.dimensions,
      { id: 'dRef', kind: 'distance', a: 'p1', b: 'r0', value: 2 },
    ],
  });
  assert.throws(() => solveContour(ref));
  const droppedRef = deleteContourRef(stateOf(ref), 'r0');
  assert.equal(droppedRef.error, null);
  assert.equal(droppedRef.warning ?? null, null);
  assert.equal(droppedRef.state.params.contour.refs.length, 0);
  assert.equal(droppedRef.state.params.contour.dimensions.some((item) => item.id === 'dRef'), false);
  assert.ok(solveContour(droppedRef.state.params.contour).contours.length >= 1);

  const stripRef = deleteContourEntity(stateOf({
    ...base,
    refs: [{ id: 'r0', kind: 'edge', broken: true }],
  }), 'r0');
  assert.ok(stripRef.removed.includes('r0'));
  assert.equal(stripRef.state.params.contour.refs.length, 0);
  assert.doesNotThrow(() => solveContour(stripRef.state.params.contour));
});

test('a delete stays when the remainder still cannot solve', () => {
  const base = contourFromRectangle(40, 30, true);
  const contour = squareWith({
    constraints: [
      ...base.constraints,
      { id: 'kBad', kind: 'coincident', items: ['p1'] },
      { id: 'k2', kind: 'parallel', items: ['r0', 'r1'] },
    ],
    refs: [
      { id: 'r0', kind: 'edge', geom: { kind: 'line', a: [0, 0], b: [10, 0] } },
      { id: 'r1', kind: 'edge', geom: { kind: 'line', a: [0, 4], b: [10, 4] } },
    ],
  });
  const removed = removeContourConstraint(stateOf(contour), 'kBad');
  assert.equal(removed.error, null);
  assert.match(removed.warning, /two references/);
  assert.equal(removed.state.params.contour.constraints.some((item) => item.id === 'kBad'), false);
  assert.equal(removed.state.params.contour.constraints.some((item) => item.id === 'k2'), true);
  assert.throws(() => solveContour(removed.state.params.contour), /two references/);

  const wrote = writeContourProfileBlock('', { params: { contour: removed.state.params.contour } });
  assert.equal(wrote.ok, true);
  assert.equal(wrote.written, true);
  assert.equal(/kBad/.test(wrote.buffer), false);
  assert.match(wrote.buffer, /k2/);
  const gate = validateContourProfile('polyline', {
    points: removed.state.params.contour.points.map((point) => point.at),
    contour: removed.state.params.contour,
  });
  assert.equal(gate.ok, true);
});

test('Add refuses a coincident that does not have two live targets', () => {
  const model = contourFromRectangle(10, 10, true);
  const one = buildConstraint(model, [{ id: 'p1', kind: 'point' }], { kind: 'coincident' });
  assert.equal(one.ok, false);
  const missing = buildConstraint(
    model,
    [{ id: 'p0', kind: 'point' }, { id: 'nope', kind: 'point' }],
    { kind: 'coincident' },
  );
  assert.equal(missing.ok, false);
  assert.match(missing.message, /not on the contour/);
  const same = buildConstraint(
    model,
    [{ id: 'p0', kind: 'point' }, { id: 'p0', kind: 'point' }],
    { kind: 'coincident' },
  );
  assert.equal(same.ok, false);
  const ok = buildConstraint(
    model,
    [{ id: 'p0', kind: 'point' }, { id: 'p1', kind: 'point' }],
    { kind: 'coincident' },
  );
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.constraint.items, ['p0', 'p1']);
});

test('dragging a point keeps references a coincident still names', () => {
  const spec = {
    points: [
      { id: 'p0', at: [0, 0] },
      { id: 'p1', at: [20, 0] },
      { id: 'p2', at: [20, 10] },
    ],
    lines: [
      { id: 'e0', a: 'p0', b: 'p1' },
      { id: 'e1', a: 'p1', b: 'p2' },
    ],
    arcs: [],
    dimensions: [],
    constraints: [{ id: 'k0', kind: 'coincident', items: ['p0', 'r0'] }],
    refs: [{ id: 'r0', kind: 'edge', geom: { kind: 'point', at: [0, 0] } }],
  };
  const moved = dragContourPoint(spec, 'p2', [30, 18]);
  assert.equal(moved.moved, true);
  assert.equal(moved.spec.refs.length, 1);
  assert.equal(moved.spec.refs[0].id, 'r0');
  assert.deepEqual(moved.spec.constraints[0].items, ['p0', 'r0']);
  const solved = solveContour(moved.spec);
  assert.equal(solved.constraints.find((item) => item.id === 'k0').broken, undefined);
  assert.equal(solved.refs[0].id, 'r0');
});
