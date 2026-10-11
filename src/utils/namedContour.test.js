import assert from 'node:assert/strict';
import test from 'node:test';
import { contourFromRectangle } from './contourSolve.js';
import { composeContourExtrude, composeContourProfile } from './contourMode.js';
import { writeContourProfileBlock } from './contourProfileWrite.js';
import { listSavedContours } from './savedContours.js';
import { renameNamedContour } from './namedContour.js';

const FACE = {
  type: 'planar',
  center: [0, 0, 10],
  normal: [0, 0, 1],
  area: 1200,
  triangleCount: 2,
  selectionMode: 'coplanar',
  planeFrame: {
    center: [0, 0, 10],
    normal: [0, 0, 1],
    x: [1, 0, 0],
    y: [0, 1, 0],
  },
};

const STARTER = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

function circle(buffer, extra = {}) {
  return composeContourProfile(buffer, {
    face: FACE,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    ...extra,
  });
}

test('a contour is a named statement and the id is not an offset', () => {
  const first = circle(STARTER);
  assert.equal(first.ok, true);
  assert.match(first.buffer, /const c1 = makeCrossSection\(\{ center: \[0, 0, 10\], normal: \[0, 0, 1\]/);
  assert.match(first.buffer, /profileCircle\(5, 32\)/);
  assert.match(first.buffer, /\/\/ @contour id=c1/);
  assert.doesNotMatch(first.buffer, /const fr = /);
  const listed = listSavedContours(first.buffer);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, 'c1');
  assert.equal(listed[0].name, 'c1');
  assert.equal(listed[0].id.includes('@'), false);
  const shifted = listSavedContours(`// moved\n${first.buffer}`);
  assert.equal(shifted[0].id, 'c1');
  assert.equal(shifted[0].name, 'c1');
});

test('a second confirm appends and the same id rewrites', () => {
  const first = circle(STARTER);
  const second = composeContourProfile(first.buffer, {
    face: FACE,
    tool: 'rectangle',
    params: { width: 16, height: 8, centered: true },
  });
  assert.equal(second.ok, true);
  assert.equal(second.contourId, 'c2');
  assert.match(second.buffer, /@contour id=c1/);
  assert.match(second.buffer, /@contour id=c2/);
  const rewritten = circle(second.buffer, { contourId: 'c1', contourName: 'c1' });
  assert.equal(rewritten.ok, true);
  assert.match(rewritten.buffer, /const c1 = makeCrossSection\([\s\S]*profileCircle\(5, 32\)/);
  assert.match(rewritten.buffer, /const c2 = makeCrossSection\([\s\S]*profileRectangle\(16, 8, true\)/);
  assert.equal(listSavedContours(rewritten.buffer).map((c) => c.id).join(','), 'c1,c2');
  const moved = listSavedContours(`/* pad */\n${rewritten.buffer}`);
  assert.deepEqual(moved.map((c) => c.id), ['c1', 'c2']);
});

test('an old binding is listed by name and an unbound call is not', () => {
  const old = 'const xs = makeCrossSection({ center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, profileCircle(4, 16));\n';
  assert.equal(listSavedContours(old)[0].id, 'xs');
  assert.equal(listSavedContours(`// pad\n${old}`)[0].id, 'xs');
  const bare = 'makeCrossSection({ center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, profileCircle(1, 8));\n';
  assert.equal(listSavedContours(bare).length, 0);
});

test('rename updates references and leaves the id', () => {
  const first = circle(STARTER);
  const script = first.buffer.replace(
    'return part;',
    'const solid = makeLoft([c1, c10]);\nconst label = \'c1\';\nreturn part;',
  );
  const renamed = renameNamedContour(script, 'c1', 'c_base');
  assert.equal(renamed.ok, true, renamed.message || '');
  assert.match(renamed.buffer, /const c_base = makeCrossSection\(/);
  assert.match(renamed.buffer, /\/\/ @contour id=c1/);
  assert.match(renamed.buffer, /makeLoft\(\[c_base, c10\]\)/);
  assert.match(renamed.buffer, /const label = 'c1'/);
  assert.doesNotMatch(renamed.buffer, /const c1 =/);
  const listed = listSavedContours(renamed.buffer);
  assert.equal(listed[0].id, 'c1');
  assert.equal(listed[0].name, 'c_base');
  assert.equal(renameNamedContour(renamed.buffer, 'c1', 'part').ok, false);
  assert.equal(renameNamedContour(renamed.buffer, 'c1', 'c_base').ok, true);
  const again = renameNamedContour(renamed.buffer, 'c1', 'c_base');
  assert.equal(again.buffer, renamed.buffer);
});

test('dimension confirm writes the contour and leaves the extrude block', () => {
  const ext = composeContourExtrude(STARTER, {
    face: FACE,
    tool: 'rectangle',
    params: { width: 12, height: 8, centered: true },
    extrude: { distance: 12, direction: 'normal', sense: 'positive' },
  });
  assert.equal(ext.ok, true, ext.message || '');
  const spec = contourFromRectangle(40, 12, false);
  const wrote = writeContourProfileBlock(ext.buffer, {
    entry: 'makeExtrude',
    face: FACE,
    tool: 'polyline',
    params: { contour: spec },
    contourId: 'c1',
    contourName: 'c1',
  });
  assert.equal(wrote.ok, true, wrote.message || '');
  assert.equal(wrote.written, true);
  assert.equal(wrote.contourId, 'c1');
  assert.match(wrote.buffer, /const c1 = makeCrossSection\([\s\S]*solveContour\(/);
  assert.match(wrote.buffer, /@contour id=c1/);
  const begin = 'contour-mode extrude begin';
  const end = 'contour-mode extrude end';
  const region = (buf) => buf.slice(buf.indexOf(begin), buf.indexOf(end));
  assert.equal(region(wrote.buffer), region(ext.buffer));
  assert.match(wrote.buffer, /makeExtrude\([^)]*12\)/);
});
