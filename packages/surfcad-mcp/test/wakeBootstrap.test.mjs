/**
 * Wake bootstrap at pair and login. Brief
 * mcp-pairing-wake-bootstrap-claude-brief-2026-11-06: pair once, message
 * from SurfCAD, with no webhook pasted by the user.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { bootstrapWake, provisionWake, wakeFromEnv, wakeStatePath } from '../src/listen/bootstrap.mjs';
import { wakeReadinessNote } from '../src/listen/listenCli.mjs';
import { WAKE_GREETING, WAKE_GREET_INSTRUCTION, wakePayload } from '../src/listen/wake.mjs';
import { readWake, saveWake, wakePath } from '../src/listen/wakeConfig.mjs';
import { saveLogin } from '../src/remote/tokenStore.mjs';

async function tempEnv(extra = {}) {
  return { SURFCAD_MCP_CONFIG_DIR: await mkdtemp(join(tmpdir(), 'surfcad-wake-boot-')), ...extra };
}

const login = (env) => saveLogin({ token: 'tok_secret_value', server: 'https://surfcad.test', name: 'bot', machine: 'm' }, env);

/** A machine: whether a listener is "running", and what the wake did. */
function machine(opts = {}) {
  const wakes = [];
  let listener = opts.listener === true;
  let started = 0;
  return {
    wakes,
    get started() { return started; },
    deps: {
      listenerPid: async () => (listener ? 4242 : null),
      startListener: async () => {
        if (opts.listenerFails) throw new Error('spawn failed');
        started += 1;
        listener = true;
        return { pid: 4242, log: '/tmp/x' };
      },
      waker: {
        wake: async (payload) => {
          wakes.push(payload);
          return opts.wakeFails ? { ok: false, form: 'post', error: 'wake_post_failed' } : { ok: true, form: 'post' };
        },
        idle: async () => {},
        busy: () => false,
      },
    },
  };
}

test('the greeting wake carries the greeting and tells a new session to say it', () => {
  assert.equal(WAKE_GREETING, 'Hi, what can I help you design?');
  const payload = wakePayload([], { reason: 'greet' });
  assert.equal(payload.type, 'surfcad.wake');
  assert.equal(payload.reason, 'greet');
  assert.equal(payload.greeting, WAKE_GREETING);
  assert.equal(payload.instruction, WAKE_GREET_INSTRUCTION);
  assert.deepEqual(payload.prompts, []);
  assert.match(payload.instruction, /reply_to_user \{ text: "Hi, what can I help you design\?" \} with no in_reply_to/);
  assert.match(payload.instruction, /read_messages \{ wait_ms: 10000 \}/);
  // A message wake tells a new session it has no memory and where its context is.
  const prompt = wakePayload([{ id: 'p1', text: 'taller', ts: 't' }]);
  assert.equal(prompt.greeting, undefined);
  assert.match(prompt.instruction, /this is a new session started to answer it/);
  assert.match(prompt.instruction, /You have no memory of earlier sessions/);
});

test('the host provides the wake through the server environment; bad values are named, not used', () => {
  assert.deepEqual(wakeFromEnv({}), { config: null, problems: [] });
  const both = wakeFromEnv({ SURFCAD_WAKE_POST: ' http://127.0.0.1:8644/wake ', SURFCAD_WAKE_BEARER: 'k1', SURFCAD_WAKE_EXEC: 'my-agent --wake' });
  assert.deepEqual(both.config, { post: { url: 'http://127.0.0.1:8644/wake', bearer: 'k1' }, exec: 'my-agent --wake' });
  assert.deepEqual(both.problems, []);
  // A URL that is not https or local is refused by the same rule as `wake set`.
  const bad = wakeFromEnv({ SURFCAD_WAKE_POST: 'http://192.168.1.9/wake', SURFCAD_WAKE_EXEC: 'my-agent --wake' });
  assert.deepEqual(bad.config, { exec: 'my-agent --wake' });
  assert.equal(bad.problems.length, 1);
  assert.match(bad.problems[0], /^SURFCAD_WAKE_POST: /);
  // A bearer alone is not a wake.
  assert.equal(wakeFromEnv({ SURFCAD_WAKE_BEARER: 'k1' }).config, null);
});

