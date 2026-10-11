import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { composeContourExtrude } from './contourMode.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { contourStatements, findReturnPartIndex } from './namedContour.js';
import { composeSheetMetalCommit } from './sheetMetal/sheetMetalScript.js';

const FACE = {
  type: 'planar',
  center: [0, 80, 0],
  normal: [0, 1, 0],
  area: 400,
  triangleCount: 2,
  selectionMode: 'coplanar',
  planeFrame: {
    center: [0, 80, 0],
    normal: [0, 1, 0],
    x: [1, 0, 0],
    y: [0, 0, 1],
  },
};

const SPEC = {
  v: 1,
  sku: 'SST316-125',
  material: 'Stainless Steel (316 Series)',
  t: 3.175,
  r: 1,
  k: 0.38,
  plane: 'XZ',
  width: 100,
  height: 60,
  bends: [],
  tabs: [],
  holes: [],
};

const STUDY = [
  '// --- fea-study begin ---',
  '// @fea-study {"v":1,"id":"s1"}',
  '// --- fea-study end ---',
  '',
].join('\n');

const CUBE = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

function extrude(buffer, extra = {}) {
  return composeContourExtrude(buffer, {
    face: FACE,
    tool: 'circle',
    params: { radius: 8, segments: 16 },
    extrude: { distance: 12, direction: 'normal', sense: 'positive' },
    ...extra,
  });
}

/** Sheet flange whose `return part` is followed by a study, as Sheet Metallica is. */
function sheetWithStudy() {
  const composed = composeSheetMetalCommit('', SPEC);
  assert.equal(composed.ok, true, composed.message);
  const src = composed.buffer.replace(/\s*$/, '');
  assert.match(src, /return part;$/);
  return `${src}\n${STUDY}`;
}

function placement(buffer) {
  const ret = findReturnPartIndex(buffer);
  const contour = contourStatements(buffer).find((row) => row.id === 'c1');
  const sheet = parseFeatureMarkers(buffer).find((row) => row.kind === 'sheetMetal');
  const extrudeAt = buffer.indexOf('contour-mode extrude begin');
  const studyAt = buffer.indexOf('fea-study begin');
  return { ret, contour, sheet, extrudeAt, studyAt };
}

test('an extrude on a sheet part is unioned before return, outside the sheet span', () => {
  const script = sheetWithStudy();
  const wrote = extrude(script);
  assert.equal(wrote.ok, true, wrote.message || '');
  assert.equal(wrote.featureId, 'extrude1');
  const place = placement(wrote.buffer);
  assert.ok(place.contour, 'contour missing');
  assert.ok(place.sheet, 'sheet span missing');
  assert.ok(place.ret > place.extrudeAt, 'extrude is after return');
  assert.ok(place.contour.end <= place.ret, 'contour is after return');
  assert.ok(place.contour.start > place.sheet.endOffset, 'contour is inside the sheet span');
  assert.ok(place.extrudeAt > place.sheet.endOffset, 'extrude is inside the sheet span');
  assert.ok(place.studyAt > place.ret, 'study was moved before return');
  assert.equal((wrote.buffer.match(/return part;/g) || []).length, 1);
  assert.match(wrote.buffer, /part = part\.add\(placeInFrame\(c1\.plane, makeExtrude\(c1\.contours, 12\), \[0, 0, 0\]\)\)/);
  assert.match(wrote.buffer, /sheetMetalSolid\(sheetSpec\)/);
  assert.match(wrote.buffer, /SST316-125/);

  const again = extrude(wrote.buffer, {
    featureId: 'extrude1',
    extrude: { distance: 20, direction: 'normal', sense: 'positive' },
  });
  assert.equal(again.ok, true, again.message || '');
  assert.match(again.buffer, /makeExtrude\(c1\.contours, 20\)/);
  assert.equal((again.buffer.match(/return part;/g) || []).length, 1);
  assert.ok(again.buffer.indexOf('fea-study begin') > findReturnPartIndex(again.buffer));
});

test('an extrude on a regular part still unions before return', () => {
  const wrote = extrude(CUBE);
  assert.equal(wrote.ok, true, wrote.message || '');
  const ret = findReturnPartIndex(wrote.buffer);
  assert.ok(wrote.buffer.indexOf('makeExtrude') < ret);
  assert.match(wrote.buffer, /let part = Manifold\.cube\(\[40, 30, 20\], true\)/);
  assert.match(wrote.buffer, /part = part\.add\(placeInFrame/);
  const studied = extrude(`${CUBE}// --- fea-study begin ---\n// @fea-study {"v":1}\n// --- fea-study end ---\n`);
  assert.equal(studied.ok, true, studied.message || '');
  const studiedRet = findReturnPartIndex(studied.buffer);
  assert.ok(studied.buffer.indexOf('makeExtrude') < studiedRet);
  assert.ok(studied.buffer.indexOf('fea-study begin') > studiedRet);
});

test('a return inside a copied function is not the script return', () => {
  const script = [
    'const copy = externalBody(function () {',
    '  let part = Manifold.cube([4, 4, 4], true);',
    '  return part;',
    '});',
    'let part = copy;',
    'return part;',
    STUDY,
  ].join('\n');
  const wrote = extrude(script);
  assert.equal(wrote.ok, true, wrote.message || '');
  const inner = wrote.buffer.indexOf('return part;');
  const outer = findReturnPartIndex(wrote.buffer);
  const call = wrote.buffer.indexOf('makeExtrude');
  assert.ok(call > inner && call < outer);
  const fn = wrote.buffer.slice(wrote.buffer.indexOf('function'), wrote.buffer.indexOf('});'));
  assert.doesNotMatch(fn, /makeExtrude|@contour/);
  assert.ok(wrote.buffer.indexOf('fea-study begin') > outer);
});

test('sheet metal plus an extrude gains volume, and so does a regular part', { timeout: 60_000 }, async () => {
  const sheet = sheetWithStudy();
  const sheetOnly = await runScript(sheet);
  const sheetWrote = extrude(sheet);
  assert.equal(sheetWrote.ok, true, sheetWrote.message || '');
  const sheetBoth = await runScript(sheetWrote.buffer);
  assert.equal(sheetBoth.status, 'NoError');
  assert.ok(sheetBoth.volume > sheetOnly.volume + 100, `sheet ${sheetOnly.volume} -> ${sheetBoth.volume}`);
  assert.ok(sheetBoth.tris > sheetOnly.tris, `sheet tris ${sheetOnly.tris} -> ${sheetBoth.tris}`);

  const cubeOnly = await runScript(CUBE);
  const cubeWrote = extrude(CUBE);
  assert.equal(cubeWrote.ok, true, cubeWrote.message || '');
  const cubeBoth = await runScript(cubeWrote.buffer);
  assert.equal(cubeBoth.status, 'NoError');
  assert.ok(cubeBoth.volume > cubeOnly.volume + 100, `cube ${cubeOnly.volume} -> ${cubeBoth.volume}`);
  assert.ok(cubeBoth.tris > cubeOnly.tris, `cube tris ${cubeOnly.tris} -> ${cubeBoth.tris}`);
});
