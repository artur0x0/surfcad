/**
 * B17 PR 4: git_save must not freeze the agent. A save still on the wire
 * after the budget answers `running` with a saveId, the bridge chain is
 * free, and git_save_status finishes it with the result git_save would
 * have returned.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSurfcadBridge } from '../utils/agentBridge.js';
import { _resetRunningSaves, SAVE_RUNNING_MESSAGE } from './commands/git.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hostWith(agentGitSave) {
  return { agentGitSave, readAgentGitAdapterKind: () => 'mock' };
}

test('a slow save answers running within the budget, leaves the chain free, and git_save_status finishes it', async () => {
  globalThis.__SURFCAD_AGENT_GIT_SAVE_WAIT_MS = 40;
  _resetRunningSaves();
  let resolveSave;
  const host = hostWith(() => new Promise((r) => { resolveSave = r; }));
  const api = createSurfcadBridge({ resolve: () => host });
  const t0 = Date.now();
  const env = await api.call('git_save', { message: 'Slow save' });
  const waited = Date.now() - t0;
  assert.equal(env.ok, true, JSON.stringify(env));
  assert.equal(env.result.status, 'running');
  assert.match(env.result.saveId, /^save-\d+-[0-9a-z]+$/);
  assert.equal(env.result.message, SAVE_RUNNING_MESSAGE);
  assert.ok(waited < 1000, `answered in ${waited} ms`);

  // The chain is free: a queued command runs while the save is still going.
  const t1 = Date.now();
  const queued = await api.call('history', {});
  assert.ok(Date.now() - t1 < 500, 'a queued command does not wait for the save');
  assert.equal(queued.ok, true);

  const still = await api.call('git_save_status', { save_id: env.result.saveId });
  assert.equal(still.ok, true);
  assert.equal(still.result.status, 'running');
  assert.ok(still.result.elapsedMs >= 0);

  resolveSave({ status: 'committed', sha: 'abc123', branch: 'main', files: ['parts/x.js'] });
  await sleep(5);
  const done = await api.call('git_save_status', { save_id: env.result.saveId });
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.result.status, 'committed');
  assert.equal(done.result.sha, 'abc123');
  assert.equal(done.result.saveId, env.result.saveId);
  assert.equal('files' in done.result, false, 'path fields stay stripped, as git_save strips them');
  delete globalThis.__SURFCAD_AGENT_GIT_SAVE_WAIT_MS;
});

test('a save that finishes within the budget answers its result directly; its id is not a status row', async () => {
  globalThis.__SURFCAD_AGENT_GIT_SAVE_WAIT_MS = 500;
  _resetRunningSaves();
  const host = hostWith(async () => { await sleep(5); return { status: 'clean' }; });
  const api = createSurfcadBridge({ resolve: () => host });
  const env = await api.call('git_save', { message: 'Fast save' });
  assert.equal(env.ok, true);
  assert.equal(env.result.status, 'clean');
  const unknown = await api.call('git_save_status', { save_id: 'save-9-zz' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'unknown_save');
  const bad = await api.call('git_save_status', {});
  assert.equal(bad.error.code, 'bad_args');
  delete globalThis.__SURFCAD_AGENT_GIT_SAVE_WAIT_MS;
});

test('a slow save that ends in a conflict reports the same typed error through git_save_status', async () => {
  globalThis.__SURFCAD_AGENT_GIT_SAVE_WAIT_MS = 20;
  _resetRunningSaves();
  const host = hostWith(async () => { await sleep(60); return { status: 'conflict', error: 'main moved', paths: ['parts/x.js'] }; });
  const api = createSurfcadBridge({ resolve: () => host });
  const env = await api.call('git_save', { message: 'Will conflict' });
  assert.equal(env.result.status, 'running');
  await sleep(80);
  const done = await api.call('git_save_status', { save_id: env.result.saveId });
  assert.equal(done.ok, false, JSON.stringify(done));
  assert.equal(done.error.code, 'conflict');
  assert.equal(done.error.message, 'main moved');
  delete globalThis.__SURFCAD_AGENT_GIT_SAVE_WAIT_MS;
});

test('a slow save whose host throws is recorded as internal, never an unhandled rejection', async () => {
  globalThis.__SURFCAD_AGENT_GIT_SAVE_WAIT_MS = 10;
  _resetRunningSaves();
  const host = hostWith(async () => { await sleep(40); throw new Error('socket closed'); });
  const api = createSurfcadBridge({ resolve: () => host });
  const env = await api.call('git_save', { message: 'Will throw' });
  assert.equal(env.result.status, 'running');
  await sleep(60);
  const done = await api.call('git_save_status', { save_id: env.result.saveId });
  assert.equal(done.ok, false);
  assert.equal(done.error.code, 'internal');
  assert.match(done.error.message, /socket closed/);
  delete globalThis.__SURFCAD_AGENT_GIT_SAVE_WAIT_MS;
});
