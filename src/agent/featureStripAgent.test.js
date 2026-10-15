import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRollbackTarget, resolveStripTarget } from './featureStripAgent.js';

const SCRIPT = `// --- cube begin id=cube1 ---
let part = Manifold.cube([10, 10, 10], true);
// --- cube end ---
// --- hole begin id=hole1 ---
part = part.subtract(Manifold.cylinder(12, 2, 2, 12, true));
// --- hole end ---
return part;
`;

test('resolveStripTarget by index and id', () => {
  const byIndex = resolveStripTarget(SCRIPT, { index: 1 });
  assert.equal(byIndex.chip.id, 'hole1');
  assert.equal(byIndex.feature.id, 'hole1');
  const byId = resolveStripTarget(SCRIPT, { id: 'cube1' });
  assert.equal(byId.chip.index, 0);
  assert.equal(byId.feature.kind, 'cube');
});

test('resolveStripTarget rejects bad index', () => {
  const out = resolveStripTarget(SCRIPT, { index: 9 });
  assert.equal(out.error.code, 'bad_index');
});

test('resolveRollbackTarget maps gap index and feature id', () => {
  const atCube = resolveRollbackTarget(SCRIPT, { id: 'cube1' });
  assert.equal(atCube.anchor, 'cube1');
  const start = resolveRollbackTarget(SCRIPT, { index: 0 });
  assert.equal(start.anchor, null);
  const end = resolveRollbackTarget(SCRIPT, { clear: true });
  assert.equal(end.anchor, undefined);
});
