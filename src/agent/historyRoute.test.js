import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assemblyStepLabel,
  historyStripTarget,
  summarizeAssemblyHistory,
  summarizePartHistory,
} from './historyRoute.js';
import { seedAssemblyHistory } from '../joints/jointUi.js';

test('historyStripTarget matches feature bar routing', () => {
  assert.equal(historyStripTarget({ sketchOpen: true, showJoints: true }), 'sketch');
  assert.equal(historyStripTarget({ sketchOpen: false, showJoints: true }), 'assembly');
  assert.equal(historyStripTarget({ sketchOpen: false, showJoints: false }), 'part');
});

test('summarizePartHistory exposes labels and availability', () => {
  const commits = [
    { code: 'a', message: 'Part' },
    { code: 'b', message: 'Extrude' },
    { code: 'c', message: 'Fillet' },
  ];
  const summary = summarizePartHistory(commits, 2, { partId: 'p1' });
  assert.equal(summary.kind, 'part');
  assert.equal(summary.partId, 'p1');
  assert.equal(summary.canUndo, true);
  assert.equal(summary.canRedo, false);
  assert.equal(summary.entries[2].label, 'Fillet');
  assert.equal(summary.entries[2].current, true);
});

test('assemblyStepLabel names new joints', () => {
  const before = { joints: [], placements: {} };
  const after = { joints: [{ id: 'j1', name: 'Mate1' }], placements: {} };
  assert.equal(assemblyStepLabel(after, before), 'Joint: Mate1');
});

test('summarizeAssemblyHistory marks head and redo', () => {
  const doc = {
    parts: [{ surfId: 's1', placement: { t: [0, 0, 0], q: [0, 0, 0, 1] } }],
    joints: [],
  };
  const history = seedAssemblyHistory(doc);
  const summary = summarizeAssemblyHistory(history);
  assert.equal(summary.canUndo, false);
  assert.equal(summary.entries[0].current, true);
});
