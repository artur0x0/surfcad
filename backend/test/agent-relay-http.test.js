import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { afterEach, describe, test } from 'node:test';
import express from 'express';
import { commandResponse } from '../../packages/surfcad-mcp/src/commandProtocol.mjs';
import { createManualClock } from '../agent/clock.js';
import { createAgentRelay } from '../agent/createRelay.js';
import { revokeRelayUser } from '../agent/install.js';
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
  /** @type {Map<string, { agentCsrf?: string }>} */
  const sessions = new Map();
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => {
    const id = req.header('x-test-user');
    req.isAuthenticated = () => Boolean(id);
    if (id) req.user = { id };
    const sid = req.header('x-test-session');
    if (sid) {
      let bag = sessions.get(sid);
      if (!bag) {
        bag = {};
        sessions.set(sid, bag);
      }
      req.session = bag;
    }
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
 *   session?: string,
 *   origin?: string,
 *   secFetchSite?: string,
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
  if (opts.session) headers['x-test-session'] = opts.session;
  if (opts.origin) headers.origin = opts.origin;
  if (opts.secFetchSite) headers['sec-fetch-site'] = opts.secFetchSite;
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

/**
 * @param {string} html
 */
function csrfFrom(html) {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  assert.ok(match, 'approval form includes a csrf token');
  return match[1];
}

/**
 * The client generates the secret. Only the hash is posted.
 * @param {Record<string, unknown>} [extra]
 */
function deviceLogin(extra = {}) {
  const bytes = randomBytes(32);
  return {
    deviceSecret: bytes.toString('base64url'),
    body: {
      ...extra,
      deviceSecretHash: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

describe('agent relay HTTP', () => {
  test('approval ignores a client-supplied city and does not return the token', async () => {
    const relay = createAgentRelay({ clock: createManualClock(1_700_000_000_000) });
    const port = await listen(relay);
    const login = deviceLogin({ name: 'Cursor', machine: 'laptop', city: 'Berlin' });
    const started = await send(port, '/agent/pair', {
      method: 'POST',
      ip: '203.0.113.10',
      body: login.body,
    });
    assert.equal(started.status, 201);
    assert.match(started.body.userCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(started.body.deviceSecret, undefined);
    assert.equal(JSON.stringify(started.body).includes(login.deviceSecret), false);
    const claim = await send(port, '/agent/pair/claim', {
      method: 'POST',
      user: 'user-a',
      ip: '203.0.113.11',
      accept: 'application/json',
      origin: 'https://surfcad.com',
      body: { userCode: started.body.userCode },
    });
    assert.equal(claim.status, 200);
    assert.equal(claim.body.sentence, 'Allow Cursor on laptop to connect?');
    assert.equal(claim.body.city, null);
    assert.equal(claim.body.ip, '203.0.113.10');
    assert.equal(String(claim.body.sentence).includes(','), false);
    assert.equal(String(claim.body.sentence).includes('Berlin'), false);

    const approved = await send(port, '/agent/pair/approve', {
      method: 'POST',
      user: 'user-a',
      ip: '203.0.113.11',
      accept: 'application/json',
      origin: 'https://surfcad.com',
      body: { userCode: started.body.userCode },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.ok, true);
    assert.equal(approved.body.token, undefined);
    assert.equal(JSON.stringify(approved.body).includes(login.deviceSecret), false);

    const again = await send(port, '/agent/pair/approve', {
      method: 'POST',
      user: 'user-a',
      ip: '203.0.113.12',
      accept: 'application/json',
      origin: 'https://surfcad.com',
      body: { userCode: started.body.userCode },
    });
    assert.equal(again.status, 400);
    assert.equal(again.body.error, 'already_used');

    const polled = await send(port, '/agent/pair/poll', {
      method: 'POST',
      ip: '203.0.113.10',
      body: { deviceSecret: login.deviceSecret },
    });
    assert.equal(polled.body.status, 'approved');
    const token = polled.body.token;
    const second = await send(port, '/agent/pair/poll', {
      method: 'POST',
      ip: '203.0.113.10',
      body: { deviceSecret: login.deviceSecret },
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
      origin: 'https://surfcad.com',
    });
    assert.equal(stolen.status, 404);
    const revoked = await send(port, `/agent/tokens/${listed.body.tokens[0].id}`, {
      method: 'DELETE',
      user: 'user-a',
      origin: 'https://surfcad.com',
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
      body: deviceLogin({ name: '<Cursor>', machine: 'laptop' }).body,
    });
    const form = await send(port, '/agent', { user: 'user-a', session: 'html-1' });
    const csrf = csrfFrom(form.text);
    const page = await send(port, '/agent/pair/claim', {
      method: 'POST',
      user: 'user-a',
      session: 'html-1',
      origin: 'https://surfcad.com',
      secFetchSite: 'same-origin',
      raw: `userCode=${encodeURIComponent(started.body.userCode)}&csrf=${encodeURIComponent(csrf)}`,
    });
    assert.equal(page.status, 200);
    assert.match(page.text, /<p[^>]*>Allow &lt;Cursor&gt; on laptop to connect\?<\/p>/);
    assert.match(page.text, /surface-light/);
    assert.match(page.text, /text-on-light/);
    assert.match(page.text, /data-ui-action="data-agent-approve-allow"/);
    assert.match(page.text, /self-reported by the agent/);
    assert.match(page.text, /Requesting IP:/);
    assert.equal(page.text.includes(started.body.userCode), false);
    assert.equal(page.text.includes('name="userCode"'), false);
    assert.equal(page.text.includes('<Cursor>'), false);
    assert.equal(page.text.includes(' in '), false);
    assert.match(page.text, /name="csrf"/);
  });

  test('a link that carries the code does not prefill or approve', async () => {
    const relay = createAgentRelay();
    const port = await listen(relay);
    const login = deviceLogin({ name: 'Cursor', machine: 'laptop' });
    const started = await send(port, '/agent/pair', {
      method: 'POST',
      ip: '203.0.113.50',
      body: login.body,
    });
    const code = started.body.userCode;
    const linked = await send(port, `/agent?userCode=${encodeURIComponent(code)}`, {
      user: 'user-a',
      session: 'link-1',
    });
    assert.equal(linked.status, 200);
    assert.equal(linked.text.includes(code), false);
    assert.match(linked.text, /A link does not fill this in or approve it/);
    const csrf = csrfFrom(linked.text);
    const skipped = await send(port, '/agent/pair/approve', {
      method: 'POST',
      user: 'user-a',
      session: 'link-1',
      origin: 'https://surfcad.com',
      secFetchSite: 'same-origin',
      raw: `userCode=${encodeURIComponent(code)}&csrf=${encodeURIComponent(csrf)}`,
    });
    assert.equal(skipped.status, 400);
    assert.match(skipped.text, /Enter the code shown by the agent/);
    assert.equal(relay.pairing.poll({
      deviceSecret: login.deviceSecret,
      ip: '203.0.113.50',
    }).status, 'pending');

    const claimed = await send(port, '/agent/pair/claim', {
      method: 'POST',
      user: 'user-a',
      session: 'link-1',
      origin: 'https://surfcad.com',
      secFetchSite: 'same-origin',
      raw: `userCode=${encodeURIComponent(code)}&csrf=${encodeURIComponent(csrf)}`,
    });
    assert.equal(claimed.status, 200);
    assert.match(claimed.text, /Allow Cursor on laptop to connect\?/);
    assert.match(claimed.text, /self-reported by the agent/);
    assert.match(claimed.text, /Lisbon|Requesting IP: 203\.0\.113\.50/);
    assert.match(claimed.text, /203\.0\.113\.50/);
    assert.equal(claimed.text.includes(code), false);
    const allowCsrf = csrfFrom(claimed.text);
    const approved = await send(port, '/agent/pair/approve', {
      method: 'POST',
      user: 'user-a',
      session: 'link-1',
      origin: 'https://surfcad.com',
      secFetchSite: 'same-origin',
      raw: `csrf=${encodeURIComponent(allowCsrf)}`,
    });
    assert.equal(approved.status, 200);
    assert.match(approved.text, /Connected\. You can close this page/);
  });

  test('approval posts reject a missing or wrong CSRF token and a cross-origin request', async () => {
    const relay = createAgentRelay();
    const port = await listen(relay);
    const login = deviceLogin({ name: 'Cursor', machine: 'laptop' });
    const started = await send(port, '/agent/pair', {
      method: 'POST',
      body: login.body,
    });
    const form = await send(port, '/agent', { user: 'user-a', session: 'csrf-1' });
    const csrf = csrfFrom(form.text);
    const code = encodeURIComponent(started.body.userCode);

    const missing = await send(port, '/agent/pair/claim', {
      method: 'POST',
      user: 'user-a',
      session: 'csrf-1',
      origin: 'https://surfcad.com',
      secFetchSite: 'same-origin',
      raw: `userCode=${code}`,
    });
    assert.equal(missing.status, 403);
    assert.match(missing.text, /Reload the page and try again/);
    assert.equal(missing.text.includes('Allow Cursor'), false);

    const wrong = await send(port, '/agent/pair/approve', {
      method: 'POST',
      user: 'user-a',
      session: 'csrf-1',
      origin: 'https://surfcad.com',
      secFetchSite: 'same-origin',
      raw: `userCode=${code}&csrf=not-the-token`,
    });
    assert.equal(wrong.status, 403);
    assert.match(wrong.text, /Reload the page and try again/);
    assert.equal(relay.pairing.poll({
      deviceSecret: login.deviceSecret,
      ip: '198.51.100.20',
    }).status, 'pending');

    const cross = await send(port, '/agent/pair/claim', {
      method: 'POST',
      user: 'user-a',
      session: 'csrf-1',
      origin: 'https://evil.example',
      secFetchSite: 'cross-site',
      raw: `userCode=${code}&csrf=${encodeURIComponent(csrf)}`,
    });
    assert.equal(cross.status, 403);
    assert.match(cross.text, /That request did not come from SurfCAD/);

    const crossJson = await send(port, '/agent/pair/approve', {
      method: 'POST',
      user: 'user-a',
      accept: 'application/json',
      origin: 'https://evil.example',
      body: { userCode: started.body.userCode },
    });
    assert.equal(crossJson.status, 403);
    assert.equal(crossJson.body.error, 'cross_origin');

    const crossSite = await send(port, '/agent/pair/approve', {
      method: 'POST',
      user: 'user-a',
      accept: 'application/json',
      secFetchSite: 'cross-site',
      body: { userCode: started.body.userCode },
    });
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.body.error, 'cross_origin');

    const claim = await send(port, '/agent/pair/claim', {
      method: 'POST',
      user: 'user-a',
      session: 'csrf-1',
      origin: 'http://localhost:5173',
      secFetchSite: 'same-site',
      raw: `userCode=${code}&csrf=${encodeURIComponent(csrf)}`,
    });
    assert.equal(claim.status, 200);
    assert.match(claim.text, /Allow Cursor on laptop to connect\?/);
    const approveCsrf = csrfFrom(claim.text);
    const approved = await send(port, '/agent/pair/approve', {
      method: 'POST',
      user: 'user-a',
      session: 'csrf-1',
      origin: 'https://www.surfcad.com',
      secFetchSite: 'same-origin',
      raw: `userCode=${code}&csrf=${encodeURIComponent(approveCsrf)}`,
    });
    assert.equal(approved.status, 200);
    assert.match(approved.text, /Connected\. You can close this page/);
  });

  test('cookie state changes reject a missing fetch signal and a cross-site request', async () => {
    const relay = createAgentRelay();
    const port = await listen(relay);
    const login = deviceLogin({ name: 'Cursor', machine: 'laptop' });
    const started = await send(port, '/agent/pair', {
      method: 'POST',
      body: login.body,
    });
    const code = started.body.userCode;
    const pending = () => relay.pairing.poll({
      deviceSecret: login.deviceSecret,
      ip: '198.51.100.20',
    }).status;

    const missing = await send(port, '/agent/pair/claim', {
      method: 'POST',
      user: 'user-a',
      accept: 'application/json',
      body: { userCode: code },
    });
    assert.equal(missing.status, 403);
    assert.equal(missing.body.error, 'cross_origin');
    assert.equal(pending(), 'pending');

    const crossSite = await send(port, '/agent/pair/claim', {
      method: 'POST',
      user: 'user-a',
      accept: 'application/json',
      origin: 'https://surfcad.com',
      secFetchSite: 'cross-site',
      body: { userCode: code },
    });
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.body.error, 'cross_origin');
    assert.equal(pending(), 'pending');

    const sameOrigin = await send(port, '/agent/pair/claim', {
      method: 'POST',
      user: 'user-a',
      accept: 'application/json',
      secFetchSite: 'same-origin',
      body: { userCode: code },
    });
    assert.equal(sameOrigin.status, 200);
    assert.equal(sameOrigin.body.sentence, 'Allow Cursor on laptop to connect?');

    const approveMissing = await send(port, '/agent/pair/approve', {
      method: 'POST',
      user: 'user-a',
      accept: 'application/json',
      body: { userCode: code },
    });
    assert.equal(approveMissing.status, 403);
    assert.equal(approveMissing.body.error, 'cross_origin');
    assert.equal(pending(), 'pending');

    const approved = await send(port, '/agent/pair/approve', {
      method: 'POST',
      user: 'user-a',
      accept: 'application/json',
      origin: 'https://www.surfcad.com',
      body: { userCode: code },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.ok, true);

    const issued = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const revokeMissing = await send(port, `/agent/tokens/${issued.id}`, {
      method: 'DELETE',
      user: 'user-a',
      accept: 'application/json',
    });
    assert.equal(revokeMissing.status, 403);
    assert.equal(revokeMissing.body.error, 'cross_origin');
    assert.equal((await relay.tokens.authenticate(issued.token)).userId, 'user-a');
    const revoked = await send(port, `/agent/tokens/${issued.id}`, {
      method: 'DELETE',
      user: 'user-a',
      secFetchSite: 'same-origin',
    });
    assert.equal(revoked.status, 200);

    relay.registry.registerTab({ userId: 'user-a', tabId: 't1', send() {} });
    relay.registry.registerTab({ userId: 'user-a', tabId: 't2', send() {} });
    const selectMissing = await send(port, '/agent/tabs/select', {
      method: 'POST',
      user: 'user-a',
      body: { tabId: 't1' },
    });
    assert.equal(selectMissing.status, 403);
    const selected = await send(port, '/agent/tabs/select', {
      method: 'POST',
      user: 'user-a',
      origin: 'http://127.0.0.1:5173',
      body: { tabId: 't1' },
    });
    assert.equal(selected.status, 200);
    assert.equal(selected.body.tabs.find((tab) => tab.id === 't1').selected, true);

    const bearer = await relay.tokens.issue({ userId: 'user-a', label: 'agent' });
    const self = await send(port, '/agent/tokens/self', {
      method: 'DELETE',
      token: bearer.token,
    });
    assert.equal(self.status, 200);
  });

  test('a second account cannot approve a code the first account opened', async () => {
    const relay = createAgentRelay();
    const port = await listen(relay);
    const started = await send(port, '/agent/pair', {
      method: 'POST',
      body: deviceLogin({ name: 'Cursor', machine: 'laptop' }).body,
    });
    const claim = await send(port, '/agent/pair/claim', {
      method: 'POST',
      user: 'user-a',
      accept: 'application/json',
      origin: 'https://surfcad.com',
      body: { userCode: started.body.userCode },
    });
    assert.equal(claim.status, 200);
    const raced = await send(port, '/agent/pair/approve', {
      method: 'POST',
      user: 'user-b',
      accept: 'application/json',
      origin: 'https://surfcad.com',
      body: { userCode: started.body.userCode },
    });
    assert.equal(raced.status, 403);
    assert.equal(raced.body.error, 'claimed');
    const approved = await send(port, '/agent/pair/approve', {
      method: 'POST',
      user: 'user-a',
      accept: 'application/json',
      origin: 'https://surfcad.com',
      body: { userCode: started.body.userCode },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.ok, true);
  });

  test('a full pending queue rejects the next command', async () => {
    const relay = createAgentRelay({ maxPending: 1 });
    relay.registry.registerTab({
      userId: 'user-a',
      tabId: 'tab-a',
      send: () => {},
    });
    const port = await listen(relay);
    const issued = await relay.tokens.issue({ userId: 'user-a', label: 'Cursor on laptop' });
    const first = await send(port, '/agent/commands', {
      method: 'POST',
      token: issued.token,
      body: { v: 1, id: 'c1', command: 'status', args: {} },
    });
    assert.equal(first.status, 202);
    const second = await send(port, '/agent/commands', {
      method: 'POST',
      token: issued.token,
      body: { v: 1, id: 'c2', command: 'status', args: {} },
    });
    assert.equal(second.status, 429);
    assert.equal(second.body.error, 'too_many_pending');
    assert.equal(second.body.message, 'Too many commands are waiting');
    assert.equal(relay.registry.pendingCount(issued.id), 1);
  });

  test('a looked-up city is "in <city>" with the credit, and a comma is stripped', async () => {
    const relay = createAgentRelay({
      lookupCity: async () => 'Lisbon, Portugal',
    });
    const port = await listen(relay);
    const started = await send(port, '/agent/pair', {
      method: 'POST',
      body: deviceLogin({ name: 'Cursor', machine: 'laptop', city: 'Ignored' }).body,
    });
    const form = await send(port, '/agent', { user: 'user-a', session: 'city-1' });
    const csrf = csrfFrom(form.text);
    const page = await send(port, '/agent/pair/claim', {
      method: 'POST',
      user: 'user-a',
      session: 'city-1',
      origin: 'https://surfcad.com',
      secFetchSite: 'same-origin',
      raw: `userCode=${encodeURIComponent(started.body.userCode)}&csrf=${encodeURIComponent(csrf)}`,
    });
    assert.match(page.text, /Allow Cursor on laptop in Lisbon Portugal to connect\?/);
    assert.match(page.text, /Lisbon Portugal\. Requesting IP:/);
    assert.match(page.text, /self-reported by the agent/);
    assert.equal(page.text.includes('Lisbon,'), false);
    assert.equal(page.text.includes('Ignored'), false);
    assert.match(page.text, /IP geolocation by ipdata/);
    assert.match(page.text, /https:\/\/ipdata\.co\//);
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
      const commands = seen.filter((frame) => frame.command === 'list_faces');
      assert.equal(commands.length, 1);
      assert.equal(seen.some((frame) => frame.type === 'agent' && frame.connected === true), true);
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
      secFetchSite: 'same-origin',
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
    assert.equal(first.filter((frame) => frame.command === 'status').length, 1);
    assert.equal(second.filter((frame) => frame.command === 'status').length, 0);
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
      const secret = 'raw-token-value-raw-token-value-raw1';
      logRelay({
        event: 'socket-close',
        userId: 'user-a',
        side: 'agent',
        code: 1011,
        reason: `diag-reason Bearer ${secret} ABCD-EFGH`,
        token: secret,
        args: { secret: 'payload-secret' },
      });
      const closeLine = lines[lines.length - 1];
      assert.match(closeLine, /"code":1011/);
      assert.match(closeLine, /diag-reason/);
      assert.equal(closeLine.includes(secret), false);
      assert.equal(closeLine.includes('ABCD-EFGH'), false);
      assert.equal(closeLine.includes('payload-secret'), false);
      assert.equal(closeLine.includes('Bearer'), false);
    } finally {
      console.info = original;
    }
  });

  test('GET /agent/prompts logs poll start and end without the token or body', async () => {
    const lines = [];
    const original = console.info;
    console.info = (...args) => lines.push(args.map(String).join(' '));
    try {
      const relay = createAgentRelay();
      const port = await listen(relay);
      const issued = await relay.tokens.issue({ userId: 'user-a', label: 'poller' });
      const anon = await send(port, '/agent/prompts?timeout=0&code=ABCD-EFGH', {});
      assert.equal(anon.status, 401);
      assert.equal(lines.some((line) => line.includes('prompt-poll')), false);

      relay.registry.holdPrompt('user-a', {
        type: 'agent.prompt',
        v: 1,
        id: 'p1',
        text: 'draw-a-secret-box',
      });
      const polled = await send(port, `/agent/prompts?timeout=0&code=ABCD-EFGH&token=${issued.token}`, {
        token: issued.token,
      });
      assert.equal(polled.status, 200);
      assert.equal(polled.body.messages[0].text, 'draw-a-secret-box');
      const again = await send(port, '/agent/prompts?timeout=0', { token: issued.token });
      assert.equal(again.status, 200);
      assert.deepEqual(again.body.messages, []);

      const events = lines
        .filter((line) => line.includes('[agent-relay]'))
        .map((line) => JSON.parse(line.slice(line.indexOf('{'))));
      const starts = events.filter((event) => event.event === 'prompt-poll-start');
      const ends = events.filter((event) => event.event === 'prompt-poll-end');
      assert.equal(starts.length, 2);
      assert.equal(ends.length, 2);
      assert.equal(starts[0].userId, 'user-a');
      assert.equal(starts[0].timeoutMs, 0);
      assert.equal(ends[0].status, 'messages');
      assert.equal(ends[1].status, 'empty');
      const logged = lines.join('\n');
      assert.equal(logged.includes(issued.token), false);
      assert.equal(logged.includes('ABCD-EFGH'), false);
      assert.equal(logged.includes('draw-a-secret-box'), false);
      assert.equal(logged.includes('Bearer'), false);
    } finally {
      console.info = original;
    }
  });

  test('DELETE /agent/tokens/self revokes only the calling token', async () => {
    const relay = createAgentRelay();
    const port = await listen(relay);
    const first = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const second = await relay.tokens.issue({ userId: 'user-a', label: 'phone' });
    const other = await relay.tokens.issue({ userId: 'user-b', label: 'other' });
    const missing = await send(port, '/agent/tokens/self', { method: 'DELETE' });
    assert.equal(missing.status, 401);
    const revoked = await send(port, '/agent/tokens/self', {
      method: 'DELETE',
      token: first.token,
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.ok, true);
    assert.equal(JSON.stringify(revoked.body).includes(first.token), false);
    assert.equal(await relay.tokens.authenticate(first.token), null);
    assert.ok(await relay.tokens.authenticate(second.token));
    assert.ok(await relay.tokens.authenticate(other.token));
    const again = await send(port, '/agent/tokens/self', {
      method: 'DELETE',
      token: first.token,
    });
    assert.equal(again.status, 401);
  });

  test('a command result is only readable by the token that submitted it', async () => {
    const relay = createAgentRelay();
    relay.registry.registerTab({
      userId: 'user-a',
      tabId: 't1',
      send(frame) {
        relay.registry.complete('user-a', frame.id, commandResponse({
          id: frame.id,
          ok: true,
          result: { n: 1 },
        }));
      },
    });
    const port = await listen(relay);
    const first = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const second = await relay.tokens.issue({ userId: 'user-a', label: 'phone' });
    const posted = await send(port, '/agent/commands', {
      method: 'POST',
      token: first.token,
      body: { v: 1, id: 'c1', command: 'status', args: {} },
    });
    assert.equal(posted.status, 202);
    const stolen = await send(port, '/agent/commands/c1?timeout=0', { token: second.token });
    assert.equal(stolen.status, 404);
    const own = await send(port, '/agent/commands/c1?timeout=0', { token: first.token });
    assert.equal(own.status, 200);
    assert.equal(own.body.status, 'done');
    assert.equal(own.body.response.result.n, 1);
  });

  test('revoke aborts an in-flight long poll', async () => {
    const relay = createAgentRelay();
    relay.registry.registerTab({ userId: 'user-a', tabId: 't1', send() {} });
    const port = await listen(relay);
    const issued = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const posted = await send(port, '/agent/commands', {
      method: 'POST',
      token: issued.token,
      body: { v: 1, id: 'c1', command: 'status', args: {} },
    });
    assert.equal(posted.status, 202);
    const waiting = send(port, '/agent/commands/c1?timeout=5000', { token: issued.token });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const revoked = await send(port, `/agent/tokens/${issued.id}`, {
      method: 'DELETE',
      user: 'user-a',
      secFetchSite: 'same-origin',
    });
    assert.equal(revoked.status, 200);
    const result = await waiting;
    assert.equal(result.status, 401);
    assert.equal(result.body.error, 'Authentication required');
  });

  test('revokeRelayUser revokes every token for the account', async () => {
    const relay = createAgentRelay();
    const first = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const second = await relay.tokens.issue({ userId: 'user-a', label: 'phone' });
    const other = await relay.tokens.issue({ userId: 'user-b', label: 'other' });
    const ids = await revokeRelayUser(relay, 'user-a');
    assert.equal(ids.length, 2);
    assert.equal(await relay.tokens.authenticate(first.token), null);
    assert.equal(await relay.tokens.authenticate(second.token), null);
    assert.equal((await relay.tokens.authenticate(other.token)).userId, 'user-b');
  });

  test('password change and account delete kill that account\'s pending join code', async () => {
    const relay = createAgentRelay();
    const changed = relay.joinCodes.create({ userId: 'user-a' });
    const superseded = relay.joinCodes.create({ userId: 'user-a' });
    const removed = relay.joinCodes.create({ userId: 'user-b' });
    const kept = relay.joinCodes.create({ userId: 'user-c' });
    assert.equal(changed.ok && superseded.ok && removed.ok && kept.ok, true);
    assert.notEqual(changed.code, superseded.code);
    // change-password and account delete both call revokeRelayUser.
    await revokeRelayUser(relay, 'user-a');
    await revokeRelayUser(relay, 'user-b');
    for (const created of [changed, superseded, removed]) {
      const result = await relay.joinCodes.redeem({
        code: created.code,
        name: 'Cursor',
        machine: 'laptop',
        ip: '203.0.113.9',
      });
      assert.deepEqual(result, { ok: false, error: 'invalid_code' });
    }
    assert.equal(relay.joinCodes.status({ userId: 'user-a' }).status, 'none');
    assert.equal(relay.joinCodes.status({ userId: 'user-b' }).status, 'none');
    const left = relay.joinCodes.snapshot();
    assert.equal(left.some((row) => row.userId === 'user-a' || row.id === changed.id || row.id === superseded.id), false);
    assert.equal(left.some((row) => row.userId === 'user-b' || row.id === removed.id), false);
    assert.equal(left.some((row) => row.id === kept.id), true);
    const still = await relay.joinCodes.redeem({
      code: kept.code,
      name: 'Cursor',
      machine: 'laptop',
      ip: '203.0.113.10',
    });
    assert.equal(still.ok, true);
    assert.equal(still.userId, 'user-c');
  });

  test('an in-flight redeem cannot keep a token issued after revokeRelayUser', async () => {
    const relay = createAgentRelay();
    const created = relay.joinCodes.create({ userId: 'user-a' });
    assert.equal(created.ok, true);
    /** @type {() => void} */
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    const realIssue = relay.tokens.issue.bind(relay.tokens);
    /** @type {string | null} */
    let issuedToken = null;
    relay.tokens.issue = async (fields) => {
      await gate;
      const issued = await realIssue(fields);
      issuedToken = issued.token;
      return issued;
    };
    const pending = relay.joinCodes.redeem({
      code: created.code,
      name: 'Cursor',
      machine: 'laptop',
      ip: '203.0.113.9',
    });
    await revokeRelayUser(relay, 'user-a');
    release();
    const result = await pending;
    assert.deepEqual(result, { ok: false, error: 'invalid_code' });
    assert.equal(result.token, undefined);
    assert.equal(typeof issuedToken, 'string');
    assert.equal(await relay.tokens.authenticate(issuedToken), null);
    const live = (await relay.tokens.list('user-a')).filter((row) => !row.revokedAt);
    assert.equal(live.length, 0);
  });

  test('cookie routes reject a foreign Origin and are rate limited per IP', async () => {
    const relay = createAgentRelay({ browserLimit: 1 });
    const port = await listen(relay);
    const foreign = await send(port, '/agent/tokens', {
      user: 'user-a',
      accept: 'application/json',
      origin: 'https://evil.example',
      ip: '203.0.113.50',
    });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.error, 'cross_origin');
    const page = await send(port, '/agent', {
      user: 'user-a',
      origin: 'https://evil.example',
      ip: '203.0.113.51',
    });
    assert.equal(page.status, 403);
    assert.match(page.text, /did not come from SurfCAD/);
    const ok = await send(port, '/agent/tokens', { user: 'user-a', ip: '203.0.113.40' });
    assert.equal(ok.status, 200);
    const limited = await send(port, '/agent/tabs', { user: 'user-a', ip: '203.0.113.40' });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, 'rate_limited');
    const otherIp = await send(port, '/agent/tabs', { user: 'user-a', ip: '203.0.113.41' });
    assert.equal(otherIp.status, 200);
  });

  test('SSE and long-poll connects are rate limited per token', async () => {
    const relay = createAgentRelay({ readLimit: 1 });
    const port = await listen(relay);
    const issued = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const first = await send(port, '/agent/commands/missing/events', { token: issued.token });
    assert.equal(first.status, 200);
    const second = await send(port, '/agent/commands/missing', { token: issued.token });
    assert.equal(second.status, 429);
    assert.equal(second.body.error, 'rate_limited');
  });

  test('a prompt poll stays present, progress drops text, and close_session ends it', async () => {
    const clock = createManualClock(1_000);
    const relay = createAgentRelay({ clock });
    const tab = [];
    relay.registry.registerTab({ userId: 'user-a', tabId: 't1', send: (frame) => tab.push(frame) });
    const port = await listen(relay);
    const issued = await relay.tokens.issue({ userId: 'user-a', label: 'laptop' });
    const polled = await send(port, '/agent/prompts?timeout=0', { token: issued.token });
    assert.equal(polled.status, 200);
    assert.equal(relay.registry.agentConnected('user-a'), true);
    assert.deepEqual(tab.at(-1), { type: 'agent', v: 1, connected: true });
    const progress = await send(port, '/agent/prompts', {
      method: 'POST',
      token: issued.token,
      body: { type: 'agent.progress', v: 1, text: 'secret thinking', working: true },
    });
    assert.equal(progress.status, 202);
    assert.deepEqual(tab.at(-1), { type: 'agent.progress', v: 1, working: true });
    const closed = await send(port, '/agent/prompts', {
      method: 'POST',
      token: issued.token,
      body: { type: 'agent.close_session', v: 1 },
    });
    assert.equal(closed.status, 202);
    assert.equal(relay.registry.agentConnected('user-a'), false);
    assert.deepEqual(tab.at(-1), { type: 'agent', v: 1, connected: false, reason: 'closed' });
    assert.equal(tab.some((frame) => frame.text === 'secret thinking'), false);
  });
});
