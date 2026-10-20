import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import User from '../db/models/User.js';
import LoginEvent from '../db/models/LoginEvent.js';
import config from '../config/index.js';
import authRoutes from '../routes/auth.js';
import { initializePassport } from '../auth/passport.js';
import {
  authAnalyticsAllowed,
  captureAuthAnalytics,
  configurePosthogCapture,
  configurePosthogEnv,
  hashDistinctId,
  parseRequestedAnalyticsConsent,
  readRequestedAnalyticsConsent,
  resetPosthogForTests,
  seedUserConsent,
  storedConsentChoice,
} from '../services/posthog.js';
import { client, installFakeModel, patch, startApp } from './helpers/fakeDb.js';

describe('server PostHog auth capture', () => {
  beforeEach(() => {
    resetPosthogForTests();
  });

  test('hashDistinctId is SHA-256 hex of the user id', () => {
    const hashed = hashDistinctId('uid-1');
    assert.equal(hashed, createHash('sha256').update('uid-1').digest('hex'));
    assert.equal(hashed.length, 64);
  });

  test('skips when consent is unknown', () => {
    assert.equal(authAnalyticsAllowed({}), false);
    assert.equal(authAnalyticsAllowed({ requested: undefined, stored: { analytics: true } }), false);
  });

  test('skips when client or stored consent is false', () => {
    assert.equal(authAnalyticsAllowed({ requested: false }), false);
    assert.equal(authAnalyticsAllowed({
      requested: true,
      stored: { analytics: false, updatedAt: new Date() },
    }), false);
  });

  test('allows when the client passed true and storage is not an opt-out', () => {
    assert.equal(authAnalyticsAllowed({ requested: true }), true);
    assert.equal(authAnalyticsAllowed({
      requested: undefined,
      stored: { analytics: true, updatedAt: new Date() },
    }), true);
  });

  test('parseRequestedAnalyticsConsent reads booleans and strings', () => {
    assert.equal(parseRequestedAnalyticsConsent(true), true);
    assert.equal(parseRequestedAnalyticsConsent('false'), false);
    assert.equal(parseRequestedAnalyticsConsent('maybe'), undefined);
  });

  test('readRequestedAnalyticsConsent prefers body then query then session', () => {
    assert.equal(readRequestedAnalyticsConsent({
      body: { analyticsConsent: true },
      query: { analyticsConsent: 'false' },
      session: { analyticsConsent: false },
    }), true);
    assert.equal(readRequestedAnalyticsConsent({
      query: { analyticsConsent: 'false' },
      session: { analyticsConsent: true },
    }), false);
    assert.equal(readRequestedAnalyticsConsent({
      session: { analyticsConsent: true },
    }), true);
    assert.equal(readRequestedAnalyticsConsent({}), undefined);
  });

  test('seedUserConsent writes only when no stored choice exists', () => {
    const user = {};
    assert.equal(seedUserConsent(user, true), true);
    assert.equal(user.consent.analytics, true);
    assert.equal(seedUserConsent(user, false), false);
    assert.equal(user.consent.analytics, true);
  });

  test('captureAuthAnalytics sends signed_up then logged_in for new users', async () => {
    const sent = [];
    configurePosthogEnv({ key: 'phc_test', host: 'https://us.i.posthog.com' });
    configurePosthogCapture((payload) => {
      const { api_key: _key, ...rest } = payload;
      sent.push(rest);
    });
    const out = await captureAuthAnalytics(
      { _id: 'uid-1' },
      { isNew: true, method: 'github', requestedConsent: true },
    );
    assert.deepEqual(out.sent, ['signed_up', 'logged_in']);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].event, 'signed_up');
    assert.equal(sent[1].event, 'logged_in');
    assert.equal(sent[0].distinct_id, hashDistinctId('uid-1'));
    assert.equal(sent[0].properties.method, 'github');
    assert.equal(sent[0].properties.$set.user_type, 'signed_in');
    assert.equal(JSON.stringify(sent).includes('phc_test'), false);
  });

  test('captureAuthAnalytics tags internal users with is_internal on the event and the person', async () => {
    const sent = [];
    configurePosthogEnv({ key: 'phc_test', host: 'https://us.i.posthog.com' });
    configurePosthogCapture((payload) => { sent.push(payload); });
    await captureAuthAnalytics(
      { _id: 'uid-1' },
      { isNew: true, method: 'github', requestedConsent: true, isInternal: true },
    );
    assert.equal(sent.length, 2);
    for (const row of sent) {
      assert.equal(row.properties.is_internal, true);
      assert.equal(row.properties.$set.is_internal, true);
      assert.equal(row.properties.$set.user_type, 'signed_in');
    }
    sent.length = 0;
    await captureAuthAnalytics({ _id: 'uid-2' }, { method: 'password', requestedConsent: true });
    assert.equal(sent.length, 1);
    assert.equal('is_internal' in sent[0].properties, false);
    assert.equal('is_internal' in sent[0].properties.$set, false);
  });

  test('captureAuthAnalytics no-ops without a key', async () => {
    let called = false;
    configurePosthogEnv({ key: '', host: 'https://us.i.posthog.com' });
    configurePosthogCapture(() => { called = true; });
    const out = await captureAuthAnalytics(
      { _id: 'uid-1' },
      { isNew: true, requestedConsent: true },
    );
    assert.deepEqual(out.sent, []);
    assert.equal(called, false);
  });

  test('storedConsentChoice ignores schema default without updatedAt', () => {
    assert.equal(storedConsentChoice({ analytics: true }), null);
    assert.equal(storedConsentChoice({ analytics: true, updatedAt: new Date() }), true);
  });
});

