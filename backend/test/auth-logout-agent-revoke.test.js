/**
 * Signing out of the site revokes every agent token, the same path as a
 * password change or account deletion. A later agent HTTP call is 401,
 * an open agent socket closes with 4001, a held prompt is cleared, and
 * the tab receives presence reason revoked.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { WebSocket } from 'ws';
import User from '../db/models/User.js';
import LoginEvent from '../db/models/LoginEvent.js';
import authRoutes from '../routes/auth.js';
import { initializePassport } from '../auth/passport.js';
import { enforceCredentialRevocation } from '../auth/session.js';
import { installAgentRelay, attachAgentSockets } from '../agent/install.js';
import { AGENT_SOCKET_CLOSE_CODE } from '../agent/agentSockets.js';
import {
  AGENT_DISCONNECTED_TOAST_COPY,
  agentDisconnectToastCopy,
} from '../../src/agent/ws/pairingFlow.js';
import { installFakeModel, patch } from './helpers/fakeDb.js';

const ORIGIN = 'https://surfcad.com';
const PROMPT_ID = '33333333-3333-4333-8333-333333333333';

/** @type {import('node:http').Server | null} */
let server = null;
/** @type {number} */
let port = 0;
/** @type {(() => void)[]} */
const restores = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} cookie
 */
function browser(cookieHolder) {
  return function request(method, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? null : JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          origin: ORIGIN,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(cookieHolder.cookie ? { Cookie: cookieHolder.cookie } : {}),
          ...headers,
        },
      }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'];
          if (setCookie?.length) {
            cookieHolder.cookie = setCookie.map((part) => part.split(';')[0]).join('; ');
          }
          let parsed = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = { _raw: raw }; }
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };
}

/**
 * @param {string} url
 * @param {Record<string, string>} headers
 */
function openSocket(url, headers) {
  const ws = new WebSocket(url, { headers });
  const opened = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => {
      res.resume();
      reject(Object.assign(new Error('upgrade failed'), { statusCode: res.statusCode }));
    });
  });
  /** @type {object[]} */
  const messages = [];
  /** @type {Array<(msg: object) => void>} */
  const waiters = [];
  ws.on('message', (raw) => {
    /** @type {object} */
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else messages.push(msg);
  });
  return {
    ws,
    opened,
    nextMessage() {
      const queued = messages.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for a socket frame')), 3000);
        waiters.push((msg) => {
          clearTimeout(timer);
          resolve(msg);
        });
      });
    },
  };
}

/**
 * @param {ReturnType<typeof browser>} request
 */
async function redeemToken(request, label) {
  const created = await request('POST', '/agent/join');
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const redeemed = await fetch(`http://127.0.0.1:${port}/agent/join/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: created.body.code, name: label, machine: 'test' }),
  });
  const body = await redeemed.json();
  assert.equal(redeemed.status, 200, JSON.stringify(body));
  assert.equal(typeof body.token, 'string');
  return body.token;
}

before(async () => {
  const users = installFakeModel(User, { unique: ['email'] });
  restores.push(
    () => users.restore(),
    patch(LoginEvent, { create: async () => ({}) }),
  );
  initializePassport();
  const sessionMiddleware = session({
    secret: 'logout-agent-revoke-test',
    resave: false,
    saveUninitialized: false,
    name: 'surfcad.sid',
  });
  const app = express();
  app.use(express.json());
  app.use(sessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(enforceCredentialRevocation);
  installAgentRelay(app, { sessionMiddleware });
  app.use('/api/auth', authRoutes);
  server = http.createServer(app);
  attachAgentSockets(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;

  const inserted = await users.insert({
    email: 'pat@example.com',
    authProvider: 'local',
    emailVerified: true,
  });
  const user = await User.findById(inserted._id);
  await user.setPassword('password12');
  await user.save();
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  for (const restore of restores.reverse()) restore();
});

test('web sign-out revokes every agent token and tells the tab why', async () => {
  const jar = { cookie: '' };
  const request = browser(jar);
  const login = await request('POST', '/api/auth/login', {
    email: 'pat@example.com',
    password: 'password12',
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));

  const first = await redeemToken(request, 'laptop');
  const second = await redeemToken(request, 'phone');
  const url = `ws://127.0.0.1:${port}/agent`;

  const tab = openSocket(url, { origin: ORIGIN, cookie: jar.cookie });
  await tab.opened;
  assert.equal((await tab.nextMessage()).type, 'registered');

  const agent = openSocket(url, { authorization: `Bearer ${first}` });
  await agent.opened;
  agent.ws.send(JSON.stringify({ type: 'hello', v: 1 }));
  assert.equal((await agent.nextMessage()).type, 'hello');
  const up = await tab.nextMessage();
  assert.equal(up.type, 'agent');
  assert.equal(up.connected, true);

  const live = await fetch(`http://127.0.0.1:${port}/agent/prompts?timeout=0`, {
    headers: { authorization: `Bearer ${first}` },
  });
  assert.equal(live.status, 200);
  const otherLive = await fetch(`http://127.0.0.1:${port}/agent/prompts?timeout=0`, {
    headers: { authorization: `Bearer ${second}` },
  });
  assert.equal(otherLive.status, 200);

  const paused = new Promise((resolve) => agent.ws.once('close', resolve));
  agent.ws.close();
  await paused;
  await sleep(30);
  assert.equal(tab.ws.readyState, WebSocket.OPEN);

  tab.ws.send(JSON.stringify({
    type: 'agent.prompt', v: 1, id: PROMPT_ID, text: 'still here',
  }));
  await sleep(30);

  const lingering = openSocket(url, { authorization: `Bearer ${second}` });
  await lingering.opened;
  const revokedClose = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for the revoke close')), 3000);
    lingering.ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });

  const loggedOut = await request('POST', '/api/auth/logout');
  assert.equal(loggedOut.status, 200, JSON.stringify(loggedOut.body));

  const ack = await tab.nextMessage();
  assert.equal(ack.type, 'agent.prompt.ack');
  assert.equal(ack.id, PROMPT_ID);
  assert.equal(ack.delivery, 'failed');

  const down = await tab.nextMessage();
  assert.deepEqual(down, { type: 'agent', v: 1, connected: false, reason: 'revoked' });
  assert.equal(agentDisconnectToastCopy(down.reason, AGENT_DISCONNECTED_TOAST_COPY), 'Agent access revoked');

  const closed = await revokedClose;
  assert.equal(closed.code, AGENT_SOCKET_CLOSE_CODE);
  assert.equal(closed.reason, 'token revoked');

  const dead = await fetch(`http://127.0.0.1:${port}/agent/prompts?timeout=0`, {
    headers: { authorization: `Bearer ${first}` },
  });
  assert.equal(dead.status, 401);
  const otherDead = await fetch(`http://127.0.0.1:${port}/agent/prompts?timeout=0`, {
    headers: { authorization: `Bearer ${second}` },
  });
  assert.equal(otherDead.status, 401);

  const me = await request('GET', '/api/auth/me');
  assert.equal(me.body?.authenticated, false);
});
