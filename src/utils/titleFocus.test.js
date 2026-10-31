import assert from 'node:assert/strict';
import test from 'node:test';
import { titleFocusPartId } from './titleFocus.js';

const doc = { activeId: 'seed', parts: [{ id: 'seed', name: 'Part' }] };

test('a selected part that is in the document is the focus', () => {
  assert.equal(titleFocusPartId({ ...doc, parts: [...doc.parts, { id: 'frame' }] }, 'frame'), 'frame');
});

test('a selected part from a previous document is ignored, the active part is focused instead', () => {
  // New assembly after the bike with the frame selected: the frame is not a
  // part of the new document, so the title chip must not re-frame it.
  assert.equal(titleFocusPartId(doc, 'frame'), 'seed');
});

test('no selection focuses the active part; an active id outside the document focuses nothing', () => {
  assert.equal(titleFocusPartId(doc, null), 'seed');
  assert.equal(titleFocusPartId({ activeId: 'gone', parts: doc.parts }, undefined), null);
  assert.equal(titleFocusPartId(null, 'frame'), null);
});
