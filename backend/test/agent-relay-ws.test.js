import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, test } from 'node:test';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { WebSocket } from 'ws';
import {
  AGENT_SOCKET_CLOSE_CODE,
  TOO_MANY_CONNECTIONS_CODE,
  TOO_MANY_CONNECTIONS_REASON,
} from '../agent/agentSockets.js';
import { createManualClock } from '../agent/clock.js';
import { createAgentRelay } from '../agent/createRelay.js';
import { authenticateBrowserUpgrade } from '../agent/browserAuth.js';
import { attachAgentWebSocket } from '../agent/wsServer.js';
import { revokeRelayUser } from '../agent/install.js';
import { TAB_SESSION_ENDED_CODE, TAB_SESSION_ENDED_REASON } from '../agent/tabSockets.js';
import { hashToken } from '../agent/tokens.js';

/** @type {import('node:http').Server[]} */
const servers = [];

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

/**
 * @param {ReturnType<typeof createAgentRelay>} relay
 * @param {(req: import('node:http').IncomingMessage) => Promise<{ id: string } | null>} authenticateUpgrade
 */
async function listen(relay, authenticateUpgrade) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header('x-test-user');
    req.isAuthenticated = () => Boolean(id);
    if (id) req.user = { id };
    next();
  });
  app.use('/agent', relay.router);
  const server = http.createServer(app);
  attachAgentWebSocket(server, relay, { authenticateUpgrade });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

/**
 * Messages are queued from construction so a frame sent with the handshake
 * is not lost between `open` and the test's listener.
 * @param {string} url
 * @param {Record<string, string>} headers
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Group timestamped events into one heartbeat tick. Lookups in a tick run
 * together; the next tick is a full interval later.
 * @param {{ at: number }[]} events
 * @param {number} gapMs
 */
function bursts(events, gapMs) {
  /** @type {typeof events[]} */
  const groups = [];
  for (const event of events) {
    const last = groups.at(-1);
    if (!last || event.at - last.at(-1).at > gapMs) groups.push([event]);
    else last.push(event);
  }
  return groups;
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {string} label
 */
function closeEvent(ws, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 2000);
    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

function openSocket(url, headers) {
  const ws = new WebSocket(url, { headers });
  /** @type {object[]} */
  const queue = [];
  /** @type {((msg: object) => void) | null} */
  let waiter = null;
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(msg);
      return;
    }
    queue.push(msg);
  });
  let settled = false;
  const opened = new Promise((resolve, reject) => {
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    ws.on('error', (error) => fail(error));
    ws.on('open', () => {
      if (settled) return;
      settled = true;
      resolve(ws);
    });
    ws.on('unexpected-response', (_req, res) => {
      res.resume();
      fail(Object.assign(new Error(`HTTP ${res.statusCode}`), { statusCode: res.statusCode }));
    });
  });
  return {
    ws,
    opened,
    nextMessage() {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for a socket message')), 2000);
        waiter = (msg) => {
          clearTimeout(timer);
          resolve(msg);
        };
      });
    },
  };
}

