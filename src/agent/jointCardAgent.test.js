import assert from 'node:assert/strict';
import test from 'node:test';
import { applyJointCard, pushAssemblyHistory, seedAssemblyHistory } from '../joints/jointUi.js';
import { buildEffectiveJointCard, jointEditCard } from './jointCardAgent.js';

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

const SHAFT = '2026-10-10-03-00-00-0001-aaaa';
const HOUSING = '2026-10-10-03-00-00-0002-bbbb';
const JOINT = '2026-10-10-03-00-00-0003-cccc';

function strip() {
  return {
    version: 1,
    source: 'local',
    name: 'Assembly',
    activeId: 'a.js',
    parts: [
      { id: 'a.js', name: 'Shaft', visible: true, order: 0, surfId: SHAFT, position: [0, 0, 0] },
      { id: 'b.js', name: 'Housing', visible: true, order: 1, surfId: HOUSING, position: [0, 0, 5] },
    ],
    joints: [{ id: JOINT, name: 'Fixed 1', type: 'fixed', a: { part: SHAFT } }],
  };
}

/** What App does on joint_commit: applyJointCard, then one history push on success. */
function commit(state, card) {
  if (!card) return { ...state, refused: 'no_joint_card' };
  const result = applyJointCard({ doc: state.doc, scripts: {}, card, catalogs: {} });
  if (!result.ok) return { ...state, refused: result.message };
  return {
    doc: result.doc,
    history: pushAssemblyHistory(state.history, state.doc, result.doc),
  };
}

test('joint_edit with joint_id opens that joint without joint_select', () => {
  const doc = strip();
  const edited = jointEditCard({ doc, card: null, jointId: JOINT, patch: { name: 'Base fixed', userNamed: true } });
  assert.equal(edited.error, undefined);
  assert.equal(edited.selected, true);
  assert.equal(edited.card.mode, 'edit');
  assert.equal(edited.card.id, JOINT);
  assert.equal(edited.card.name, 'Base fixed');
  assert.equal(edited.card.picks.length, 1);

  const open = jointEditCard({ doc, card: edited.card, jointId: JOINT, patch: { name: 'Again', userNamed: true } });
  assert.equal(open.selected, false);
  assert.equal(open.card.name, 'Again');
});

test('joint_edit refusals return an error and no card', () => {
  const doc = strip();
  assert.equal(jointEditCard({ doc, jointId: 'nope', patch: {} }).error.code, 'unknown_joint');
  assert.equal(jointEditCard({ doc, card: null, patch: { name: 'x' } }).error.code, 'no_joint_edit');
  assert.equal(jointEditCard({ doc: null, jointId: JOINT }).error.code, 'no_assembly');
  const create = { mode: 'create', picks: [] };
  assert.equal(jointEditCard({ doc, card: create, patch: { name: 'x' } }).error.code, 'no_joint_edit');
});

test('edit by id then commit is one history step; failures leave history unchanged', () => {
  const doc = strip();
  let state = { doc, history: seedAssemblyHistory(doc) };
  const length = () => state.history.commits.length;

  const renamed = jointEditCard({ doc: state.doc, jointId: JOINT, patch: { name: 'Base fixed', userNamed: true } });
  state = commit(state, renamed.card);
  assert.equal(state.refused, undefined);
  assert.equal(length(), 2);
  assert.equal(state.doc.joints[0].name, 'Base fixed');

  const missing = jointEditCard({ doc: state.doc, jointId: 'nope', patch: { name: 'x', userNamed: true } });
  assert.equal(missing.error.code, 'unknown_joint');
  state = commit(state, missing.card);
  assert.equal(state.refused, 'no_joint_card');
  assert.equal(length(), 2);

  const misfit = jointEditCard({ doc: state.doc, jointId: JOINT, patch: { type: 'coincident', userPickedType: true } });
  assert.equal(misfit.error, undefined);
  state = commit(state, misfit.card);
  assert.ok(state.refused, 'a fixed joint has one pick, so coincident does not fit');
  assert.equal(length(), 2);
  assert.equal(state.doc.joints[0].type, 'fixed');

  const same = jointEditCard({ doc: state.doc, jointId: JOINT, patch: {} });
  state = commit(state, same.card);
  assert.equal(state.refused, undefined);
  assert.equal(length(), 2, 'an unchanged commit writes no step');
  assert.equal(state.history.head, 1);
});
