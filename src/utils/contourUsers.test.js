import assert from 'node:assert/strict';
import test from 'node:test';
import { contourFromRectangle } from './contourSolve.js';
import { writeContourProfileBlock } from './contourProfileWrite.js';
import {
  composeContourExtrude,
  composeContourLoft,
  composeContourProfile,
} from './contourMode.js';
import { listSavedContours } from './savedContours.js';
import {
  assignFeatureSlot,
  emptyFeatureSlotCard,
  renameFeatureSlotRefs,
  setFeatureStationOffset,
} from './featureSlotCard.js';
import {
  contourFeatureUsers,
  contourUsedByText,
  featuresWithContours,
  mentionsIdentifier,
  saveEditedContour,
} from './contourUsers.js';

const FACE = {
  type: 'planar',
  center: [0, 0, 0],
  normal: [0, 0, 1],
  planeFrame: {
    center: [0, 0, 0],
    normal: [0, 0, 1],
    x: [1, 0, 0],
    y: [0, 1, 0],
  },
};

function sharedScript() {
  const c1 = composeContourProfile('', {
    face: FACE,
    tool: 'circle',
    params: { radius: 6, segments: 24 },
  });
  assert.equal(c1.ok, true, c1.message);
  const ext = composeContourExtrude(c1.buffer, {
    face: FACE,
    tool: 'circle',
    params: { radius: 6, segments: 24 },
    contourId: 'c1',
    contourName: 'c1',
    extrude: { distance: 8, direction: 'normal', sense: 'positive' },
  });
  assert.equal(ext.ok, true, ext.message);
  const c2 = composeContourProfile(ext.buffer, {
    face: FACE,
    tool: 'circle',
    params: { radius: 3, segments: 16 },
  });
  assert.equal(c2.ok, true, c2.message);
  const loft = composeContourLoft(c2.buffer, {
    loft: {
      profiles: [
        { contourId: 'c1', contourName: 'c1', offset: 0, tool: 'circle', params: { radius: 6, segments: 24 } },
        { contourId: 'c2', contourName: 'c2', offset: 20, tool: 'circle', params: { radius: 3, segments: 16 } },
      ],
    },
  });
  assert.equal(loft.ok, true, loft.message);
  return loft.buffer;
}

function blockRegion(buffer, kind) {
  const begin = buffer.indexOf(`contour-mode ${kind} begin`);
  const end = buffer.indexOf(`contour-mode ${kind} end`);
  return buffer.slice(begin, end);
}

test('the banner names feature blocks in script order', () => {
  const buffer = sharedScript();
  assert.equal(contourUsedByText(buffer, 'c1'), 'Used by Extrude 1, Loft 1');
  assert.equal(contourUsedByText(buffer, 'c2'), 'Used by Loft 1');
  assert.equal(contourUsedByText(buffer, 'c3'), 'Unused');
  assert.equal(mentionsIdentifier('makeExtrude(c10.contours, 8)', 'c1'), false);
  assert.equal(mentionsIdentifier('makeExtrude(obj.c1.contours, 8)', 'c1'), false);
  assert.equal(mentionsIdentifier('const label = "c1";', 'c1'), false);
  const dotted = buffer.replace(
    'placeInFrame(c1.plane, makeExtrude(c1.contours',
    'placeInFrame(obj.plane, makeExtrude(obj.c1.contours',
  );
  assert.equal(contourUsedByText(dotted, 'c1'), 'Used by Loft 1');
  const positional = buffer.replace(/ id=extrude1/g, '');
  const users = contourFeatureUsers(positional, 'c1');
  assert.equal(users[0].label, 'Extrude');
  assert.equal(users[1].label, 'Loft 1');
});

