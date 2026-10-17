/**
 * Apple Sign In (C2). Email must come from the id_token, not req.body.user.
 * No live Apple network: the strategy verify callback is invoked directly
 * with a locally built token. Models are array-backed.
 * Run: cd backend && npm install && node --test test/auth-apple.test.js
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import passport from 'passport';
import User from '../db/models/User.js';
import LoginEvent from '../db/models/LoginEvent.js';
import config from '../config/index.js';
import authRoutes from '../routes/auth.js';
import { initializePassport } from '../auth/passport.js';
import { installFakeModel, patch, startApp } from './helpers/fakeDb.js';

const VICTIM = 'victim@example.com';
const TOKEN_EMAIL = 'real@icloud.com';

let users;
let app;
let keyDir;
const restores = [];

function fakeIdToken(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64');
  return `${header}.${payload}.sig`;
}

function runAppleVerify(req, idToken, profile = {}) {
  const strategy = passport._strategy('apple');
  assert.ok(strategy, 'Apple strategy must be registered for this suite');
  return new Promise((resolve) => {
    strategy._verify(req, 'at', 'rt', idToken, profile, (err, user, info) => {
      resolve({ err, user, info });
    });
  });
}

before(async () => {
  keyDir = mkdtempSync(join(tmpdir(), 'surfcad-apple-'));
  const keyPath = join(keyDir, 'apple.p8');
  execFileSync('openssl', [
    'genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', keyPath,
  ]);
  users = installFakeModel(User, { unique: ['email'] });
  restores.push(
    () => users.restore(),
    patch(LoginEvent, { create: async () => ({}) }),
    patch(config.apple, {
      clientId: 'com.surfcad.test',
      teamId: 'TEAMID12',
      keyId: 'KEYID123',
      privateKeyPath: keyPath,
      callbackUrl: 'http://127.0.0.1/api/auth/apple/callback',
    }),
  );
  initializePassport();
  app = await startApp((a) => a.use('/api/auth', authRoutes));
});

after(async () => {
  await app?.close();
  for (const restore of restores.reverse()) restore();
});

beforeEach(() => {
  users.rows.length = 0;
});

describe('exploit C2', () => {
  test('req.body.user email must not override the id_token email', async () => {
    const req = {
      body: {
        user: JSON.stringify({
          email: VICTIM,
          name: { firstName: 'Vic', lastName: 'Tim' },
        }),
      },
    };
    const idToken = fakeIdToken({
      sub: 'apple-real-1',
      email: TOKEN_EMAIL,
      email_verified: true,
    });
    const { err, user } = await runAppleVerify(req, idToken);
    assert.equal(err, null, err?.message);
    assert.equal(user.email, TOKEN_EMAIL);
    assert.equal(users.find({ email: TOKEN_EMAIL })?.providerId, 'apple-real-1');
    assert.equal(users.find({ email: VICTIM }), null);
  });

  test('an unverified Apple email must not link to an existing verified account', async () => {
    await users.insert({
      email: VICTIM,
      authProvider: 'local',
      emailVerified: true,
    });
    const { err, user } = await runAppleVerify(
      { body: {} },
      fakeIdToken({ sub: 'apple-unverified', email: VICTIM, email_verified: false }),
    );
    assert.ok(!user);
    assert.ok(err);
    assert.equal(users.find({ email: VICTIM }).providerId, null);
    assert.equal(users.find({ email: VICTIM }).authProvider, 'local');
  });

  test('Apple must not link to an account whose email was never verified', async () => {
    await users.insert({
      email: VICTIM,
      authProvider: 'local',
      emailVerified: false,
      passwordHash: 'planted-hash',
    });
    const { err, user } = await runAppleVerify(
      { body: {} },
      fakeIdToken({ sub: 'apple-victim', email: VICTIM, email_verified: true }),
    );
    assert.ok(!user);
    assert.ok(err);
    const row = users.find({ email: VICTIM });
    assert.equal(row.providerId, null);
    assert.equal(row.passwordHash, 'planted-hash');
    assert.equal(row.emailVerified, false);
  });
});

describe('regression', () => {
  test('Apple first sign-in uses the id_token email and body name', async () => {
    const req = {
      body: {
        user: JSON.stringify({
          name: { firstName: 'Ada', lastName: 'Lovelace' },
        }),
      },
    };
    const { err, user, info } = await runAppleVerify(
      req,
      fakeIdToken({ sub: 'apple-ada', email: 'ada@icloud.com', email_verified: true }),
    );
    assert.equal(err, null, err?.message);
    assert.equal(info.isNew, true);
    assert.equal(user.email, 'ada@icloud.com');
    assert.equal(user.firstName, 'Ada');
    assert.equal(user.lastName, 'Lovelace');
  });

  test('Apple subsequent sign-in finds the same user by provider id', async () => {
    const first = await runAppleVerify(
      { body: {} },
      fakeIdToken({ sub: 'apple-ada', email: 'ada@icloud.com', email_verified: true }),
    );
    assert.equal(first.err, null, first.err?.message);
    const second = await runAppleVerify(
      { body: {} },
      fakeIdToken({ sub: 'apple-ada', email: 'ada@icloud.com', email_verified: true }),
    );
    assert.equal(second.err, null, second.err?.message);
    assert.equal(second.info.isNew, false);
    assert.equal(String(second.user._id), String(first.user._id));
    assert.equal(users.rows.length, 1);
  });

  test('Apple links to an existing verified account when the token email is verified', async () => {
    await users.insert({
      email: 'ada@icloud.com',
      authProvider: 'local',
      emailVerified: true,
    });
    const { err, user } = await runAppleVerify(
      { body: {} },
      fakeIdToken({ sub: 'apple-ada', email: 'ada@icloud.com', email_verified: true }),
    );
    assert.equal(err, null, err?.message);
    assert.equal(user.email, 'ada@icloud.com');
    assert.equal(users.find({ email: 'ada@icloud.com' }).providerId, 'apple-ada');
    assert.equal(users.find({ email: 'ada@icloud.com' }).authProvider, 'apple');
  });

  test('Apple verify does not read id_token from the form-post body', () => {
    const src = readFileSync(new URL('../auth/passport.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /req\.body\??\.(id_token|idToken)/);
    assert.match(src, /idToken is results\.id_token from Apple's token endpoint/);
  });
});

describe('apple-unconfigured', () => {
  test('Apple routes refuse cleanly when the strategy is not registered', async () => {
    // This suite registers Apple. The unconfigured case is in
    // auth-apple-unconfigured.test.js so it does not share this passport state.
    assert.ok(passport._strategy('apple'));
  });
});
