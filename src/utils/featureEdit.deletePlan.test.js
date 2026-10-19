import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFeatureMarkers } from './featureMarkers.js';
import { deleteFeatureEdit, featureDeletePlan, partDeclarationDeletePlan } from './featureEdit.js';

/**
 * Pi 5 acceptance A2: deleting the feature that declares `part` while later
 * features still use `part` gets a confirm (UI) / confirm: true (agent).
 */

const BASE_AND_TWO = `// --- cube begin id=cube0 ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
// --- cube begin id=cube1 ---
part = part.add(Manifold.cube([10, 10, 30], true));
// --- cube end ---
// --- cube begin id=cube2 ---
part = part.subtract(Manifold.cube([5, 5, 50], true));
// --- cube end ---
return part;
`;

const BASE_ONLY = `// --- cube begin id=cube0 ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
return part;
`;

const BASE_AND_LOOSE = `// --- cube begin id=cube0 ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
part = part.translate([0, 0, 5]);
return part;
`;

const features = (script) => parseFeatureMarkers(script);

test('deleting the base feature with later features that use part asks first', () => {
  const [base] = features(BASE_AND_TWO);
  const plan = partDeclarationDeletePlan(BASE_AND_TWO, base);
  assert.deepEqual(plan, { count: 2, message: 'Delete anyway (2 later features use part)' });
  const full = featureDeletePlan(BASE_AND_TWO, base);
  assert.equal(full.ok, false);
  assert.equal(full.confirm, true);
  assert.equal(full.base, true);
  assert.equal(full.count, 2);
});

test('one later feature reads singular', () => {
  const script = BASE_AND_TWO.replace(/\/\/ --- cube begin id=cube2 ---[\s\S]*?\/\/ --- cube end ---\n/, '');
  const [base] = features(script);
  assert.equal(partDeclarationDeletePlan(script, base).message, 'Delete anyway (1 later feature uses part)');
});

test('loose code after the base still counts, with no feature count', () => {
  const [base] = features(BASE_AND_LOOSE);
  assert.deepEqual(partDeclarationDeletePlan(BASE_AND_LOOSE, base), {
    count: 0,
    message: 'Delete anyway (later code uses part)',
  });
});

test('deleting the only feature is an empty part and does not ask', () => {
  const [base] = features(BASE_ONLY);
  assert.equal(partDeclarationDeletePlan(BASE_ONLY, base), null);
  assert.deepEqual(featureDeletePlan(BASE_ONLY, base), { ok: true, confirm: false });
});

test('a later feature that does not declare part does not ask', () => {
  const [, second] = features(BASE_AND_TWO);
  assert.equal(partDeclarationDeletePlan(BASE_AND_TWO, second), null);
  assert.deepEqual(featureDeletePlan(BASE_AND_TWO, second), { ok: true, confirm: false });
});

test('the confirmed delete drops only the base block and leaves part undeclared', () => {
  const [base] = features(BASE_AND_TWO);
  const result = deleteFeatureEdit(BASE_AND_TWO, base);
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.buffer, /let part/);
  assert.match(result.buffer, /id=cube1/);
  assert.match(result.buffer, /id=cube2/);
  assert.match(result.buffer, /return part;/);
});
