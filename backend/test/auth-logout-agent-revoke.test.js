/**
 * Signing out revokes only the agent tokens that browser session approved.
 * Another session's agent stays up. A password change still revokes both.
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
import { installAgentRelay, attachAgentSockets, mountedAgentRelay } from '../agent/install.js';
import { AGENT_SOCKET_CLOSE_CODE } from '../agent/agentSockets.js';
import {
  AGENT_DISCONNECTED_TOAST_COPY,
  agentDisconnectToastCopy,
} from '../../src/agent/ws/pairingFlow.js';
import { installFakeModel, patch } from './helpers/fakeDb.js';

const ORIGIN = 'https://surfcad.com';

/** @type {import('node:http').Server | null} */
let server = null;
/** @type {string} */
let userId = '';
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
  userId = String(inserted._id);
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

/**
 * @param {ReturnType<typeof browser>} request
 */
async function login(request) {
  const result = await request('POST', '/api/auth/login', {
    email: 'pat@example.com',
    password: 'password12',
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
}

/**
 * @param {string} cookie
 */
async function openTab(cookie) {
  const tab = openSocket(`ws://127.0.0.1:${port}/agent`, { origin: ORIGIN, cookie });
  await tab.opened;
  assert.equal((await tab.nextMessage()).type, 'registered');
  return tab;
}

/**
 * @param {string} token
 */
async function helloAgent(token) {
  const agent = openSocket(`ws://127.0.0.1:${port}/agent`, { authorization: `Bearer ${token}` });
  await agent.opened;
  agent.ws.send(JSON.stringify({ type: 'hello', v: 1 }));
  assert.equal((await agent.nextMessage()).type, 'hello');
  return agent;
}

/**
 * @param {string} token
 */
async function promptStatus(token) {
  const res = await fetch(`http://127.0.0.1:${port}/agent/prompts?timeout=0`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return res.status;
}

test('sign-out revokes only that browser, and a password change still revokes both', async () => {
  const iphone = { cookie: '' };
  const desktop = { cookie: '' };
  const phoneRequest = browser(iphone);
  const deskRequest = browser(desktop);
  await login(phoneRequest);
  await login(deskRequest);

  const phoneToken = await redeemToken(phoneRequest, 'iphone');
  const deskToken = await redeemToken(deskRequest, 'desktop');
  const phoneTab = await openTab(iphone.cookie);
  const deskTab = await openTab(desktop.cookie);
  const phoneAgent = await helloAgent(phoneToken);
  const phoneUp = await phoneTab.nextMessage();
  const deskUp = await deskTab.nextMessage();
  assert.equal(phoneUp.connected, true);
  assert.equal(deskUp.connected, true);
  const deskAgent = await helloAgent(deskToken);
  const relay = mountedAgentRelay();
  assert.ok(relay);
  const legacy = await relay.tokens.issue({ userId, label: 'legacy' });
  const legacyAgent = await helloAgent(legacy.token);
  assert.equal(await promptStatus(phoneToken), 200);
  assert.equal(await promptStatus(deskToken), 200);
  assert.equal(await promptStatus(legacy.token), 200);

  let deskAgentClosed = false;
  let legacyAgentClosed = false;
  deskAgent.ws.once('close', () => { deskAgentClosed = true; });
  legacyAgent.ws.once('close', () => { legacyAgentClosed = true; });
  const phoneAgentClosed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for the iphone agent to close')), 3000);
    phoneAgent.ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
  const phoneTabClosed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for the iphone tab to close')), 3000);
    phoneTab.ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });

  const loggedOut = await phoneRequest('POST', '/api/auth/logout');
  assert.equal(loggedOut.status, 200, JSON.stringify(loggedOut.body));

  const down = await deskTab.nextMessage();
  assert.deepEqual(down, { type: 'agent', v: 1, connected: false, reason: 'revoked' });
  assert.equal(agentDisconnectToastCopy(down.reason, AGENT_DISCONNECTED_TOAST_COPY), 'Agent access revoked');
  const back = await deskTab.nextMessage();
  assert.deepEqual(back, { type: 'agent', v: 1, connected: true });

  const closed = await phoneAgentClosed;
  assert.equal(closed.code, AGENT_SOCKET_CLOSE_CODE);
  assert.equal(closed.reason, 'token revoked');
  await sleep(40);
  assert.equal(deskAgentClosed, false);
  assert.equal(legacyAgentClosed, false);
  assert.equal(deskAgent.ws.readyState, WebSocket.OPEN);
  assert.equal(legacyAgent.ws.readyState, WebSocket.OPEN);
  assert.equal(deskTab.ws.readyState, WebSocket.OPEN);
  const phoneTabEnd = await phoneTabClosed;
  assert.equal(phoneTabEnd.code, 1000);
  assert.equal(phoneTabEnd.reason, 'session ended');

  assert.equal(await promptStatus(phoneToken), 401);
  assert.equal(await promptStatus(deskToken), 200);
  assert.equal(await promptStatus(legacy.token), 200);
  const me = await phoneRequest('GET', '/api/auth/me');
  assert.equal(me.body?.authenticated, false);
  const deskMe = await deskRequest('GET', '/api/auth/me');
  assert.equal(deskMe.body?.authenticated, true);

  const againPhone = { cookie: '' };
  const againDesk = { cookie: '' };
  const againPhoneRequest = browser(againPhone);
  const againDeskRequest = browser(againDesk);
  await login(againPhoneRequest);
  await login(againDeskRequest);
  const secondPhone = await redeemToken(againPhoneRequest, 'iphone-2');
  const secondDesk = await redeemToken(againDeskRequest, 'desktop-2');
  const watch = await openTab(againDesk.cookie);
  const secondPhoneAgent = await helloAgent(secondPhone);
  const secondDeskAgent = await helloAgent(secondDesk);
  const phoneClose = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for both agents to close')), 3000);
    let pending = 2;
    const onClose = (code, reason) => {
      pending -= 1;
      if (pending > 0) return;
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    };
    secondPhoneAgent.ws.once('close', onClose);
    secondDeskAgent.ws.once('close', onClose);
  });
  const changed = await againDeskRequest('POST', '/api/auth/change-password', {
    currentPassword: 'password12',
    newPassword: 'password123',
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  const revoked = await watch.nextMessage();
  assert.deepEqual(revoked, { type: 'agent', v: 1, connected: false, reason: 'revoked' });
  assert.equal(agentDisconnectToastCopy(revoked.reason, AGENT_DISCONNECTED_TOAST_COPY), 'Agent access revoked');
  const extra = await Promise.race([
    watch.nextMessage(),
    sleep(80).then(() => null),
  ]);
  assert.equal(extra, null);
  const both = await phoneClose;
  assert.equal(both.code, AGENT_SOCKET_CLOSE_CODE);
  assert.equal(both.reason, 'token revoked');
  assert.equal(await promptStatus(secondPhone), 401);
  assert.equal(await promptStatus(secondDesk), 401);
  assert.equal(await promptStatus(deskToken), 401);
  assert.equal(await promptStatus(legacy.token), 401);
  assert.notEqual(legacyAgent.ws.readyState, WebSocket.OPEN);
});