describe('auth routes emit PostHog events with consent', () => {
  let users;
  let app;
  const restores = [];
  const captures = [];

  before(async () => {
    users = installFakeModel(User, { unique: ['email'] });
    restores.push(
      () => users.restore(),
      patch(LoginEvent, { create: async () => ({}) }),
    );
    initializePassport();
    app = await startApp((a) => a.use('/api/auth', authRoutes));
  });

  after(async () => {
    await app?.close();
    for (const restore of restores.reverse()) restore();
    resetPosthogForTests();
  });

  beforeEach(() => {
    users.rows.length = 0;
    captures.length = 0;
    resetPosthogForTests();
    configurePosthogEnv({ key: 'phc_test' });
    configurePosthogCapture((payload) => {
      const { api_key: _key, ...rest } = payload;
      captures.push(rest);
    });
  });

  async function insertLocalUser(email = 'pat@example.com') {
    const inserted = await users.insert({
      email,
      authProvider: 'local',
      emailVerified: true,
    });
    const user = await User.findById(inserted._id);
    await user.setPassword('password12');
    await user.save();
    return user;
  }

  test('login captures logged_in once when consent is true', async () => {
    const user = await insertLocalUser();
    const http = client(app.port);
    const res = await http('POST', '/api/auth/login', {
      email: 'pat@example.com',
      password: 'password12',
      analyticsConsent: true,
    });
    assert.equal(res.status, 200);
    assert.equal(captures.length, 1);
    assert.equal(captures[0].event, 'logged_in');
    assert.equal(captures[0].distinct_id, hashDistinctId(user._id));
    assert.equal(captures[0].properties.method, 'password');
  });

  test('login from a user on the internal list carries is_internal: true', async () => {
    const user = await insertLocalUser();
    user.githubLogin = 'octocat';
    await user.save();
    const saved = config.internalUsers;
    config.internalUsers = new Set(['octocat']);
    try {
      const http = client(app.port);
      const res = await http('POST', '/api/auth/login', {
        email: 'pat@example.com',
        password: 'password12',
        analyticsConsent: true,
      });
      assert.equal(res.status, 200);
      assert.equal(captures.length, 1);
      assert.equal(captures[0].event, 'logged_in');
      assert.equal(captures[0].properties.is_internal, true);
      assert.equal(captures[0].properties.$set.is_internal, true);
    } finally {
      config.internalUsers = saved;
    }
  });

  test('login from an ordinary user carries no is_internal', async () => {
    await insertLocalUser();
    const http = client(app.port);
    const res = await http('POST', '/api/auth/login', {
      email: 'pat@example.com',
      password: 'password12',
      analyticsConsent: true,
    });
    assert.equal(res.status, 200);
    assert.equal(captures.length, 1);
    assert.equal('is_internal' in captures[0].properties, false);
  });

  test('login skips capture when consent is omitted', async () => {
    await insertLocalUser();
    const http = client(app.port);
    const res = await http('POST', '/api/auth/login', {
      email: 'pat@example.com',
      password: 'password12',
    });
    assert.equal(res.status, 200);
    assert.equal(captures.length, 0);
  });

  test('login skips capture when consent is false', async () => {
    await insertLocalUser();
    const http = client(app.port);
    const res = await http('POST', '/api/auth/login', {
      email: 'pat@example.com',
      password: 'password12',
      analyticsConsent: false,
    });
    assert.equal(res.status, 200);
    assert.equal(captures.length, 0);
  });

  test('login JSON includes isInternal boolean', async () => {
    const previous = config.internalUsers;
    config.internalUsers = new Set(['pat@example.com']);
    try {
      await insertLocalUser();
      const http = client(app.port);
      const res = await http('POST', '/api/auth/login', {
        email: 'pat@example.com',
        password: 'password12',
        analyticsConsent: false,
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.user.isInternal, true);
    } finally {
      config.internalUsers = previous;
    }
  });

  test('/me exposes isInternal boolean and never the allowlist', async () => {
    const previous = config.internalUsers;
    config.internalUsers = new Set(['pat@example.com']);
    try {
      await insertLocalUser();
      const http = client(app.port);
      await http('POST', '/api/auth/login', {
        email: 'pat@example.com',
        password: 'password12',
      });
      const me = await http('GET', '/api/auth/me');
      assert.equal(me.status, 200);
      assert.equal(me.body.isInternal, true);
      assert.equal(me.body.user.isInternal, true);
      assert.equal(me.body.isAdmin, false);
      assert.equal(me.body.user.isAdmin, false);
      assert.equal(JSON.stringify(me.body).includes('internalUsers'), false);
    } finally {
      config.internalUsers = previous;
    }
  });
});
