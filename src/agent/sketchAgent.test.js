import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSketchTool, sketchParamsFromArgs } from './sketchAgent.js';

test('normalizeSketchTool maps aliases', () => {
  assert.equal(normalizeSketchTool('rect'), 'rectangle');
  assert.equal(normalizeSketchTool('poly'), 'polyline');
  assert.equal(normalizeSketchTool('bogus'), null);
});

test('sketchParamsFromArgs merges rectangle sizes', () => {
  const params = sketchParamsFromArgs('rectangle', { width: 30, height: 18 });
  assert.equal(params.width, 30);
  assert.equal(params.height, 18);
  assert.equal(params.centered, true);
});

test('sketchParamsFromArgs copies polyline points', () => {
  const params = sketchParamsFromArgs('polyline', {
    points: [[0, 0], [40, 0], [40, 20], [0, 20]],
  });
  assert.equal(params.points.length, 4);
  assert.deepEqual(params.points[1], [40, 0]);
});
