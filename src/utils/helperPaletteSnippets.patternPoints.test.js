import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeHelperInsert,
  HELPER_PALETTE_ITEMS,
  paletteRailSections,
  parsePatternPoints,
  helperNeedsBody,
} from './helperPaletteSnippets.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { parseFeatureEdit, FEATURE_EDIT_DIALOGS } from './featureEdit.js';
import { validateHelperParams, coerceHelperParams, schemaPropertiesForHelper } from '../agent/helperPaletteAgent.js';

const BOLT = '// --- cylinder begin id=b1 ---\nlet part = Manifold.cylinder(12, 2.5, 2.5, 24);\n// --- cylinder end ---\nreturn part;\n';

test('parsePatternPoints accepts arrays and JSON, normalises, and refuses junk', () => {
  assert.deepEqual(parsePatternPoints([[0, 0, 0], { at: [1, 2, 3], axis: [0, 0, 1] }, { at: ['4', 5, 6] }]), [[0, 0, 0], { at: [1, 2, 3], axis: [0, 0, 1] }, { at: [4, 5, 6] }]);
  assert.deepEqual(parsePatternPoints('[[0, 0, 0], [40, 0, 0]]'), [[0, 0, 0], [40, 0, 0]]);
  for (const bad of ['', '[]', 'nope', [], null, [[1, 2]], [{ axis: [0, 0, 1] }], [{ at: [0, 0, 0], axis: [0, 0, 0] }], ['x'], [[1, 2, 'q']]]) {
    assert.equal(parsePatternPoints(bad), null, JSON.stringify(bad));
  }
});

test('the Points button sits in Build after Array and composes a patternOnPoints block', () => {
  const build = paletteRailSections('desktop').find((s) => s.key === 'Build').items.map((i) => i.id);
  assert.ok(build.indexOf('patternPoints') > build.indexOf('array3D'), build.join(','));
  assert.equal(helperNeedsBody('patternPoints'), true);
  const out = composeHelperInsert(BOLT, 'patternPoints', null, {
    points: [{ at: [-20, -15, 6], axis: [0, 0, 1] }, [20, -15, 6]],
    up: 'z',
    keepOriginal: false,
    merge: true,
  });
  assert.ok(out, 'composes');
  assert.deepEqual(parseFeatureMarkers(out).map((b) => b.kind), ['cylinder', 'patternPoints']);
  assert.match(out, /part = patternOnPoints\(part, \[\{"at":\[-20,-15,6\],"axis":\[0,0,1\]\},\[20,-15,6\]\], \{ up: \[0, 0, 1\], keepOriginal: false, merge: true \}\);/);
  // The block reopens in the helper sheet with its fields.
  assert.deepEqual(FEATURE_EDIT_DIALOGS.patternPoints, { dialog: 'helper', helperId: 'patternPoints' });
  const block = out.slice(out.indexOf('// --- patternPoints begin'), out.indexOf('// --- patternPoints end') + '// --- patternPoints end ---'.length);
  const edit = parseFeatureEdit('patternPoints', block);
  assert.equal(edit.ok !== false, true, JSON.stringify(edit));
  assert.equal(edit.fields.points, '[{"at":[-20,-15,6],"axis":[0,0,1]},[20,-15,6]]');
  assert.equal(edit.fields.up, 'z');
  assert.equal(edit.fields.keepOriginal, false);
  assert.equal(edit.fields.merge, true);
  // Unusable points compose nothing.
  assert.equal(composeHelperInsert(BOLT, 'patternPoints', null, { points: 'nope' }), null);
  assert.equal(composeHelperInsert('', 'patternPoints', null, { points: [[0, 0, 0]] }), null, 'needs a body');
});

test('the agent tool takes an array or a JSON string and refuses bad points with bad_args', () => {
  const item = HELPER_PALETTE_ITEMS.find((i) => i.id === 'patternPoints');
  const props = schemaPropertiesForHelper(item);
  assert.deepEqual(props.points.type, ['array', 'string']);
  assert.equal(validateHelperParams(item, coerceHelperParams(item, { points: [[0, 0, 0]] })), null);
  assert.equal(validateHelperParams(item, coerceHelperParams(item, { points: '[{"at":[1,2,3],"axis":[0,1,0]}]' })), null);
  for (const bad of [[], 'x', [[1, 2]], [{ at: [0, 0, 0], axis: [0, 0, 0] }]]) {
    const verdict = validateHelperParams(item, coerceHelperParams(item, { points: bad }));
    assert.equal(verdict?.code, 'bad_args', JSON.stringify(bad));
    assert.match(verdict.message, /\[x, y, z\]/);
  }
});
