import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFeatureMarkers } from './featureMarkers.js';
import { confirmFeatureEdit, parseFeatureEdit } from './featureEdit.js';

/** edit_feature on a rotate changes its angle, axis, center, or target body. */

const SCRIPT = `// --- cube begin id=cube0 ---
let part = Manifold.cube([20, 20, 20], true);
part = part.add(Manifold.cube([10, 10, 10], true).translate([40, 0, 0]), { merge: false });
// --- cube end ---
// --- rotate begin id=rotate1 ---
part = rotateAbout(part, 'z', 30, null, { bodies: [{ at: [40, 0, 0] }] });
// --- rotate end ---
return part;
`;

test('a rotate edit exposes axis, angle, center, and the target centroid', () => {
  const [, rotate] = parseFeatureMarkers(SCRIPT);
  assert.equal(rotate.kind, 'rotate');
  const session = parseFeatureEdit('rotate', SCRIPT.slice(rotate.startOffset, rotate.endOffset));
  assert.deepEqual(session.fields, { axis: 'z', angle: 30, center: null, at: [40, 0, 0] });
});

test('confirm rewrites only the fields that changed', () => {
  const [, rotate] = parseFeatureMarkers(SCRIPT);
  const angle = confirmFeatureEdit(SCRIPT, rotate, { fields: { angle: 45 } });
  assert.equal(angle.ok, true, angle.message);
  assert.equal(angle.changed, true);
  assert.match(angle.buffer, /rotateAbout\(part, 'z', 45, null, \{ bodies: \[\{ at: \[40, 0, 0\] \}\] \}\)/);

  const axis = confirmFeatureEdit(SCRIPT, rotate, { fields: { axis: [1, 0, 0] } });
  assert.match(axis.buffer, /rotateAbout\(part, \[1, 0, 0\], 30, null,/);
  const named = confirmFeatureEdit(SCRIPT, rotate, { fields: { axis: 'y' } });
  assert.match(named.buffer, /rotateAbout\(part, 'y', 30, null,/);

  const center = confirmFeatureEdit(SCRIPT, rotate, { fields: { center: [0, 0, 5] } });
  assert.match(center.buffer, /rotateAbout\(part, 'z', 30, \[0, 0, 5\], \{ bodies/);
  const back = confirmFeatureEdit(center.buffer, parseFeatureMarkers(center.buffer)[1], { fields: { center: null } });
  assert.match(back.buffer, /rotateAbout\(part, 'z', 30, null, \{ bodies/);

  const at = confirmFeatureEdit(SCRIPT, rotate, { fields: { at: [0, 0, 0] } });
  assert.match(at.buffer, /\{ bodies: \[\{ at: \[0, 0, 0\] \}\] \}/);
  assert.doesNotMatch(at.buffer, /at: \[40, 0, 0\]/);

  const same = confirmFeatureEdit(SCRIPT, rotate, { fields: { axis: 'z', angle: 30, center: null, at: [40, 0, 0] } });
  assert.equal(same.changed, false);
  const bad = confirmFeatureEdit(SCRIPT, rotate, { fields: { axis: 'w', at: [1, 'x'] } });
  assert.equal(bad.changed, false);
});
