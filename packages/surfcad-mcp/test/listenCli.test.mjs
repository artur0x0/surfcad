/**
 * `surfcad-mcp wake …` and `surfcad-mcp listen …` through runCli.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseArgs, runCli } from '../src/cli.mjs';
import { listenerPidPath, readListenerPid } from '../src/listen/daemon.mjs';
import { WAKE_SETUP_STEPS, wakeSetupState } from '../src/listen/listenCli.mjs';
import { saveLogin } from '../src/remote/tokenStore.mjs';

async function tempEnv() {
  return { SURFCAD_MCP_CONFIG_DIR: await mkdtemp(join(tmpdir(), 'surfcad-listen-cli-')) };
}

function capture() {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    io: {
      stdout: (text) => { out.stdout += text; },
      stderr: (text) => { out.stderr += text; },
    },
  };
}

async function login(env) {
  await saveLogin({ token: 'tok_secret_value', server: 'https://surfcad.test', name: 'bot', machine: 'm' }, env);
}

test('parseArgs: wake and listen take their own flags and refuse the others', () => {
  const set = parseArgs(['wake', 'set', '--post', 'http://127.0.0.1:8644/w', '--bearer=k1', '--exec', 'my-agent --wake "now"']);
  assert.equal(set.command, 'wake');
  assert.equal(set.action, 'set');
  assert.equal(set.post, 'http://127.0.0.1:8644/w');
  assert.equal(set.bearer, 'k1');
  assert.equal(set.exec, 'my-agent --wake "now"');
  assert.equal(parseArgs(['wake', 'set', '--exec=--weird-binary x']).exec, '--weird-binary x');
  assert.equal(parseArgs(['wake']).action, '');
  assert.equal(parseArgs(['listen', '--detach']).detach, true);
  assert.equal(parseArgs(['listen', '--stop']).stop, true);
  assert.throws(() => parseArgs(['listen', '--detach', '--stop']), { code: 'bad_args' });
  assert.throws(() => parseArgs(['login', '--post', 'http://127.0.0.1/w']), { code: 'bad_args' });
  assert.throws(() => parseArgs(['status', '--detach']), { code: 'bad_args' });
  assert.throws(() => parseArgs(['wake', 'listen']), { code: 'bad_args' });
  assert.throws(() => parseArgs(['wake', 'set', '--post']), { code: 'bad_args' });
});

test('wake set saves both forms, show and status describe them without the key, clear removes them', async () => {
  const env = await tempEnv();
  const a = capture();
  let outcome = await runCli(['wake', 'set', '--post', 'http://127.0.0.1:8644/wake', '--bearer', 'k_secret_1', '--exec', 'my-agent --wake'], { env, io: a.io });
  assert.deepEqual(outcome, { action: 'exit', code: 0 });
  assert.match(a.out.stdout, /Wake saved on this machine/);
  assert.match(a.out.stdout, /wake post: http:\/\/127\.0\.0\.1:8644\/wake \(with a bearer key\)/);
  assert.match(a.out.stdout, /wake exec: my-agent --wake/);
  assert.match(a.out.stdout, /Next: npx surfcad-mcp wake test, then npx surfcad-mcp listen --detach/);
  assert.ok(!a.out.stdout.includes('k_secret_1'));
  assert.deepEqual(await wakeSetupState(env), { forms: ['post', 'exec'], listenerRunning: false });

  const b = capture();
  outcome = await runCli(['status'], { env, io: b.io });
  assert.equal(outcome.code, 0);
  assert.match(b.out.stdout, /not logged in/);
  assert.match(b.out.stdout, /wake post: http:\/\/127\.0\.0\.1:8644\/wake/);
  assert.match(b.out.stdout, /listener: not running/);
  assert.ok(!b.out.stdout.includes('k_secret_1'));

  const c = capture();
  outcome = await runCli(['wake', 'clear'], { env, io: c.io });
  assert.equal(outcome.code, 0);
  const d = capture();
  await runCli(['wake'], { env, io: d.io });
  assert.equal(d.out.stdout, 'wake: not set\n');
});

test('wake set refuses a URL that is not https or local, and a bare call', async () => {
  const env = await tempEnv();
  for (const args of [['wake', 'set'], ['wake', 'set', '--post', 'http://192.168.1.20/wake'], ['wake', 'set', '--bearer', 'k', '--exec', 'x']]) {
    const c = capture();
    const outcome = await runCli(args, { env, io: c.io });
    assert.equal(outcome.code, 1, args.join(' '));
    assert.ok(c.out.stderr.length > 0);
  }
  assert.deepEqual(await wakeSetupState(env), { forms: [], listenerRunning: false });
});

test('wake test fires the saved wake once with reason "test"', async () => {
  const env = await tempEnv();
  await runCli(['wake', 'set', '--post', 'http://127.0.0.1:8644/wake'], { env, io: capture().io });
  const seen = [];
  const ok = capture();
  let outcome = await runCli(['wake', 'test'], {
    env,
    io: ok.io,
    fetch: async (url, init) => { seen.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); },
  });
  assert.equal(outcome.code, 0);
  assert.match(ok.out.stdout, /Wake sent by post/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].body.reason, 'test');
  assert.deepEqual(seen[0].body.prompts, []);
  const bad = capture();
  outcome = await runCli(['wake', 'test'], { env, io: bad.io, fetch: async () => { throw new Error('refused'); } });
  assert.equal(outcome.code, 1);
  assert.match(bad.out.stderr, /Wake failed \(wake_post_failed\)/);
  // Nothing saved: say how to set it.
  const none = capture();
  outcome = await runCli(['wake', 'test'], { env: await tempEnv(), io: none.io });
  assert.equal(outcome.code, 1);
  assert.match(none.out.stderr, /No wake is set\. Run: npx surfcad-mcp wake set/);
});

test('listen needs a saved login and a saved wake', async () => {
  const env = await tempEnv();
  const a = capture();
  let outcome = await runCli(['listen'], { env, io: a.io });
  assert.equal(outcome.code, 1);
  assert.match(a.out.stderr, /No saved login\. Run npx surfcad-mcp login first/);
  await login(env);
  const b = capture();
  outcome = await runCli(['listen'], { env, io: b.io });
  assert.equal(outcome.code, 1);
  assert.match(b.out.stderr, /No wake is set/);
});

test('listen runs until stopped, holds the pid file while it runs, and wakes for an unread message', async () => {
  const env = await tempEnv();
  await login(env);
  await runCli(['wake', 'set', '--post', 'http://127.0.0.1:8644/wake'], { env, io: capture().io });
  const wakes = [];
  let offered = new Set();
  let pidWhileRunning = null;
  let stop = () => {};
  const fetchDouble = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/wake') {
      wakes.push(JSON.parse(init.body));
      pidWhileRunning = await readListenerPid(env);
      stop();
      return new Response('{}', { status: 200 });
    }
    assert.equal(url.origin, 'https://surfcad.test');
    assert.equal(url.pathname, '/agent/prompts');
    assert.equal(init.headers.Authorization, 'Bearer tok_secret_value');
    const session = url.searchParams.get('session');
    await new Promise((r) => setImmediate(r));
    if (offered.has(session)) return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    offered.add(session);
    return new Response(JSON.stringify({ messages: [{ type: 'agent.prompt', v: 1, id: 'p1', text: 'hi', ts: 't' }] }), { status: 200 });
  };
  const c = capture();
  const realNow = Date.now;
  // Past the grace at once: the loop reads Date.now().
  let skew = 0;
  Date.now = () => realNow() + skew;
  try {
    const running = runCli(['listen'], { env, io: c.io, fetch: fetchDouble, onSignals: (fn) => { stop = fn; } });
    await new Promise((r) => setTimeout(r, 30));
    skew = 10_000;
    const outcome = await running;
    assert.deepEqual(outcome, { action: 'exit', code: 0 });
  } finally {
    Date.now = realNow;
  }
  assert.equal(wakes.length, 1);
  assert.deepEqual(wakes[0].prompts.map((p) => p.id), ['p1']);
  assert.equal(pidWhileRunning, process.pid);
  assert.equal(await readListenerPid(env), null, 'the pid file is removed on exit');
  assert.match(c.out.stderr, /listening for SurfCAD chat messages at https:\/\/surfcad\.test/);
  assert.match(c.out.stderr, /woke the agent by post for 1 message/);
  assert.ok(!c.out.stderr.includes('tok_secret_value'));
});

test('listen --detach starts one background listener and says where its log is; a second start and --stop see it', async () => {
  const env = await tempEnv();
  await login(env);
  await runCli(['wake', 'set', '--exec', 'my-agent --wake'], { env, io: capture().io });
  const spawned = [];
  const spawnDouble = (cmd, args, opts) => {
    spawned.push({ cmd, args, detached: opts.detached });
    return { pid: 424242, unref() {} };
  };
  const a = capture();
  let outcome = await runCli(['listen', '--detach'], { env, io: a.io, spawn: spawnDouble });
  assert.equal(outcome.code, 0);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].cmd, process.execPath);
  assert.match(spawned[0].args[0], /bin\/surfcad-mcp\.js$/);
  assert.equal(spawned[0].args[1], 'listen');
  assert.equal(spawned[0].detached, true);
  assert.match(a.out.stdout, /Listener started \(pid 424242\)\. Wake: exec\. Log: .*listener\.log/);
  // A live listener (this process stands in for it): no second copy.
  await writeFile(listenerPidPath(env), `${process.pid}\n`);
  const b = capture();
  outcome = await runCli(['listen', '--detach'], { env, io: b.io, spawn: spawnDouble });
  assert.equal(outcome.code, 0);
  assert.equal(spawned.length, 1);
  assert.match(b.out.stdout, /already running/);
  assert.deepEqual(await wakeSetupState(env), { forms: ['exec'], listenerRunning: true });
  const s = capture();
  await runCli(['status'], { env, io: s.io });
  assert.match(s.out.stdout, /listener: running \(pid \d+, log /);
  // A pid file left by a dead listener is cleaned up.
  await writeFile(listenerPidPath(env), '999999999\n');
  assert.equal(await readListenerPid(env), null);
  await assert.rejects(readFile(listenerPidPath(env), 'utf8'), { code: 'ENOENT' });
  const none = capture();
  outcome = await runCli(['listen', '--stop'], { env, io: none.io });
  assert.equal(outcome.code, 0);
  assert.match(none.out.stdout, /No listener is running/);
});

test('the install steps name login, wake set with both forms, wake test and listen --detach, in that order', () => {
  assert.equal(WAKE_SETUP_STEPS.length, 4);
  assert.match(WAKE_SETUP_STEPS[0], /^npx surfcad-mcp login/);
  assert.match(WAKE_SETUP_STEPS[1], /^npx surfcad-mcp wake set --post .* --exec /);
  assert.match(WAKE_SETUP_STEPS[2], /^npx surfcad-mcp wake test/);
  assert.match(WAKE_SETUP_STEPS[3], /^npx surfcad-mcp listen --detach/);
});
