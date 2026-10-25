import assert from 'node:assert/strict';
import test from 'node:test';
import { v1Registry } from './index.js';

const create = v1Registry.get('joint_create');
const remove = v1Registry.get('joint_delete');

const FACE_KEY = { at: [0, 0, 10], n: [0, 0, 1], area: 1200 };
const TWO_PICKS = [
  { part_id: 'frame', face_id: 'f4', key: FACE_KEY },
  { part_id: 'wheel', face_id: 'f1', key: { at: [0, 0, 0], n: [0, 0, -1], area: 1200 } },
];

function host(overrides = {}) {
  const calls = [];
  let card = null;
  let picks = [];
  const transforms = {
    frame: { position: [0, 0, 0], rotation: [0, 0, 0] },
    wheel: { position: [3, 4, 20], rotation: [0, 0, 0] },
  };
  return {
    calls,
    jointOpen() { calls.push('open'); card = { type: null }; picks = []; return { result: { open: true } }; },
    jointApplyPicks({ picks: rows }) {
      calls.push(`picks:${rows.length}`);
      if (rows.some((r) => r.part_id === 'ghost')) return { error: { code: 'unknown_part', message: 'Unknown part id: ghost' } };
      picks = rows;
      return { result: { picked: rows.map((r) => r.part_id), count: rows.length, pickCount: rows.length } };
    },
    jointSetParams({ patch }) {
      calls.push(`params:${patch.type}`);
      card = { ...card, ...patch };
      return { result: { ok: true, type: card.type, name: card.name ?? `${card.type} 1`, valueMm: card.valueMm ?? null, sense: 1, opposed: true, mode: 'create', pickCount: picks.length } };
    },
    prepareJointCommit() {
      calls.push('commit');
      if (card.type === 'symmetric') return { ok: false, message: 'symmetric needs a plane between the picks' };
      return { ok: true, jointId: 'j7', jointCount: 1, unchanged: false };
    },
    finishJointCommit() { calls.push('finish'); card = null; },
    jointCancel() { calls.push('cancel'); card = null; return { result: { cancelled: true } }; },
    agentGetPartTransform({ partId }) { return { result: transforms[partId] }; },
    cardOpen: () => card !== null,
    ...overrides,
  };
}

test('joint_create checkArgs: type and picks are required, fixed takes one pick, others two', () => {
  assert.match(create.checkArgs({}).message, /needs type/);
  assert.match(create.checkArgs({ type: 'coincident' }).message, /needs picks/);
  assert.match(create.checkArgs({ type: 'nope', picks: TWO_PICKS }).message, /Unknown joint type/);
  assert.match(create.checkArgs({ type: 'fixed', picks: TWO_PICKS }).message, /exactly one pick/);
  assert.match(create.checkArgs({ type: 'coincident', picks: [TWO_PICKS[0]] }).message, /exactly two picks/);
  assert.match(create.checkArgs({ type: 'fixed', picks: [{ part_id: 'frame', kind: 'part', face_id: 'f1' }] }).message, /takes no face_id/);
  assert.equal(create.checkArgs({ type: 'fixed', picks: [{ part_id: 'frame' }] }), null);
  assert.equal(create.checkArgs({ type: 'planar', picks: TWO_PICKS }), null);
  assert.equal(create.schema.required.includes('picks'), true);
  assert.ok(create.schema.properties.return, 'a mutating tool takes the return flag');
});

test('joint_create runs open → picks → params → commit and reports the solved placements', async () => {
  const ctx = host();
  const out = await create.run(ctx, { type: 'coincident', picks: TWO_PICKS, name: 'Wheel seat' });
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.deepEqual(ctx.calls, ['open', 'picks:2', 'params:coincident', 'commit', 'finish']);
  assert.equal(out.result.ok, true);
  assert.equal(out.result.jointId, 'j7');
  assert.equal(out.result.type, 'coincident');
  assert.equal(out.result.name, 'Wheel seat');
  assert.equal(out.result.pickCount, 2);
  assert.equal(out.result.usedSelection, false);
  assert.deepEqual(out.result.placements, [
    { part_id: 'frame', position: [0, 0, 0], rotation: [0, 0, 0] },
    { part_id: 'wheel', position: [3, 4, 20], rotation: [0, 0, 0] },
  ]);
  assert.equal(ctx.cardOpen(), false, 'the card is closed after the commit');
});

