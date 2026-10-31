import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, test } from 'node:test';
import express from 'express';
import { commandResponse } from '../../packages/surfcad-mcp/src/commandProtocol.mjs';
import { createManualClock } from '../agent/clock.js';
import { createAgentRelay } from '../agent/createRelay.js';
import { logRelay } from '../agent/log.js';
import { MAX_AGENT_MESSAGE_BYTES, TAB_ASLEEP_MS } from '../agent/limits.js';

/** @type {import('node:http').Server | null} */
let server = null;

afterEach(async () => {
  if (!server) return;
  const closing = server;
  server = null;
  closing.closeAllConnections?.();
  await new Promise((resolve) => closing.close(resolve));
});

/**
 * @param {ReturnType<typeof createAgentRelay>} relay
 */
async function listen(relay) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => {
    const id = req.header('x-test-user');
    req.isAuthenticated = () => Boolean(id);
    if (id) req.user = { id };
    next();
  });
  app.use('/agent', relay.router);
  app.use((err, _, res, next) => {
    res.status(500).json({ error: 'internal', message: err.message });
  });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

/**
 * @param {number} port
 * @param {string} path
 * @param {{
 *   method?: string,
 *   body?: unknown,
 *   raw?: string,
 *   user?: string,
 *   token?: string,
 *   ip?: string,
 *   accept?: string,
 *   contentType?: string,
 * }} [opts]
 */
async function send(port, path, opts = {}) {
  const headers = {};
  let payload;
  if (opts.raw != null) {
    payload = opts.raw;
    headers['content-type'] = opts.contentType || 'application/x-www-form-urlencoded';
  } else if (opts.body !== undefined) {
    payload = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
  }
  if (payload != null) headers['content-length'] = String(Buffer.byteLength(payload));
  if (opts.accept) headers.accept = opts.accept;
  if (opts.user) headers['x-test-user'] = opts.user;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: payload,
  });
  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

