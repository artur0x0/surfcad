import assert from 'node:assert/strict';
import test from 'node:test';
import { runListener, promptFromFrame } from '../src/listen/listener.mjs';

/**
 * A relay double with the pull semantics of backend/agent/registry.js:
 * a held prompt is offered to each pull session once and stays held until
 * it is taken.
 */
function fakeRelay() {
  /** @type {Array<{ frame: object, offered: Set<string> }>} */
  let held = [];
  const calls = [];
  let status = 200;
  let errorBody = null;
  let failNext = 0;
  return {
    calls,
    send(id, text = 'hello') { held.push({ frame: { type: 'agent.prompt', v: 1, id, text, ts: '2026-11-06T12:00:00Z' }, offered: new Set() }); },
    take(id) { held = held.filter((row) => row.frame.id !== id); },
    revoke(error = 'token_revoked') { status = 401; errorBody = { error }; },
    failNext(n) { failNext = n; },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ session: url.searchParams.get('session'), timeout: Number(url.searchParams.get('timeout')), auth: init?.headers?.Authorization });
      if (failNext > 0) { failNext -= 1; throw new Error('network'); }
      if (status === 401) return new Response(JSON.stringify(errorBody), { status: 401 });
      const session = url.searchParams.get('session');
      const messages = [];
      for (const row of held) {
        if (row.offered.has(session)) continue;
        row.offered.add(session);
        messages.push(row.frame);
      }
      // A real long-poll waits; the double yields so the loop is not a spin.
      if (!messages.length) await new Promise((r) => setImmediate(r));
      return new Response(JSON.stringify({ messages }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
}

function harness(relay, extra = {}) {
  const wakes = [];
  const logs = [];
  const ac = new AbortController();
  let clock = 0;
  const waker = extra.waker || {
    wake: async (payload) => { wakes.push(payload); return { ok: true, form: 'post' }; },
    idle: async () => {},
    busy: () => false,
  };
  const done = runListener({
    serverUrl: 'https://surfcad.test',
    token: 'tok_secret_value',
    wake: { post: { url: 'http://127.0.0.1:9/wake' } },
    fetch: relay.fetch,
    log: (line) => logs.push(line),
    graceMs: 4000,
    pollMs: 25000,
    rewakeMs: 120000,
    backoffMs: [0],
    waker,
    now: () => clock,
    sleep: async () => {},
    signal: ac.signal,
    ...extra.options,
  });
  return {
    wakes, logs, done,
    stop: async () => { ac.abort(); return done; },
    advance: (ms) => { clock += ms; },
    /** Let the loop turn a few times. */
    settle: async (turns = 30) => { for (let i = 0; i < turns; i += 1) await new Promise((r) => setImmediate(r)); },
  };
}

test('promptFromFrame takes a prompt frame and nothing else', () => {
  assert.deepEqual(promptFromFrame({ type: 'agent.prompt', id: 'p1', text: 'hi', ts: 't', screenshot: { data: 'x' } }), { id: 'p1', text: 'hi', ts: 't', screenshot: true });
  assert.equal(promptFromFrame({ type: 'agent.prompt.cancel', id: 'p1' }), null);
  assert.equal(promptFromFrame({ type: 'agent.prompt' }), null);
  assert.equal(promptFromFrame(null), null);
});

test('an unread message wakes the agent once the grace has passed, and not before', async () => {
  const relay = fakeRelay();
  const h = harness(relay);
  relay.send('p1', 'make the hole bigger');
  await h.settle();
  assert.equal(h.wakes.length, 0, 'no wake inside the grace');
  h.advance(4000);
  await h.settle();
  assert.equal(h.wakes.length, 1);
  assert.equal(h.wakes[0].type, 'surfcad.wake');
  assert.deepEqual(h.wakes[0].prompts.map((p) => p.id), ['p1']);
  assert.equal(h.wakes[0].prompts[0].text, 'make the hole bigger');
  // Watching never takes the message: it is still held for the agent.
  const fresh = await relay.fetch('https://surfcad.test/agent/prompts?timeout=0&session=agentprocess1', {});
  assert.deepEqual((await fresh.json()).messages.map((m) => m.id), ['p1']);
  await h.stop();
});

test('a message an agent reads inside the grace does not wake anyone', async () => {
  const relay = fakeRelay();
  const h = harness(relay);
  relay.send('p1');
  await h.settle();
  relay.take('p1');
  h.advance(4000);
  await h.settle();
  assert.equal(h.wakes.length, 0);
  assert.ok(h.logs.some((line) => /p1 was read/.test(line)), h.logs.join('\n'));
  await h.stop();
});

test('two messages inside one grace are one wake', async () => {
  const relay = fakeRelay();
  const h = harness(relay);
  relay.send('p1');
  relay.send('p2');
  await h.settle();
  h.advance(4000);
  await h.settle();
  assert.equal(h.wakes.length, 1);
  assert.deepEqual(h.wakes[0].prompts.map((p) => p.id).sort(), ['p1', 'p2']);
  await h.stop();
});

test('a woken message that stays unread is woken for once more, then left alone', async () => {
  const relay = fakeRelay();
  const h = harness(relay);
  relay.send('p1');
  await h.settle();
  h.advance(4000);
  await h.settle();
  assert.equal(h.wakes.length, 1);
  h.advance(60000);
  await h.settle();
  assert.equal(h.wakes.length, 1, 'not before the re-wake time');
  h.advance(60000);
  await h.settle();
  assert.equal(h.wakes.length, 2);
  h.advance(120000);
  await h.settle();
  assert.equal(h.wakes.length, 2, 'two wakes is the limit');
  await h.stop();
});

test('while the wake command of an earlier message still runs, no second copy starts', async () => {
  const relay = fakeRelay();
  let busy = true;
  const wakes = [];
  const waker = {
    wake: async (payload) => {
      if (busy) return { ok: false, form: 'exec', error: 'wake_exec_busy' };
      wakes.push(payload);
      return { ok: true, form: 'exec' };
    },
    idle: async () => {},
    busy: () => busy,
  };
  const h = harness(relay, { waker });
  relay.send('p1');
  await h.settle();
  h.advance(4000);
  await h.settle();
  assert.equal(wakes.length, 0);
  busy = false;
  h.advance(15000);
  await h.settle();
  assert.equal(wakes.length, 1);
  await h.stop();
});

test('every poll carries the bearer and a pull session; the token is never logged', async () => {
  const relay = fakeRelay();
  const h = harness(relay);
  relay.send('p1');
  await h.settle();
  h.advance(4000);
  await h.settle();
  await h.stop();
  assert.ok(relay.calls.length >= 2);
  for (const call of relay.calls) {
    assert.equal(call.auth, 'Bearer tok_secret_value');
    assert.match(call.session, /^[a-f0-9]{32}$/);
  }
  // The watch session and the probe session differ.
  assert.ok(new Set(relay.calls.map((c) => c.session)).size >= 2);
  assert.ok(!h.logs.join('\n').includes('tok_secret_value'));
});

test('a revoked or expired login ends the listener with the reason', async () => {
  for (const error of ['token_revoked', 'expired']) {
    const relay = fakeRelay();
    relay.revoke(error);
    const h = harness(relay);
    const out = await h.done;
    assert.equal(out.reason, error);
    assert.ok(h.logs.some((line) => /npx surfcad-mcp login/.test(line)));
  }
});

test('a network failure is retried and the message still wakes the agent', async () => {
  const relay = fakeRelay();
  relay.failNext(3);
  const h = harness(relay);
  relay.send('p1');
  await h.settle(60);
  h.advance(4000);
  await h.settle(60);
  assert.equal(h.wakes.length, 1);
  assert.ok(h.logs.some((line) => /cannot reach/.test(line)));
  await h.stop();
});

test('an agent in a turn is not woken; the message wakes it once it has gone idle unread', async () => {
  const relay = fakeRelay();
  let awake = true;
  const h = harness(relay, { options: { isAwake: () => awake } });
  relay.send('p1');
  await h.settle();
  h.advance(4000);
  await h.settle();
  assert.equal(h.wakes.length, 0);
  assert.ok(h.logs.some((line) => /p1 is unread but the agent is in a turn/.test(line)), h.logs.join('\n'));
  h.advance(15000);
  await h.settle();
  assert.equal(h.wakes.length, 0, 'still in a turn');
  assert.equal(h.logs.filter((line) => /in a turn/.test(line)).length, 1, 'said once');
  awake = false;
  h.advance(15000);
  await h.settle();
  assert.equal(h.wakes.length, 1);
  await h.stop();
});

test('an agent in a turn that reads the message is never woken', async () => {
  const relay = fakeRelay();
  const h = harness(relay, { options: { isAwake: () => true } });
  relay.send('p1');
  await h.settle();
  h.advance(4000);
  await h.settle();
  relay.take('p1');
  h.advance(15000);
  await h.settle();
  assert.equal(h.wakes.length, 0);
  assert.ok(h.logs.some((line) => /p1 was read/.test(line)));
  await h.stop();
});
