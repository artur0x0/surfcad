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

test('buildAgentMode reports the open feature edit with its id, kind, and dialog (Pi 5 C4)', () => {
  const mode = buildAgentMode({
    featureEdit: { mode: 'edit', feature: { id: 'cube-0', kind: 'cube', index: 0 }, dialog: 'helper' },
  });
  assert.equal(mode.viewport, 'featureEdit');
  assert.deepEqual(mode.featureEdit, { mode: 'edit', featureId: 'cube-0', kind: 'cube', dialog: 'helper' });
  assert.equal(buildAgentMode({ featureEdit: null }).featureEdit, null);
});

test('buildAgentMode keeps a picker mode ahead of the feature edit that opened it', () => {
  const mode = buildAgentMode({
    fillet: { entry: 'filletEdges', edgeCount: 1 },
    featureEdit: { mode: 'edit', feature: { id: 'fillet-1', kind: 'fillet' }, dialog: 'fillet' },
  });
  assert.equal(mode.viewport, 'fillet');
  assert.equal(mode.featureEdit.featureId, 'fillet-1');
});
