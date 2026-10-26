import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFeatureMarkers } from './featureMarkers.js';
import { confirmFeatureEdit, creationDialogFor, parseFeatureEdit } from './featureEdit.js';

const SCRIPT = `// --- cube begin id=cube0 ---
let part = Manifold.cube([20, 20, 20], true);
// --- cube end ---
// --- mirror begin id=mirror1 ---
part = mirror(part, 'yz', true, { bodies: [{ at: [0, 0, 0] }] });
// --- mirror end ---
return part;
`;

test('a mirror edit reopens the mirror card and can change the named plane', () => {
  assert.deepEqual(creationDialogFor('mirror'), { dialog: 'mirror', entry: 'mirror' });
  const mirror = parseFeatureMarkers(SCRIPT).find((f) => f.kind === 'mirror');
  const session = parseFeatureEdit('mirror', SCRIPT.slice(mirror.startOffset, mirror.endOffset));
  assert.equal(session.dialog, 'mirror');
  assert.equal(session.fields.plane, 'yz');
  assert.equal(session.fields.keepOriginal, true);
  assert.deepEqual(session.fields.at, [0, 0, 0]);
  const edited = confirmFeatureEdit(SCRIPT, mirror, { fields: { plane: 'xy' } });
  assert.equal(edited.ok, true, edited.message);
  assert.match(edited.buffer, /mirror\(part, 'xy', true, \{ bodies: \[\{ at: \[0, 0, 0\] \}\] \}\)/);
  assert.equal((edited.buffer.match(/\bmirror\s*\(/g) || []).length, 1);
});

test('a workplane mirror still parses', () => {
  const block = `// --- mirror begin ---
part = mirror(part, { center: [30, 0, 0], normal: [1, 0, 0] }, true, { bodies: [{ at: [20, 0, 0] }] });
// --- mirror end ---`;
  const session = parseFeatureEdit('mirror', block);
  assert.equal(session.ok, true, session.message);
  assert.deepEqual(session.fields.plane, { center: [30, 0, 0], normal: [1, 0, 0] });
  assert.deepEqual(session.fields.at, [20, 0, 0]);
});
