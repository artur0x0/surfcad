import assert from 'node:assert/strict';
import test from 'node:test';
import {
  entryVisible,
  faceBelongsToStudy,
  feaTapAction,
  studyMemberIds,
} from './feaPickGate.js';

const rows = [{ id: 'fea-a' }, { id: 'fea-b' }, { id: 'fea-c' }];

test('part scope members are only the analyzed part', () => {
  assert.deepEqual(studyMemberIds({ scope: null }, rows, 'fea-a'), ['fea-a']);
  assert.deepEqual(studyMemberIds({}, rows, ''), []);
});

test('assembly members are the rows, and parts scope is the id list', () => {
  assert.deepEqual(
    studyMemberIds({ scope: { kind: 'assembly' } }, rows, 'fea-a'),
    ['fea-a', 'fea-b', 'fea-c'],
  );
  assert.deepEqual(
    studyMemberIds({ scope: { kind: 'parts', ids: ['fea-a', 'fea-c'] } }, rows, 'fea-b'),
    ['fea-a', 'fea-c'],
  );
  assert.deepEqual(
    studyMemberIds({ scope: { kind: 'assembly' } }, [], 'fea-a'),
    ['fea-a'],
  );
});

test('off-study taps are ignored in setup and results', () => {
  const members = ['fea-a'];
  assert.equal(feaTapAction({
    screen: 'setup', scopeKind: 'part', memberIds: members, hitPartId: 'fea-b',
  }), 'ignore');
  assert.equal(feaTapAction({
    screen: 'results', scopeKind: 'part', memberIds: members, hitPartId: 'fea-b',
  }), 'ignore');
  assert.equal(feaTapAction({
    screen: 'running', scopeKind: 'assembly', memberIds: ['fea-a', 'fea-b'], hitPartId: 'fea-c',
  }), 'ignore');
  assert.equal(feaTapAction({
    screen: 'setup', scopeKind: 'part', memberIds: members, hitPartId: '',
  }), 'ignore');
  assert.equal(feaTapAction({
    screen: 'setup', scopeKind: 'part', memberIds: members, hitPartId: null,
  }), 'ignore');
});

test('a member face is a pick, including during results', () => {
  assert.equal(feaTapAction({
    screen: 'setup', scopeKind: 'part', memberIds: ['fea-a'], hitPartId: 'fea-a',
  }), 'pick');
  assert.equal(feaTapAction({
    screen: 'results', scopeKind: 'assembly', memberIds: ['fea-a', 'fea-b'], hitPartId: 'fea-b',
  }), 'pick');
});

test('assembly setup adds a part that is not in the study yet', () => {
  assert.equal(feaTapAction({
    screen: 'setup',
    scopeKind: 'parts',
    memberIds: ['fea-a', 'fea-b'],
    hitPartId: 'fea-c',
  }), 'add-part');
  assert.equal(feaTapAction({
    screen: 'setup',
    scopeKind: 'assembly',
    memberIds: ['fea-a'],
    hitPartId: 'fea-b',
  }), 'add-part');
  assert.equal(feaTapAction({
    screen: 'results',
    scopeKind: 'parts',
    memberIds: ['fea-a', 'fea-b'],
    hitPartId: 'fea-c',
  }), 'ignore');
  assert.equal(feaTapAction({
    screen: 'setup',
    scopeKind: 'part',
    memberIds: ['fea-a'],
    hitPartId: 'fea-b',
  }), 'ignore');
});

test('visible faces are the analyzed part, or assembly members only', () => {
  assert.equal(faceBelongsToStudy({ at: [0, 0, 0] }, ['fea-a'], 'fea-a'), true);
  assert.equal(faceBelongsToStudy({ part: 'fea-b' }, ['fea-a'], 'fea-a'), false);
  assert.equal(faceBelongsToStudy({ part: 'fea-b' }, ['fea-a', 'fea-b'], 'fea-a'), true);
  assert.equal(faceBelongsToStudy({ part: 'fea-c' }, ['fea-a', 'fea-b'], 'fea-a'), false);
  assert.equal(faceBelongsToStudy({}, ['fea-a', 'fea-b'], 'fea-a'), true);
  assert.equal(faceBelongsToStudy({}, ['fea-b'], 'fea-a'), false);

  const studyFaces = {
    fixtures: [
      { faces: [{ part: 'fea-a' }] },
      { faces: [{ part: 'fea-c' }] },
    ],
    loads: [
      { faces: [{}] },
      { faces: [{ part: 'fea-b' }] },
    ],
  };
  const members = ['fea-a', 'fea-b'];
  assert.equal(entryVisible(studyFaces.fixtures[0], members, 'fea-a'), true);
  assert.equal(entryVisible(studyFaces.fixtures[1], members, 'fea-a'), false);
  assert.equal(entryVisible(studyFaces.loads[0], members, 'fea-a'), true);
  assert.equal(entryVisible(studyFaces.loads[1], members, 'fea-a'), true);
  assert.equal(entryVisible(studyFaces.loads[1], ['fea-a'], 'fea-a'), false);
});
