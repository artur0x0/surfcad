import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, test } from 'node:test';
import express from 'express';
import { createManualClock } from '../agent/clock.js';
import { createAgentRelay } from '../agent/createRelay.js';
import { createJoinCodeService, joinCodeFromBytes } from '../agent/joinCode.js';
import { JOIN_TTL_MS, MAX_AGENT_MESSAGE_BYTES } from '../agent/limits.js';
import { USER_CODE_ALPHABET } from '../agent/pairing.js';
import { createTokenService } from '../agent/tokens.js';

const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

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
 * @param {Record<string, unknown>} [extra]
 */
function harness(extra = {}) {
  const clock = createManualClock(1_700_000_000_000);
  const tokens = createTokenService({ now: () => clock.now() });
  const join = createJoinCodeService({
    tokens,
    now: () => clock.now(),
    ...extra,
  });
  return { clock, tokens, join };
}

/**
 * @param {ReturnType<typeof createAgentRelay>} relay
 */
async function listen(relay) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => {
    const id = req.header('x-test-user');
    req.isAuthenticated = () => Boolean(id);
    if (id) req.user = { id };
    next();
  });
  app.use('/agent', relay.router);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return /** @type {import('node:net').AddressInfo} */ (server.address()).port;
}

/**
 * @param {number} port
 * @param {string} path
 * @param {Record<string, unknown>} [opts]
 */
async function send(port, path, opts = {}) {
  const headers = { accept: 'application/json' };
  let payload;
  if (opts.body !== undefined) {
    payload = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(payload));
  }
  if (opts.user) headers['x-test-user'] = opts.user;
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  if (opts.origin) headers.origin = opts.origin;
  if (opts.secFetchSite) headers['sec-fetch-site'] = opts.secFetchSite;
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: payload,
  });
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

test('rejection sampling skips bytes that would bias the alphabet', () => {
  assert.equal(USER_CODE_ALPHABET.length, 31);
  const skipped = joinCodeFromBytes([255, 248, 249, 0]);
  assert.equal(skipped[0], USER_CODE_ALPHABET[0]);
  assert.equal(skipped.length, 1);
});

