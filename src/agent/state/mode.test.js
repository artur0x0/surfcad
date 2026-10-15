import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentMode } from './mode.js';

test('buildAgentMode prefers an explicit viewport mode', () => {
  assert.deepEqual(buildAgentMode({ viewportMode: 'custom' }).viewport, 'custom');
});

test('buildAgentMode infers fillet mode from fillet state', () => {
  const mode = buildAgentMode({
    fillet: { entry: 'filletEdges', edgeCount: 2 },
  });
  assert.equal(mode.viewport, 'fillet');
  assert.deepEqual(mode.fillet, { entry: 'filletEdges', edgeCount: 2 });
});

test('buildAgentMode maps chamfer entry separately', () => {
  const mode = buildAgentMode({ fillet: { entry: 'chamferEdges' } });
  assert.equal(mode.viewport, 'chamfer');
});
