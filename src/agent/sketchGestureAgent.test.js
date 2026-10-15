import test from 'node:test';
import assert from 'node:assert/strict';
import { contourFromRectangle, solveContour } from '../utils/contourSolve.js';
import { specFromSolved } from '../utils/contourGesture.js';
import { enterContourState } from '../utils/contourMode.js';
import {
  applySketchConstrain,
  applySketchDimension,
  contourIdsStableAcrossSolve,
  contourPickFromRef,
  picksFromArgs,
} from './sketchGestureAgent.js';

test('contour entity and dim ids stay stable across solveContour', () => {
  const spec = contourFromRectangle(20, 12);
  assert.equal(contourIdsStableAcrossSolve(spec), true);
  const solved = solveContour(spec);
  const back = specFromSolved(solved);
  assert.deepEqual(
    (back.lines || []).map((row) => row.id).sort(),
    (spec.lines || []).map((row) => row.id).sort(),
  );
  assert.deepEqual(
    (back.dimensions || []).map((row) => row.id).sort(),
    (spec.dimensions || []).map((row) => row.id).sort(),
  );
});

test('picksFromArgs resolves rectangle edge shorthand', () => {
  const spec = contourFromRectangle(10, 8);
  const picks = picksFromArgs(spec, { edge: 'e0' });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].kind, 'line');
  assert.equal(picks[0].id, 'e0');
});

test('applySketchDimension drives length on a promoted rectangle sketch', () => {
  let state = enterContourState({ entry: 'crossSection', tool: 'rectangle' });
  state = {
    ...state,
    params: { ...state.params, width: 24, height: 16 },
  };
  const applied = applySketchDimension(state, { kind: 'length', edge: 'e0', value: 28 });
  assert.ok(!applied.error, applied.error?.message);
  const dim = (applied.state.params.contour.dimensions || []).find((row) => row.edge === 'e0');
  assert.ok(dim);
  assert.ok(Math.abs(dim.value - 28) < 1e-3, JSON.stringify(dim));
  assert.equal(contourPickFromRef(applied.state.params.contour, 'e0')?.id, 'e0');
});

test('applySketchConstrain adds parallel between two lines', () => {
  let state = enterContourState({ entry: 'crossSection', tool: 'rectangle' });
  state = {
    ...state,
    params: { ...state.params, width: 24, height: 16 },
  };
  const applied = applySketchConstrain(state, {
    kind: 'horizontal',
    picks: [{ kind: 'line', id: 'e0' }],
  });
  assert.ok(!applied.error, applied.error?.message);
  const kinds = (applied.state.params.contour.constraints || []).map((row) => row.kind);
  assert.ok(kinds.includes('horizontal'));
});
