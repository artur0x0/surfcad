/**
 * /api/generate over HTTP with the real requireAuth.
 * Run: cd backend && node --test test/generate-route.test.js
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import { requireAuth } from '../auth/session.js';
import { createGenerateHandler } from '../services/generateProxy.js';
import { createRateLimiter, rateLimitMiddleware, userKey } from '../services/rateLimiter.js';

let server;
let base;
let upstreamCalls = 0;

before(async () => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use((req, res, next) => {
    const id = req.get('x-test-user');
    req.user = id ? { _id: id } : undefined;
    req.isAuthenticated = () => Boolean(id);
    next();
  });
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
  app.post(
    '/api/generate',
    requireAuth,
    rateLimitMiddleware(limiter, userKey, 'Too many AI requests.'),
    createGenerateHandler({
      systemPrompt: 'p',
      apiKey: 'k',
      fetchImpl: async () => {
        upstreamCalls += 1;
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'return 1;' } }] }) };
      },
    }),
  );
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

function post(body, user) {
  return fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
    body: JSON.stringify(body),
  });
}

describe('/api/generate route', () => {
  test('401 without a session and no upstream call', async () => {
    const res = await post({ messages: [{ role: 'user', content: 'x' }] });
    assert.equal(res.status, 401);
    assert.equal(upstreamCalls, 0);
  });

  test('signed-in user is served, then rate limited', async () => {
    const msg = { messages: [{ role: 'user', content: 'x' }] };
    assert.equal((await post(msg, 'u1')).status, 200);
    assert.equal((await post(msg, 'u1')).status, 200);
    const third = await post(msg, 'u1');
    assert.equal(third.status, 429);
    assert.ok(third.headers.get('retry-after'));
    assert.equal(upstreamCalls, 2);
  });

  test('client system message is rejected', async () => {
    const res = await post({ messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'y' }] }, 'u2');
    assert.equal(res.status, 400);
  });
});
