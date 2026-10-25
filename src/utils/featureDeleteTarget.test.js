import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStripTarget } from '../agent/featureStripAgent.js';
import { liveSheetFeature } from './featureSheetWriteback.js';
import { composeHelperInsert } from './helperPaletteSnippets.js';
import { featureDeleteTarget, featureWriteTarget } from './pickRetarget.js';

/**
 * delete_feature { index: 0 } on the active Rear Wheel returned
 * confirm_required for "Cylinder 1" (cylinder-0). focusWritePart(null)
 * followed the face pick onto the Frame, then index 0 was that part's
 * first feature. The delete target is the active part, or part_id.
 */

function twoParts() {
  let frame = composeHelperInsert('', 'cylinder', null, { height: 80, radius: 15 });
  frame = composeHelperInsert(frame, 'cylinder', null, { height: 20, radius: 4 });
  let wheel = composeHelperInsert('', 'tube', null, {
    section: 'round', outerRadius: 20, innerRadius: 16, height: 10,
  });
  wheel = composeHelperInsert(wheel, 'cube', null, {
    width: 8, depth: 8, height: 8, center: true, combine: 'add',
  });
  const doc = {
    activeId: 'wheel',
    parts: [
      { id: 'frame', name: 'Frame' },
      { id: 'wheel', name: 'Rear Wheel' },
    ],
  };
  return { frame, wheel, doc };
}

test('delete_feature index 0 stays on the active part when another part is picked', () => {
  const { frame, wheel, doc } = twoParts();
  const picked = featureWriteTarget(doc, { pickedId: 'frame' });
  assert.equal(picked.id, 'frame', 'a face pick still retargets a feature write');

  const target = featureDeleteTarget(doc, { index: 0 });
  assert.equal(target.error, undefined);
  assert.equal(target.id, 'wheel');
  assert.equal(target.load, false);

  const frameHit = resolveStripTarget(frame, { index: 0 });
  const wheelHit = resolveStripTarget(wheel, { index: 0 });
  assert.equal(frameHit.feature.id, 'cylinder-0');
  assert.equal(wheelHit.feature.id, 'tube-0');
  const frameLive = liveSheetFeature(frame, frameHit.feature);
  const wheelLive = liveSheetFeature(wheel, wheelHit.feature);
  assert.equal(frameLive.chipLabel, 'Cylinder 1');
  assert.equal(wheelLive.chipLabel, 'Tube');
  assert.doesNotMatch(
    `${wheelLive.chipLabel} declares part`,
    /Cylinder/,
    'the active part\'s feature 0 is the tube, not the picked part\'s cylinder',
  );
});

test('delete_feature part_id selects that row and rejects an unknown id', () => {
  const { doc } = twoParts();
  const asked = featureDeleteTarget(doc, { index: 0, part_id: 'frame' });
  assert.equal(asked.id, 'frame');
  assert.equal(asked.load, true);
  const same = featureDeleteTarget(doc, { part_id: 'wheel' });
  assert.equal(same.id, 'wheel');
  assert.equal(same.load, false);
  const missing = featureDeleteTarget(doc, { part_id: 'Frame' });
  assert.equal(missing.error.code, 'unknown_part');
  const omitted = featureDeleteTarget(doc, { index: 0, part_id: '' });
  assert.equal(omitted.id, 'wheel');
});
