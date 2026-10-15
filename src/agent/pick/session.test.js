import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addPicks,
  clearPicks,
  createPickSessions,
  pickKeyId,
  popPick,
  readPickLimits,
  removePicks,
  sessionCount,
  sessionEntries,
  summarizeSession,
} from './session.js';

const TOP = { at: [0, 0, 10], n: [0, 0, 1], area: 400 };
const SIDE = { at: [10, 0, 5], n: [1, 0, 0], area: 200 };

function row(id) {
  return { id, entry: { id } };
}

function fresh(store, extra = {}) {
  return store.begin({
    kind: 'face',
    target: 'selection',
    min: 1,
    max: null,
    timeoutMs: 1000,
    original: [],
    base: [],
    ...extra,
  });
}

test('pickKeyId dedupes face keys within rounding and orders face pairs', () => {
  assert.equal(pickKeyId('face', TOP), pickKeyId('face', { ...TOP, at: [0.0001, 0, 10.0002] }));
  assert.notEqual(pickKeyId('face', TOP), pickKeyId('face', { ...TOP, src: -2, ord: 0 }));
  assert.equal(pickKeyId('face', 'e3'), null);
  assert.equal(pickKeyId('edge', 'e3'), 'e:e3');
  assert.equal(
    pickKeyId('edge', { faceKeyA: TOP, faceKeyB: SIDE }),
    pickKeyId('edge', { faceKeyA: SIDE, faceKeyB: TOP }),
  );
  assert.equal(pickKeyId('edge', { faceKeyA: TOP }), null);
  assert.equal(pickKeyId('edge', 7), null);
});

test('readPickLimits applies defaults and refuses bad ranges', () => {
  assert.deepEqual(readPickLimits({}), { min: 1, max: null, timeoutMs: 120000 });
  assert.deepEqual(readPickLimits({ min: 0, max: 2, timeout_ms: 5000 }), { min: 0, max: 2, timeoutMs: 5000 });
  assert.equal(readPickLimits({ min: -1 }).error.code, 'bad_args');
  assert.equal(readPickLimits({ min: 2, max: 1 }).error.code, 'bad_args');
  assert.equal(readPickLimits({ timeout_ms: 10 }).error.code, 'bad_args');
  assert.equal(readPickLimits({ timeout_ms: 1.5e6 + 1e6 }).error.code, 'bad_args');
});

test('add skips repeats, enforces max, and composes base before picks', () => {
  const store = createPickSessions({ now: () => 0 });
  const s0 = fresh(store, { base: [row('b1')], max: 3 });
  const a = addPicks(s0, [
    { key: 'k1', id: 'e:k1', entries: [row('x'), row('b1')] },
    { key: 'k1', id: 'e:k1', entries: [row('x')] },
  ]);
  assert.equal(a.added, 1);
  assert.equal(a.skipped, 1);
  assert.deepEqual(sessionEntries(a.session).map((r) => r.id), ['b1', 'x']);
  assert.equal(sessionCount(a.session), 2);
  const b = addPicks(a.session, [
    { key: 'k2', id: 'e:k2', entries: [row('y')] },
    { key: 'k3', id: 'e:k3', entries: [row('z')] },
  ]);
  assert.equal(b.error.code, 'pick_limit');
  assert.deepEqual(b.error.details, { max: 3, count: 2, adding: 2 });
});

test('remove drops agent picks or seeded entries and reports not_picked', () => {
  const store = createPickSessions({ now: () => 0 });
  const s0 = fresh(store, { base: [row('b1'), row('b2')] });
  const s1 = addPicks(s0, [{ key: 'k1', id: 'e:k1', entries: [row('x')] }]).session;
  const byKey = removePicks(s1, [{ id: 'e:k1', entries: [row('x')] }]);
  assert.equal(byKey.removed, 1);
  assert.deepEqual(sessionEntries(byKey.session).map((r) => r.id), ['b1', 'b2']);
  const seeded = removePicks(s1, [{ id: 'e:other', entries: [row('b2')] }]);
  assert.deepEqual(sessionEntries(seeded.session).map((r) => r.id), ['b1', 'x']);
  assert.equal(removePicks(s1, [{ id: 'e:none', entries: [row('q')] }]).error.code, 'not_picked');
});

test('undo pops the last agent pick only; clear drops base too', () => {
  const store = createPickSessions({ now: () => 0 });
  const s0 = fresh(store, { base: [row('b1')] });
  assert.equal(popPick(s0).error.code, 'nothing_to_undo');
  const s1 = addPicks(s0, [{ key: 'k1', id: 'e:k1', entries: [row('x')] }]).session;
  assert.deepEqual(sessionEntries(popPick(s1).session).map((r) => r.id), ['b1']);
  assert.deepEqual(sessionEntries(clearPicks(s1)), []);
});

test('an idle session expires once with pick_timeout, then the slot is free', () => {
  let t = 0;
  const store = createPickSessions({ now: () => t });
  assert.equal(store.take().error.code, 'no_pick_session');
  const s = fresh(store, { timeoutMs: 1000 });
  t = 900;
  store.save(s);
  t = 1800;
  assert.equal(store.take().session.id, s.id);
  t = 3000;
  assert.equal(store.peek(), null);
  const gone = store.take();
  assert.equal(gone.error.code, 'pick_timeout');
  assert.equal(gone.error.details.session, s.id);
  assert.equal(store.take().error.code, 'no_pick_session');
});

test('summary is JSON and reports what the agent picked', () => {
  const store = createPickSessions({ now: () => 0 });
  const s = addPicks(fresh(store), [{ key: TOP, id: pickKeyId('face', TOP), entries: [row('f')] }]).session;
  const summary = summarizeSession(store, store.save(s));
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), summary);
  assert.deepEqual(summary.picks, [TOP]);
  assert.equal(summary.count, 1);
  assert.equal(summary.entries, 1);
  assert.equal(summary.expiresInMs, 1000);
});
