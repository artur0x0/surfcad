import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmFeatureEdit, openFeatureEdit } from './featureEdit.js';
import { parseFeatureMarkers } from './featureMarkers.js';

/**
 * Every numeric field the edit card shows is written back on Confirm.
 *
 * The card reads its fields from the block (parseFeatureEdit) and Confirm
 * rewrites the block from the merged fields (rewriteBlock). A kind whose
 * rewrite covered only its sample key let the other fields fall through as
 * "unchanged": the preview showed the new value, Confirm wrote nothing, and
 * the part kept its old settings (the flanged box's hole grid spacing).
 */

const HOST = [
  '// --- cube begin id=cube1 ---',
  'let box1 = Manifold.cube([80, 40, 10], true);',
  'let part = box1;',
  '// --- cube end id=cube1 ---',
].join('\n');
const FRAME = 'const fr = workplaneFromFace(part, { center: [0, 0, 5], normal: [0, 0, 1] });';
const TAIL = [
  '// --- cylinder begin id=cylinder1 ---',
  'let cyl1 = Manifold.cylinder(20, 5, 5, 48).translate([0, 0, 5]);',
  'part = part.add(cyl1);',
  '// --- cylinder end id=cylinder1 ---',
  'return part;',
  '',
].join('\n');

/** A script with one `marker` block between the host cube and a later cylinder. */
function scriptWith(marker, lines, id = `${marker}1`) {
  return [HOST, `// --- ${marker} begin id=${id} ---`, ...lines, `// --- ${marker} end id=${id} ---`, TAIL].join('\n');
}

/** Change each numeric field on its own and read it back from the rewritten block. */
function roundTripEveryNumber(label, script, kind, { skip = [] } = {}) {
  const feature = parseFeatureMarkers(script).find((f) => f.kind === kind);
  assert.ok(feature, `${label}: ${kind} block parsed`);
  const session = openFeatureEdit(script, feature);
  assert.equal(session.ok, true, `${label}: ${session.message || ''}`);
  const numeric = Object.entries(session.fields).filter(([key, value]) => typeof value === 'number' && !skip.includes(key));
  assert.ok(numeric.length > 0, `${label}: has numeric fields`);
  for (const [key, value] of numeric) {
    const nextValue = Number.isInteger(value) ? value + 3 : Math.round((value + 2.5) * 100) / 100;
    const out = confirmFeatureEdit(script, feature, { fields: { ...session.fields, [key]: nextValue } });
    assert.equal(out.ok, true, `${label}: ${key} confirm ok (${out.message || ''})`);
    assert.equal(out.changed, true, `${label}: ${key} ${value} -> ${nextValue} is a change`);
    const after = parseFeatureMarkers(out.buffer).find((f) => f.kind === kind);
    const again = openFeatureEdit(out.buffer, after);
    assert.equal(again.ok, true, `${label}: ${key} reopens`);
    assert.ok(Math.abs(again.fields[key] - nextValue) < 1e-9, `${label}: ${key} read back as ${again.fields[key]}, wanted ${nextValue}`);
    for (const [other, prior] of numeric) {
      if (other === key) continue;
      assert.ok(Math.abs(again.fields[other] - prior) < 1e-9, `${label}: ${key} edit left ${other} at ${again.fields[other]}, was ${prior}`);
    }
    assert.equal(parseFeatureMarkers(out.buffer).length, parseFeatureMarkers(script).length, `${label}: ${key} keeps the feature count`);
    assert.ok(out.buffer.endsWith(TAIL), `${label}: ${key} leaves the later feature alone`);
  }
}

test('hole grid: count U, count V, spacing U, spacing V and diameter all write back', () => {
  const script = scriptWith('holePattern', [FRAME, 'part = holePattern(part, fr, { n: 2, m: 2, spacingU: 30, spacingV: 20, dia: 3.4 });']);
  roundTripEveryNumber('hole grid', script, 'holePattern');
});

