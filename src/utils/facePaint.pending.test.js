import assert from 'node:assert/strict';
import test from 'node:test';
import { commitPaintColors, livePaintTap, pendingPaintCount } from './facePaint.js';
import { mintSurfId } from './git/surfId.js';

/** Pi 5 C5: paint_state.pendingCount is 1 after one paint, not the saved paints too. */

const SURF = mintSurfId();
const faceA = { at: [0, 0, 10], n: [0, 0, 1], area: 1200 };
const faceB = { at: [20, 0, 0], n: [1, 0, 0], area: 600 };

test('a session seeded from one saved paint reports 0, then 1 after a single tap', () => {
  const saved = commitPaintColors(null, SURF, { color: '#3b82f6', keys: [faceA] });
  assert.equal(pendingPaintCount(saved, saved), 0, 'nothing pending as the popup opens');
  const tapped = livePaintTap({ session: saved, undo: [], lastTap: null }, {
    surfId: SURF, color: '#ef4444', key: faceB, now: 1000,
  });
  assert.equal(tapped.changed, true);
  assert.equal(pendingPaintCount(tapped.session, saved), 1, 'one new face');
  assert.equal(Object.values(tapped.session)[0].faces.length, 2, 'the map holds both faces');
});

test('recoloring a saved face counts once; the same color again counts nothing', () => {
  const saved = commitPaintColors(null, SURF, { color: '#3b82f6', keys: [faceA] });
  const recolor = commitPaintColors(saved, SURF, { color: '#22c55e', keys: [faceA] });
  assert.equal(pendingPaintCount(recolor, saved), 1);
  const same = commitPaintColors(saved, SURF, { color: '#3b82f6', keys: [faceA] });
  assert.equal(pendingPaintCount(same, saved), 0);
});

test('a part color counts once, and an empty session counts nothing', () => {
  const part = commitPaintColors(null, SURF, { color: '#f59e0b', part: true });
  assert.equal(pendingPaintCount(part, null), 1);
  assert.equal(pendingPaintCount(part, part), 0);
  assert.equal(pendingPaintCount(null, null), 0);
});
