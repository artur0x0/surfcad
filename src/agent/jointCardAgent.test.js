import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEffectiveJointCard } from './jointCardAgent.js';

test('buildEffectiveJointCard merges live picks before commit', () => {
  const doc = { joints: [] };
  const card = {
    mode: 'create',
    type: 'coincident',
    userPickedType: true,
    userNamed: false,
    picks: [],
  };
  const picks = [
    { partId: 'a', surfId: 's1', kind: 'face', planar: true, axis: false, key: { at: [0, 0, 1], n: [0, 0, 1], area: 10 } },
    { partId: 'b', surfId: 's2', kind: 'face', planar: true, axis: false, key: { at: [0, 0, 0], n: [0, 0, -1], area: 10 } },
  ];
  const settled = buildEffectiveJointCard(card, picks, doc);
  assert.equal(settled.picks.length, 2);
  assert.equal(settled.type, 'coincident');
});
