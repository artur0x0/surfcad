import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeContourExtrude,
  composeContourRevolve,
  composeContourSweep,
  contourExtrudeOwnedRegion,
  contourRevolveOwnedRegion,
  contourSweepOwnedRegion,
  stripContourExtrudeBlock,
} from './contourMode.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { composeHelperInsert } from './helperPaletteSnippets.js';
import { parseExtrudeReference, parseSweepReferences } from './solidReference.js';

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
const EDGE = [{ a: 0, b: 1, va: [0, 0, 0], vb: [0, 0, 20], length: 20, key: 'e0' }];

function extrude(buffer, extra = {}) {
  return composeContourExtrude(buffer, {
    face: FACE,
    tool: 'circle',
    params: { radius: 5, segments: 32 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
    ...extra,
  });
}

test('an extrude names a contour and the block id is not an offset', () => {
  const first = extrude(STARTER);
  assert.equal(first.ok, true);
  assert.equal(first.featureId, 'extrude1');
  assert.match(first.buffer, /const c1 = makeCrossSection\(/);
  assert.match(first.buffer, /\/\/ @contour id=c1/);
  assert.match(first.buffer, /makeExtrude\(c1\.contours, 10\)/);
  assert.match(first.buffer, /placeInFrame\(c1\.plane, makeExtrude\(c1\.contours, 10\), \[0, 0, 0\]\)/);
  const owned = contourExtrudeOwnedRegion(first.buffer, 'extrude1');
  assert.match(owned, /makeExtrude\(/);
  assert.doesNotMatch(owned, /makeCrossSection/);
  assert.deepEqual(parseExtrudeReference(owned), { name: 'c1', distance: 10, w: 0 });
  const shifted = parseFeatureMarkers(`// moved\n${first.buffer}`).find((f) => f.kind === 'extrude');
  assert.equal(shifted.id, 'extrude1');
});

test('the same extrude id rewrites; a confirm with no id appends', () => {
  const first = extrude(STARTER);
  const rewritten = extrude(first.buffer, {
    featureId: first.featureId,
    tool: 'rectangle',
    params: { width: 16, height: 8, centered: true },
    extrude: { distance: 6, direction: 'normal', sense: 'negative' },
  });
  assert.equal(rewritten.ok, true);
  assert.equal(rewritten.featureId, 'extrude1');
  assert.match(rewritten.buffer, /profileRectangle\(16, 8, true\)/);
  assert.doesNotMatch(rewritten.buffer, /profileCircle/);
  assert.match(rewritten.buffer, /\[0, 0, -6\]/);
  assert.equal((rewritten.buffer.match(/contour-mode extrude begin/g) || []).length, 1);

  const appended = extrude(first.buffer);
  assert.equal(appended.featureId, 'extrude2');
  assert.match(appended.buffer, /id=extrude1/);
  assert.match(appended.buffer, /id=extrude2/);
  assert.equal((appended.buffer.match(/makeExtrude\(/g) || []).length, 2);
  assert.equal(stripContourExtrudeBlock(appended.buffer), appended.buffer);
});

test('two features can share one contour', () => {
  const first = extrude(STARTER);
  const shared = composeContourRevolve(first.buffer, {
    face: FACE,
    tool: 'circle',
    params: { radius: 3, segments: 16 },
    revolve: { angle: 180, axis: 'v', sense: 'positive' },
    contourName: 'c1',
  });
  assert.equal(shared.ok, true);
  assert.equal(shared.featureId, 'revolve1');
  assert.equal((shared.buffer.match(/const c1 =/g) || []).length, 1);
  assert.match(shared.buffer, /id=extrude1/);
  assert.match(contourRevolveOwnedRegion(shared.buffer, 'revolve1'), /makeRevolve\(c1\.contours\.map/);
  assert.match(shared.buffer, /\[u, v\]/);
});

test('a sweep names a profile and a path contour', () => {
  const first = composeContourSweep('', {
    face: null,
    tool: 'circle',
    params: { radius: 2, segments: 16 },
    edges: EDGE,
    sweep: { reverse: false },
  });
  assert.equal(first.ok, true);
  assert.equal(first.featureId, 'sweep1');
  assert.match(first.buffer, /@contour id=c1/);
  assert.match(first.buffer, /@contour id=c2/);
  assert.match(first.buffer, /type: 'path'/);
  const owned = contourSweepOwnedRegion(first.buffer, 'sweep1');
  assert.match(owned, /sweepPoints\(new CrossSection\(c1\.contours\)/);
  assert.match(owned, /c2\.profile\.closed/);
  assert.doesNotMatch(owned, /makeCrossSection|makeSweepPath/);
  assert.deepEqual(parseSweepReferences(owned), { profile: 'c1', path: 'c2' });

  const again = composeContourSweep(first.buffer, {
    face: null,
    tool: 'circle',
    params: { radius: 4, segments: 16 },
    edges: EDGE,
    sweep: { reverse: true },
  });
  assert.equal(again.featureId, 'sweep2');
  assert.match(again.buffer, /center: \[0, 0, 20\]/);
  assert.match(again.buffer, /id=sweep1/);

  const rewritten = composeContourSweep(first.buffer, {
    face: null,
    tool: 'circle',
    params: { radius: 4, segments: 16 },
    edges: EDGE,
    featureId: 'sweep1',
  });
  assert.equal(rewritten.featureId, 'sweep1');
  assert.equal((rewritten.buffer.match(/contour-mode sweep begin/g) || []).length, 1);
  assert.match(rewritten.buffer, /profileCircle\(4, 16\)/);
});

test('an old unmarked extrude keeps its chip id, and a later insert lands after the block', () => {
  const old = [
    '// --- contour-mode extrude begin ---',
    'const xs = makeCrossSection({ center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, profileCircle(5, 32));',
    'let part = placeInFrame(xs.plane, makeExtrude(xs.contours, 10), [0, 0, 0]);',
    '// --- contour-mode extrude end ---',
    '',
  ].join('\n');
  const chip = parseFeatureMarkers(old).find((f) => f.kind === 'extrude');
  assert.equal(chip.id, 'extrude-0');

  const script = composeHelperInsert('', 'makeExtrude');
  assert.match(script, /id=extrude1/);
  assert.match(script, /makeExtrude\(c1\.contours/);
  const next = composeHelperInsert(script, 'moveFace');
  const end = next.indexOf('contour-mode extrude end id=extrude1');
  const move = next.indexOf('moveFace(');
  assert.ok(end >= 0 && move > end, next);
});

test('a dangling extrude marker is refused', () => {
  const bad = composeContourExtrude('// --- contour-mode extrude begin ---\nreturn part;\n', {
    face: FACE,
    tool: 'circle',
    params: { radius: 5, segments: 16 },
    extrude: { distance: 10, direction: 'normal', sense: 'positive' },
  });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /unbalanced/);
});
