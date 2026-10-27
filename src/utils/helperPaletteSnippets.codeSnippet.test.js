import assert from 'node:assert/strict';
import test from 'node:test';
import { composeHelperInsert, HELPER_PALETTE_ITEMS, paletteRailSections } from './helperPaletteSnippets.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { parseFeatureGaps } from './featureGaps.js';
import { parseFeatureEdit, FEATURE_EDIT_DIALOGS } from './featureEdit.js';
import { validateHelperParams, coerceHelperParams } from '../agent/helperPaletteAgent.js';

const CUBE = '// --- cube begin id=c1 ---\nlet part = Manifold.cube([40, 30, 20], true);\n// --- cube end ---\nreturn part;\n';

test('the Script snippet stays off the rail and still inserts a code block that starts with the FEATURE-GAP line', () => {
  const build = paletteRailSections('desktop').find((s) => s.key === 'Build');
  assert.ok(!build.items.some((i) => i.id === 'codeSnippet'), build.items.map((i) => i.id).join(','));
  const item = HELPER_PALETTE_ITEMS.find((i) => i.id === 'codeSnippet');
  assert.equal(item.railHidden, true);
  const out = composeHelperInsert(CUBE, 'codeSnippet', null, {
    gap: 'sweep along 3D path',
    why: 'extrude only goes straight',
    script: 'part = part.add(Manifold.cylinder(10, 2, 2, 24));\n',
  });
  assert.ok(out, 'composes');
  const blocks = parseFeatureMarkers(out);
  assert.deepEqual(blocks.map((b) => b.kind), ['cube', 'code']);
  const gaps = parseFeatureGaps(out);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].gap, 'sweep along 3D path');
  assert.equal(gaps[0].why, 'extrude only goes straight');
  assert.match(out, /\/\/ --- code begin ---\n\/\/ FEATURE-GAP: sweep along 3D path \| extrude only goes straight\npart = part\.add\(Manifold\.cylinder\(10, 2, 2, 24\)\);\n\/\/ --- code end ---/);
  assert.match(out, /return part;\s*$/);
  assert.deepEqual(FEATURE_EDIT_DIALOGS.code, { dialog: 'helper', helperId: 'codeSnippet' });
  const block = out.slice(out.indexOf('// --- code begin'), out.indexOf('// --- code end') + '// --- code end ---'.length);
  const edit = parseFeatureEdit('code', block);
  assert.equal(edit.ok !== false, true, JSON.stringify(edit));
  assert.equal(edit.fields.gap, 'sweep along 3D path');
  assert.equal(edit.fields.why, 'extrude only goes straight');
  assert.match(edit.fields.script, /part = part\.add\(Manifold\.cylinder\(10, 2, 2, 24\)\);/);
});

test('on an empty part the snippet makes the first body; the default placeholder is replaced', () => {
  const out = composeHelperInsert('', 'codeSnippet', null, { gap: 'thread', why: 'no thread feature', script: 'part = part;' });
  assert.match(out, /let part = Manifold\.cube\(\[10, 10, 10\], true\);/);
  assert.match(out, /^\/\/ --- code begin ---\n\/\/ FEATURE-GAP: thread \| no thread feature/m);
});

test('the agent tool refuses an empty gap, why, or script with bad_args', () => {
  const item = HELPER_PALETTE_ITEMS.find((i) => i.id === 'codeSnippet');
  const ok = validateHelperParams(item, coerceHelperParams(item, { gap: 'a', why: 'b', script: 'part = part;' }));
  assert.equal(ok, null);
  for (const missing of ['gap', 'why', 'script']) {
    const args = { gap: 'a', why: 'b', script: 'part = part;', [missing]: '   ' };
    const verdict = validateHelperParams(item, coerceHelperParams(item, args));
    assert.equal(verdict?.code, 'bad_args', missing);
    assert.match(verdict.message, /FEATURE|gap|why|script/i);
  }
  assert.equal(validateHelperParams(item, coerceHelperParams(item, {}))?.code, 'bad_args');
});

test('on an empty part a snippet written as `part = …` declares part, and one that declares it is left alone (B3)', () => {
  const assigned = composeHelperInsert('', 'codeSnippet', null, { gap: 'thread', why: 'no thread feature', script: 'part = Manifold.cube([10, 10, 10], true);\npart = part.add(Manifold.sphere(3, 12));' });
  assert.match(assigned, /\/\/ FEATURE-GAP: thread \| no thread feature\nlet part = Manifold\.cube\(\[10, 10, 10\], true\);\npart = part\.add/);
  assert.equal((assigned.match(/let part/g) || []).length, 1);
  const declared = composeHelperInsert('', 'codeSnippet', null, { gap: 'thread', why: 'no thread feature', script: 'const base = Manifold.cube([10, 10, 10], true);\nlet part = base;' });
  assert.equal((declared.match(/let part/g) || []).length, 1);
  assert.match(declared, /const base = Manifold\.cube/);
  const noPart = composeHelperInsert('', 'codeSnippet', null, { gap: 'x', why: 'y', script: 'const lonely = Manifold.cube([1, 1, 1]);' });
  assert.match(noPart, /\nlet part;\nconst lonely/);
  // A later feature on a part that already exists is untouched.
  const later = composeHelperInsert(CUBE, 'codeSnippet', null, { gap: 'x', why: 'y', script: 'part = part.add(Manifold.sphere(2, 8));' });
  assert.doesNotMatch(later, /let part = part/);
});
