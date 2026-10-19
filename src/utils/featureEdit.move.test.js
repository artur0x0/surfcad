import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFeatureMarkers } from './featureMarkers.js';
import { confirmFeatureEdit, parseFeatureEdit } from './featureEdit.js';

/** Bike acceptance PR 1: edit_feature on a move can change its target body. */

const SCRIPT = `// --- cube begin id=cube0 ---
let part = Manifold.cube([20, 20, 20], true);
part = part.add(Manifold.cube([10, 10, 10], true).translate([40, 0, 0]), { merge: false });
// --- cube end ---
// --- move begin id=move1 ---
part = move(part, [0, 15, 0], { bodies: [{ at: [40, 0, 0] }] });
// --- move end ---
return part;
`;

test('a move edit exposes its target centroid and re-points on confirm', () => {
  const [, move] = parseFeatureMarkers(SCRIPT);
  const session = parseFeatureEdit('move', SCRIPT.slice(move.startOffset, move.endOffset));
  assert.deepEqual(session.fields.at, [40, 0, 0]);
  const result = confirmFeatureEdit(SCRIPT, move, { fields: { at: [0, 0, 0] } });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.changed, true);
  assert.match(result.buffer, /move\(part, \[0, 15, 0\], \{ bodies: \[\{ at: \[0, 0, 0\] \}\] \}\)/);
  assert.doesNotMatch(result.buffer, /at: \[40, 0, 0\]/);
});

test('the same target and a bad target leave the block alone', () => {
  const [, move] = parseFeatureMarkers(SCRIPT);
  const same = confirmFeatureEdit(SCRIPT, move, { fields: { at: [40, 0, 0] } });
  assert.equal(same.changed, false);
  const bad = confirmFeatureEdit(SCRIPT, move, { fields: { at: [1, 'x'] } });
  assert.equal(bad.changed, false);
  const delta = confirmFeatureEdit(SCRIPT, move, { fields: { dz: 7, at: [0, 0, 0] } });
  assert.match(delta.buffer, /move\(part, \[0, 15, 7\], \{ bodies: \[\{ at: \[0, 0, 0\] \}\] \}\)/);
});
