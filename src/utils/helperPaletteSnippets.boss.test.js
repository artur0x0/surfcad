/**
 * The Boss palette item / insert_boss: what it writes, how the agent schema
 * describes it, and how the edit card reads and rewrites the call.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOSS_BEGIN,
  bossOptsLiteral,
  composeHelperInsert,
  HELPERS_NEED_BODY,
  HELPER_PALETTE_ITEMS,
  paletteRailSections,
} from './helperPaletteSnippets.js';
import { confirmFeatureEdit, parseFeatureEdit } from './featureEdit.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { faceAwareParams, isFaceFeature } from './faceFeaturePlacement.js';
import { describeHelperRefusal, schemaPropertiesForHelper, coerceHelperParams } from '../agent/helperPaletteAgent.js';
import { INSERT_EMITS } from '../agent/export/insertEmits.js';

const CUBE = `// --- cube begin id=cube1 ---
let part = Manifold.cube([40, 30, 10], true);
// --- cube end ---
return part;
`;
const item = HELPER_PALETTE_ITEMS.find((row) => row.id === 'boss');

test('bossOptsLiteral writes size and height always and the rest only off the default', () => {
  assert.equal(bossOptsLiteral({}), "{ size: 'M3', height: 8 }");
  assert.equal(bossOptsLiteral({ size: 'M4', height: 6, dia: 0, hole: 'tap', holeDepth: 0 }), "{ size: 'M4', height: 6 }");
  assert.equal(bossOptsLiteral({ size: 'M4', height: 6, dia: 12, hole: 'clearance', holeDepth: 9, fit: 'loose' }),
    "{ size: 'M4', height: 6, dia: 12, hole: 'clearance', holeDepth: 9, fit: 'loose' }");
  assert.equal(bossOptsLiteral({ hole: 'none', holeDepth: 5, fit: 'loose' }), "{ size: 'M3', height: 8, hole: 'none' }");
  assert.equal(bossOptsLiteral({ hole: 'tap', fit: 'loose' }), "{ size: 'M3', height: 8 }", 'fit only matters on a clearance hole');
});

test('insert_boss composes a boss block on the default top workplane and is refused on an empty part', () => {
  const out = composeHelperInsert(CUBE, 'boss', null, { size: 'M3', height: 8 });
  assert.ok(out, 'composed');
  assert.match(out, /\/\/ --- boss begin id=boss1 ---/);
  assert.match(out, /const topFace = facesByNormal\(part, \[0, 0, 1\]\)\[0\];/);
  assert.match(out, /const fr = workplaneFromFace\(part, topFace\);/);
  assert.match(out, /part = boss\(part, fr, 0, 0, \{ size: 'M3', height: 8 \}\);/);
  assert.equal(parseFeatureMarkers(out).filter((f) => f.kind === 'boss').length, 1);
  assert.equal(composeHelperInsert('', 'boss', null, {}), null, 'needs a body');
  assert.ok(HELPERS_NEED_BODY.has('boss'));
  assert.match(describeHelperRefusal(item, { params: {}, buffer: '' }), /Boss needs a body first/);
  const face = { type: 'planar', center: [0, 0, 5], normal: [0, 0, 1], area: 1200, name: 'cube1.top' };
  const onFace = composeHelperInsert(CUBE, 'boss', null, { size: 'M4', height: 6, hole: 'clearance', u: 10, v: -5 }, face);
  assert.match(onFace, /part = boss\(part, fr, 10, -5, \{ size: 'M4', height: 6, hole: 'clearance' \}\);/);
  assert.equal(INSERT_EMITS.insert_boss.includes("boss(part, fr, 0, 0, { size: 'M3', height: 8 })"), true, INSERT_EMITS.insert_boss);
});

test('the Boss button sits in Build after Hole and the card knows it as a face feature', () => {
  const build = paletteRailSections('desktop').find((s) => s.key === 'Build').items.map((i) => i.id);
  assert.deepEqual(build, ['hole', 'boss', 'cut', 'boolean', 'shell', 'addDraft', 'array3D']);
  assert.ok(isFaceFeature('boss'));
  const planar = faceAwareParams('boss', 'planar').map((p) => p.name);
  assert.deepEqual(planar, ['body', 'size', 'height', 'dia', 'hole', 'holeDepth', 'fit', 'placement', 'u', 'v']);
  const cyl = faceAwareParams('boss', 'cylindrical').map((p) => p.name);
  assert.ok(cyl.includes('angleDeg') && cyl.includes('axial') && !cyl.includes('u'));
});

test('the agent schema carries the boss fields and use_selection, and coerce keeps them', () => {
  const props = schemaPropertiesForHelper(item);
  for (const key of ['size', 'height', 'dia', 'hole', 'holeDepth', 'fit', 'u', 'v', 'use_selection']) {
    assert.ok(props[key], `schema has ${key}`);
  }
  assert.deepEqual(props.hole.enum, ['tap', 'clearance', 'none']);
  assert.match(props.use_selection.description, /selected planar face/);
  const merged = coerceHelperParams(item, { size: 'M5', height: 12, hole: 'none', u: 3 });
  assert.equal(merged.size, 'M5');
  assert.equal(merged.height, 12);
  assert.equal(merged.hole, 'none');
  assert.equal(merged.u, 3);
  assert.equal(merged.dia, 0);
});

test('the edit card reads a boss call back and rewrites it from changed fields', () => {
  const script = composeHelperInsert(CUBE, 'boss', null, { size: 'M3', height: 8, u: 5, v: -3 });
  const feature = parseFeatureMarkers(script).find((f) => f.kind === 'boss');
  const block = script.slice(feature.startOffset, feature.endOffset);
  assert.ok(block.startsWith(BOSS_BEGIN.replace(' ---', ' id=boss1 ---')) || block.includes('boss begin'), block.slice(0, 40));
  const session = parseFeatureEdit('boss', block);
  assert.equal(session.ok, true, session.message);
  assert.deepEqual(session.fields, { u: 5, v: -3, size: 'M3', height: 8, dia: 0, hole: 'tap', holeDepth: 0, fit: 'normal' });

  const edited = confirmFeatureEdit(script, feature, { fields: { height: 12, hole: 'clearance', fit: 'loose', dia: 10, u: 6 } });
  assert.equal(edited.ok, true, edited.message);
  assert.equal(edited.changed, true);
  assert.match(edited.buffer, /part = boss\(part, fr, 6, -3, \{ size: 'M3', height: 12, dia: 10, hole: 'clearance', fit: 'loose' \}\);/);
  assert.equal(parseFeatureMarkers(edited.buffer).length, parseFeatureMarkers(script).length);

  const same = confirmFeatureEdit(script, feature, { fields: { height: 8 } });
  assert.equal(same.changed, false);

  const solid = confirmFeatureEdit(edited.buffer, feature, { fields: { hole: 'none' } });
  assert.match(solid.buffer, /\{ size: 'M3', height: 12, dia: 10, hole: 'none' \}/);
});
