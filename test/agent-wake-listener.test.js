/**
 * `surfcad-mcp listen` against the real relay router.
 *
 * The listener watches GET /agent/prompts with a pull session. What it
 * relies on is server behaviour, so it is pinned here, on the server:
 *   - its polls keep the agent present, so a tab prompt is held, not failed;
 *   - watching never takes a prompt: it stays held for the agent's process;
 *   - a prompt an agent process takes inside the grace is not woken for;
 *   - a fresh pull session is offered what is still held (the "did anyone
 *     read it" probe).
 *
 * This file is in test/, not backend/test/: deploy.sh be-deploy walks every
 * import under backend/ (tests included) and refuses to deploy when one
 * leaves backend/ for a file that is not on its BE_SHARED list. A test in
 * backend/ that imports the listener would put four MCP package files on
 * the prod server's must-ship list. backend/test/external-imports.test.js
 * pins that.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';
import { createAgentRelay } from '../backend/agent/createRelay.js';
import { runListener } from '../packages/surfcad-mcp/src/listen/listener.mjs';

// express is the backend's dependency, not the root's.
const express = createRequire(new URL('../backend/package.json', import.meta.url))('express');

/** @type {import('node:http').Server | null} */
let server = null;

afterEach(async () => {
  if (!server) return;
  const closing = server;
  server = null;
  closing.closeAllConnections?.();
  await new Promise((resolve) => closing.close(resolve));
});

async function listen(relay) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = () => false;
    next();
  });
  app.use('/agent', relay.router);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function until(check, label, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail(`timed out waiting for: ${label}`);
}

function startListener(port, token, extra = {}) {
  const wakes = [];
  const logs = [];
  const ac = new AbortController();
  const done = runListener({
    serverUrl: `http://127.0.0.1:${port}`,
    token,
    wake: { post: { url: 'http://127.0.0.1:9/unused' } },
    log: (line) => logs.push(line),
    graceMs: 80,
    pollMs: 150,
    rewakeMs: 60_000,
    backoffMs: [20],
    waker: {
      wake: async (payload) => { wakes.push(payload); return { ok: true, form: 'post' }; },
      idle: async () => {},
      busy: () => false,
    },
    signal: ac.signal,
    ...extra,
  });
  return { wakes, logs, done, stop: async () => { ac.abort(); return done; } };
}

test('a prompt sent while only the listener is up is held, wakes the agent, and is still there for it to read', async () => {
  const relay = createAgentRelay();
  const port = await listen(relay);
  const issued = await relay.tokens.issue({ userId: 'user-a', label: 'listener' });
  const listener = startListener(port, issued.token);
  try {
    // The listener's polls are what make the agent present.
    await until(() => relay.registry.agentConnected('user-a') === true, 'presence from the first poll');
    let expired = false;
    const outcome = relay.registry.deliverPrompt('user-a', { type: 'agent.prompt', v: 1, id: 'p1', text: 'make the boss taller' }, { onExpire() { expired = true; } });
    // No agent socket took it, and it was not dropped: it waits for the agent.
    assert.equal(outcome.held, true);
    assert.equal(outcome.present, true);
    assert.equal(outcome.delivered, 0);
    await until(() => listener.wakes.length === 1, 'the wake');
    assert.deepEqual(listener.wakes[0].prompts.map((p) => p.id), ['p1']);
    assert.equal(listener.wakes[0].prompts[0].text, 'make the boss taller');
    assert.equal(expired, false);
    // Watching and probing took nothing. The woken agent's own process reads it.
    assert.deepEqual(relay.registry.heldPromptIds('user-a'), ['p1']);
    const res = await fetch(`http://127.0.0.1:${port}/agent/prompts?timeout=0&session=agentprocess0001`, {
      headers: { Authorization: `Bearer ${issued.token}` },
    });
    assert.deepEqual((await res.json()).messages.map((m) => m.id), ['p1']);
  } finally {
    assert.deepEqual(await listener.stop(), { reason: 'stopped' });
  }
});

test('a prompt an agent process takes inside the grace is not woken for', async () => {
  const relay = createAgentRelay();
  const port = await listen(relay);
  const issued = await relay.tokens.issue({ userId: 'user-a', label: 'listener' });
  const listener = startListener(port, issued.token, { graceMs: 300 });
  try {
    await until(() => relay.registry.agentConnected('user-a') === true, 'presence from the first poll');
    relay.registry.deliverPrompt('user-a', { type: 'agent.prompt', v: 1, id: 'p2', text: 'hi' }, {});
    await until(() => listener.logs.some((line) => /message p2 is waiting/.test(line)), 'the listener saw it');
    // The agent is in a turn and polling: its process reads the prompt and reports it taken.
    const taken = await fetch(`http://127.0.0.1:${port}/agent/prompts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'agent.prompt.taken', v: 1, ids: ['p2'] }),
    });
    assert.equal(taken.status, 202);
    await until(() => listener.logs.some((line) => /message p2 was read/.test(line)), 'the listener saw it was read');
    assert.equal(listener.wakes.length, 0);
  } finally {
    await listener.stop();
  }
});

test('a revoked login stops the listener with the reason', async () => {
  const relay = createAgentRelay();
  const port = await listen(relay);
  const listener = startListener(port, 'not-a-real-token');
  const out = await listener.done;
  assert.ok(out.reason === 'unauthorized' || out.reason === 'token_revoked' || out.reason === 'expired', out.reason);
  assert.ok(listener.logs.some((line) => /npx surfcad-mcp login/.test(line)));
});
