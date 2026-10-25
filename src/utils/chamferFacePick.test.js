/**
 * insert_chamfer_edges on a named face (playtest: roundedBox-2.right, a
 * faceplate with four M5 holes) must chamfer that face's boundary only.
 * An irregular pick with no name used to emit convexEdges(part) and the
 * kernel returned the shredded solid.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeHelperRefusal } from '../agent/helperPaletteAgent.js';
import { classifySelectedFace } from './faceFeaturePlacement.js';
import { composeHelperInsert } from './helperPaletteSnippets.js';

const PLATE = `// --- roundedBox begin id=plate ---
let part = roundedBox([16, 70, 50], 3, 8);
// --- roundedBox end id=plate ---
`;

function face(mode, name) {
  return classifySelectedFace({
    center: [8, 0, 0],
    normal: [1, 0, 0],
    area: 200,
    triangleCount: 12,
    selectionMode: mode,
    ...(name ? { name, feature: 'plate', role: 'right' } : {}),
  });
}

test('a named face chamfer writes edgesOf, including an irregular pick', () => {
  for (const mode of ['coplanar', 'all-connected']) {
    const script = composeHelperInsert(PLATE, 'chamferEdges', null, { chamfer: 1 }, face(mode, 'plate.right'), null);
    assert.match(script, /edgesOf\(part, "plate\.right"\)/);
    assert.doesNotMatch(script, /convexEdges\(part\)/);
  }
  const omitted = composeHelperInsert(PLATE, 'chamferEdges', null, { chamfer: 1 }, null, null);
  assert.match(omitted, /convexEdges\(part\)/);
});

test('an irregular face with no name is refused instead of chamfering every edge', () => {
  const bare = face('all-connected');
  assert.equal(bare.type, 'irregular');
  assert.equal(composeHelperInsert(PLATE, 'chamferEdges', null, { chamfer: 1 }, bare, null), null);
  const why = describeHelperRefusal(
    { id: 'chamferEdges', label: 'Chamfer' },
    { faceContext: bare, edgeContext: null, buffer: PLATE },
  );
  assert.match(why, /no face name/);
  assert.match(why, /insert_failed|refused|named face/i);
});
