import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignFeatureSlot,
  contoursForSlot,
  emptyFeatureSlotCard,
  featureSlotCommitPayload,
  featureSlotReady,
  setFeatureStationOffset,
} from './featureSlotCard.js';
import {
  composeContourExtrude,
  composeContourLoft,
  composeContourProfile,
  composeContourRevolve,
  composeContourSweep,
  composePathContour,
  REVOLVE_SEGMENTS,
} from './contourMode.js';
import { listSavedContours } from './savedContours.js';

const FACE = {
  type: 'planar',
  planeFrame: {
    center: [0, 0, 10],
    normal: [0, 0, 1],
    x: [1, 0, 0],
    y: [0, 1, 0],
  },
};
const SIDE = {
  type: 'planar',
  planeFrame: {
    center: [25, 0, 25],
    normal: [1, 0, 0],
    x: [0, 0, -1],
    y: [0, 1, 0],
  },
};
const STARTER = 'let part = Manifold.cube([40, 30, 20], true);\nreturn part;\n';

test('a slot fill keeps the other station and its offset', () => {
  const card = emptyFeatureSlotCard('makeLoft');
  const next = assignFeatureSlot(card, { role: 'station', index: 0 }, {
    id: 'c1',
    name: 'c1',
    label: 'c1 · circle r5',
  });
  assert.equal(next.stations[0].contourName, 'c1');
  assert.equal(next.stations[0].offset, 0);
  assert.equal(next.stations[1].contourName, null);
  assert.equal(next.stations[1].offset, 20);
  assert.equal(next.combine, 'add');
  assert.equal(featureSlotReady(next), false);
  const both = assignFeatureSlot(next, { role: 'station', index: 1 }, { id: 'c2', name: 'c2', label: 'c2' });
  assert.equal(featureSlotReady(both), true);
  assert.equal(both.stations[0].contourName, 'c1');
});

test('path contours are listed for the path slot only', () => {
  const profile = composeContourProfile('', { face: FACE, tool: 'circle', params: { radius: 4, segments: 16 } });
  const path = composePathContour(profile.buffer, { face: FACE, tool: 'circle', params: { radius: 3, segments: 12 } });
  assert.equal(path.ok, true, path.message);
  assert.match(path.buffer, /type: 'path'/);
  const saved = listSavedContours(path.buffer);
  assert.equal(saved.length, 2);
  assert.equal(contoursForSlot(saved, 'profile').length, 1);
  assert.equal(contoursForSlot(saved, 'path').length, 1);
  assert.equal(contoursForSlot(saved, 'path')[0].tool, 'path');
});

test('feature confirm keeps a named contour and writes the edited extrude', () => {
  const profile = composeContourProfile(STARTER, {
    face: FACE,
    tool: 'rectangle',
    params: { width: 12, height: 8, centered: true },
  });
  const fresh = emptyFeatureSlotCard('makeExtrude');
  assert.equal(fresh.extrude.distance, 10);
  assert.equal(fresh.extrude.sense, 'positive');
  let card = assignFeatureSlot(fresh, { role: 'profile', index: 0 }, {
    id: profile.contourId,
    name: profile.contourName,
    label: profile.contourName,
    plane: FACE.planeFrame,
  });
  assert.equal(card.extrude.distance, 10);
  card = {
    ...card,
    extrude: { ...card.extrude, distance: 25, sense: 'negative' },
  };
  const wrote = composeContourExtrude(profile.buffer, featureSlotCommitPayload(card));
  assert.equal(wrote.ok, true, wrote.message);
  assert.match(wrote.buffer, /profileRectangle\(12, 8, true\)/);
  assert.doesNotMatch(wrote.buffer, /profileCircle/);
  assert.match(wrote.buffer, /makeExtrude\(c1\.contours, 25\)/);
  assert.match(wrote.buffer, /\[0, 0, -25\]/);
  assert.match(wrote.buffer, /id=extrude1/);
});

test('two named loft stations may share offset 0', () => {
  const a = composeContourProfile(STARTER, { face: FACE, tool: 'circle', params: { radius: 5, segments: 16 } });
  const b = composeContourProfile(a.buffer, { face: SIDE, tool: 'circle', params: { radius: 4, segments: 16 } });
  let card = emptyFeatureSlotCard('makeLoft');
  card = assignFeatureSlot(card, { role: 'station', index: 0 }, { id: 'c1', name: 'c1', label: 'c1' });
  card = assignFeatureSlot(card, { role: 'station', index: 1 }, { id: 'c2', name: 'c2', label: 'c2' });
  card = setFeatureStationOffset(card, 1, 0);
  const wrote = composeContourLoft(b.buffer, featureSlotCommitPayload(card));
  assert.equal(wrote.ok, true, wrote.message);
  assert.match(wrote.buffer, /makeLoft\(\[c1,/);
  assert.doesNotMatch(wrote.buffer, /offsetPlaneFrame\(c2/);
});

test('a sweep confirm names an existing path and does not need edges', () => {
  const profile = composeContourProfile(STARTER, { face: FACE, tool: 'circle', params: { radius: 3, segments: 16 } });
  const path = composePathContour(profile.buffer, { face: FACE, tool: 'circle', params: { radius: 8, segments: 16 } });
  const before = path.buffer;
  let card = assignFeatureSlot(
    assignFeatureSlot(emptyFeatureSlotCard('makeSweep'), { role: 'profile', index: 0 }, { id: 'c1', name: 'c1', label: 'c1' }),
    { role: 'path', index: 0 },
    { id: path.contourName, name: path.contourName, label: path.contourName, params: { closed: true } },
  );
  assert.equal(card.sweep.closed, true);
  card = { ...card, sweep: { reverse: true, closed: false } };
  const wrote = composeContourSweep(path.buffer, featureSlotCommitPayload(card));
  assert.equal(wrote.ok, true, wrote.message);
  assert.match(wrote.buffer, /sweepPoints\(new CrossSection\(c1\.contours\)/);
  assert.match(wrote.buffer, /slice\(\)\.reverse\(\)/);
  assert.match(wrote.buffer, /closed: false/);
  assert.match(wrote.buffer, /type: 'path', closed: true/);
  assert.equal((wrote.buffer.match(/type: 'path'/g) || []).length, 1);
  assert.equal(before.includes("type: 'path'"), true);
});

test('revolve confirm writes the card angle, segments, and sense', () => {
  const profile = composeContourProfile(STARTER, {
    face: FACE,
    tool: 'circle',
    params: { radius: 8, segments: 16 },
  });
  const fresh = emptyFeatureSlotCard('makeRevolve');
  assert.equal(fresh.revolve.segments, REVOLVE_SEGMENTS);
  assert.equal(fresh.revolve.angle, 360);
  const card = {
    ...assignFeatureSlot(fresh, { role: 'profile', index: 0 }, {
      id: profile.contourId,
      name: profile.contourName,
      label: profile.contourName,
      plane: FACE.planeFrame,
    }),
    revolve: { angle: 180, axis: 'v', sense: 'negative', segments: 24 },
  };
  const wrote = composeContourRevolve(profile.buffer, featureSlotCommitPayload(card));
  assert.equal(wrote.ok, true, wrote.message);
  assert.match(wrote.buffer, /, 24, 180\)/);
  assert.match(wrote.buffer, /rotate\(\[0, 0, -180\]\)/);
  assert.match(wrote.buffer, /profileCircle\(8, 16\)/);
});
