import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeMirrorCommit,
  emptyMirrorState,
  mirrorPlaneFrame,
  mirrorPreviewMap,
  parseMirrorCall,
  validateMirrorAccept,
} from './mirrorMode.js';
import { MIRROR_BEGIN, MIRROR_END } from './helperPaletteSnippets.js';

const HOST = 'let part = Manifold.cube([10, 10, 10], true);\nreturn part;\n';

test('confirm without a body or a plane is refused', () => {
  const noBody = composeMirrorCommit(HOST, { ...emptyMirrorState(), planeSource: 'yz' });
  assert.equal(noBody.ok, false);
  assert.match(noBody.message, /Double-click a body/);
  const noPlane = composeMirrorCommit(HOST, { ...emptyMirrorState(), target: { at: [1, 2, 3] } });
  assert.equal(noPlane.ok, false);
  assert.match(noPlane.message, /Pick a plane/);
});

test('a named plane and a workplane each emit one mirror, and a second confirm replaces it', () => {
  const named = composeMirrorCommit(HOST, {
    ...emptyMirrorState(),
    target: { at: [20, 0, 0] },
    planeSource: 'yz',
  });
  assert.equal(named.ok, true);
  assert.match(named.buffer, /part = mirror\(part, 'yz', true, \{ bodies: \[\{ at: \[20, 0, 0\] \}\] \}\);/);
  assert.equal((named.buffer.match(/\bmirror\s*\(/g) || []).length, 1);
  assert.ok(named.buffer.includes(MIRROR_BEGIN) && named.buffer.includes(MIRROR_END));

  const frame = composeMirrorCommit(HOST, {
    ...emptyMirrorState(),
    target: { at: [20, 0, 0], minTri: 4 },
    planeSource: 'workplane',
    workplane: { id: 'wp1@1', name: 'wp1', center: [30, 0, 0], normal: [1, 0, 0] },
  });
  assert.equal(frame.ok, true);
  assert.match(frame.buffer, /mirror\(part, \{ center: \[30, 0, 0\], normal: \[1, 0, 0\] \}, true, \{ bodies: \[\{ at: \[20, 0, 0\], tri: 4 \}\] \}\)/);

  const again = composeMirrorCommit(frame.buffer, {
    ...emptyMirrorState(),
    target: { at: [20, 0, 0] },
    planeSource: 'xy',
  });
  assert.equal(again.ok, true);
  assert.equal((again.buffer.match(/\bmirror\s*\(/g) || []).length, 1);
  assert.match(again.buffer, /mirror\(part, 'xy', true/);
  assert.doesNotMatch(again.buffer, /center: \[30, 0, 0\]/);
});

test('the preview reflects a point across the picked plane', () => {
  const map = mirrorPreviewMap({
    ...emptyMirrorState(),
    target: { at: [0, 0, 0] },
    planeSource: 'workplane',
    workplane: { center: [30, 0, 0], normal: [1, 0, 0] },
  });
  assert.ok(map);
  const hit = map([20, 4, -2]);
  assert.ok(Math.abs(hit[0] - 40) < 1e-9 && Math.abs(hit[1] - 4) < 1e-9 && Math.abs(hit[2] + 2) < 1e-9);
  assert.equal(mirrorPreviewMap(emptyMirrorState()), null);
  assert.deepEqual(mirrorPlaneFrame({ planeSource: 'xz' }).normal, [0, 1, 0]);
});

test('parse reads the old string call and a workplane call', () => {
  const old = parseMirrorCall("part = mirror(part, 'yz', true);");
  assert.equal(old.plane, 'yz');
  assert.equal(old.keepOriginal, true);
  assert.equal(old.at, null);
  const next = parseMirrorCall("part = mirror(part, { center: [30, 0, 0], normal: [1, 0, 0] }, true, { bodies: [{ at: [20, 0, 0] }] });");
  assert.deepEqual(next.plane, { center: [30, 0, 0], normal: [1, 0, 0] });
  assert.deepEqual(next.at, [20, 0, 0]);
  assert.equal(validateMirrorAccept(emptyMirrorState()).ok, false);
});
