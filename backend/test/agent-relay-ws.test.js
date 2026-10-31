import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, test } from 'node:test';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { WebSocket } from 'ws';
import { createAgentRelay } from '../agent/createRelay.js';
import { authenticateBrowserUpgrade } from '../agent/browserAuth.js';
import { attachAgentWebSocket } from '../agent/wsServer.js';

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
    while (tabMessages.length < 1) {
      if (Date.now() - started > 2000) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(tabMessages.length, 1);
    assert.equal(tabMessages[0].args.secret, 'payload-secret');
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
    assert.equal(tabMessages.length, 1);
    agent.ws.close();
    old.ws.close();
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
});
