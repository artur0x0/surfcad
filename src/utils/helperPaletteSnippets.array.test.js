import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { composeHelperInsert } from './helperPaletteSnippets.js';

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

test('array of part itself is unchanged', () => {
  const lid = composeHelperInsert('', 'cube', null, LID);
  const next = composeHelperInsert(lid, 'array3D', null, {
    body: 'part', arrayType: 'grid', nx: 2, ny: 1, nz: 1, sx: 70, sy: 0, sz: 0,
  });
  const tail = next.slice(next.indexOf('// --- array begin'));
  assert.match(tail, /part = array3D\(part, \[2, 1, 1\], \[70, 0, 0\]\);/);
  assert.doesNotMatch(tail, /part = part\.(add|subtract)\(/);
});
