import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { coerceHelperParams, validateHelperParams } from '../agent/helperPaletteAgent.js';
import { confirmFeatureEdit, parseFeatureEdit } from './featureEdit.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { HELPER_PALETTE_ITEMS, composeHelperInsert } from './helperPaletteSnippets.js';

/**
 * Pi 5 acceptance A1: arraying a subtract body replaced the whole part with
 * the arrayed cutters (`box2 = array3D(box2, …); part = box2;`). The array
 * keeps the original instance, so the generator re-applies the body's own
 * combine op instead: a cutter cuts every copy, an added body adds every copy.
 */

const LID = { width: 60, depth: 80, height: 4, center: true };
const LID_VOLUME = 60 * 80 * 4;
const COPIES = 6;

/** Name of the body the last `part = part.<op>(name)` line combined. */
function combinedBody(script, op) {
  const m = [...script.matchAll(new RegExp(`part = part\\.${op}\\(([A-Za-z_$][\\w$]*)`, 'g'))].pop();
  assert.ok(m, `no part.${op}(…) in\n${script}`);
  return m[1];
}

function lidWithSlot() {
  const lid = composeHelperInsert('', 'cube', null, LID);
  const script = composeHelperInsert(lid, 'cube', null, {
    width: 4, depth: 4, height: 10, center: true, combine: 'subtract',
  });
  return { script, body: combinedBody(script, 'subtract') };
}

function lidWithBoss() {
  const lid = composeHelperInsert('', 'cube', null, LID);
  // Sits on the lid's top face (lid spans z = -2..2, boss z = 2..6).
  const script = composeHelperInsert(lid, 'cube', null, {
    width: 4, depth: 4, height: 4, center: true, z: 4, combine: 'add',
  });
  return { script, body: combinedBody(script, 'add') };
}

function arrayAlongY(script, body) {
  return composeHelperInsert(script, 'array3D', null, {
    body, arrayType: 'grid', nx: 1, ny: COPIES, nz: 1, sx: 0, sy: 6, sz: 0,
  });
}

test('array of a subtract body cuts every copy and keeps the part', async () => {
  const { script, body } = lidWithSlot();
  const next = arrayAlongY(script, body);
  const tail = next.slice(next.indexOf('// --- array begin'));
  assert.match(tail, new RegExp(`${body} = array3D\\(${body}, \\[1, ${COPIES}, 1\\], \\[0, 6, 0\\]\\);`));
  assert.match(tail, new RegExp(`part = part\\.subtract\\(${body}\\);`));
  assert.doesNotMatch(tail, new RegExp(`^\\s*part = ${body};`, 'm'));

  const ran = await runScript(next);
  assert.equal(ran.status, 'NoError');
  assert.equal(ran.bodyCount, 1, 'the lid is one body, not six cutters');
  const expected = LID_VOLUME - COPIES * 4 * 4 * 4;
  assert.ok(Math.abs(ran.volume - expected) < 1e-3, `volume ${ran.volume}, expected ${expected}`);
});

test('array of an added body adds every copy to the part', async () => {
  const { script, body } = lidWithBoss();
  const next = arrayAlongY(script, body);
  const tail = next.slice(next.indexOf('// --- array begin'));
  assert.match(tail, new RegExp(`part = part\\.add\\(${body}\\);`));
  assert.doesNotMatch(tail, new RegExp(`^\\s*part = ${body};`, 'm'));

  const ran = await runScript(next);
  assert.equal(ran.status, 'NoError');
  assert.equal(ran.bodyCount, 1);
  const expected = LID_VOLUME + COPIES * 4 * 4 * 4;
  assert.ok(Math.abs(ran.volume - expected) < 1e-3, `volume ${ran.volume}, expected ${expected}`);
});

test('array keeps the body\'s merge: false option', () => {
  const lid = composeHelperInsert('', 'cube', null, LID);
  const script = composeHelperInsert(lid, 'cube', null, {
    width: 4, depth: 4, height: 4, center: true, z: 10, combine: 'add', merge: false,
  });
  const body = combinedBody(script, 'add');
  assert.match(script, new RegExp(`part = part\\.add\\(${body}, \\{ merge: false \\}\\);`));
  const next = arrayAlongY(script, body);
  const tail = next.slice(next.indexOf('// --- array begin'));
  assert.match(tail, new RegExp(`part = part\\.add\\(${body}, \\{ merge: false \\}\\);`));
});

test('polar array of a subtract body cuts every copy', () => {
  const { script, body } = lidWithSlot();
  const next = composeHelperInsert(script, 'array3D', null, {
    body, arrayType: 'polar', count: 4, boltCircleRadius: 20, axis: 'z',
  });
  const tail = next.slice(next.indexOf('// --- polarArray begin'));
  assert.match(tail, new RegExp(`${body} = polarArray\\(${body}, 4, 20, 'z'\\);`));
  assert.match(tail, new RegExp(`part = part\\.subtract\\(${body}\\);`));
  assert.doesNotMatch(tail, new RegExp(`^\\s*part = ${body};`, 'm'));
});

