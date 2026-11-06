/**
 * mcp-modeling-bugs-2026-11-05 §8: a long mold analysis must not look like
 * silence. A mold_* call still running after the budget answers a heartbeat
 * (status running, a jobId, phase, percent, elapsed and an estimate), and
 * mold_status answers the next heartbeat or the final result. A heartbeat is
 * never mistaken for the result, and a quick analysis is unchanged.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSurfcadBridge } from '../utils/agentBridge.js';
import { AGENT_MOLD_WAIT_MS, MOLD_RUNNING_MESSAGE, _resetMoldJobs } from './commands/moldJob.js';
import { MOLD_RUNNING_NOTE, metaForCommand } from './export/commandMeta.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FIT = {
  fit: 'fixable',
  undercutCount: 2,
  pull: [0, 0, 1],
  wall: { nominal: 2, min: 0.9, max: 3.4 },
};

function withBudget(ms, fn) {
  return async () => {
    globalThis.__SURFCAD_AGENT_MOLD_WAIT_MS = ms;
    _resetMoldJobs();
    try {
      await fn();
    } finally {
      delete globalThis.__SURFCAD_AGENT_MOLD_WAIT_MS;
      _resetMoldJobs();
    }
  };
}

test('the heartbeat budget is about 30 seconds', () => {
  assert.equal(AGENT_MOLD_WAIT_MS, 30_000);
});

test('a long mold_fit answers a heartbeat, mold_status answers the next one, then the result', withBudget(40, async () => {
  let finish;
  let progress = { stage: 'Pull direction', percent: 0 };
  const host = {
    moldFit: () => new Promise((resolve) => { finish = resolve; }),
    moldProgress: () => progress,
  };
  const api = createSurfcadBridge({ resolve: () => host });

  const t0 = Date.now();
  const first = await api.call('mold_fit', {});
  const waited = Date.now() - t0;
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.ok(waited >= 30 && waited < 1500, `the first heartbeat came after the budget (${waited} ms)`);
  const beat = first.result;
  assert.equal(beat.status, 'running');
  assert.equal(beat.stillRunning, true);
  assert.match(beat.jobId, /^mold-\d+-[0-9a-z]+$/);
  assert.equal(beat.command, 'mold_fit');
  assert.equal(beat.phase, 'Pull direction');
  assert.equal(beat.percent, 0);
  assert.equal(typeof beat.elapsedSec, 'number');
  assert.equal('etaSec' in beat, false, 'no estimate before there is progress to estimate from');
  assert.equal(beat.message, MOLD_RUNNING_MESSAGE);
  // Not mistaken for completion: none of the result's fields are there.
  for (const key of ['fit', 'undercutCount', 'pull', 'wall', 'partId']) assert.equal(key in beat, false, key);

  // The chain is free while the analysis runs.
  const t1 = Date.now();
  const other = await api.call('history', {});
  assert.equal(other.ok, true);
  assert.ok(Date.now() - t1 < 500, 'another command does not wait for the analysis');

  // The next call waits the budget again and answers the next heartbeat, with progress.
  progress = { stage: 'Wall thickness', percent: 40 };
  const t2 = Date.now();
  const second = await api.call('mold_status', { job_id: beat.jobId });
  assert.ok(Date.now() - t2 >= 30, 'mold_status waits for the analysis, it does not spin');
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.result.status, 'running');
  assert.equal(second.result.stillRunning, true);
  assert.equal(second.result.jobId, beat.jobId);
  assert.equal(second.result.phase, 'Wall thickness');
  assert.equal(second.result.percent, 40);
  assert.ok(second.result.etaSec >= 1, 'an estimate once there is progress');
  assert.equal('fit' in second.result, false);

  // The analysis finishes while a status call is waiting: that call answers the result at once.
  const pending = api.call('mold_status', { job_id: beat.jobId });
  await sleep(5);
  const t3 = Date.now();
  finish({ partId: 'part-1', frame: 'local', ...FIT });
  const done = await pending;
  assert.ok(Date.now() - t3 < 30, 'the result is not held until the budget ends');
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.result.fit, 'fixable');
  assert.equal(done.result.undercutCount, 2);
  assert.deepEqual(done.result.wall, FIT.wall);
  assert.equal(done.result.partId, 'part-1');
  assert.equal(done.result.jobId, beat.jobId);
  assert.equal('status' in done.result, false, 'the final result is not a heartbeat');
  assert.equal('stillRunning' in done.result, false);

  // The finished result stays readable.
  const again = await api.call('mold_status', { job_id: beat.jobId });
  assert.equal(again.result.fit, 'fixable');
}));

test('a mold analysis that finishes inside the budget answers its result directly, with no job', withBudget(500, async () => {
  const host = { moldFit: async () => { await sleep(5); return { partId: 'p', ...FIT }; } };
  const api = createSurfcadBridge({ resolve: () => host });
  const env = await api.call('mold_fit', {});
  assert.equal(env.ok, true);
  assert.equal(env.result.fit, 'fixable');
  assert.equal('jobId' in env.result, false);
  assert.equal('status' in env.result, false);
  const unknown = await api.call('mold_status', { job_id: 'mold-9-zz' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'unknown_job');
  const bad = await api.call('mold_status', {});
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'bad_args');
}));

test('a long analysis that fails reports the same typed error through mold_status', withBudget(30, async () => {
  let finish;
  const host = { moldFit: () => new Promise((resolve) => { finish = resolve; }) };
  const api = createSurfcadBridge({ resolve: () => host });
  const env = await api.call('mold_fit', {});
  assert.equal(env.result.status, 'running');
  finish({ error: { code: 'no_mesh', message: 'No mesh for that part' } });
  await sleep(5);
  const done = await api.call('mold_status', { job_id: env.result.jobId });
  assert.equal(done.ok, false);
  assert.equal(done.error.code, 'no_mesh');

  // A handler that throws late is an error on the record, not an unhandled rejection.
  let reject;
  host.moldFit = () => new Promise((_resolve, rej) => { reject = rej; });
  const second = await api.call('mold_fit', {});
  assert.equal(second.result.status, 'running');
  reject(new Error('worker died'));
  await sleep(5);
  const failed = await api.call('mold_status', { job_id: second.result.jobId });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'internal');
  assert.match(failed.error.message, /worker died/);
}));

test('every analysis command sits under the budget, and its description says what a heartbeat is', withBudget(30, async () => {
  const slow = () => new Promise(() => {});
  const host = {
    moldFit: slow,
    moldDfm: slow,
    moldQuote: slow,
    moldParting: slow,
    moldDraft: slow,
    moldWallMap: slow,
    moldPull: slow,
  };
  const api = createSurfcadBridge({ resolve: () => host });
  const calls = [
    ['mold_fit', {}],
    ['mold_dfm', { on: true }],
    ['mold_quote', { on: true }],
    ['mold_parting', { on: true }],
    ['mold_side_actions', {}],
    ['mold_draft', { on: true }],
    ['mold_wall_map', { on: true }],
  ];
  for (const [name, args] of calls) {
    const env = await api.call(name, args);
    assert.equal(env.ok, true, `${name}: ${JSON.stringify(env)}`);
    assert.equal(env.result.status, 'running', name);
    assert.equal(env.result.stillRunning, true, name);
    assert.equal(env.result.command, name);
    assert.match(metaForCommand(name).description, /That is a heartbeat, not the result\. Call mold_status \{ job_id \}/, name);
    assert.ok(metaForCommand(name).description.includes(MOLD_RUNNING_NOTE), name);
  }
  assert.match(metaForCommand('mold_status').description, /A heartbeat is not a result/);
  assert.match(metaForCommand('mold_status').description, /waits up to about 30 s/);
  assert.equal(metaForCommand('mold_status').mutates, false);
  // The lead and payment commands are not analyses.
  assert.doesNotMatch(metaForCommand('mold_request_firm_quote').description, /heartbeat/);
}));
