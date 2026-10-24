import assert from 'node:assert/strict';
import test from 'node:test';
import { markerWithId } from './featureBlockId.js';
import {
  createFeatureTracker,
  failedFeatureIds,
  failedFeatureTitles,
  featureSkipFailure,
  instrumentFeatureBlocks,
  unionSkipIds,
} from './featureFailure.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import {
  CONTOUR_EXTRUDE_BEGIN,
  CONTOUR_EXTRUDE_END,
  CUBE_BEGIN,
  CUBE_END,
  FILLET_MODE_BEGIN,
  FILLET_MODE_END,
  SHELL_BEGIN,
  SHELL_END,
} from './helperPaletteSnippets.js';

function region(begin, end, id, body) {
  return `${markerWithId(begin, id)}\n${body}\n${markerWithId(end, id)}`;
}

function midChain() {
  return [
    region(CUBE_BEGIN, CUBE_END, 'cube1', 'let part = Manifold.cube([20, 20, 20], true);'),
    region(
      FILLET_MODE_BEGIN,
      FILLET_MODE_END,
      'fillet1',
      'const selEdges = edgesBetween(part, 0, 6);\npart = filletAlongPath(part, selEdges, 2);',
    ),
    region(
      FILLET_MODE_BEGIN,
      FILLET_MODE_END,
      'fillet2',
      'const selEdges2 = edgesBetween(part, 90, 91);\nconst badContour = { plane: {}, contours: [] };\npart = filletAlongPath(part, selEdges2, 2);',
    ),
    region(SHELL_BEGIN, SHELL_END, 'shell1', "part = hollow(part, 2, 'z');"),
    region(
      CONTOUR_EXTRUDE_BEGIN,
      CONTOUR_EXTRUDE_END,
      'extrude1',
      'part = part.add(placeInFrame(badContour.plane, makeExtrude(badContour.contours, 10), [0, 0, 0]));',
    ),
    'return part;',
    '',
  ].join('\n');
}

test('a mid-chain failure marks the throw and titles the dependent', () => {
  const script = midChain();
  const features = parseFeatureMarkers(script);
  const fillet = features.find((feature) => feature.id === 'fillet2');
  const block = script.slice(fillet.startOffset, fillet.endOffset);
  const error = {
    featureId: 'fillet2',
    featureBlock: block,
    scriptLine: 8,
    message: 'Selected edges not found',
  };
  assert.deepEqual(unionSkipIds(script, [], 'fillet2'), ['fillet2', 'extrude1']);
  const report = featureSkipFailure(script, error, ['fillet2'], ['fillet2', 'extrude1']);
  assert.equal(report.featureId, 'fillet2');
  assert.equal(report.featureBlock, block);
  assert.equal(report.scriptLine, 8);
  assert.equal(report.message, 'Selected edges not found');
  assert.deepEqual(report.skipped.map((row) => row.id), ['extrude1']);
  assert.equal(report.skipped[0].threw, false);
  assert.equal(report.skipped[0].dependsOn, 'fillet2');

  const failure = { id: report.featureId, block: report.featureBlock, skipped: report.skipped };
  const ids = failedFeatureIds(script, failure);
  assert.equal(ids.has('fillet2'), true);
  assert.equal(ids.has('extrude1'), true);
  assert.equal(ids.has('shell1'), false);
  assert.equal(ids.has('cube1'), false);

  const titles = failedFeatureTitles(script, failure);
  assert.equal(titles.fillet2, undefined);
  assert.equal(titles.extrude1.chip, 'Extrude — skipped, depends on Fillet 2');
  assert.equal(titles.extrude1.sheet, 'Skipped — depends on Fillet 2');
  assert.equal(titles.extrude1.dependsOn, 'fillet2');

  const edited = script.replace('badContour.contours', '[]');
  assert.equal(failedFeatureIds(edited, failure).has('extrude1'), false);
  assert.equal(failedFeatureIds(edited, failure).has('fillet2'), true);
  assert.equal(failedFeatureTitles(edited, failure).extrude1, undefined);
});

test('the feature tracker times each block and reports entries through the hook', () => {
  const entered = [];
  const left = [];
  const tracker = createFeatureTracker({ onEnter: (i) => entered.push(i), onLeave: (i, ms) => left.push([i, ms]) });
  tracker.enter(0);
  tracker.enter(1);
  assert.equal(tracker.current(), 1);
  tracker.leave(1);
  assert.equal(tracker.current(), 0);
  tracker.leave(0);
  assert.equal(tracker.current(), null);
  assert.deepEqual(entered, [0, 1]);
  assert.deepEqual(left.map(([i]) => i), [1, 0]);
  const timings = tracker.timings();
  assert.deepEqual(timings.map((row) => row.index), [1, 0]);
  assert.ok(timings.every((row) => Number.isFinite(row.ms) && row.ms >= 0));
  // A leave with no matching enter records nothing.
  tracker.leave(7);
  assert.equal(tracker.timings().length, 2);
});

test('instrumented blocks carry kind and label for progress and timings', () => {
  const script = [
    markerWithId(CUBE_BEGIN, 'cube1'),
    'let part = Manifold.cube([10, 10, 10], true);',
    CUBE_END,
    markerWithId(SHELL_BEGIN, 'shell1'),
    'part = hollow(part, 1);',
    SHELL_END,
    'return part;',
  ].join('\n');
  const { features } = instrumentFeatureBlocks(script);
  assert.deepEqual(features.map((f) => [f.id, f.kind]), [['cube1', 'cube'], ['shell1', 'shell']]);
  assert.ok(features.every((f) => typeof f.label === 'string' && f.label));
});
