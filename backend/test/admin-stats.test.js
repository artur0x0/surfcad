/**
 * GET /api/admin/stats — 404 for non-admins, 200 for admins, 400 on bad days.
 * Run: cd backend && node --test test/admin-stats.test.js
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import config from '../config/index.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { createAdminRouter } from '../routes/admin.js';
import { createRateLimiter } from '../services/rateLimiter.js';

const SAMPLE_STATS = {
  days: 7,
  generatedAt: '2026-10-18T12:00:00.000Z',
  totals: {
    signups: 2,
    logins: 5,
    activeUsers: 3,
    quotes: 1,
    orders: 0,
    partnerSubmissions: 1,
  },
  series: {
    signups: [{ date: '2026-10-18', count: 2 }],
    logins: [{ date: '2026-10-18', count: 5 }],
    activeUsers: [{ date: '2026-10-18', count: 3 }],
    quotes: [{ date: '2026-10-18', count: 1 }],
    orders: [{ date: '2026-10-18', count: 0 }],
    partnerSubmissions: [{ date: '2026-10-18', count: 1 }],
  },
};

let server;
let base;
const previousLogins = config.adminGithubLogins;
let fetchCalls = 0;

before(async () => {
  config.adminGithubLogins = new Set(['octocat']);
  const app = express();
  app.use((req, res, next) => {
    const login = req.get('x-github-login');
    req.user = login ? { _id: 'user-1', githubLogin: login } : undefined;
    req.isAuthenticated = () => Boolean(login);
    next();
  });
  app.use('/api/admin', createAdminRouter({
    requireAdmin,
    fetchAdminStats: async ({ days }) => {
      fetchCalls += 1;
      return { ...SAMPLE_STATS, days };
    },
    limiter: createRateLimiter({ limit: 100, windowMs: 60_000 }),
  }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  config.adminGithubLogins = previousLogins;
  server?.close();
});

function getStats(days, login) {
  const query = days === undefined ? '' : `?days=${days}`;
  return fetch(`${base}/api/admin/stats${query}`, {
    headers: login ? { 'x-github-login': login } : {},
  });
}

function collectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
    return keys;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

describe('GET /api/admin/stats', () => {
  test('signed-out users get 404, not 403', async () => {
    const beforeCalls = fetchCalls;
    const res = await getStats('7');
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'Not found');
    assert.equal(fetchCalls, beforeCalls);
  });

  test('signed-in non-admins get 404, not 403', async () => {
    const beforeCalls = fetchCalls;
    const res = await getStats('7', 'someone-else');
    assert.equal(res.status, 404);
    assert.notEqual(res.status, 403);
    assert.equal(fetchCalls, beforeCalls);
  });

  test('admin gets 200 with bucket-shaped counts and no PII fields', async () => {
    const res = await getStats('7', 'OctoCat');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.days, 7);
    assert.equal(body.totals.signups, 2);
    assert.ok(Array.isArray(body.series.signups));
    assert.equal(body.series.signups[0].date, '2026-10-18');
    assert.equal(body.series.signups[0].count, 2);

    const keys = collectKeys(body);
    for (const forbidden of [
      'email', 'emails', 'address', 'addresses', 'name', 'firstName', 'lastName',
      'phone', 'street', 'userId', 'githubLogin', 'guest-email', 'ip', 'userAgent',
    ]) {
      assert.equal(keys.has(forbidden), false, forbidden);
    }
  });

  test('bad days value is 400 for an admin', async () => {
    const res = await getStats('14', 'octocat');
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /days must be 7, 30, or 120/);
  });

  test('missing days is 400 for an admin', async () => {
    const res = await getStats(undefined, 'octocat');
    assert.equal(res.status, 400);
  });

  test('non-admin still gets 404 when days are invalid', async () => {
    const res = await getStats('14', 'someone-else');
    assert.equal(res.status, 404);
  });
});
