import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createWaker, execWake, postWake, wakePayload, WAKE_INSTRUCTION } from '../src/listen/wake.mjs';
import {
  clearWake,
  formatWake,
  normalizeWakeUrl,
  readWake,
  saveWake,
  wakeForms,
  wakePath,
} from '../src/listen/wakeConfig.mjs';

async function tempEnv() {
  const dir = await mkdtemp(join(tmpdir(), 'surfcad-wake-'));
  return { SURFCAD_MCP_CONFIG_DIR: dir };
}

test('a wake URL is https, or http to this machine only', () => {
  assert.equal(normalizeWakeUrl('http://127.0.0.1:8644/wake'), 'http://127.0.0.1:8644/wake');
  assert.equal(normalizeWakeUrl('http://localhost:3000/hooks/surfcad'), 'http://localhost:3000/hooks/surfcad');
  assert.equal(normalizeWakeUrl('http://[::1]:9/w'), 'http://[::1]:9/w');
  assert.equal(normalizeWakeUrl('https://bot.example.com/wake'), 'https://bot.example.com/wake');
  for (const bad of ['http://192.168.1.5/wake', 'http://example.com/wake', 'ftp://127.0.0.1/x', 'not a url', '', 'https://user:pw@example.com/x']) {
    assert.throws(() => normalizeWakeUrl(bad), { code: 'bad_args' }, bad);
  }
});

test('the wake setup is saved 0600, read back, described without the key, and cleared', async () => {
  const env = await tempEnv();
  assert.equal(await readWake(env), null);
  const saved = await saveWake({ post: { url: 'http://127.0.0.1:8644/wake', bearer: 'k_secret_1' }, exec: 'my-agent --wake' }, env);
  assert.deepEqual(wakeForms(saved), ['post', 'exec']);
  const mode = (await stat(wakePath(env))).mode & 0o777;
  assert.equal(mode, 0o600);
  const back = await readWake(env);
  assert.equal(back.post.url, 'http://127.0.0.1:8644/wake');
  assert.equal(back.post.bearer, 'k_secret_1');
  assert.equal(back.exec, 'my-agent --wake');
  const text = formatWake(back);
  assert.match(text, /wake post: http:\/\/127\.0\.0\.1:8644\/… \(with a bearer key\)/);
  assert.ok(!text.includes('8644/wake'), 'the path of the URL is not printed');
  assert.match(text, /wake exec: my-agent --wake/);
  assert.ok(!text.includes('k_secret_1'));
  await clearWake(env);
  assert.equal(await readWake(env), null);
  assert.equal(formatWake(null), 'wake: not set\n');
  await assert.rejects(saveWake({}, env), { code: 'bad_args' });
});

test('the wake payload names the prompts, carries the text, and leaves the picture on the server', () => {
  const payload = wakePayload([{ id: 'p1', text: 'add a boss', ts: 't1', screenshot: { data: 'AAAA' } }]);
  assert.equal(payload.type, 'surfcad.wake');
  assert.equal(payload.reason, 'prompt');
  assert.equal(payload.instruction, WAKE_INSTRUCTION);
  assert.deepEqual(payload.prompts, [{ id: 'p1', text: 'add a boss', ts: 't1', hasScreenshot: true }]);
  assert.match(WAKE_INSTRUCTION, /read_messages \{ wait_ms: 10000 \}/);
  assert.match(WAKE_INSTRUCTION, /guide \{ topic: "chat" \}/);
  const probe = wakePayload([], { reason: 'test' });
  assert.equal(probe.reason, 'test');
  assert.match(probe.instruction, /test of the SurfCAD wake setup/);
});