describe('join code service', () => {
  test('a code is single use and the second redeem matches an unknown code', async () => {
    const { tokens, join } = harness();
    const created = join.create({ userId: 'user-a' });
    assert.equal(created.ok, true);
    assert.match(created.code, CODE_RE);
    const first = await join.redeem({
      code: created.code,
      name: 'Cursor',
      machine: 'laptop',
      ip: '203.0.113.10',
    });
    assert.equal(first.ok, true);
    const second = await join.redeem({
      code: created.code,
      name: 'Cursor',
      machine: 'laptop',
      ip: '203.0.113.11',
    });
    const unknown = await join.redeem({
      code: 'WXYZ-2345',
      name: 'Cursor',
      machine: 'laptop',
      ip: '203.0.113.12',
    });
    assert.deepEqual(second, unknown);
    assert.equal(second.error, 'invalid_code');
    assert.equal((await tokens.list('user-a')).length, 1);
  });

  test('an expired code is the same error as an unknown code', async () => {
    const { clock, join } = harness();
    const created = join.create({ userId: 'user-a' });
    const unknown = await join.redeem({
      code: 'MNPQ-RSTV',
      name: 'Cursor',
      machine: 'laptop',
      ip: '203.0.113.20',
    });
    clock.advance(JOIN_TTL_MS);
    const expired = await join.redeem({
      code: created.code,
      name: 'Cursor',
      machine: 'laptop',
      ip: '203.0.113.21',
    });
    assert.deepEqual(expired, unknown);
    assert.equal(join.status({ userId: 'user-a' }).status, 'expired');
    assert.equal(join.status({ userId: 'user-a' }).code, undefined);
  });

  test('five failed redeems kill the code', async () => {
    const { clock, join } = harness();
    const created = join.create({ userId: 'user-a' });
    clock.advance(JOIN_TTL_MS);
    for (let i = 0; i < 5; i += 1) {
      const failed = await join.redeem({
        code: created.code,
        name: 'Cursor',
        machine: 'laptop',
        ip: `203.0.113.${30 + i}`,
      });
      assert.deepEqual(failed, { ok: false, error: 'invalid_code' });
    }
    assert.equal(join.snapshot()[0].status, 'dead');
    const live = join.create({ userId: 'user-b' });
    for (let i = 0; i < 5; i += 1) {
      const failed = await join.redeem({
        code: 'BBBB-BBBB',
        id: live.id,
        name: 'Cursor',
        machine: 'laptop',
        ip: `198.51.100.${i + 1}`,
      });
      assert.equal(failed.error, 'invalid_code');
    }
    const row = join.snapshot().find((entry) => entry.id === live.id);
    assert.equal(row.status, 'pending');
    assert.equal(row.failedTries, 0);
    const still = await join.redeem({
      code: live.code,
      name: 'Cursor',
      machine: 'laptop',
      ip: '198.51.100.20',
    });
    assert.equal(still.ok, true);
    assert.equal(still.userId, 'user-b');
  });

  test('redeem is limited per IP and globally, separate from the per-code tries', async () => {
    const { join } = harness({ redeemIpLimit: 2, globalRedeemLimit: 3 });
    const created = join.create({ userId: 'user-a' });
    assert.equal((await join.redeem({
      code: 'CCCC-CCCC', ip: '203.0.113.40', name: 'a', machine: 'm',
    })).error, 'invalid_code');
    assert.equal((await join.redeem({
      code: 'DDDD-DDDD', ip: '203.0.113.40', name: 'a', machine: 'm',
    })).error, 'invalid_code');
    const limited = await join.redeem({
      code: created.code, ip: '203.0.113.40', name: 'a', machine: 'm',
    });
    assert.equal(limited.error, 'rate_limited');
    assert.ok(limited.retryAfterSec >= 1);
    const otherIp = await join.redeem({
      code: 'EEEE-EEEE', ip: '203.0.113.41', name: 'a', machine: 'm',
    });
    assert.equal(otherIp.error, 'rate_limited');
    assert.equal(join.snapshot().find((row) => row.id === created.id).status, 'pending');
  });

  test('a code from user A never yields a token for user B', async () => {
    const { tokens, join } = harness();
    const created = join.create({ userId: 'user-a' });
    const redeemed = await join.redeem({
      code: created.code,
      name: 'Cursor',
      machine: 'laptop',
      ip: '203.0.113.50',
      userId: 'user-b',
      account: 'user-b',
      user: { id: 'user-b' },
    });
    assert.equal(redeemed.ok, true);
    assert.equal(redeemed.userId, 'user-a');
    const owned = await tokens.list('user-a');
    assert.equal(owned.length, 1);
    assert.equal(owned[0].machine, 'laptop');
    assert.equal(owned[0].ip, '203.0.113.50');
    assert.match(owned[0].label, /Cursor/);
    assert.equal((await tokens.list('user-b')).length, 0);
  });

  test('create is limited per account', () => {
    const { join } = harness({ createLimit: 2 });
    assert.equal(join.create({ userId: 'user-a' }).ok, true);
    assert.equal(join.create({ userId: 'user-a' }).ok, true);
    const limited = join.create({ userId: 'user-a' });
    assert.equal(limited.error, 'rate_limited');
    assert.ok(limited.retryAfterSec >= 1);
    assert.equal(join.create({ userId: 'user-b' }).ok, true);
  });

  test('a new code supersedes the previous one and only one stays pending', async () => {
    const { join } = harness();
    const first = join.create({ userId: 'user-a' });
    const second = join.create({ userId: 'user-a' });
    assert.notEqual(first.code, second.code);
    const pending = join.snapshot().filter((row) => row.status === 'pending');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, second.id);
    const old = await join.redeem({
      code: first.code, name: 'a', machine: 'm', ip: '203.0.113.60',
    });
    assert.deepEqual(old, { ok: false, error: 'invalid_code' });
    const current = await join.redeem({
      code: second.code, name: 'a', machine: 'm', ip: '203.0.113.61',
    });
    assert.equal(current.ok, true);
    assert.equal(current.userId, 'user-a');
  });

  test('the pending cap counts live codes and a refresh replaces the account code', () => {
    const { join } = harness({ maxPending: 1 });
    const first = join.create({ userId: 'user-a' });
    assert.equal(first.ok, true);
    const blocked = join.create({ userId: 'user-b' });
    assert.equal(blocked.error, 'unavailable');
    const refreshed = join.create({ userId: 'user-a' });
    assert.equal(refreshed.ok, true);
    assert.equal(join.snapshot().filter((row) => row.status === 'pending').length, 1);
  });

  test('only the hash is stored', () => {
    const { join } = harness();
    const created = join.create({ userId: 'user-a' });
    const dumped = JSON.stringify(join.snapshot());
    assert.equal(dumped.includes(created.code), false);
    assert.equal(dumped.includes(created.code.replace('-', '')), false);
    assert.match(join.snapshot()[0].codeHash, /^[0-9a-f]{64}$/);
    assert.equal(join.snapshot()[0].code, undefined);
  });

  test('a browser cookie cannot redeem', async () => {
    const { tokens, join } = harness();
    const created = join.create({ userId: 'user-a' });
    const refused = await join.redeem({
      code: created.code,
      name: 'Cursor',
      machine: 'laptop',
      ip: '203.0.113.70',
      cookie: true,
    });
    assert.deepEqual(refused, { ok: false, error: 'invalid_code' });
    assert.equal((await tokens.list('user-a')).length, 0);
    const ok = await join.redeem({
      code: created.code,
      name: 'Cursor',
      machine: 'laptop',
      ip: '203.0.113.71',
    });
    assert.equal(ok.ok, true);
  });
});

