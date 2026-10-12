import assert from 'node:assert/strict';
import test from 'node:test';
import { enterContourState, switchContourTool } from './contourMode.js';
import {
  emptySketchHistory,
  observeSketchEdit,
  sketchEditKey,
  undoSketchEdit,
} from './contourSketchHistory.js';

const FACE = {
  type: 'planar',
  center: [0, 0, 18],
  normal: [0, 0, 1],
  area: 100,
  triangleCount: 2,
  selectionMode: 'coplanar',
};

test('the accepted sketch is the baseline and one edit undoes', () => {
  let hist = emptySketchHistory();
  const fresh = enterContourState('crossSection', null);
  assert.ok(sketchEditKey(fresh));
  hist = observeSketchEdit(hist, fresh);
  assert.equal(hist.depth, 0, 'the first sketch is not a step');
  const tilted = observeSketchEdit(hist, { ...fresh, planeAngles: { x: 12, y: 0, z: 0 } });
  assert.equal(tilted.depth, 1, 'a plane edit on the default plane is a step');

  const base = enterContourState('crossSection', FACE);
  assert.equal(base.planePreset, 'face');
  hist = observeSketchEdit(emptySketchHistory(), base);
  assert.equal(hist.depth, 0, 'the accepted plane is not a step');

  const poly = switchContourTool(base, 'polyline');
  hist = observeSketchEdit(hist, poly);
  assert.equal(hist.depth, 1);

  const pointed = { ...poly, params: { ...poly.params, points: [[1, 2]] } };
  hist = observeSketchEdit(hist, pointed);
  assert.equal(hist.depth, 2);
  assert.equal(hist.stack.length, 2);

  const gestured = { ...pointed, gesture: 'dimension', picks: [{ id: 'a' }], tagId: 't' };
  const held = observeSketchEdit(hist, gestured);
  assert.equal(held.depth, 2, 'opening Dimension is not a step');

  const undone = undoSketchEdit(held);
  assert.ok(undone);
  assert.equal(undone.state.tool, 'polyline');
  assert.equal(undone.state.params.points.length, 0);
  assert.equal(undone.history.depth, 1);

  const again = undoSketchEdit(undone.history);
  assert.equal(again.state.tool, 'cursor');
  assert.equal(again.history.depth, 0);
  assert.equal(undoSketchEdit(again.history), null);
});
