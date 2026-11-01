/**
 * edit_feature on a draft used to accept only angle and flip, so the insert
 * params (draftDeg, pull, reference, faceScope) could not reverse a draft.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFeatureMarkers } from './featureMarkers.js';
import { confirmFeatureEdit } from './featureEdit.js';

const SCRIPT = `// --- cube begin id=cube1 ---
let part = Manifold.cube([40, 40, 20], true);
// --- cube end ---
// --- draft begin id=draft1 ---
part = draftFaces(part, 'sides', 1, { pull: 'z', reference: 'max' });
// --- draft end ---
return part;
`;

function draftFeature() {
  return parseFeatureMarkers(SCRIPT).find((f) => f.kind === 'draft');
}

test('draftDeg, pull, reference, and faceScope rewrite the draftFaces call', () => {
  const feature = draftFeature();
  const angle = confirmFeatureEdit(SCRIPT, feature, { fields: { draftDeg: -1 } });
  assert.equal(angle.ok, true, angle.message);
  assert.equal(angle.changed, true);
  assert.match(angle.buffer, /draftFaces\(part, 'sides', -1, \{ pull: 'z', reference: 'max' \}\)/);

  const rest = confirmFeatureEdit(angle.buffer, parseFeatureMarkers(angle.buffer).find((f) => f.kind === 'draft'), {
    fields: { pull: '-z', reference: 'min', faceScope: 'sides' },
  });
  assert.equal(rest.ok, true, rest.message);
  assert.match(rest.buffer, /draftFaces\(part, 'sides', -1, \{ pull: '-z', reference: 'min' \}\)/);

  const again = confirmFeatureEdit(rest.buffer, parseFeatureMarkers(rest.buffer).find((f) => f.kind === 'draft'), {
    fields: { flip: true },
  });
  assert.equal(again.changed, false, again.buffer);
});

test('flip negates a positive draft angle and is idempotent once it is negative', () => {
  const feature = draftFeature();
  const flipped = confirmFeatureEdit(SCRIPT, feature, { fields: { flip: true } });
  assert.equal(flipped.ok, true, flipped.message);
  assert.match(flipped.buffer, /draftFaces\(part, 'sides', -1, \{ pull: 'z', reference: 'max' \}\)/);
  const twice = confirmFeatureEdit(flipped.buffer, parseFeatureMarkers(flipped.buffer).find((f) => f.kind === 'draft'), {
    fields: { flip: true },
  });
  assert.equal(twice.changed, false);
  assert.match(twice.buffer, /draftFaces\(part, 'sides', -1,/);
});
