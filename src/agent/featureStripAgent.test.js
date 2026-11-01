import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFeatureTree } from './state/featureTree.js';
import { planStripDelete, resolveRollbackTarget, resolveStripTarget } from './featureStripAgent.js';

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

const ORPHAN = `// --- cube begin id=cube1 ---
let part = Manifold.cube([40, 40, 20], true);
// --- cube end ---
// --- draft begin id=draft1 ---
part = draftFaces(part, 'sides', 1, { pull: 'z', reference: 'max' });
// --- draft end ---
const c1 = makeCrossSection({ center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, profileRectangle(50, 50, true)); // @contour id=c1
// --- boolean begin id=boolean2 ---
part = booleanBodies(part, { op: 'union' });
// --- boolean end ---
return part;
`;

test('an orphan contour deletes by contour:c1, c1, and its strip index', () => {
  const tree = buildFeatureTree({ script: ORPHAN });
  assert.deepEqual(tree.features.map((row) => row.id), ['cube1', 'draft1', 'contour:c1', 'boolean2']);
  for (const args of [{ id: 'contour:c1' }, { id: 'c1' }, { index: 2 }]) {
    const planned = planStripDelete(ORPHAN, args);
    assert.equal(planned.error, undefined, JSON.stringify(planned.error));
    assert.equal(planned.featureId, 'contour:c1');
    assert.doesNotMatch(planned.source, /@contour id=c1/);
    assert.doesNotMatch(planned.source, /const c1/);
    assert.match(planned.source, /id=cube1/);
    assert.match(planned.source, /id=draft1/);
    assert.match(planned.source, /id=boolean2/);
    const after = buildFeatureTree({ script: planned.source });
    assert.equal(after.features.some((row) => row.id === 'contour:c1' || row.kind === 'contour'), false);
  }
});

test('a contour something still names is not deleted until confirm', () => {
  const used = ORPHAN.replace(
    '// --- boolean begin id=boolean2 ---',
    `// --- contour-mode extrude begin id=extrude1 ---
part = part.add(makeExtrude(c1.contours, 8));
// --- contour-mode extrude end ---
// --- boolean begin id=boolean2 ---`,
  );
  const refused = planStripDelete(used, { id: 'contour:c1' });
  assert.equal(refused.error.code, 'confirm_required');
  assert.equal(refused.error.details.featureId, 'contour:c1');
  assert.equal(refused.error.details.dependents, 1);
  const gone = planStripDelete(used, { id: 'c1', confirm: true });
  assert.equal(gone.error, undefined, JSON.stringify(gone.error));
  assert.doesNotMatch(gone.source, /@contour id=c1/);
  assert.doesNotMatch(gone.source, /id=extrude1/);
  assert.match(gone.source, /id=boolean2/);
});

test('resolveRollbackTarget maps gap index and feature id', () => {
  const atCube = resolveRollbackTarget(SCRIPT, { id: 'cube1' });
  assert.equal(atCube.anchor, 'cube1');
  const start = resolveRollbackTarget(SCRIPT, { index: 0 });
  assert.equal(start.anchor, null);
  const end = resolveRollbackTarget(SCRIPT, { clear: true });
  assert.equal(end.anchor, undefined);
});