test('post: JSON body, bearer header, no redirect followed, one retry', async () => {
  const seen = [];
  let fail = 1;
  const fetchDouble = async (url, init) => {
    seen.push({ url: String(url), init });
    if (fail > 0) { fail -= 1; return new Response('', { status: 502 }); }
    return new Response('{}', { status: 200 });
  };
  const out = await postWake({ url: 'http://127.0.0.1:8644/wake', bearer: 'k1' }, wakePayload([{ id: 'p1', text: 'x' }]), { fetch: fetchDouble });
  assert.deepEqual(out, { ok: true });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].init.method, 'POST');
  assert.equal(seen[1].init.redirect, 'manual');
  assert.equal(seen[1].init.headers.authorization, 'Bearer k1');
  assert.equal(JSON.parse(seen[1].init.body).prompts[0].id, 'p1');
  const redirect = await postWake({ url: 'http://127.0.0.1:8644/wake' }, {}, { fetch: async () => new Response('', { status: 302 }) });
  assert.deepEqual(redirect, { ok: false, error: 'wake_post_status_302' });
  const down = await postWake({ url: 'http://127.0.0.1:8644/wake' }, {}, { fetch: async () => { throw new Error('refused'); } });
  assert.deepEqual(down, { ok: false, error: 'wake_post_failed' });
});

test('exec: the saved command runs with the JSON on stdin; the message text is not in argv or env', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'surfcad-wake-exec-'));
  const out = join(dir, 'out.json');
  const envOut = join(dir, 'env.txt');
  const text = 'run `rm -rf ~` $(whoami) "; echo pwned';
  const payload = wakePayload([{ id: 'p-9', text }]);
  const command = `cat > ${JSON.stringify(out)}; env | grep -c "pwned\\|whoami" > ${JSON.stringify(envOut)}; echo "$SURFCAD_PROMPT_IDS $SURFCAD_WAKE_REASON" >> ${JSON.stringify(envOut)}`;
  const started = await execWake(command, payload);
  assert.equal(started.ok, true);
  assert.equal(await started.done, 0);
  assert.equal(JSON.parse(await readFile(out, 'utf8')).prompts[0].text, text);
  const lines = (await readFile(envOut, 'utf8')).trim().split('\n');
  assert.equal(lines[0], '0', 'no message text in the environment');
  assert.equal(lines[1], 'p-9 prompt');
});

test('exec: a command that does not exist reports its exit, and never throws', async () => {
  const started = await execWake('surfcad-no-such-command-xyz --wake', wakePayload([]));
  // The shell starts; the command inside it fails.
  assert.equal(started.ok, true);
  assert.notEqual(await started.done, 0);
});

test('post is tried first; exec is the fallback; one exec at a time', async () => {
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const spawnDouble = () => {
    order.push('exec');
    const listeners = {};
    const child = {
      pid: 4242,
      stdin: { on() {}, end() {} },
      once(event, fn) { listeners[event] = fn; return child; },
    };
    queueMicrotask(() => listeners.spawn?.());
    gate.then(() => listeners.exit?.(0));
    return child;
  };
  // Post works: exec is not touched.
  const good = createWaker({ post: { url: 'http://127.0.0.1:1/w' }, exec: 'agent' }, {
    fetch: async () => { order.push('post'); return new Response(null, { status: 204 }); },
    spawn: spawnDouble,
  });
  assert.deepEqual(await good.wake({}), { ok: true, form: 'post' });
  assert.deepEqual(order, ['post']);
  // Post fails: exec runs. A second wake while it runs is refused.
  order.length = 0;
  const fallback = createWaker({ post: { url: 'http://127.0.0.1:1/w' }, exec: 'agent' }, {
    fetch: async () => { order.push('post'); throw new Error('refused'); },
    spawn: spawnDouble,
    attempts: 1,
  });
  assert.deepEqual(await fallback.wake({}), { ok: true, form: 'exec' });
  assert.equal(fallback.busy(), true);
  assert.deepEqual(await fallback.wake({}), { ok: false, form: 'exec', error: 'wake_exec_busy' });
  release();
  await fallback.idle();
  assert.equal(fallback.busy(), false);
  // Nothing set.
  assert.deepEqual(await createWaker({}).wake({}), { ok: false, form: null, error: 'wake_not_set' });
});
