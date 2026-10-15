import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFeatureTree } from './featureTree.js';

const SCRIPT = `// --- cube begin id=cube1 ---
let part = Manifold.cube([10, 10, 10], true);
// --- cube end ---
// --- hole begin id=hole1 ---
part = part.subtract(Manifold.cylinder(12, 2, 2, 12, true));
// --- hole end ---
return part;
`;

test('buildFeatureTree lists features in script order with failure flags', () => {
  const tree = buildFeatureTree({
    script: SCRIPT,
    failedIds: new Set(['hole1']),
    rollbackAnchor: 'cube1',
    activeChipId: 'hole1',
  });
  assert.equal(tree.features.length, 2);
  assert.equal(tree.features[0].id, 'cube1');
  assert.equal(tree.features[0].failed, false);
  assert.equal(tree.features[1].failed, true);
  assert.equal(tree.rollbackAnchor, 'cube1');
  assert.equal(tree.activeChipId, 'hole1');
});