describe('join code HTTP', () => {
  test('create requires the fetch-metadata rule and status does not return the code', async () => {
    const relay = createAgentRelay();
    const port = await listen(relay);
    const missing = await send(port, '/agent/join', { method: 'POST', user: 'user-a', body: {} });
    assert.equal(missing.status, 403);
    assert.equal(missing.body.error, 'cross_origin');
    const crossSite = await send(port, '/agent/join', {
      method: 'POST',
      user: 'user-a',
      body: {},
      origin: 'https://surfcad.com',
      secFetchSite: 'cross-site',
    });
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.body.error, 'cross_origin');
    const created = await send(port, '/agent/join', {
      method: 'POST',
      user: 'user-a',
      body: {},
      secFetchSite: 'same-origin',
    });
    assert.equal(created.status, 201);
    assert.match(created.body.code, CODE_RE);
    const status = await send(port, '/agent/join', { user: 'user-a' });
    assert.equal(status.status, 200);
    assert.equal(status.body.status, 'pending');
    assert.equal(status.body.id, created.body.id);
    assert.equal(status.body.code, undefined);
    assert.equal(JSON.stringify(status.body).includes(created.body.code), false);
    const other = await send(port, '/agent/join', { user: 'user-b' });
    assert.equal(other.body.status, 'none');
  });

  test('redeem ignores account fields, rejects cookies, caps the body, and does not log the code', async () => {
    const lines = [];
    const methods = ['info', 'log', 'warn', 'error', 'debug'];
    const original = Object.fromEntries(methods.map((method) => [method, console[method]]));
    for (const method of methods) {
      console[method] = (...args) => { lines.push(args.map(String).join(' ')); };
    }
    try {
      const relay = createAgentRelay({
        join: { redeemIpLimit: 20 },
      });
      const port = await listen(relay);
      const created = await send(port, '/agent/join', {
        method: 'POST',
        user: 'user-a',
        body: {},
        origin: 'https://surfcad.com',
      });
      assert.equal(created.status, 201);
      const cooked = await send(port, '/agent/join/redeem', {
        method: 'POST',
        body: {
          code: created.body.code,
          name: 'Cursor',
          machine: 'laptop',
          userId: 'user-b',
          account: 'user-b',
        },
        cookie: 'connect.sid=browser-session',
        ip: '203.0.113.80',
      });
      assert.equal(cooked.status, 400);
      assert.deepEqual(cooked.body, { error: 'invalid_code' });
      assert.equal((await relay.tokens.list('user-a')).length, 0);
      const named = await send(port, '/agent/join/redeem', {
        method: 'POST',
        body: {
          code: 'BBBB-BBBB',
          id: created.body.id,
          name: 'Cursor',
          machine: 'laptop',
        },
        ip: '203.0.113.79',
      });
      assert.equal(named.status, 400);
      assert.equal(named.body.error, 'invalid_code');
      const pending = relay.joinCodes.snapshot().find((row) => row.id === created.body.id);
      assert.equal(pending.status, 'pending');
      assert.equal(pending.failedTries, 0);
      const unknown = await send(port, '/agent/join/redeem', {
        method: 'POST',
        body: { code: 'WXYZ-2345', name: 'Cursor', machine: 'laptop', userId: 'user-b' },
        ip: '203.0.113.81',
      });
      const redeemed = await send(port, '/agent/join/redeem', {
        method: 'POST',
        body: {
          code: created.body.code,
          name: 'Cursor',
          machine: 'laptop',
          userId: 'user-b',
          account: 'user-b',
        },
        ip: '203.0.113.82',
      });
      assert.equal(redeemed.status, 200);
      assert.equal(typeof redeemed.body.token, 'string');
      assert.equal(redeemed.body.userId, undefined);
      const again = await send(port, '/agent/join/redeem', {
        method: 'POST',
        body: { code: created.body.code, name: 'Cursor', machine: 'laptop' },
        ip: '203.0.113.83',
      });
      assert.equal(again.status, 400);
      assert.deepEqual(again.body, unknown.body);
      const listed = await relay.tokens.list('user-a');
      assert.equal(listed.length, 1);
      assert.equal(listed[0].ip, '203.0.113.82');
      assert.equal((await relay.tokens.list('user-b')).length, 0);
      const oversized = await send(port, '/agent/join/redeem', {
        method: 'POST',
        body: { code: created.body.code, pad: 'Z'.repeat(MAX_AGENT_MESSAGE_BYTES) },
        ip: '203.0.113.84',
      });
      assert.equal(oversized.status, 413);
      const logged = lines.join('\n');
      assert.equal(logged.includes(created.body.code), false);
      assert.equal(logged.includes(created.body.code.replace('-', '')), false);
      assert.equal(logged.includes(redeemed.body.token), false);
      assert.equal(logged.includes('Z'.repeat(80)), false);
    } finally {
      for (const method of methods) console[method] = original[method];
    }
  });
});
