/**
 * Apple routes when APPLE_* is unset. The strategy is not registered.
 * Run: cd backend && npm install && node --test test/auth-apple-unconfigured.test.js
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import passport from 'passport';
import authRoutes from '../routes/auth.js';
import { initializePassport } from '../auth/passport.js';
import config from '../config/index.js';
import { client, startApp } from './helpers/fakeDb.js';

let app;

before(async () => {
  assert.equal(config.apple.clientId, undefined);
  initializePassport();
  assert.equal(passport._strategy('apple'), undefined);
  app = await startApp((a) => a.use('/api/auth', authRoutes));
});

after(async () => {
  await app?.close();
});

describe('exploit C2 unconfigured', () => {
  test('GET /api/auth/apple refuses cleanly when Apple is not configured', async () => {
    const r = await client(app.port)('GET', '/api/auth/apple');
    assert.ok(r.status === 404 || r.status === 503, `expected 404 or 503, got ${r.status}`);
    assert.ok(!String(r.body?.error || '').includes('Unknown authentication strategy'));
  });

  test('POST /api/auth/apple/callback refuses cleanly when Apple is not configured', async () => {
    const r = await client(app.port)('POST', '/api/auth/apple/callback', { code: 'x' });
    assert.ok(r.status === 404 || r.status === 503, `expected 404 or 503, got ${r.status}`);
  });
});