test('saving rewrites the contour by id and leaves the feature blocks', () => {
  const before = sharedScript();
  const saved = saveEditedContour(before, {
    id: 'c1',
    name: 'c1',
    tool: 'circle',
    params: { radius: 18, segments: 24 },
    face: FACE,
  });
  assert.equal(saved.ok, true, saved.message);
  assert.match(saved.buffer, /profileCircle\(18, 24\)/);
  assert.match(saved.buffer, /const c1 = makeCrossSection\(/);
  assert.match(saved.buffer, /@contour id=c1/);
  assert.match(saved.buffer, /makeExtrude\(c1\.contours, 8\)/);
  assert.match(saved.buffer, /makeLoft\(\[c1,/);
  assert.equal(blockRegion(saved.buffer, 'extrude'), blockRegion(before, 'extrude'));
  assert.equal(blockRegion(saved.buffer, 'loft'), blockRegion(before, 'loft'));
  assert.match(saved.buffer, /profileCircle\(3, 16\)/);
});

test('renaming in the editor updates every reference and keeps the id', () => {
  const before = sharedScript();
  const saved = saveEditedContour(before, {
    id: 'c1',
    name: 'custom',
    tool: 'circle',
    params: { radius: 6, segments: 24 },
    face: FACE,
  });
  assert.equal(saved.ok, true, saved.message);
  assert.equal(saved.name, 'custom');
  assert.match(saved.buffer, /const custom = makeCrossSection\(/);
  assert.match(saved.buffer, /@contour id=c1/);
  assert.match(saved.buffer, /makeExtrude\(custom\.contours, 8\)/);
  assert.match(saved.buffer, /makeLoft\(\[custom, \{ \.\.\.c2/);
  assert.doesNotMatch(saved.buffer, /const c1 =/);
  assert.doesNotMatch(saved.buffer, /makeExtrude\(c1/);
  assert.equal(saveEditedContour(before, {
    id: 'c1',
    name: 'part',
    tool: 'circle',
    params: { radius: 6, segments: 24 },
    face: FACE,
  }).ok, false);
  assert.match(before, /const c1 =/);
});

test('reopen keeps dimensions and constraints', () => {
  const before = sharedScript();
  const spec = contourFromRectangle(12, 8, true);
  const wrote = writeContourProfileBlock(before, {
    face: FACE,
    tool: 'polyline',
    params: { contour: spec },
    contourId: 'c1',
    contourName: 'c1',
  });
  assert.equal(wrote.ok, true, wrote.message);
  const listed = listSavedContours(wrote.buffer).find((row) => row.id === 'c1');
  assert.equal(listed.tool, 'polyline');
  assert.equal(listed.params.contour.dimensions.length, spec.dimensions.length);
  assert.equal(listed.params.contour.constraints.length, spec.constraints.length);
  assert.equal(listed.params.contour.dimensions[0].value, 12);
  const again = saveEditedContour(wrote.buffer, {
    id: 'c1',
    name: 'c1',
    tool: 'polyline',
    params: listed.params,
    face: FACE,
  });
  assert.equal(again.ok, true, again.message);
  const reopened = listSavedContours(again.buffer).find((row) => row.id === 'c1');
  assert.equal(reopened.params.contour.dimensions.length, spec.dimensions.length);
  assert.equal(reopened.params.contour.constraints[0].kind, 'horizontal');
  assert.equal(blockRegion(again.buffer, 'extrude'), blockRegion(wrote.buffer, 'extrude'));
});

test('the strip lists the contour chip without a type badge', () => {
  const chips = featuresWithContours(sharedScript());
  const contour = chips.find((chip) => chip.contourId === 'c1');
  assert.equal(contour.kind, 'contour');
  assert.equal(contour.chipLabel, 'c1');
  assert.equal(contour.id, 'contour:c1');
  assert.equal(contour.typeIndex, null);
  const extrudeAt = chips.findIndex((chip) => chip.kind === 'extrude');
  const contourAt = chips.findIndex((chip) => chip.contourId === 'c1');
  assert.ok(contourAt >= 0 && contourAt < extrudeAt);
});

test('a rename refreshes every slot that stored the contour id', () => {
  let card = emptyFeatureSlotCard('makeLoft');
  card = assignFeatureSlot(card, { role: 'station', index: 0 }, {
    id: 'c1', name: 'c1', label: 'c1 · circle r6',
  });
  card = assignFeatureSlot(card, { role: 'station', index: 1 }, {
    id: 'c2', name: 'c2', label: 'c2',
  });
  card = setFeatureStationOffset(card, 0, 4);
  const next = renameFeatureSlotRefs(card, 'c1', {
    id: 'c1', name: 'custom', label: 'custom · circle r18',
  });
  assert.equal(next.stations[0].contourName, 'custom');
  assert.equal(next.stations[0].contourId, 'c1');
  assert.equal(next.stations[0].label, 'custom · circle r18');
  assert.equal(next.stations[0].offset, 4);
  assert.equal(next.stations[1].contourName, 'c2');
  assert.equal(next.stations[1].offset, 20);
});