test('provision: the environment wins and is saved for the listener; a saved wake stands alone; nothing is nothing', async () => {
  const bare = await tempEnv();
  assert.deepEqual(await provisionWake(bare), { config: null, source: null, problems: [] });

  await saveWake({ exec: 'old-agent --wake' }, bare);
  const saved = await provisionWake(bare);
  assert.equal(saved.source, 'saved');
  assert.equal(saved.config.exec, 'old-agent --wake');

  const env = { ...bare, SURFCAD_WAKE_POST: 'http://127.0.0.1:8644/wake', SURFCAD_WAKE_BEARER: 'k_secret_9' };
  const provided = await provisionWake(env);
  assert.equal(provided.source, 'env');
  assert.deepEqual(provided.config.post, { url: 'http://127.0.0.1:8644/wake', bearer: 'k_secret_9' });
  // Written where `surfcad-mcp listen`, a separate process, reads it. Mode 0600.
  const onDisk = await readWake(bare);
  assert.equal(onDisk.post.url, 'http://127.0.0.1:8644/wake');
  assert.equal(onDisk.exec, undefined, 'the host said post only');
  assert.equal((await stat(wakePath(bare))).mode & 0o777, 0o600);
  // The same environment again does not rewrite the file.
  const before = (await stat(wakePath(bare))).mtimeMs;
  await provisionWake(env);
  assert.equal((await stat(wakePath(bare))).mtimeMs, before);
});

test('pair on a host that provides a wake: the listener starts, the wake greets once, and the state is ready', async () => {
  const env = await tempEnv({ SURFCAD_WAKE_POST: 'http://127.0.0.1:8644/wake', SURFCAD_WAKE_BEARER: 'k_secret_9' });
  await saveLogin({ token: 'tok_secret_value', server: 'https://surfcad.test' }, env);
  const m = machine();
  const first = await bootstrapWake({ env, remote: true, greet: true, ...m.deps });
  assert.deepEqual(first.forms, ['post']);
  assert.equal(first.source, 'env');
  assert.equal(first.listenerStarted, true);
  assert.equal(first.listenerRunning, true);
  assert.equal(first.coldWake, 'ready');
  assert.equal(first.greeting, 'sent_by_wake');
  assert.equal(m.started, 1);
  assert.equal(m.wakes.length, 1);
  assert.equal(m.wakes[0].reason, 'greet');
  // The user never pasted anything, and no secret is in what the agent is told.
  const note = wakeReadinessNote(first, { remote: true });
  assert.match(note, /^Idle wake: ready \(post; listener running\)/);
  assert.ok(!note.includes('k_secret_9') && !note.includes('tok_secret_value') && !note.includes('8644'));
  const state = await readFile(wakeStatePath(env), 'utf8');
  assert.ok(!state.includes('tok_secret_value'), 'the greeting mark is not the token');

  // The next pair of the same login: no second listener, no second greeting.
  const again = await bootstrapWake({ env, remote: true, greet: true, ...m.deps });
  assert.equal(again.listenerStarted, false);
  assert.equal(again.greeting, 'already_sent');
  assert.equal(again.coldWake, 'ready');
  assert.equal(m.started, 1);
  assert.equal(m.wakes.length, 1);

  // A new login (after a Disconnect) is greeted again.
  await saveLogin({ token: 'tok_after_relogin', server: 'https://surfcad.test' }, env);
  const relogin = await bootstrapWake({ env, remote: true, greet: true, ...m.deps });
  assert.equal(relogin.greeting, 'sent_by_wake');
  assert.equal(m.wakes.length, 2);
});

test('pair on a host with no wake: cold wake is unavailable, no listener is started, and the pairing session greets once', async () => {
  const env = await tempEnv();
  await saveLogin({ token: 'tok_secret_value', server: 'https://surfcad.test' }, env);
  const m = machine();
  const first = await bootstrapWake({ env, remote: true, greet: true, ...m.deps });
  assert.deepEqual(first.forms, []);
  assert.equal(first.source, null);
  assert.equal(first.coldWake, 'unavailable');
  assert.equal(first.listenerRunning, false);
  assert.equal(first.greeting, 'send_it_yourself');
  assert.equal(m.started, 0, 'a listener with no wake cannot start a turn, so it is not started');
  assert.equal(m.wakes.length, 0);
  const note = wakeReadinessNote(first, { remote: true });
  assert.match(note, /Idle wake: unavailable on this host/);
  assert.match(note, /Greet the user now/);
  assert.doesNotMatch(note, /ready/);
  const again = await bootstrapWake({ env, remote: true, greet: true, ...m.deps });
  assert.equal(again.greeting, 'already_sent');
  assert.equal(again.coldWake, 'unavailable');
});

test('brief test J: a listener that is running with no wake set does not make cold wake ready', async () => {
  const env = await tempEnv();
  await saveLogin({ token: 'tok_secret_value', server: 'https://surfcad.test' }, env);
  const m = machine({ listener: true });
  const state = await bootstrapWake({ env, remote: true, greet: false, ...m.deps });
  assert.equal(state.listenerRunning, true);
  assert.deepEqual(state.forms, []);
  assert.equal(state.coldWake, 'unavailable');
  assert.doesNotMatch(wakeReadinessNote(state, { remote: true }), /ready/);
});