describe('agent relay HTTP', () => {
  test('approval ignores a client-supplied city and does not return the token', async () => {
    const relay = createAgentRelay({ clock: createManualClock(1_700_000_000_000) });
    const port = await listen(relay);
    const started = await send(port, '/agent/pair', {
      method: 'POST',
      ip: '203.0.113.10',
      body: { name: 'Cursor', machine: 'laptop', city: 'Berlin' },
    });
    assert.equal(started.status, 201);
    assert.match(started.body.userCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const claim = await send(port, '/agent/pair/claim', {
      method: 'POST',
      user: 'user-a',
      ip: '203.0.113.11',
      accept: 'application/json',
      body: { userCode: started.body.userCode },
    });
    assert.equal(claim.status, 200);
    assert.equal(claim.body.sentence, 'Allow Cursor on laptop to connect?');
    assert.equal(claim.body.city, null);
    assert.equal(String(claim.body.sentence).includes(','), false);
    assert.equal(String(claim.body.sentence).includes('Berlin'), false);

    const approved = await send(port, '/agent/pair/approve', {
      method: 'POST',
      user: 'user-a',
      ip: '203.0.113.11',
      accept: 'application/json',
      body: { userCode: started.body.userCode },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.ok, true);
    assert.equal(approved.body.token, undefined);
    assert.equal(JSON.stringify(approved.body).includes(started.body.deviceSecret), false);

    const again = await send(port, '/agent/pair/approve', {
      method: 'POST',
      user: 'user-a',
      ip: '203.0.113.12',
      accept: 'application/json',
      body: { userCode: started.body.userCode },
    });
    assert.equal(again.status, 400);
    assert.equal(again.body.error, 'already_used');

    const polled = await send(port, '/agent/pair/poll', {
      method: 'POST',
      ip: '203.0.113.10',
      body: { deviceSecret: started.body.deviceSecret },
    });
    assert.equal(polled.body.status, 'approved');
    const token = polled.body.token;
    const second = await send(port, '/agent/pair/poll', {
      method: 'POST',
      ip: '203.0.113.10',
      body: { deviceSecret: started.body.deviceSecret },
    });
    assert.equal(second.body.status, 'consumed');
    assert.equal(second.body.token, undefined);

    const listed = await send(port, '/agent/tokens', { user: 'user-a' });
    assert.equal(listed.body.tokens.length, 1);
    assert.equal(listed.body.tokens[0].label, 'Cursor on laptop');
    assert.equal(JSON.stringify(listed.body).includes(token), false);
    assert.equal(JSON.stringify(listed.body).includes('tokenHash'), false);
    const hidden = await send(port, '/agent/tokens', { user: 'user-b' });
    assert.deepEqual(hidden.body.tokens, []);
    const stolen = await send(port, `/agent/tokens/${listed.body.tokens[0].id}`, {
      method: 'DELETE',
      user: 'user-b',
    });
    assert.equal(stolen.status, 404);
    const revoked = await send(port, `/agent/tokens/${listed.body.tokens[0].id}`, {
      method: 'DELETE',
      user: 'user-a',
    });
    assert.equal(revoked.status, 200);
    const after = await send(port, '/agent/commands', {
      method: 'POST',
      token,
      body: { v: 1, id: 'c1', command: 'status', args: {} },
    });
    assert.equal(after.status, 401);
  });

  test('the HTML page shows the approval sentence with the name escaped', async () => {
    const relay = createAgentRelay();
    const port = await listen(relay);
    const anonymous = await send(port, '/agent');
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.text, /Sign in to SurfCAD to approve an agent/);
    const started = await send(port, '/agent/pair', {
      method: 'POST',
      body: { name: '<Cursor>', machine: 'laptop' },
    });
    const page = await send(port, '/agent/pair/claim', {
      method: 'POST',
      user: 'user-a',
      raw: `userCode=${encodeURIComponent(started.body.userCode)}`,
    });
    assert.equal(page.status, 200);
    assert.match(page.text, /<p>Allow &lt;Cursor&gt; on laptop to connect\?<\/p>/);
    assert.equal(page.text.includes('<Cursor>'), false);
    assert.equal(page.text.includes(' in '), false);
  });

  test('old clients are told to update, and an oversized command is not forwarded', async () => {
    const lines = [];
    const original = console.info;
    console.info = (...args) => {
      lines.push(args.map(String).join(' '));
    };
    try {
      const relay = createAgentRelay({ commandLimit: 2 });
      const seen = [];
      relay.registry.registerTab({
        userId: 'user-a',
        tabId: 'tab-a',
        send: (frame) => seen.push(frame),
      });
      const port = await listen(relay);
      const issued = await relay.tokens.issue({ userId: 'user-a', label: 'Cursor on laptop' });
      const old = await send(port, '/agent/commands', {
        method: 'POST',
        token: issued.token,
        body: { id: 'c0', command: 'status', args: {} },
      });
      assert.equal(old.status, 400);
      assert.equal(old.body.error, 'please update surfcad-mcp');
      const newer = await send(port, '/agent/commands', {
        method: 'POST',
        token: issued.token,
        body: { v: 2, id: 'c2', command: 'status', args: {} },
      });
      assert.equal(newer.status, 400);
      assert.match(newer.body.error, /Unsupported protocol version: 2/);
      const huge = await send(port, '/agent/commands', {
        method: 'POST',
        token: issued.token,
        body: {
          v: 1,
          id: 'big',
          command: 'status',
          args: { blob: 'x'.repeat(MAX_AGENT_MESSAGE_BYTES) },
        },
      });
      assert.equal(huge.status, 413);
      assert.equal(seen.length, 0);

      const ok = await send(port, '/agent/commands', {
        method: 'POST',
        token: issued.token,
        body: { v: 1, id: 'c1', command: 'list_faces', args: { secret: 'payload-secret' } },
      });
      assert.equal(ok.status, 202);
      assert.equal(seen.length, 1);
      assert.equal(seen[0].command, 'list_faces');
      const logged = lines.filter((line) => line.includes('[agent-relay]')).join('\n');
      assert.match(logged, /list_faces/);
      assert.equal(logged.includes('payload-secret'), false);
      assert.equal(logged.includes(issued.token), false);
    } finally {
      console.info = original;
    }
  });

  test('long-poll and SSE return the tab result, and another user cannot read it', async () => {
    const relay = createAgentRelay();
    let pendingFrame = null;
    relay.registry.registerTab({
      userId: 'user-a',
      tabId: 'tab-a',
      send: (frame) => {
        pendingFrame = frame;
      },
    });
    const port = await listen(relay);
    const mine = await relay.tokens.issue({ userId: 'user-a', label: 'mine' });
    const other = await relay.tokens.issue({ userId: 'user-b', label: 'other' });
    const posted = await send(port, '/agent/commands', {
      method: 'POST',
      token: mine.token,
      body: { v: 1, id: 'c1', command: 'status', args: {} },
    });
    assert.equal(posted.status, 202);
    const waiting = await send(port, '/agent/commands/c1?timeout=0', { token: mine.token });
    assert.equal(waiting.body.status, 'pending');
    const stolen = await send(port, '/agent/commands/c1?timeout=0', { token: other.token });
    assert.equal(stolen.status, 404);
    relay.registry.complete('user-a', pendingFrame.id, commandResponse({
      id: pendingFrame.id,
      ok: true,
      result: { faces: 4 },
    }));
    const done = await send(port, '/agent/commands/c1', { token: mine.token });
    assert.equal(done.body.status, 'done');
    assert.equal(done.body.response.result.faces, 4);

    relay.registry.registerTab({
      userId: 'user-a',
      tabId: 'tab-sse',
      send(frame) {
        relay.registry.complete('user-a', frame.id, commandResponse({
          id: frame.id,
          ok: true,
          result: { via: 'sse' },
        }));
      },
    });
    await send(port, '/agent/commands', {
      method: 'POST',
      token: mine.token,
      body: { v: 1, id: 's1', command: 'status', args: {} },
    });
    const sse = await send(port, '/agent/commands/s1/events', { token: mine.token });
    assert.match(sse.text, /event: result/);
    assert.match(sse.text, /"via":"sse"/);
  });

  test('a command for a user with no tab sleeps, and is not delivered to someone else', async () => {
    const clock = createManualClock(10_000);
    const relay = createAgentRelay({ clock, asleepMs: TAB_ASLEEP_MS });
    const other = [];
    relay.registry.registerTab({
      userId: 'user-b',
      tabId: 'tab-b',
      send: (frame) => other.push(frame),
    });
    const port = await listen(relay);
    const issued = await relay.tokens.issue({ userId: 'user-a', label: 'Cursor on laptop' });
    const posted = await send(port, '/agent/commands', {
      method: 'POST',
      token: issued.token,
      body: { v: 1, id: 'sleep', command: 'status', args: { secret: 'payload-secret' } },
    });
    assert.equal(posted.status, 202);
    assert.equal(other.length, 0);
    clock.advance(TAB_ASLEEP_MS);
    const result = await send(port, '/agent/commands/sleep?timeout=0', { token: issued.token });
    assert.equal(result.body.status, 'done');
    assert.equal(result.body.response.error.message, 'SurfCAD tab is asleep');
    assert.equal(relay.registry.debugPayloads().includes('payload-secret'), false);
    assert.equal(other.length, 0);
  });

  test('tabs can be listed and selected', async () => {
    const clock = createManualClock(10_000);
    const relay = createAgentRelay({ clock });
    const first = [];
    const second = [];
    relay.registry.registerTab({ userId: 'user-a', tabId: 't1', send: (frame) => first.push(frame) });
    clock.advance(5);
    relay.registry.registerTab({ userId: 'user-a', tabId: 't2', send: (frame) => second.push(frame) });
    const port = await listen(relay);
    const listed = await send(port, '/agent/tabs', { user: 'user-a' });
    assert.deepEqual(listed.body.tabs.map((tab) => tab.id), ['t2', 't1']);
    const picked = await send(port, '/agent/tabs/select', {
      method: 'POST',
      user: 'user-a',
      body: { tabId: 't1' },
    });
    assert.equal(picked.status, 200);
    assert.equal(picked.body.tabs.find((tab) => tab.id === 't1').selected, true);
    const issued = await relay.tokens.issue({ userId: 'user-a', label: 'Cursor on laptop' });
    await send(port, '/agent/commands', {
      method: 'POST',
      token: issued.token,
      body: { v: 1, id: 'c1', command: 'status', args: {} },
    });
    assert.equal(first.length, 1);
    assert.equal(second.length, 0);
    const foreign = await send(port, '/agent/tabs', { user: 'user-b' });
    assert.deepEqual(foreign.body.tabs, []);
  });

  test('metadata log drops payload fields', () => {
    const lines = [];
    const original = console.info;
    console.info = (...args) => lines.push(args.map(String).join(' '));
    try {
      logRelay({
        event: 'command',
        userId: 'user-a',
        command: 'status',
        bytes: 12,
        args: { secret: 'payload-secret' },
        token: 'raw-token',
      });
      const line = lines.join('\n');
      assert.match(line, /"event":"command"/);
      assert.equal(line.includes('payload-secret'), false);
      assert.equal(line.includes('raw-token'), false);
    } finally {
      console.info = original;
    }
  });
});
