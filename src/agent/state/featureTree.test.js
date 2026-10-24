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

test('buildFeatureTree lists a virtual Code chip for unmarked source', () => {
  const raw = 'let part = Manifold.cube([8, 8, 8], true);\nreturn part;\n';
  const tree = buildFeatureTree({ script: raw });
  assert.equal(tree.features.length, 1);
  assert.equal(tree.features[0].kind, 'code');
  assert.equal(tree.features[0].id, 'code-fallback');
});

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

test('buildFeatureTree adds the kernel milliseconds of each block when the last run reported them', () => {
  const tree = buildFeatureTree({ script: SCRIPT, featureMs: { cube1: 3.2, hole1: 1840 } });
  assert.equal(tree.features[0].ms, 3.2);
  assert.equal(tree.features[1].ms, 1840);
  const bare = buildFeatureTree({ script: SCRIPT });
  assert.equal('ms' in bare.features[0], false);
});