test('joint_create: an unknown part closes the card and keeps the error code', async () => {
  const ctx = host();
  const out = await create.run(ctx, { type: 'coincident', picks: [TWO_PICKS[0], { part_id: 'ghost', face_id: 'f1', key: FACE_KEY }] });
  assert.equal(out.error.code, 'unknown_part');
  assert.match(out.error.message, /Unknown part id: ghost/);
  assert.match(out.error.message, /joint_create takes type/);
  assert.deepEqual(ctx.calls, ['open', 'picks:2', 'cancel']);
  assert.equal(ctx.cardOpen(), false);
});

test('joint_create: a joint the solver refuses is joint_unsolvable with the reason, nothing written, card closed', async () => {
  const ctx = host();
  const out = await create.run(ctx, { type: 'symmetric', picks: TWO_PICKS });
  assert.equal(out.error.code, 'joint_unsolvable');
  assert.equal(out.error.details.reason, 'symmetric needs a plane between the picks');
  assert.match(out.error.message, /symmetric joint could not be solved/);
  assert.match(out.error.message, /Nothing was written/);
  assert.deepEqual(ctx.calls, ['open', 'picks:2', 'params:symmetric', 'commit', 'cancel']);
  assert.equal(ctx.cardOpen(), false);
});

test('joint_create: a whole-part fixed pick needs no face', async () => {
  const ctx = host();
  const out = await create.run(ctx, { type: 'fixed', picks: [{ part_id: 'frame' }] });
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.equal(out.result.type, 'fixed');
  assert.deepEqual(out.result.placements.map((p) => p.part_id), ['frame']);
});

test('joint_create: when the joint card cannot open the error says so and nothing else runs', async () => {
  const ctx = host({ jointOpen() { return { result: { open: false, suppressed: true } }; } });
  const out = await create.run(ctx, { type: 'coincident', picks: TWO_PICKS });
  assert.equal(out.error.code, 'joints_unavailable');
  assert.deepEqual(ctx.calls, []);
});

test('joint_create: a real axis tie returns the candidate axes', async () => {
  const candidates = [
    { id: 'f2', origin: [0.4, 0, 0], direction: [0, 0, 1], radius: 4 },
    { id: 'f3', origin: [-0.4, 0, 0], direction: [0, 0, 1], radius: 4 },
  ];
  const ctx = host({
    prepareJointCommit() {
      return { ok: false, message: 'More than one axis matches on Hub', candidates };
    },
  });
  const out = await create.run(ctx, { type: 'concentric', picks: TWO_PICKS });
  assert.equal(out.error.code, 'joint_unsolvable');
  assert.equal(out.error.details.reason, 'More than one axis matches on Hub');
  assert.deepEqual(out.error.details.candidates, candidates);
  assert.equal(ctx.cardOpen(), false);
});

test('joint_delete removes one joint by id', () => {
  assert.equal(remove.checkArgs({}).code, 'bad_args');
  assert.equal(remove.uiEntry, 'data-joint-card');
  const ctx = {
    jointDelete({ joint_id }) {
      assert.equal(joint_id, 'j7');
      return { result: { ok: true, jointId: joint_id, jointCount: 0 } };
    },
  };
  assert.deepEqual(remove.run(ctx, { joint_id: 'j7' }), {
    result: { ok: true, jointId: 'j7', jointCount: 0 },
  });
  assert.equal(remove.run({}, { joint_id: 'j7' }).error.code, 'internal');
});