function plate() {
  return composeHelperInsert('', 'cube', null, { width: 60, depth: 60, height: 10, center: true });
}

test('polar bore params subtract holes and do not copy the plate', async () => {
  const host = plate();
  const next = composeHelperInsert(host, 'polarArray', null, {
    count: 4, boltCircleRadius: 20, axis: 'z', boreRadius: 3, boreHeight: 20,
  });
  const tail = next.slice(next.indexOf('// --- polarArray begin'));
  assert.match(tail, /const bore1 = Manifold\.cylinder\(20, 3, 3, 64, true\);/);
  assert.match(tail, /const holes = polarArray\(bore1, 4, 20, 'z'\);/);
  assert.match(tail, /part = part\.subtract\(holes\);/);
  assert.doesNotMatch(tail, /part = polarArray\(part/);

  const ran = await runScript(next);
  assert.equal(ran.status, 'NoError');
  assert.equal(ran.bodyCount, 1, 'one plate with holes, not a copy of the plate');
  const solid = 60 * 60 * 10;
  assert.ok(ran.volume < solid - 100, `volume ${ran.volume} did not lose the holes`);
  assert.ok(ran.volume > solid - 4 * Math.PI * 9 * 10 - 50, `volume ${ran.volume} lost more than the four bores`);

  const feature = parseFeatureMarkers(next).find((row) => row.kind === 'polarArray');
  const parsed = parseFeatureEdit('polarArray', next.slice(feature.startOffset, feature.endOffset));
  assert.equal(parsed.fields.boreRadius, 3);
  assert.equal(parsed.fields.boreHeight, 20);
  assert.equal(parsed.fields.boltCircleRadius, 20);
  const edited = confirmFeatureEdit(next, feature, { fields: { count: 6 } });
  assert.equal(edited.ok, true);
  assert.match(edited.buffer, /polarArray\(bore1, 6, 20, 'z'\)/);
  assert.match(edited.buffer, /part = part\.subtract\(holes\)/);
});

test('polar holes follow the axis on x and y', async () => {
  const host = composeHelperInsert('', 'cube', null, { width: 40, depth: 40, height: 40, center: true });
  for (const axis of ['x', 'y']) {
    const next = composeHelperInsert(host, 'polarArray', null, {
      count: 4, boltCircleRadius: 12, axis, boreRadius: 2, boreHeight: 50,
    });
    const ran = await runScript(next);
    assert.equal(ran.status, 'NoError', axis);
    assert.equal(ran.bodyCount, 1, axis);
    const solid = 40 * 40 * 40;
    const bore = 4 * Math.PI * 4 * 40;
    assert.ok(Math.abs(ran.volume - (solid - bore)) < 30, `${axis} volume ${ran.volume}, expected about ${solid - bore}`);
  }
  const alongY = composeHelperInsert(host, 'polarArray', null, {
    count: 4, boltCircleRadius: 12, axis: 'y', boreRadius: 2, boreHeight: 50,
  });
  assert.match(alongY, /rotate\(\[-90, 0, 0\]\)/);
  const alongX = composeHelperInsert(host, 'polarArray', null, {
    count: 4, boltCircleRadius: 12, axis: 'x', boreRadius: 2, boreHeight: 50,
  });
  assert.match(alongX, /rotate\(\[0, 90, 0\]\)/);
});

test('polar copy of part does not keep the source beside the copies', async () => {
  const host = composeHelperInsert('', 'cube', null, { width: 8, depth: 8, height: 8, center: true });
  const next = composeHelperInsert(host, 'polarArray', null, {
    body: 'part', count: 5, boltCircleRadius: 50, axis: 'y',
  });
  const tail = next.slice(next.indexOf('// --- polarArray begin'));
  assert.match(tail, /part = polarArray\(part, 5, 50, 'y'\);/);
  assert.doesNotMatch(tail, /Manifold\.cylinder/);
  assert.doesNotMatch(tail, /part = part\.add\(/);
  const ran = await runScript(next);
  assert.equal(ran.status, 'NoError');
  assert.equal(ran.bodyCount, 5, 'five copies, not the original plus the array');
  assert.ok(Math.abs(ran.volume - 5 * 512) < 1e-3, `volume ${ran.volume}`);
});

test('polar copy of an aliased body replaces part instead of adding the array', async () => {
  const prefix = 'let box1 = Manifold.cube([8, 8, 8], true);\nlet part = box1;';
  const next = composeHelperInsert(prefix, 'polarArray', null, {
    body: 'box1', count: 4, boltCircleRadius: 30, axis: 'z',
  });
  const tail = next.slice(next.indexOf('// --- polarArray begin'));
  assert.match(tail, /box1 = polarArray\(box1, 4, 30, 'z'\);/);
  assert.match(tail, /part = box1;/);
  assert.doesNotMatch(tail, /part = part\.add\(box1\)/);
  const ran = await runScript(next);
  assert.equal(ran.status, 'NoError');
  assert.equal(ran.bodyCount, 4);
  assert.ok(Math.abs(ran.volume - 4 * 512) < 1e-3, `volume ${ran.volume}`);
});

test('polar copy of an added body drops the untranslated source', async () => {
  const lid = composeHelperInsert('', 'cube', null, LID);
  const script = composeHelperInsert(lid, 'cube', null, {
    width: 6, depth: 6, height: 6, center: true, z: 20, combine: 'add',
  });
  const body = combinedBody(script, 'add');
  const next = composeHelperInsert(script, 'polarArray', null, {
    body, count: 4, boltCircleRadius: 25, axis: 'z',
  });
  const tail = next.slice(next.indexOf('// --- polarArray begin'));
  assert.match(tail, /const polarSrc = /);
  assert.match(tail, new RegExp(`part = part\\.subtract\\(polarSrc\\);`));
  assert.match(tail, new RegExp(`part = part\\.add\\(${body}\\);`));
  const ran = await runScript(next);
  assert.equal(ran.status, 'NoError');
  const expected = LID_VOLUME + 4 * 6 * 6 * 6;
  assert.ok(Math.abs(ran.volume - expected) < 1e-3, `volume ${ran.volume}, expected ${expected}`);
  assert.equal(ran.bodyCount, 5, 'the lid plus four bosses, not five bosses');
});

test('polar radius 0 does not push a copied body off the axis', async () => {
  const host = composeHelperInsert('', 'cube', null, { width: 10, depth: 10, height: 10, center: true });
  const next = composeHelperInsert(host, 'polarArray', null, { count: 4, axis: 'z' });
  assert.match(next, /part = polarArray\(part, 4, 0, 'z'\);/);
  const ran = await runScript(next);
  assert.equal(ran.status, 'NoError');
  assert.equal(ran.bodyCount, 1);
  assert.ok(Math.abs(ran.volume - 1000) < 1e-3, `volume ${ran.volume}`);
});

test('a bolt circle around x orbits in the YZ plane', async () => {
  const ran = await runScript(`
    let part = Manifold.cube([4, 4, 4], true);
    part = polarArray(part, 4, 30, 'x');
    return part;
  `);
  assert.equal(ran.status, 'NoError');
  assert.equal(ran.bodyCount, 4);
  assert.ok(ran.bodyCentroids.every((c) => Math.abs(c[0]) < 0.1), JSON.stringify(ran.bodyCentroids));
  assert.ok(ran.bodyCentroids.every((c) => Math.abs(Math.hypot(c[1], c[2]) - 30) < 0.1), JSON.stringify(ran.bodyCentroids));
});

test('drilling without a bolt circle radius is bad_args', () => {
  const polar = HELPER_PALETTE_ITEMS.find((item) => item.id === 'polarArray');
  const array = HELPER_PALETTE_ITEMS.find((item) => item.id === 'array3D');
  const drilled = validateHelperParams(polar, coerceHelperParams(polar, { boreRadius: 3, boltCircleRadius: 0 }));
  assert.equal(drilled.code, 'bad_args');
  assert.match(drilled.message, /boltCircleRadius/);
  const viaArray = validateHelperParams(array, coerceHelperParams(array, {
    arrayType: 'polar', boreRadius: 3, boltCircleRadius: 0,
  }));
  assert.equal(viaArray.code, 'bad_args');
  const grid = validateHelperParams(array, coerceHelperParams(array, { arrayType: 'grid', boreRadius: 3 }));
  assert.equal(grid, null);
  const copy = validateHelperParams(polar, coerceHelperParams(polar, { count: 5, axis: 'y' }));
  assert.equal(copy, null);
  const host = plate();
  assert.equal(composeHelperInsert(host, 'polarArray', null, { boreRadius: 3, boltCircleRadius: 0 }), null);
});

test('an empty polar array is still a circle of pins', () => {
  const script = composeHelperInsert('', 'array3D', null, { arrayType: 'polar', count: 6 });
  assert.match(script, /Manifold\.cylinder\(10, 3, 3, 64\)/);
  assert.match(script, /polarArray\([^)]*6, 20, 'z'\)/);
});

test('array of part itself is unchanged', () => {
  const lid = composeHelperInsert('', 'cube', null, LID);
  const next = composeHelperInsert(lid, 'array3D', null, {
    body: 'part', arrayType: 'grid', nx: 2, ny: 1, nz: 1, sx: 70, sy: 0, sz: 0,
  });
  const tail = next.slice(next.indexOf('// --- array begin'));
  assert.match(tail, /part = array3D\(part, \[2, 1, 1\], \[70, 0, 0\]\);/);
  assert.doesNotMatch(tail, /part = part\.(add|subtract)\(/);
});
