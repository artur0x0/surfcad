import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JOINT_BROKEN_CODE,
  JOINT_BROKEN_HINT,
  buildJointHealth,
  jointBrokenWarning,
  jointFailuresOf,
  newlyBrokenJoints,
  withJointBrokenWarning,
} from './jointHealth.js';

const FRAME = '2026-10-07-20-56-31-0423-a3f9';
const WHEEL = '2026-10-07-20-56-31-0423-b4e1';
const FACE = { at: [0, 0, 5], n: [0, 0, 1], area: 100 };

const JOINTS = [
  { id: 'j1', name: 'Coincident 1', type: 'coincident', opposed: true, a: { part: FRAME, kind: 'face', key: FACE }, b: { part: WHEEL, kind: 'face', key: FACE } },
  { id: 'j2', name: 'Ground', type: 'fixed', a: { part: FRAME } },
  { id: 'j3', name: 'Angle 1', type: 'angle', value: 35, sense: -1, a: { part: FRAME, kind: 'face', key: FACE }, b: { part: WHEEL, kind: 'face', key: FACE } },
];

const rowId = (surf) => (surf === FRAME ? 'frame' : surf === WHEEL ? 'wheel' : surf);

test('buildJointHealth lists every joint with its status, reason, picks and parts by row id', () => {
  const health = buildJointHealth({
    joints: JOINTS,
    statuses: { j1: 'broken', j3: 'conflict' },
    messages: { j1: 'Face not found on Wheel' },
    partIdOf: rowId,
  });
  assert.equal(health.total, 3);
  assert.deepEqual(health.failed, { count: 2, ids: ['j1', 'j3'] });
  const [j1, j2, j3] = health.joints;
  assert.equal(j1.status, 'broken');
  assert.equal(j1.reason, 'Face not found on Wheel');
  assert.deepEqual(j1.parts, ['frame', 'wheel']);
  assert.deepEqual(j1.picks[1], { part_id: 'wheel', kind: 'face', key: FACE });
  assert.equal(j1.opposed, true);
  assert.equal(j2.status, 'ok');
  assert.equal(j2.reason, undefined);
  assert.deepEqual(j2.picks, [{ part_id: 'frame' }]);
  assert.equal(j3.status, 'conflict');
  assert.equal(j3.reason, 'Conflicts with another joint');
  assert.equal(j3.value_deg, 35);
  assert.equal(j3.value_mm, undefined);
  assert.equal(j3.sense, -1);
});

test('a joint with no live status is ok, and the rows survive JSON', () => {
  const health = buildJointHealth({ joints: JOINTS });
  assert.deepEqual(health.failed, { count: 0, ids: [] });
  assert.ok(health.joints.every((row) => row.status === 'ok'));
  assert.deepEqual(JSON.parse(JSON.stringify(health)), health);
  assert.deepEqual(jointFailuresOf(health), { count: 0, ids: [] });
  assert.deepEqual(jointFailuresOf(null), { count: 0, ids: [] });
});

test('newlyBrokenJoints reports joints that fail now and did not before, including new ones', () => {
  const before = buildJointHealth({ joints: JOINTS.slice(0, 2), statuses: { j1: 'broken' } });
  const after = buildJointHealth({ joints: JOINTS, statuses: { j1: 'broken', j3: 'conflict' } });
  assert.deepEqual(newlyBrokenJoints(before, after).map((row) => row.id), ['j3']);
  assert.deepEqual(newlyBrokenJoints(null, after), []);
  const healed = buildJointHealth({ joints: JOINTS });
  assert.deepEqual(newlyBrokenJoints(after, healed), []);
});

test('jointBrokenWarning and withJointBrokenWarning attach one warning to a success only', () => {
  const before = buildJointHealth({ joints: JOINTS });
  const after = buildJointHealth({ joints: JOINTS, statuses: { j1: 'broken' }, messages: { j1: 'Face not found on Wheel' }, partIdOf: rowId });
  const warning = jointBrokenWarning(before, after);
  assert.equal(warning.code, JOINT_BROKEN_CODE);
  assert.equal(warning.hint, JOINT_BROKEN_HINT);
  assert.deepEqual(warning.joints, [{ id: 'j1', name: 'Coincident 1', type: 'coincident', status: 'broken', reason: 'Face not found on Wheel', parts: ['frame', 'wheel'] }]);
  assert.equal(jointBrokenWarning(before, before), null);

  const ok = withJointBrokenWarning({ result: { ok: true } }, before, after);
  assert.equal(ok.result.warning.code, JOINT_BROKEN_CODE);
  const err = { error: { code: 'edit_failed', message: 'no' } };
  assert.equal(withJointBrokenWarning(err, before, after), err);
  const kept = withJointBrokenWarning({ result: { ok: true, warning: { code: 'unjointed_part' } } }, before, after);
  assert.equal(kept.result.warning.code, 'unjointed_part');
  assert.equal(withJointBrokenWarning({ result: { ok: true } }, before, before).result.warning, undefined);
});
