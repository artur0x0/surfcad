import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeContourExtrude,
  composeContourLoft,
  contourLoftOwnedRegion,
  defaultLoftProfiles,
} from './contourMode.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { composeHelperInsert } from './helperPaletteSnippets.js';
import { parseLoftReferences } from './loftReference.js';

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

const SIDE = {
  center: [25, 0, 25],
  normal: [1, 0, 0],
  x: [0, 0, -1],
  y: [0, 1, 0],
};

const STARTER = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

function loft(buffer, extra = {}) {
  return composeContourLoft(buffer, {
    face: FACE,
    loft: { profiles: defaultLoftProfiles(), selected: 0 },
    ...extra,
  });
}

test('a loft names contours and the block id is not an offset', () => {
  const first = loft(STARTER);
  assert.equal(first.ok, true);
  assert.equal(first.featureId, 'loft1');
  assert.match(first.buffer, /const c1 = makeCrossSection\(/);
  assert.match(first.buffer, /const c2 = makeCrossSection\(/);
  assert.match(first.buffer, /\/\/ @contour id=c1/);
  assert.match(first.buffer, /\/\/ @contour id=c2/);
  assert.match(first.buffer, /makeLoft\(\[c1, \{ \.\.\.c2, plane: offsetPlaneFrame\(c2\.plane, 20\) \}\]\)/);
  assert.match(first.buffer, /placeInFrame\(c1\.plane, makeLoft\(/);
  assert.match(first.buffer, /contour-mode loft begin id=loft1/);
  const owned = contourLoftOwnedRegion(first.buffer, 'loft1');
  assert.match(owned, /makeLoft\(/);
  assert.doesNotMatch(owned, /makeCrossSection/);
  assert.deepEqual(parseLoftReferences(owned), [
    { name: 'c1', offset: 0 },
    { name: 'c2', offset: 20 },
  ]);
  const shifted = parseFeatureMarkers(`// moved\n${first.buffer}`).find((f) => f.kind === 'loft');
  assert.equal(shifted.id, 'loft1');
});

test('the same feature id rewrites; a confirm with no id appends', () => {
  const first = loft(STARTER);
  const rewritten = loft(first.buffer, {
    featureId: first.featureId,
    loft: {
      profiles: [
        { tool: 'rectangle', params: { width: 16, height: 10, centered: true }, offset: 0 },
        { tool: 'circle', params: { radius: 6, segments: 32 }, offset: 25 },
      ],
      selected: 0,
    },
  });
  assert.equal(rewritten.ok, true);
  assert.equal(rewritten.featureId, 'loft1');
  assert.match(rewritten.buffer, /profileRectangle\(16, 10, true\)/);
  assert.match(rewritten.buffer, /profileCircle\(6, 32\)/);
  assert.equal((rewritten.buffer.match(/contour-mode loft begin/g) || []).length, 1);
  assert.equal((rewritten.buffer.match(/const c1 =/g) || []).length, 1);

  const appended = loft(first.buffer);
  assert.equal(appended.featureId, 'loft2');
  assert.match(appended.buffer, /id=loft1/);
  assert.match(appended.buffer, /id=loft2/);
  assert.equal((appended.buffer.match(/makeLoft\(/g) || []).length, 2);
});

test('two lofts can share one contour, and an owned plane drops a leftover offset', () => {
  const first = loft(STARTER);
  const shared = composeContourLoft(first.buffer, {
    face: FACE,
    loft: {
      profiles: [
        { tool: 'circle', params: { radius: 5, segments: 64 }, offset: 0, contourName: 'c1' },
        { tool: 'circle', params: { radius: 3, segments: 16 }, offset: 40 },
      ],
    },
  });
  assert.equal(shared.ok, true);
  assert.equal(shared.featureId, 'loft2');
  assert.equal((shared.buffer.match(/const c1 =/g) || []).length, 1);
  const refs = parseLoftReferences(contourLoftOwnedRegion(shared.buffer, 'loft2'));
  assert.equal(refs[0].name, 'c1');
  assert.equal(refs[0].offset, 0);

  const elbow = composeContourLoft('', {
    face: FACE,
    loft: {
      profiles: [
        { tool: 'circle', params: { radius: 5, segments: 32 }, offset: 0 },
        {
          tool: 'circle',
          params: { radius: 5, segments: 32 },
          offset: 20,
          planeKind: 'workplane',
          plane: SIDE,
        },
      ],
    },
  });
  assert.equal(elbow.ok, true);
  assert.match(elbow.buffer, /normal: \[1, 0, 0\]/);
  assert.doesNotMatch(elbow.buffer, /offsetPlaneFrame/);
  assert.match(elbow.buffer, /placeInFrame\(c1\.plane, makeLoft\(\[c1, c2\]\)\)/);
});

test('an extrude confirm leaves the loft, and an old unmarked loft keeps its chip id', () => {
  const first = loft(STARTER);
  const extruded = composeContourExtrude(first.buffer, {
    face: FACE,
    tool: 'circle',
    params: { radius: 4, segments: 16 },
    extrude: { distance: 8, direction: 'normal', sense: 'positive' },
  });
  assert.equal(extruded.ok, true);
  assert.match(extruded.buffer, /id=loft1/);
  assert.match(extruded.buffer, /makeExtrude/);
  assert.match(extruded.buffer, /makeLoft/);

  const old = [
    '// --- contour-mode loft begin ---',
    'const xs0 = makeCrossSection({ center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, profileCircle(5, 64));',
    'let part = placeInFrame(xs0.plane, makeLoft([xs0, xs1]));',
    '// --- contour-mode loft end ---',
    '',
  ].join('\n');
  const chip = parseFeatureMarkers(old).find((f) => f.kind === 'loft');
  assert.equal(chip.id, 'loft-0');
});

test('a later palette insert lands after an id-marked loft block', () => {
  const script = composeHelperInsert('', 'makeLoft');
  assert.match(script, /id=loft1/);
  assert.match(script, /makeLoft\(\[c1, \{ \.\.\.c2, plane: offsetPlaneFrame\(c2\.plane, 20\) \}\]\)/);
  const next = composeHelperInsert(script, 'moveFace');
  const end = next.indexOf('contour-mode loft end id=loft1');
  const move = next.indexOf('moveFace(');
  assert.ok(end >= 0 && move > end, next);
});
