import assert from 'node:assert/strict';
import test from 'node:test';
import { commitPaintColors, livePaintChanged, livePaintPart } from './facePaint.js';

const SURF = '2026-10-18-07-19-33-0215-1e48';

const faces = [{
  id: 7,
  at: [0, -10, 0],
  n: [0, -1, 0],
  area: 486.4,
}];

const storedKey = { at: [0, -10, 0], n: [0, -1, 0], area: 480 };
const freshKey = { at: [0, -10, 0], n: [0, -1, 0], area: 486.4 };

test('the same color on a face that still matches keeps the saved key', () => {
  const colors = { [SURF]: { faces: [{ color: '#aa1122', key: storedKey }] } };
  const next = commitPaintColors(colors, SURF, {
    color: '#AA1122',
    keys: [freshKey],
    faces,
  });
  assert.equal(next, colors);
  assert.equal(livePaintChanged(next, colors), false);
});

test('a new color on a matching face replaces the saved key', () => {
  const colors = { [SURF]: { faces: [{ color: '#aa1122', key: storedKey }] } };
  const next = commitPaintColors(colors, SURF, {
    color: '#1a1a1a',
    keys: [freshKey],
    faces,
  });
  assert.equal(next[SURF].faces.length, 1);
  assert.equal(next[SURF].faces[0].color, '#1a1a1a');
  assert.equal(next[SURF].faces[0].key.area, 486.4);
  assert.equal(livePaintChanged(next, colors), true);
});

test('painting a face the saved key missed is a new write', () => {
  const colors = {
    [SURF]: { faces: [{ color: '#aa1122', key: { at: [0, -10, 8], n: [0, -1, 0], area: 480 } }] },
  };
  const next = commitPaintColors(colors, SURF, {
    color: '#aa1122',
    keys: [freshKey],
    faces,
  });
  assert.equal(livePaintChanged(next, colors), true);
  assert.equal(next[SURF].faces.length, 2);
});

test('painting the whole part with the color it already has does not change the session', () => {
  const session = { [SURF]: { part: '#1a1a1a' } };
  const next = livePaintPart({ session, undo: [] }, { surfId: SURF, color: '#1A1A1A' });
  assert.equal(next.changed, false);
  assert.equal(livePaintChanged(next.session, session), false);
});
