import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignFeatureSlot,
  buildFeatureSlotPreview,
  contoursForSlot,
  emptyFeatureSlotCard,
  featureSlotCardFromEdit,
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
  listContourExtrudeBlocks,
  listContourLoftBlocks,
  listContourRevolveBlocks,
  listContourSweepBlocks,
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

test('reopening a named extrude fills the slot and keeps the block id', () => {
  const profile = composeContourProfile(STARTER, {
    face: FACE,
    tool: 'rectangle',
    params: { width: 12, height: 8, centered: true },
  });
  const wrote = composeContourExtrude(profile.buffer, {
    ...featureSlotCommitPayload({
      ...assignFeatureSlot(emptyFeatureSlotCard('makeExtrude'), { role: 'profile', index: 0 }, {
        id: 'c1', name: 'c1', label: 'c1', plane: FACE.planeFrame,
      }),
      combine: 'subtract',
      extrude: { distance: 18, sense: 'both', direction: 'normal' },
    }),
  });
  assert.equal(wrote.ok, true, wrote.message);
  const block = listContourExtrudeBlocks(wrote.buffer)[0].text;
  const card = featureSlotCardFromEdit({
    entry: 'makeExtrude',
    block,
    feature: { id: 'extrude-0' },
  }, listSavedContours(wrote.buffer));
  assert.equal(card.featureId, 'extrude1');
  assert.equal(card.profile.contourName, 'c1');
  assert.equal(card.extrude.distance, 18);
  assert.equal(card.extrude.sense, 'both');
  assert.equal(card.combine, 'subtract');
  assert.equal(card.merge, true);
  const again = composeContourExtrude(wrote.buffer, featureSlotCommitPayload(card));
  assert.equal(again.ok, true, again.message);
  assert.equal((again.buffer.match(/makeExtrude\(/g) || []).length, 1);
  assert.match(again.buffer, /id=extrude1/);
});

test('an inline extrude with no contour name stays on Pick a contour', () => {
  const block = [
    '// --- contour-mode extrude begin id=extrude1 ---',
    'part = part.add(placeInFrame(plane, makeExtrude(profileCircle(4, 16).contours, 12), [0, 0, 0]));',
    '// --- contour-mode extrude end id=extrude1 ---',
  ].join('\n');
  const card = featureSlotCardFromEdit({
    entry: 'makeExtrude',
    kind: 'extrude',
    block,
    fields: { distance: 12, sense: 'positive' },
    feature: { id: 'extrude-0' },
  }, [{ id: 'c1', name: 'c1', label: 'c1 · circle' }]);
  assert.equal(card.profile, null);
  assert.equal(card.featureId, 'extrude1');
  assert.equal(card.extrude.distance, 12);
  const missing = featureSlotCardFromEdit({
    entry: 'makeExtrude',
    block: 'makeExtrude(c1.contours, 8)',
    feature: { id: 'extrude-0' },
  }, [{ id: 'c1', name: 'c1', label: 'c1 · 4 pts' }]);
  assert.equal(missing.featureId, null);
  assert.equal(missing.profile.contourName, 'c1');
  assert.equal(missing.profile.label, 'c1 · 4 pts');
});

test('reopening loft and sweep fills named slots when the profile parser cannot', () => {
  const a = composeContourProfile(STARTER, { face: FACE, tool: 'circle', params: { radius: 5, segments: 16 } });
  const b = composeContourProfile(a.buffer, { face: SIDE, tool: 'circle', params: { radius: 4, segments: 16 } });
  let loft = emptyFeatureSlotCard('makeLoft');
  loft = assignFeatureSlot(loft, { role: 'station', index: 0 }, { id: 'c1', name: 'c1', label: 'c1' });
  loft = assignFeatureSlot(loft, { role: 'station', index: 1 }, { id: 'c2', name: 'c2', label: 'c2' });
  loft = setFeatureStationOffset(loft, 1, 20);
  const wrote = composeContourLoft(b.buffer, featureSlotCommitPayload(loft));
  assert.equal(wrote.ok, true, wrote.message);
  const card = featureSlotCardFromEdit({
    entry: 'makeLoft',
    block: listContourLoftBlocks(wrote.buffer)[0].text,
  }, listSavedContours(wrote.buffer));
  assert.equal(card.stations.length, 2);
  assert.equal(card.stations[0].contourName, 'c1');
  assert.equal(card.stations[1].contourName, 'c2');
  assert.equal(card.stations[1].offset, 20);
  assert.equal(card.featureId, 'loft1');

  const profile = composeContourProfile(STARTER, { face: FACE, tool: 'circle', params: { radius: 3, segments: 16 } });
  const path = composePathContour(profile.buffer, { face: FACE, tool: 'circle', params: { radius: 8, segments: 16 } });
  const sweep = {
    ...assignFeatureSlot(
      assignFeatureSlot(emptyFeatureSlotCard('makeSweep'), { role: 'profile', index: 0 }, { id: 'c1', name: 'c1', label: 'c1' }),
      { role: 'path', index: 0 },
      { id: path.contourName, name: path.contourName, label: path.contourName, params: { closed: true } },
    ),
    sweep: { reverse: true, closed: false },
    merge: false,
  };
  const swept = composeContourSweep(path.buffer, featureSlotCommitPayload(sweep));
  assert.equal(swept.ok, true, swept.message);
  const again = featureSlotCardFromEdit({
    entry: 'makeSweep',
    block: listContourSweepBlocks(swept.buffer)[0].text,
  }, listSavedContours(swept.buffer));
  assert.equal(again.profile.contourName, 'c1');
  assert.equal(again.path.contourName, path.contourName);
  assert.equal(again.sweep.reverse, true);
  assert.equal(again.sweep.closed, false);
  assert.equal(again.merge, false);
  assert.equal(again.featureId, 'sweep1');
});

test('reopening a revolve keeps axis, segments, and sense', () => {
  const profile = composeContourProfile(STARTER, {
    face: FACE,
    tool: 'circle',
    params: { radius: 8, segments: 16 },
  });
  const wrote = composeContourRevolve(profile.buffer, featureSlotCommitPayload({
    ...assignFeatureSlot(emptyFeatureSlotCard('makeRevolve'), { role: 'profile', index: 0 }, {
      id: 'c1', name: 'c1', label: 'c1', plane: FACE.planeFrame,
    }),
    revolve: { angle: 180, axis: 'u', sense: 'negative', segments: 24 },
  }));
  assert.equal(wrote.ok, true, wrote.message);
  const card = featureSlotCardFromEdit({
    entry: 'makeRevolve',
    block: listContourRevolveBlocks(wrote.buffer)[0].text,
  }, listSavedContours(wrote.buffer));
  assert.equal(card.profile.contourName, 'c1');
  assert.equal(card.revolve.angle, 180);
  assert.equal(card.revolve.segments, 24);
  assert.equal(card.revolve.sense, 'negative');
  assert.equal(card.revolve.axis, 'u');
  assert.equal(card.featureId, 'revolve1');
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

test('slot preview uses the saved contour and the card values', () => {
  const profile = composeContourProfile(STARTER, {
    face: FACE,
    tool: 'rectangle',
    params: { width: 12, height: 8, centered: true },
  });
  const saved = listSavedContours(profile.buffer);
  assert.equal(buildFeatureSlotPreview(emptyFeatureSlotCard('makeExtrude'), saved), null);
  const card = {
    ...assignFeatureSlot(emptyFeatureSlotCard('makeExtrude'), { role: 'profile' }, saved[0]),
    extrude: { distance: 25, direction: 'normal', sense: 'positive' },
  };
  const preview = buildFeatureSlotPreview(card, saved);
  assert.equal(preview.kind, 'extrude');
  assert.equal(preview.payload.distance, 25);
  const loop = preview.payload.contours[0];
  const width = Math.max(...loop.map((p) => p[0])) - Math.min(...loop.map((p) => p[0]));
  assert.ok(Math.abs(width - 12) < 1e-6, String(width));

  const live = buildFeatureSlotPreview(emptyFeatureSlotCard('makeExtrude'), [], {
    slot: { role: 'profile' },
    tool: 'circle',
    params: { radius: 6, segments: 16 },
    face: FACE,
  });
  assert.equal(live.kind, 'extrude');
  assert.equal(live.payload.distance, 10);

  const revolve = buildFeatureSlotPreview({
    ...assignFeatureSlot(emptyFeatureSlotCard('makeRevolve'), { role: 'profile' }, saved[0]),
    revolve: { angle: 90, axis: 'v', sense: 'positive', segments: 16 },
  }, saved);
  assert.equal(revolve.kind, 'revolve');
  assert.equal(revolve.payload.angle, 90);
});

test('loft and sweep previews follow the filled slots', () => {
  const a = composeContourProfile(STARTER, {
    face: FACE,
    tool: 'circle',
    params: { radius: 5, segments: 16 },
  });
  const b = composeContourProfile(a.buffer, {
    face: FACE,
    tool: 'circle',
    params: { radius: 8, segments: 16 },
  });
  const saved = listSavedContours(b.buffer);
  let loft = emptyFeatureSlotCard('makeLoft');
  loft = assignFeatureSlot(loft, { role: 'station', index: 0 }, saved[0]);
  loft = assignFeatureSlot(loft, { role: 'station', index: 1 }, saved[1]);
  const loftPreview = buildFeatureSlotPreview(loft, saved);
  assert.equal(loftPreview.kind, 'loft');
  assert.ok(loftPreview.payload.stations.length >= 2);
  const z0 = loftPreview.payload.stations[0].plane.center[2];
  const z1 = loftPreview.payload.stations[1].plane.center[2];
  assert.ok(Math.abs((z1 - z0) - 20) < 1e-6, `${z0} ${z1}`);

  const path = composePathContour(b.buffer, {
    face: SIDE,
    tool: 'circle',
    params: { radius: 8, segments: 12 },
  });
  assert.equal(path.ok, true, path.message);
  const sweepSaved = listSavedContours(path.buffer);
  let sweep = emptyFeatureSlotCard('makeSweep');
  sweep = assignFeatureSlot(sweep, { role: 'profile' }, sweepSaved.find((row) => row.name === 'c1'));
  sweep = assignFeatureSlot(sweep, { role: 'path' }, sweepSaved.find((row) => row.tool === 'path'));
  const sweepPreview = buildFeatureSlotPreview(sweep, sweepSaved);
  assert.equal(sweepPreview?.kind, 'sweep');
  assert.ok(sweepPreview.payload.stations.length >= 2);
  assert.equal(sweepPreview.payload.closed, true);
});