test('hole grid from a Hole insert: the clearance name reads as its diameter and a new diameter rewrites that binding', () => {
  const script = scriptWith('holePattern', [
    FRAME,
    "const _cd1 = fastenerClearanceDia('M3', 'normal');",
    'const span1 = holeSpan(part, fr);',
    'part = holePattern(part, fr, { n: 2, m: 3, spacingU: 30, spacingV: 20, dia: _cd1, span: span1 });',
  ]);
  const feature = parseFeatureMarkers(script).find((f) => f.kind === 'holePattern');
  const session = openFeatureEdit(script, feature);
  assert.equal(session.ok, true, session.message || '');
  assert.deepEqual(session.fields, { n: 2, m: 3, spacingU: 30, spacingV: 20, dia: 3.4 });
  const spacing = confirmFeatureEdit(script, feature, { fields: { ...session.fields, spacingU: 45, m: 4 } });
  assert.equal(spacing.changed, true);
  assert.match(spacing.buffer, /holePattern\(part, fr, \{ n: 2, m: 4, spacingU: 45, spacingV: 20, dia: _cd1, span: span1 \}\)/);
  assert.match(spacing.buffer, /const _cd1 = fastenerClearanceDia\('M3', 'normal'\);/);
  const dia = confirmFeatureEdit(script, feature, { fields: { ...session.fields, dia: 4.5 } });
  assert.equal(dia.changed, true);
  assert.match(dia.buffer, /const _cd1 = 4\.5;/);
  assert.match(dia.buffer, /dia: _cd1, span: span1/);
  const reopened = openFeatureEdit(dia.buffer, parseFeatureMarkers(dia.buffer).find((f) => f.kind === 'holePattern'));
  assert.equal(reopened.fields.dia, 4.5);
  roundTripEveryNumber('hole grid (named dia)', script, 'holePattern');
});

test('clearance hole: u and v write back, size and fit too', () => {
  const script = scriptWith('clearanceHole', [FRAME, 'const span = holeSpan(part, fr);', "part = clearanceHole(part, fr, 43.5, 46.5, 'M3', span, 'normal');"]);
  roundTripEveryNumber('clearance hole', script, 'clearanceHole');
  const feature = parseFeatureMarkers(script).find((f) => f.kind === 'clearanceHole');
  const session = openFeatureEdit(script, feature);
  const out = confirmFeatureEdit(script, feature, { fields: { ...session.fields, size: 'M5', fit: 'loose' } });
  assert.equal(out.changed, true);
  assert.match(out.buffer, /clearanceHole\(part, fr, 43\.5, 46\.5, 'M5', span, 'loose'\)/);
});

test('tap drill hole: u, v and size write back', () => {
  const script = scriptWith('tapDrillHole', [FRAME, "part = tapDrillHole(part, fr, 16.5, -4, 'M3', 6);"]);
  roundTripEveryNumber('tap drill', script, 'tapDrillHole');
  const feature = parseFeatureMarkers(script).find((f) => f.kind === 'tapDrillHole');
  const session = openFeatureEdit(script, feature);
  const out = confirmFeatureEdit(script, feature, { fields: { ...session.fields, size: 'M4' } });
  assert.equal(out.changed, true);
  assert.match(out.buffer, /tapDrillHole\(part, fr, 16\.5, -4, 'M4', 6\)/);
});

test('counterbore and countersink: every numeric argument writes back', () => {
  const cbore = scriptWith('cboreHole', [FRAME, 'const span = holeSpan(part, fr);', 'part = cboreHole(part, fr, 10, 5, 3.4, 6.5, 3.2, span);']);
  roundTripEveryNumber('cbore', cbore, 'cboreHole');
  const csk = scriptWith('cskHole', [FRAME, 'const span = holeSpan(part, fr);', 'part = cskHole(part, fr, 10, 5, 3.4, 6.9, 1.7, span);']);
  roundTripEveryNumber('csk', csk, 'cskHole');
});

test('grid array: every count and spacing writes back', () => {
  const script = scriptWith('array', ['part = array3D(part, [3, 2, 1], [20, 15, 10]);']);
  roundTripEveryNumber('array', script, 'array');
});

test('polar array: count, bolt circle radius, and the bore size write back', () => {
  const script = scriptWith('polarArray', [
    'const bore1 = Manifold.cylinder(12, 1.7, 1.7, 32);',
    "const holes1 = polarArray(bore1, 6, 20, 'z');",
    'part = part.subtract(holes1);',
  ]);
  roundTripEveryNumber('polar array', script, 'polarArray');
});

test('shell wall and move face distance still write back', () => {
  const shell = scriptWith('shell', ["part = hollow(part, 1.85, 'z');"]);
  roundTripEveryNumber('shell', shell, 'shell');
  const moveFace = scriptWith('move-face', ['part = moveFace(part, [{ center: [0, 0, 5], normal: [0, 0, 1] }], 4);'], 'moveFace1');
  roundTripEveryNumber('move face', moveFace, 'moveFace');
});