describe('agent relay websocket', () => {
  test('rejects a browser socket with a foreign or missing Origin', async () => {
    const relay = createAgentRelay();
    const port = await listen(relay, async (req) => {
      const id = req.headers['x-test-user'];
      return typeof id === 'string' ? { id } : null;
    });
    const url = `ws://127.0.0.1:${port}/agent`;
    await assert.rejects(
      openSocket(url, { origin: 'https://evil.example', 'x-test-user': 'user-a' }).opened,
      (error) => error.statusCode === 403,
    );
    await assert.rejects(
      openSocket(url, { 'x-test-user': 'user-a' }).opened,
      (error) => error.statusCode === 403,
    );
    assert.equal(relay.registry.listTabs('user-a').length, 0);

    const tab = openSocket(url, {
      origin: 'https://surfcad.com',
      'x-test-user': 'user-a',
    });
    await tab.opened;
    const registered = await tab.nextMessage();
    assert.equal(registered.type, 'registered');
    assert.equal(registered.v, 1);
    assert.equal(relay.registry.listTabs('user-a').length, 1);
    const dev = openSocket(url, {
      origin: 'http://localhost:5173',
      'x-test-user': 'user-a',
    });
    await dev.opened;
    assert.equal((await dev.nextMessage()).type, 'registered');
    tab.ws.close();
    dev.ws.close();
  });

  test('an agent handshake rejects an old client and a bad token', async () => {
    const relay = createAgentRelay({ maxMessageBytes: 1024 });
    const tabMessages = [];
    relay.registry.registerTab({
      userId: 'user-a',
      tabId: 'tab-a',
      send: (frame) => tabMessages.push(frame),
    });
    const port = await listen(relay, async () => null);
    const url = `ws://127.0.0.1:${port}/agent`;
    await assert.rejects(
      openSocket(url, { authorization: 'Bearer not-a-real-token', origin: 'https://evil.example' }).opened,
      (error) => error.statusCode === 401,
    );

    const issued = await relay.tokens.issue({ userId: 'user-a', label: 'Cursor on laptop' });
    const old = openSocket(url, {
      authorization: `Bearer ${issued.token}`,
      origin: 'https://evil.example',
    });
    await old.opened;
    const failed = old.nextMessage();
    old.ws.send(JSON.stringify({ type: 'hello' }));
    assert.equal((await failed).error, 'please update surfcad-mcp');

    const agent = openSocket(url, {
      authorization: `Bearer ${issued.token}`,
      origin: 'https://evil.example',
    });
    await agent.opened;
    const hello = agent.nextMessage();
    agent.ws.send(JSON.stringify({ type: 'hello', v: 1 }));
    assert.equal((await hello).type, 'hello');
    const reply = agent.nextMessage();
    agent.ws.send(JSON.stringify({ v: 1, id: 'c1', command: 'list_faces', args: { secret: 'payload-secret' } }));
    const started = Date.now();
    while (!tabMessages.some((frame) => frame.command === 'list_faces')) {
      if (Date.now() - started > 2000) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const commands = tabMessages.filter((frame) => frame.command);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].args.secret, 'payload-secret');
    relay.registry.complete('user-a', 'c1', {
      v: 1,
      id: 'c1',
      ok: true,
      result: { faces: 1 },
    });
    const result = await reply;
    assert.equal(result.ok, true);
    assert.equal(result.result.faces, 1);

    const huge = Buffer.alloc(relay.maxMessageBytes + 32, 0x61);
    agent.ws.send(huge);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(tabMessages.filter((frame) => frame.command).length, 1);
    agent.ws.close();
    old.ws.close();
  });

  test('revoking a token closes its live socket and a further command is rejected', async () => {
    const relay = createAgentRelay();
    const port = await listen(relay, async () => null);
    const issued = await relay.tokens.issue({ userId: 'user-a', label: 'Cursor on laptop' });
    const url = `ws://127.0.0.1:${port}/agent`;
    const agent = openSocket(url, { authorization: `Bearer ${issued.token}` });
    await agent.opened;
    const hello = agent.nextMessage();
    agent.ws.send(JSON.stringify({ type: 'hello', v: 1 }));
    assert.equal((await hello).type, 'hello');

    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for the socket to close')), 2000);
      agent.ws.once('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
    const revoked = await fetch(`http://127.0.0.1:${port}/agent/tokens/${issued.id}`, {
      method: 'DELETE',
      headers: { 'x-test-user': 'user-a' },
    });
    assert.equal(revoked.status, 200);
    const event = await closed;
    assert.equal(event.code, AGENT_SOCKET_CLOSE_CODE);
    assert.equal(event.reason, 'token revoked');
    assert.equal(agent.ws.readyState, WebSocket.CLOSED);

    const later = [];
    agent.ws.on('message', (data) => later.push(JSON.parse(data.toString())));
    try {
      agent.ws.send(JSON.stringify({ v: 1, id: 'after', command: 'status', args: {} }));
    } catch {
      later.push({ ok: false, error: { message: 'socket closed' } });
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(later.some((msg) => msg.ok === true), false);

    await assert.rejects(
      openSocket(url, { authorization: `Bearer ${issued.token}` }).opened,
      (error) => error.statusCode === 401,
    );
    const command = await fetch(`http://127.0.0.1:${port}/agent/commands`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${issued.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ v: 1, id: 'c-after', command: 'status', args: {} }),
    });
    assert.equal(command.status, 401);
  });

  test('an open socket rejects the next command when the token is revoked or expired', async () => {
    const clock = createManualClock(1_000_000);
    const relay = createAgentRelay({ clock, tokenTtlMs: 60_000 });
    const port = await listen(relay, async () => null);
    const url = `ws://127.0.0.1:${port}/agent`;

    const revoked = await relay.tokens.issue({ userId: 'user-a', label: 'Cursor on laptop' });
    const agent = openSocket(url, { authorization: `Bearer ${revoked.token}` });
    await agent.opened;
    const hello = agent.nextMessage();
    agent.ws.send(JSON.stringify({ type: 'hello', v: 1 }));
    assert.equal((await hello).type, 'hello');
    assert.equal(await relay.tokens.revoke('user-a', revoked.id), true);
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for the revoked socket to close')), 2000);
      agent.ws.once('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
    const failed = agent.nextMessage();
    agent.ws.send(JSON.stringify({ v: 1, id: 'c-revoked', command: 'status', args: {} }));
    const msg = await failed;
    assert.equal(msg.ok, false);
    assert.equal(msg.id, 'c-revoked');
    assert.equal(msg.error.code, 'unauthorized');
    assert.equal(msg.error.message, 'Token revoked');
    const event = await closed;
    assert.equal(event.code, AGENT_SOCKET_CLOSE_CODE);
    assert.equal(event.reason, 'token revoked');
    assert.equal(relay.registry.pendingCount(revoked.id), 0);

    const expiring = await relay.tokens.issue({ userId: 'user-a', label: 'Cursor on desk' });
    const aged = openSocket(url, { authorization: `Bearer ${expiring.token}` });
    await aged.opened;
    const agedHello = aged.nextMessage();
    aged.ws.send(JSON.stringify({ type: 'hello', v: 1 }));
    assert.equal((await agedHello).type, 'hello');
    clock.advance(60_000);
    const expiredClose = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for the expired socket to close')), 2000);
      aged.ws.once('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
    const expiredMsg = aged.nextMessage();
    aged.ws.send(JSON.stringify({ v: 1, id: 'c-expired', command: 'status', args: {} }));
    const expired = await expiredMsg;
    assert.equal(expired.ok, false);
    assert.equal(expired.id, 'c-expired');
    assert.equal(expired.error.message, 'Token expired');
    const expiredEvent = await expiredClose;
    assert.equal(expiredEvent.code, AGENT_SOCKET_CLOSE_CODE);
    assert.equal(expiredEvent.reason, 'token expired');
  });

  test('a browser tab registers with the session cookie', async () => {
    passport.serializeUser((user, done) => done(null, user.id));
    passport.deserializeUser((id, done) => done(null, { id }));
    const sessionMiddleware = session({
      secret: 'agent-relay-session-test',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, sameSite: 'lax' },
    });
    const app = express();
    app.use(express.json());
    app.use(sessionMiddleware);
    app.use(passport.initialize());
    app.use(passport.session());
    app.post('/login', (req, res, next) => {
      req.login({ id: 'user-a' }, (err) => (err ? next(err) : res.json({ ok: true })));
    });
    const relay = createAgentRelay();
    const server = http.createServer(app);
    attachAgentWebSocket(server, relay, {
      authenticateUpgrade: (req) => authenticateBrowserUpgrade(req, sessionMiddleware),
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    const login = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/login',
        method: 'POST',
        agent: false,
        headers: { 'content-type': 'application/json', 'content-length': '2', connection: 'close' },
      }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.headers['set-cookie']));
      });
      req.on('error', reject);
      req.end('{}');
    });
    const cookie = String(Array.isArray(login) ? login[0] : login).split(';')[0];
    const url = `ws://127.0.0.1:${port}/agent`;
    await assert.rejects(
      openSocket(url, { origin: 'https://www.surfcad.com' }).opened,
      (error) => error.statusCode === 401,
    );
    const tab = openSocket(url, { origin: 'https://www.surfcad.com', cookie });
    await tab.opened;
    const registered = await tab.nextMessage();
    assert.equal(registered.type, 'registered');
    assert.deepEqual(relay.registry.listTabs('user-a').map((item) => item.id), [registered.tabId]);
    tab.ws.close();
  });

  test('DELETE /agent/tokens/self closes that token and leaves another open', async () => {
    const relay = createAgentRelay();
    const port = await listen(relay, async () => null);
    const first = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const second = await relay.tokens.issue({ userId: 'user-a', label: 'phone' });
    const url = `ws://127.0.0.1:${port}/agent`;
    const agent = openSocket(url, { authorization: `Bearer ${first.token}` });
    const other = openSocket(url, { authorization: `Bearer ${second.token}` });
    await agent.opened;
    await other.opened;
    agent.ws.send(JSON.stringify({ type: 'hello', v: 1 }));
    other.ws.send(JSON.stringify({ type: 'hello', v: 1 }));
    assert.equal((await agent.nextMessage()).type, 'hello');
    assert.equal((await other.nextMessage()).type, 'hello');
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for self-revoke close')), 2000);
      agent.ws.once('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
    const revoked = await fetch(`http://127.0.0.1:${port}/agent/tokens/self`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${first.token}` },
    });
    assert.equal(revoked.status, 200);
    const event = await closed;
    assert.equal(event.code, AGENT_SOCKET_CLOSE_CODE);
    assert.equal(event.reason, 'token revoked');
    assert.equal(other.ws.readyState, WebSocket.OPEN);
    other.ws.close();
  });

  test('a further agent or tab past the per-user cap is closed', async () => {
    const relay = createAgentRelay({ maxAgents: 1, maxTabs: 1 });
    const port = await listen(relay, async () => ({ id: 'user-a' }));
    const first = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const second = await relay.tokens.issue({ userId: 'user-a', label: 'phone' });
    const url = `ws://127.0.0.1:${port}/agent`;
    const agent = openSocket(url, { authorization: `Bearer ${first.token}` });
    await agent.opened;
    const extra = openSocket(url, { authorization: `Bearer ${second.token}` });
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for the agent cap')), 2000);
      extra.ws.once('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
    await extra.opened;
    const closedEvent = await closed;
    assert.equal(closedEvent.code, TOO_MANY_CONNECTIONS_CODE);
    assert.equal(closedEvent.reason, TOO_MANY_CONNECTIONS_REASON);
    assert.equal(agent.ws.readyState, WebSocket.OPEN);

    const tab = openSocket(url, { origin: 'https://surfcad.com' });
    await tab.opened;
    assert.equal((await tab.nextMessage()).type, 'registered');
    const extraTab = openSocket(url, { origin: 'https://surfcad.com' });
    const tabClosed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for the tab cap')), 2000);
      extraTab.ws.once('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
    await extraTab.opened;
    assert.equal((await tabClosed).code, TOO_MANY_CONNECTIONS_CODE);
    agent.ws.close();
    tab.ws.close();
  });

  test('an idle expired token is closed by the ping sweep', async () => {
    const clock = createManualClock(1_000_000);
    const relay = createAgentRelay({ clock, tokenTtlMs: 1000, pingIntervalMs: 100 });
    const port = await listen(relay, async () => null);
    const issued = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const agent = openSocket(`ws://127.0.0.1:${port}/agent`, {
      authorization: `Bearer ${issued.token}`,
    });
    await agent.opened;
    agent.ws.send(JSON.stringify({ type: 'hello', v: 1 }));
    assert.equal((await agent.nextMessage()).type, 'hello');
    clock.advance(1000);
    const event = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for the idle expiry close')), 2000);
      agent.ws.once('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
    assert.equal(event.code, AGENT_SOCKET_CLOSE_CODE);
    assert.equal(event.reason, 'token expired');
  });

  test('a tab socket closes when the session check fails on the heartbeat', async () => {
    let signedIn = true;
    const relay = createAgentRelay({ pingIntervalMs: 40 });
    const port = await listen(relay, async (req) => {
      if (!signedIn) return null;
      const id = req.headers['x-test-user'];
      return typeof id === 'string' ? { id } : null;
    });
    const tab = openSocket(`ws://127.0.0.1:${port}/agent`, {
      origin: 'https://surfcad.com',
      'x-test-user': 'user-a',
    });
    await tab.opened;
    assert.equal((await tab.nextMessage()).type, 'registered');
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for the session close')), 2000);
      tab.ws.once('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
    signedIn = false;
    const event = await closed;
    assert.equal(event.code, TAB_SESSION_ENDED_CODE);
    assert.equal(event.reason, TAB_SESSION_ENDED_REASON);
  });

  test('closing one account\'s tabs leaves another account and its agent token', async () => {
    const relay = createAgentRelay({ pingIntervalMs: 60_000 });
    const port = await listen(relay, async (req) => {
      const id = req.headers['x-test-user'];
      return typeof id === 'string' ? { id } : null;
    });
    const url = `ws://127.0.0.1:${port}/agent`;
    const tab = openSocket(url, { origin: 'https://surfcad.com', 'x-test-user': 'user-a' });
    const other = openSocket(url, { origin: 'https://surfcad.com', 'x-test-user': 'user-b' });
    await tab.opened;
    await other.opened;
    assert.equal((await tab.nextMessage()).type, 'registered');
    assert.equal((await other.nextMessage()).type, 'registered');
    const issued = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for the tab close')), 2000);
      tab.ws.once('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
    assert.equal(relay.tabSockets.closeUser('user-a'), 1);
    const event = await closed;
    assert.equal(event.code, TAB_SESSION_ENDED_CODE);
    assert.equal(other.ws.readyState, WebSocket.OPEN);
    assert.equal((await relay.tokens.authenticate(issued.token)).userId, 'user-a');
    other.ws.close();
  });

  test('revokeRelayUser closes that account\'s agent sockets with 4001', async () => {
    const relay = createAgentRelay();
    const port = await listen(relay, async () => null);
    const first = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const second = await relay.tokens.issue({ userId: 'user-b', label: 'other' });
    const url = `ws://127.0.0.1:${port}/agent`;
    const agent = openSocket(url, { authorization: `Bearer ${first.token}` });
    const other = openSocket(url, { authorization: `Bearer ${second.token}` });
    await agent.opened;
    await other.opened;
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for the revoke close')), 2000);
      agent.ws.once('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
    const ids = await revokeRelayUser(relay, 'user-a');
    assert.deepEqual(ids, [first.id]);
    const event = await closed;
    assert.equal(event.code, AGENT_SOCKET_CLOSE_CODE);
    assert.equal(event.reason, 'token revoked');
    assert.equal(other.ws.readyState, WebSocket.OPEN);
    other.ws.close();
  });

  test('a session-store error on the heartbeat closes the tab socket', async () => {
    let boom = false;
    const relay = createAgentRelay({ pingIntervalMs: 40 });
    const port = await listen(relay, async (req) => {
      if (boom) throw new Error('session store down');
      const id = req.headers['x-test-user'];
      return typeof id === 'string' ? { id } : null;
    });
    const tab = openSocket(`ws://127.0.0.1:${port}/agent`, {
      origin: 'https://surfcad.com',
      'x-test-user': 'user-a',
    });
    await tab.opened;
    assert.equal((await tab.nextMessage()).type, 'registered');
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for the session-store close')), 2000);
      tab.ws.once('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
    boom = true;
    const event = await closed;
    assert.equal(event.code, 1011);
    assert.equal(event.reason, 'internal');
  });

  test('a token-store error on the heartbeat closes the agent socket', async () => {
    const relay = createAgentRelay({ pingIntervalMs: 40 });
    const port = await listen(relay, async () => null);
    const issued = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const agent = openSocket(`ws://127.0.0.1:${port}/agent`, {
      authorization: `Bearer ${issued.token}`,
    });
    await agent.opened;
    agent.ws.send(JSON.stringify({ type: 'hello', v: 1 }));
    assert.equal((await agent.nextMessage()).type, 'hello');
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for the token-store close')), 2000);
      agent.ws.once('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
    relay.tokens.status = async () => {
      throw new Error('token store down');
    };
    const event = await closed;
    assert.equal(event.code, 1011);
    assert.equal(event.reason, 'internal');
  });

  test('one heartbeat looks up a shared tab session once', async () => {
    /** @type {{ id: string, at: number }[]} */
    const probes = [];
    let counting = false;
    const relay = createAgentRelay({ pingIntervalMs: 80 });
    const port = await listen(relay, async (req) => {
      const id = req.headers['x-test-user'];
      if (counting && typeof id === 'string') probes.push({ id, at: Date.now() });
      return typeof id === 'string' ? { id } : null;
    });
    const url = `ws://127.0.0.1:${port}/agent`;
    const shared = { origin: 'https://surfcad.com', 'x-test-user': 'user-a', cookie: 'sid=same' };
    const tabs = [
      openSocket(url, shared),
      openSocket(url, shared),
      openSocket(url, { origin: 'https://surfcad.com', 'x-test-user': 'user-b', cookie: 'sid=other' }),
    ];
    for (const tab of tabs) {
      await tab.opened;
      assert.equal((await tab.nextMessage()).type, 'registered');
    }
    counting = true;
    await sleep(700);
    const groups = bursts(probes, 40);
    assert.ok(groups.length >= 4, `expected several ticks, saw ${groups.length}`);
    for (const group of groups.slice(1, -1)) {
      const ids = group.map((probe) => probe.id).sort();
      assert.deepEqual(ids, ['user-a', 'user-b']);
    }
    for (const tab of tabs) tab.ws.close();
  });

  test('one heartbeat looks up a shared agent token once', async () => {
    const relay = createAgentRelay({ pingIntervalMs: 80 });
    const port = await listen(relay, async () => null);
    const shared = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const other = await relay.tokens.issue({ userId: 'user-a', label: 'phone' });
    const url = `ws://127.0.0.1:${port}/agent`;
    const sockets = [
      openSocket(url, { authorization: `Bearer ${shared.token}` }),
      openSocket(url, { authorization: `Bearer ${shared.token}` }),
      openSocket(url, { authorization: `Bearer ${other.token}` }),
    ];
    for (const agent of sockets) await agent.opened;
    /** @type {{ hash: string, at: number }[]} */
    const calls = [];
    let counting = false;
    const real = relay.tokens.status.bind(relay.tokens);
    relay.tokens.status = async (hash) => {
      if (counting) calls.push({ hash, at: Date.now() });
      return real(hash);
    };
    counting = true;
    await sleep(700);
    const groups = bursts(calls, 40);
    assert.ok(groups.length >= 4, `expected several ticks, saw ${groups.length}`);
    const hashes = new Set([hashToken(shared.token), hashToken(other.token)]);
    for (const group of groups.slice(1, -1)) {
      assert.equal(group.length, 2);
      assert.deepEqual(new Set(group.map((call) => call.hash)), hashes);
    }
    for (const agent of sockets) agent.ws.close();
  });

  test('a session-store error closes every tab that shared the lookup', async () => {
    let armed = false;
    let sharedProbes = 0;
    const relay = createAgentRelay({ pingIntervalMs: 200 });
    const port = await listen(relay, async (req) => {
      if (armed && req.headers.cookie === 'sid=same') sharedProbes += 1;
      if (armed && req.headers.cookie === 'sid=same') throw new Error('session store down');
      const id = req.headers['x-test-user'];
      return typeof id === 'string' ? { id } : null;
    });
    const url = `ws://127.0.0.1:${port}/agent`;
    const headers = { origin: 'https://surfcad.com', 'x-test-user': 'user-a', cookie: 'sid=same' };
    const first = openSocket(url, headers);
    const second = openSocket(url, headers);
    const other = openSocket(url, {
      origin: 'https://surfcad.com',
      'x-test-user': 'user-b',
      cookie: 'sid=other',
    });
    await first.opened;
    await second.opened;
    await other.opened;
    assert.equal((await first.nextMessage()).type, 'registered');
    assert.equal((await second.nextMessage()).type, 'registered');
    assert.equal((await other.nextMessage()).type, 'registered');
    const closed = Promise.all([
      closeEvent(first.ws, 'the first shared tab'),
      closeEvent(second.ws, 'the second shared tab'),
    ]);
    armed = true;
    const events = await closed;
    assert.equal(events[0].code, 1011);
    assert.equal(events[1].code, 1011);
    assert.equal(events[0].reason, 'internal');
    assert.equal(sharedProbes, 1);
    assert.equal(other.ws.readyState, WebSocket.OPEN);
    other.ws.close();
  });

  test('a token-store error closes every socket that shared that token', async () => {
    const relay = createAgentRelay({ pingIntervalMs: 200 });
    const port = await listen(relay, async () => null);
    const shared = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const otherIssued = await relay.tokens.issue({ userId: 'user-a', label: 'phone' });
    const sharedHash = hashToken(shared.token);
    const url = `ws://127.0.0.1:${port}/agent`;
    const first = openSocket(url, { authorization: `Bearer ${shared.token}` });
    const second = openSocket(url, { authorization: `Bearer ${shared.token}` });
    const other = openSocket(url, { authorization: `Bearer ${otherIssued.token}` });
    await first.opened;
    await second.opened;
    await other.opened;
    let lookups = 0;
    let armed = false;
    const real = relay.tokens.status.bind(relay.tokens);
    relay.tokens.status = async (hash) => {
      if (!armed) return real(hash);
      lookups += 1;
      if (hash === sharedHash) throw new Error('token store down');
      return real(hash);
    };
    const closed = Promise.all([
      closeEvent(first.ws, 'the first shared agent'),
      closeEvent(second.ws, 'the second shared agent'),
    ]);
    armed = true;
    const events = await closed;
    assert.equal(events[0].code, 1011);
    assert.equal(events[1].code, 1011);
    assert.equal(events[0].reason, 'internal');
    assert.equal(lookups, 2);
    assert.equal(other.ws.readyState, WebSocket.OPEN);
    other.ws.close();
  });

  test('revoking a token closes every socket for it on the next heartbeat', async () => {
    const relay = createAgentRelay({ pingIntervalMs: 80 });
    const port = await listen(relay, async () => null);
    const shared = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const otherIssued = await relay.tokens.issue({ userId: 'user-b', label: 'other' });
    const url = `ws://127.0.0.1:${port}/agent`;
    const first = openSocket(url, { authorization: `Bearer ${shared.token}` });
    const second = openSocket(url, { authorization: `Bearer ${shared.token}` });
    const other = openSocket(url, { authorization: `Bearer ${otherIssued.token}` });
    await first.opened;
    await second.opened;
    await other.opened;
    const closed = Promise.all([
      closeEvent(first.ws, 'the first revoked agent'),
      closeEvent(second.ws, 'the second revoked agent'),
    ]);
    assert.equal(await relay.tokens.revoke('user-a', shared.id), true);
    const events = await closed;
    assert.equal(events[0].code, AGENT_SOCKET_CLOSE_CODE);
    assert.equal(events[1].code, AGENT_SOCKET_CLOSE_CODE);
    assert.equal(events[0].reason, 'token revoked');
    assert.equal(events[1].reason, 'token revoked');
    assert.equal(other.ws.readyState, WebSocket.OPEN);
    other.ws.close();
  });

  test('websocket upgrades are rate limited per client IP', async () => {
    const relay = createAgentRelay({ connectLimit: 1 });
    const port = await listen(relay, async () => null);
    const issued = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const url = `ws://127.0.0.1:${port}/agent`;
    const agent = openSocket(url, { authorization: `Bearer ${issued.token}` });
    await agent.opened;
    await assert.rejects(
      openSocket(url, { authorization: `Bearer ${issued.token}` }).opened,
      (error) => error.statusCode === 429,
    );
    agent.ws.close();
  });
});
