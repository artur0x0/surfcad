import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { buildJointHealth, JOINT_BROKEN_CODE } from '../state/jointHealth.js';
import { v1Registry } from './index.js';

const FACE = { at: [0, 0, 5], n: [0, 0, 1], area: 100 };
const JOINTS = [
  { id: 'j1', name: 'Coincident 1', type: 'coincident', opposed: true, a: { part: 'frame', kind: 'face', key: FACE }, b: { part: 'wheel', kind: 'face', key: FACE } },
  { id: 'j2', name: 'Ground', type: 'fixed', a: { part: 'frame' } },
];

/**
 * A host whose joint health is whatever `live` says. `execute` flips it to
 * `afterRun` when given, the way a part run re-resolves every joint.
 */
function host({ live = {}, afterRun = null, joints = JOINTS } = {}) {
  let statuses = live.statuses || {};
  let messages = live.messages || {};
  const read = () => buildJointHealth({ joints, statuses, messages });
  return {
    readParts: () => ({ activeId: 'frame', assemblyName: 'Bike', parts: [{ id: 'frame', name: 'Frame', visible: true }, { id: 'wheel', name: 'Wheel', visible: true }] }),
    readJoints: () => joints,
    readJointHealth: read,
    getScript: () => '',
    setEditor() {},
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory() {},
    async execute() {
      if (afterRun) {
        statuses = afterRun.statuses || {};
        messages = afterRun.messages || {};
      }
      return { ok: true, errors: [], volume: 1, bbox: null, partName: 'Frame' };
    },
    prepareHelperInsert() {
      return { source: 'let part = Manifold.cube([10,10,10], true);\nreturn part;\n' };
    },
    jointOpen() { return { result: { open: true } }; },
    jointApplyPicks({ picks }) { return { result: { picked: picks.map((r) => r.part_id), count: picks.length } }; },
    jointSetParams({ patch }) { return { result: { ok: true, type: patch.type, name: 'Coincident 2', valueMm: null, sense: 1, opposed: true } }; },
    prepareJointCommit() {
      // The new joint solves, but it leaves j1 in conflict.
      statuses = { j1: 'conflict' };
      messages = { j1: 'Joint "Coincident 1" conflicts' };
      return { ok: true, jointId: 'j3', jointCount: 3, unchanged: false };
    },
    finishJointCommit() {},
    jointCancel() { return { result: { cancelled: true } }; },
    agentGetPartTransform({ partId }) { return { result: { position: [0, 0, 0], rotation: [0, 0, 0], partId } }; },
  };
}

const bridge = (h) => createSurfcadBridge({ resolve: () => h });

test('list_joints is an immediate read in the joint group with a strict schema', () => {
  const cmd = v1Registry.get('list_joints');
  assert.ok(cmd, 'registered');
  assert.equal(cmd.immediate, true);
  assert.equal(cmd.schema.additionalProperties, false);
});

test('list_joints lists every joint with status and reason; status carries jointFailures', async () => {
  const api = bridge(host({ live: { statuses: { j1: 'broken' }, messages: { j1: 'Face not found on Wheel' } } }));
  const listed = await api.call('list_joints', {});
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.equal(listed.result.total, 2);
  assert.deepEqual(listed.result.failed, { count: 1, ids: ['j1'] });
  assert.equal(listed.result.joints[0].status, 'broken');
  assert.equal(listed.result.joints[0].reason, 'Face not found on Wheel');
  assert.deepEqual(listed.result.joints[0].parts, ['frame', 'wheel']);
  assert.equal(listed.result.joints[1].status, 'ok');

  const status = await api.call('status', {});
  assert.deepEqual(status.result.jointFailures, { count: 1, ids: ['j1'] });
  assert.deepEqual(status.result.unjointedParts, []);
});

test('a clean assembly reports zero failures and no warning on a mutate', async () => {
  const api = bridge(host());
  const status = await api.call('status', {});
  assert.deepEqual(status.result.jointFailures, { count: 0, ids: [] });
  const inserted = await api.call('insert_cube', {});
  assert.equal(inserted.ok, true, JSON.stringify(inserted));
  assert.equal(inserted.result.warning, undefined);
  assert.deepEqual(inserted.result.status.jointFailures, { count: 0, ids: [] });
});

test('a part edit that breaks a joint returns warning joint_broken with the reason', async () => {
  const api = bridge(host({ afterRun: { statuses: { j1: 'broken' }, messages: { j1: 'Face not found on Frame' } } }));
  const edited = await api.call('insert_cube', {});
  assert.equal(edited.ok, true, JSON.stringify(edited));
  assert.equal(edited.result.warning?.code, JOINT_BROKEN_CODE);
  assert.deepEqual(edited.result.warning.joints.map((row) => [row.id, row.status, row.reason]), [['j1', 'broken', 'Face not found on Frame']]);
  assert.deepEqual(edited.result.status.jointFailures, { count: 1, ids: ['j1'] });
  // The next edit does not repeat a warning for a joint that was already broken.
  const again = await api.call('insert_cube', {});
  assert.equal(again.result.warning, undefined);
});

test('a host without a joint reader keeps status and results unchanged', async () => {
  const h = host();
  delete h.readJointHealth;
  const api = bridge(h);
  const status = await api.call('status', {});
  assert.equal(status.result.jointFailures, undefined);
  const inserted = await api.call('insert_cube', {});
  assert.equal(inserted.result.warning, undefined);
  const listed = await api.call('list_joints', {});
  assert.deepEqual(listed.result, { joints: [], total: 0, failed: { count: 0, ids: [] } });
});

test('joint_create and joint_commit warn when the commit leaves another joint failing', async () => {
  const api = bridge(host());
  const created = await api.call('joint_create', {
    type: 'coincident',
    picks: [{ part_id: 'frame', face_id: 'f1', key: FACE }, { part_id: 'wheel', face_id: 'f2', key: FACE }],
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.result.jointId, 'j3');
  assert.equal(created.result.warning?.code, JOINT_BROKEN_CODE);
  assert.deepEqual(created.result.warning.joints.map((row) => row.id), ['j1']);
  assert.match(created.result.warning.joints[0].reason, /conflicts/);
});