test('a wake that does not fire is not called ready, and the greeting is tried again at the next pair', async () => {
  const env = await tempEnv({ SURFCAD_WAKE_POST: 'http://127.0.0.1:8644/wake' });
  await saveLogin({ token: 'tok_secret_value', server: 'https://surfcad.test' }, env);
  const m = machine({ wakeFails: true });
  const first = await bootstrapWake({ env, remote: true, greet: true, ...m.deps });
  assert.equal(first.greeting, 'wake_failed');
  assert.equal(first.coldWake, 'unavailable');
  assert.deepEqual(first.problems, ['The wake did not fire (wake_post_failed).']);
  assert.match(wakeReadinessNote(first, { remote: true }), /Greet the user yourself/);
  const second = await bootstrapWake({ env, remote: true, greet: true, ...m.deps });
  assert.equal(second.greeting, 'wake_failed', 'not marked as greeted');
  assert.equal(m.wakes.length, 2);
});

test('a status read reports and repairs the listener but never greets; autoListen false only reports', async () => {
  const env = await tempEnv({ SURFCAD_WAKE_EXEC: 'my-agent --wake' });
  await saveLogin({ token: 'tok_secret_value', server: 'https://surfcad.test' }, env);
  const quiet = machine();
  const off = await bootstrapWake({ env, remote: true, greet: false, autoListen: false, ...quiet.deps });
  assert.equal(off.coldWake, 'listener_stopped');
  assert.equal(off.greeting, 'already_sent');
  assert.equal(quiet.started, 0);
  assert.equal(quiet.wakes.length, 0);
  assert.match(wakeReadinessNote(off, { remote: true }), /the listener is not running/);
  const repaired = await bootstrapWake({ env, remote: true, greet: false, ...quiet.deps });
  assert.equal(repaired.listenerStarted, true);
  assert.equal(repaired.coldWake, 'ready');
  assert.equal(quiet.wakes.length, 0, 'status never wakes anyone');
  // The listener cannot start: say how to start it by hand.
  const broken = machine({ listenerFails: true });
  const failed = await bootstrapWake({ env, remote: true, greet: false, ...broken.deps });
  assert.equal(failed.coldWake, 'listener_stopped');
  assert.match(failed.problems.join(' '), /npx surfcad-mcp listen --detach/);
});

test('the local relay has no login and no listener: a wake is fired by the MCP process, and that is ready', async () => {
  const env = await tempEnv({ SURFCAD_WAKE_EXEC: 'my-agent --wake' });
  const m = machine();
  const state = await bootstrapWake({ env, remote: false, greet: true, ...m.deps });
  assert.equal(state.coldWake, 'ready');
  assert.equal(state.listenerRunning, false);
  assert.equal(m.started, 0);
  assert.equal(state.greeting, 'sent_by_wake');
  assert.match(wakeReadinessNote(state, { remote: false }), /This process fires it/);
});

test('a caller with nobody to tell (login, a server start) does not use up the greeting when there is no wake', async () => {
  const env = await tempEnv();
  await saveLogin({ token: 'tok_secret_value', server: 'https://surfcad.test' }, env);
  const m = machine();
  const start = await bootstrapWake({ env, remote: true, greet: true, selfGreet: false, ...m.deps });
  assert.equal(start.greeting, 'already_sent');
  // The pair that follows still tells the session to greet.
  const pair = await bootstrapWake({ env, remote: true, greet: true, ...m.deps });
  assert.equal(pair.greeting, 'send_it_yourself');
});

test('after login: a wake in the environment starts the listener; no wake says cold wake is unavailable; the switch turns it off', async () => {
  const { bootstrapAfterLogin } = await import('../src/listen/listenCli.mjs');
  const spawned = [];
  const spawnDouble = (cmd, args, opts) => {
    spawned.push({ args, detached: opts.detached });
    // A pid that is alive, so "running" holds for the check that follows.
    return { pid: process.pid, unref() {} };
  };
  const env = await tempEnv({ SURFCAD_WAKE_EXEC: 'my-agent --wake' });
  await login(env);
  const line = await bootstrapAfterLogin({ env, spawn: spawnDouble });
  assert.match(line, /^Idle wake: ready \(exec; listener started\)/);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].args[1], 'listen');
  assert.equal(spawned[0].detached, true);
  // Already running: reported, not started twice.
  assert.match(await bootstrapAfterLogin({ env, spawn: spawnDouble }), /listener running/);
  assert.equal(spawned.length, 1);

  const bare = await tempEnv();
  await login(bare);
  assert.match(await bootstrapAfterLogin({ env: bare, spawn: spawnDouble }), /^Idle wake: unavailable \(no wake is set\)/);
  assert.equal(spawned.length, 1, 'no wake, no listener');

  const off = await tempEnv({ SURFCAD_WAKE_EXEC: 'my-agent --wake', SURFCAD_WAKE_BOOTSTRAP: '0' });
  await login(off);
  assert.equal(await bootstrapAfterLogin({ env: off, spawn: spawnDouble }), '');
  assert.equal(spawned.length, 1);
});
