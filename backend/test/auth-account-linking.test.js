/**
 * Guest convert (C1) and OAuth account linking (H2). No live Mongo, no
 * GitHub/Google network: models are array-backed, fetch and email are mocked.
 * Run: cd backend && npm install && node --test test/auth-account-linking.test.js
 */
import assert from 'node:assert/strict';
import { describe, test, before, after, beforeEach } from 'node:test';
import passport from 'passport';
import User from '../db/models/User.js';
import Order from '../db/models/Order.js';
import LoginEvent from '../db/models/LoginEvent.js';
import email from '../services/email.js';
import config from '../config/index.js';
import authRoutes from '../routes/auth.js';
import { initializePassport } from '../auth/passport.js';
import { installFakeModel, patch, startApp, client } from './helpers/fakeDb.js';

const VICTIM = 'victim@example.com';
const ATTACKER_PASSWORD = 'attacker-pass-1';
const BUYER_PASSWORD = 'buyer-pass-1';

let users;
let orders;
let app;
let sentCodes;
const restores = [];

function githubFetch(profileByToken) {
  return async (url, init = {}) => {
    const auth = init.headers?.Authorization || '';
    const token = auth.replace(/^Bearer\s+/, '');
    const profile = profileByToken[token];
    const body = (() => {
      if (!profile) return { message: 'Bad credentials' };
      if (String(url).endsWith('/user/emails')) return profile.emails || [];
      return profile.user;
    })();
    return {
      ok: !!profile,
      status: profile ? 200 : 401,
      json: async () => body,
    };
  };
}

async function githubSignIn(token, profile) {
  const restoreFetch = patch(globalThis, { fetch: githubFetch({ [token]: profile }) });
  try {
    return await client(app.port)('POST', '/api/auth/github', { access_token: token });
  } finally {
    restoreFetch();
  }
}

async function paidGuestOrder(guest, overrides = {}) {
  return orders.insert({
    'order-number': `ORD-202610-${String(orders.rows.length + 1).padStart(4, '0')}ABCD`,
    'guest-email': guest.email,
    'guest-session-id': guest.id,
    status: 'paid',
    'model-data': {
      script: 'box(1,1,1)', process: 'FDM', material: 'PLA', infill: 20, 'volume-mm3': 1,
    },
    quote: { 'material-cost': 1, 'machine-cost': 1, subtotal: 2, 'shipping-cost': 1, total: 3 },
    payment: { 'paid-at': new Date() },
    ...overrides,
  });
}

function googleProfile(id, mail, verified = true) {
  return {
    id,
    displayName: 'Vic Tim',
    name: { givenName: 'Vic', familyName: 'Tim' },
    emails: [{ value: mail, verified }],
  };
}

function runGoogleVerify(profile) {
  const strategy = passport._strategy('google');
  assert.ok(strategy, 'Google strategy must be registered for this suite');
  return new Promise((resolve) => {
    strategy._verify({ session: {} }, 'at', 'rt', profile, (err, user, info) => {
      resolve({ err, user, info });
    });
  });
}

before(async () => {
  users = installFakeModel(User, { unique: ['email'] });
  orders = installFakeModel(Order, { unique: ['order-number'] });
  restores.push(
    () => users.restore(),
    () => orders.restore(),
    patch(LoginEvent, { create: async () => ({}) }),
    patch(email, {
      sendVerificationEmail: async (to, code) => { sentCodes.push({ to, code }); return true; },
      sendAdminNewUserNotification: async () => true,
    }),
    patch(config.google, {
      clientId: 'test-google-id',
      clientSecret: 'test-google-secret',
      callbackUrl: 'http://127.0.0.1/cb',
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
  orders.rows.length = 0;
  sentCodes = [];
});

describe('exploit C1', () => {
  test('guest convert sets a password on an existing OAuth-only account', async () => {
    await users.insert({
      email: VICTIM,
      authProvider: 'google',
      providerId: 'g-victim',
      emailVerified: true,
    });
    const attacker = client(app.port);
    const guest = await attacker('POST', '/api/auth/guest', { email: VICTIM });
    assert.equal(guest.status, 200);
    const converted = await attacker('POST', '/api/auth/guest/convert', { password: ATTACKER_PASSWORD });
    assert.notEqual(converted.status, 200, 'convert must not succeed for an existing account');
    assert.equal(users.find({ email: VICTIM }).passwordHash, null);

    const login = await client(app.port)('POST', '/api/auth/login', {
      email: VICTIM,
      password: ATTACKER_PASSWORD,
    });
    assert.equal(login.status, 401);
    assert.equal(login.body?.user, undefined);
  });

  test('guest convert creates a verified account with no paid order and no code', async () => {
    const attacker = client(app.port);
    await attacker('POST', '/api/auth/guest', { email: 'nobody@example.com' });
    const converted = await attacker('POST', '/api/auth/guest/convert', { password: ATTACKER_PASSWORD });
    assert.notEqual(converted.status, 200);
    assert.equal(users.find({ email: 'nobody@example.com' }), null);
  });
});

describe('exploit H2', () => {
  test('GitHub sign-in must not leave an attacker password on a just-verified account', async () => {
    const attacker = client(app.port);
    const reg = await attacker('POST', '/api/auth/register', {
      email: VICTIM,
      password: ATTACKER_PASSWORD,
    });
    assert.equal(reg.body.pendingVerification, true);
    assert.ok(users.find({ email: VICTIM }).passwordHash);

    const gh = await githubSignIn('victim-token', {
      user: { id: 4242, login: 'victim', email: VICTIM, name: 'Vic Tim' },
      emails: [{ email: VICTIM, primary: true, verified: true }],
    });
    assert.notEqual(gh.status, 200, 'must refuse the link to a never-verified account');
    const row = users.find({ email: VICTIM });
    assert.equal(row.emailVerified, false);
    assert.equal(row.githubId, null);
    assert.ok(row.passwordHash);

    const login = await client(app.port)('POST', '/api/auth/login', {
      email: VICTIM,
      password: ATTACKER_PASSWORD,
    });
    assert.equal(login.body?.user, undefined);
  });

  test('GitHub link login keeps the new session on a verified account', async () => {
    await users.insert({
      email: VICTIM,
      authProvider: 'local',
      emailVerified: true,
    });
    const c = client(app.port);
    const restoreFetch = patch(globalThis, {
      fetch: githubFetch({
        tok: {
          user: { id: 4242, login: 'victim', email: VICTIM, name: 'Vic Tim' },
          emails: [{ email: VICTIM, primary: true, verified: true }],
        },
      }),
    });
    try {
      const gh = await c('POST', '/api/auth/github', { access_token: 'tok' });
      assert.equal(gh.status, 200);
      const me = await c('GET', '/api/auth/me');
      assert.equal(me.body.authenticated, true);
      assert.equal(me.body.user.email, VICTIM);
    } finally {
      restoreFetch();
    }
  });

  test('Google sign-in must not leave an attacker password on a just-verified account', async () => {
    await client(app.port)('POST', '/api/auth/register', {
      email: VICTIM,
      password: ATTACKER_PASSWORD,
    });
    const { err, user } = await runGoogleVerify(googleProfile('g-victim', VICTIM));
    assert.ok(err);
    assert.ok(!user);
    const row = users.find({ email: VICTIM });
    assert.equal(row.emailVerified, false);
    assert.equal(row.authProvider, 'local');
    assert.ok(row.passwordHash);
  });

  test('findOrCreateOAuth refuses a never-verified account for GitHub, Google, and Apple', async () => {
    for (const provider of ['github', 'google', 'apple']) {
      users.rows.length = 0;
      await users.insert({
        email: VICTIM,
        authProvider: 'local',
        emailVerified: false,
        passwordHash: 'planted-hash',
        addresses: [{
          name: 'Mallory',
          street: '1 Evil St',
          city: 'Austin',
          state: 'TX',
          zip: '78701',
        }],
      });

      await assert.rejects(
        () => User.findOrCreateOAuth(googleProfile(`${provider}-1`, VICTIM), provider),
        (e) => e.statusCode === 409,
        provider,
      );
      const row = users.find({ email: VICTIM });
      assert.equal(row.passwordHash, 'planted-hash', provider);
      assert.equal(row.emailVerified, false, provider);
      assert.equal(row.authProvider, 'local', provider);
    }
  });
});

describe('regression', () => {
  test('GitHub sign-in creates a new account', async () => {
    const c = client(app.port);
    const restoreFetch = patch(globalThis, {
      fetch: githubFetch({
        tok: {
          user: { id: 7, login: 'octo', email: 'octo@example.com', name: 'Octo Cat' },
          emails: [{ email: 'octo@example.com', primary: true, verified: true }],
        },
      }),
    });
    try {
      const r = await c('POST', '/api/auth/github', { access_token: 'tok' });
      assert.equal(r.status, 200);
      assert.equal(r.body.isNew, true);
      assert.equal(r.body.user.email, 'octo@example.com');
      assert.equal(users.find({ email: 'octo@example.com' }).githubId, '7');
      assert.equal((await c('GET', '/api/auth/me')).body.authenticated, true);

      const again = await client(app.port)('POST', '/api/auth/github', { access_token: 'tok' });
      assert.equal(again.status, 200);
      assert.equal(again.body.isNew, false);
      assert.equal(users.rows.length, 1);
    } finally {
      restoreFetch();
    }
  });

  test('GitHub sign-in links to an existing verified account', async () => {
    await users.insert({
      email: 'octo@example.com',
      authProvider: 'local',
      emailVerified: true,
    });
    const r = await githubSignIn('tok', {
      user: { id: 8, login: 'octo', email: 'octo@example.com', name: 'Octo' },
      emails: [{ email: 'octo@example.com', primary: true, verified: true }],
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.isNew, false);
    assert.equal(users.find({ email: 'octo@example.com' }).githubId, '8');
  });

  test('Google sign-in creates a new account and finds it again', async () => {
    const first = await runGoogleVerify(googleProfile('g-new', 'new@example.com'));
    assert.equal(first.err, null);
    assert.equal(first.user.email, 'new@example.com');
    assert.equal(first.info.isNew, true);
    const second = await runGoogleVerify(googleProfile('g-new', 'new@example.com'));
    assert.equal(second.err, null);
    assert.equal(second.info.isNew, false);
    assert.equal(String(second.user._id), String(first.user._id));
  });

  test('Google sign-in links to an existing verified account', async () => {
    await users.insert({
      email: 'old@example.com',
      authProvider: 'local',
      emailVerified: true,
    });
    const r = await runGoogleVerify(googleProfile('g-old', 'old@example.com'));
    assert.equal(r.err, null);
    assert.equal(r.user.email, 'old@example.com');
    assert.equal(users.find({ email: 'old@example.com' }).providerId, 'g-old');
    assert.ok(users.find({ email: 'old@example.com' }).passwordHash == null);
  });

  test('email register, verify, and login', async () => {
    const c = client(app.port);
    const reg = await c('POST', '/api/auth/register', {
      email: 'Ada@Example.com',
      password: 'ada-pass-12',
      firstName: 'Ada',
      lastName: 'L',
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.body.pendingVerification, true);
    assert.equal(sentCodes.length, 1);
    assert.equal(JSON.stringify(reg.body).includes(sentCodes[0].code), false);

    const early = await client(app.port)('POST', '/api/auth/login', {
      email: 'ada@example.com',
      password: 'ada-pass-12',
    });
    assert.equal(early.status, 200);
    assert.equal(early.body.pendingVerification, true);
    assert.equal(early.body.user, undefined);

    const code = sentCodes.at(-1).code;
    const verified = await c('POST', '/api/auth/verify', { email: 'ada@example.com', code });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.verified, true);
    assert.equal(verified.body.user.email, 'ada@example.com');

    const login = await client(app.port)('POST', '/api/auth/login', {
      email: 'ada@example.com',
      password: 'ada-pass-12',
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.email, 'ada@example.com');
  });
});

describe('convert-with-code', () => {
  test('a paid guest converts with the emailed code, and the code is single-use', async () => {
    const guest = client(app.port);
    const started = await guest('POST', '/api/auth/guest', { email: 'Buyer@Example.com' });
    await paidGuestOrder(started.body.guest);

    const sent = await guest('POST', '/api/auth/guest/convert/code', {});
    assert.equal(sent.status, 200);
    assert.equal(sentCodes.length, 1);
    assert.equal(sentCodes[0].to, 'buyer@example.com');
    assert.equal(JSON.stringify(sent.body).includes(sentCodes[0].code), false);

    const converted = await guest('POST', '/api/auth/guest/convert', {
      password: BUYER_PASSWORD,
      code: sentCodes[0].code,
    });
    assert.equal(converted.status, 200);
    assert.equal(converted.body.user.email, 'buyer@example.com');
    const row = users.find({ email: 'buyer@example.com' });
    assert.equal(row.emailVerified, true);
    assert.equal(row.authProvider, 'local');

    const me = await guest('GET', '/api/auth/me');
    assert.equal(me.body.authenticated, true);

    const replay = await client(app.port)('POST', '/api/auth/guest/convert', {
      password: 'other-pass-1',
      code: sentCodes[0].code,
    });
    assert.notEqual(replay.status, 200);

    const login = await client(app.port)('POST', '/api/auth/login', {
      email: 'buyer@example.com',
      password: BUYER_PASSWORD,
    });
    assert.equal(login.status, 200);
  });

  test('a paid order in the session is not enough without the emailed code', async () => {
    const guest = client(app.port);
    const started = await guest('POST', '/api/auth/guest', { email: 'buyer@example.com' });
    await paidGuestOrder(started.body.guest);
    const converted = await guest('POST', '/api/auth/guest/convert', {
      password: BUYER_PASSWORD,
      code: '000000',
    });
    assert.notEqual(converted.status, 200);
    assert.equal(users.find({ email: 'buyer@example.com' }), null);
  });

  test('an unpaid order does not unlock a code', async () => {
    const guest = client(app.port);
    const started = await guest('POST', '/api/auth/guest', { email: 'buyer@example.com' });
    await paidGuestOrder(started.body.guest, { status: 'pending', payment: {} });
    const sent = await guest('POST', '/api/auth/guest/convert/code', {});
    assert.equal(sent.status, 403);
    assert.equal(sentCodes.length, 0);
  });

  test('an order from another session does not unlock a code', async () => {
    const guest = client(app.port);
    await guest('POST', '/api/auth/guest', { email: 'buyer@example.com' });
    await paidGuestOrder({ email: 'buyer@example.com', id: 'some-other-session' });
    const sent = await guest('POST', '/api/auth/guest/convert/code', {});
    assert.equal(sent.status, 403);
    assert.equal(sentCodes.length, 0);
  });

  test('an existing account gets the same sign-in message and no code', async () => {
    await users.insert({ email: VICTIM, authProvider: 'local', emailVerified: true });
    const guest = client(app.port);
    const started = await guest('POST', '/api/auth/guest', { email: VICTIM });
    await paidGuestOrder(started.body.guest);
    const sent = await guest('POST', '/api/auth/guest/convert/code', {});
    assert.equal(sent.status, 409);
    assert.match(sent.body.error, /already exists.*sign in/i);
    assert.equal(sentCodes.length, 0);
  });

  test('wrong codes are capped at five attempts', async () => {
    const guest = client(app.port);
    const started = await guest('POST', '/api/auth/guest', { email: 'buyer@example.com' });
    await paidGuestOrder(started.body.guest);
    await guest('POST', '/api/auth/guest/convert/code', {});
    const good = sentCodes[0].code;
    const wrong = good === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i += 1) {
      const r = await guest('POST', '/api/auth/guest/convert', {
        password: BUYER_PASSWORD,
        code: wrong,
      });
      assert.equal(r.status, 400);
    }
    const late = await guest('POST', '/api/auth/guest/convert', {
      password: BUYER_PASSWORD,
      code: good,
    });
    assert.equal(late.status, 400);
    assert.match(late.body.error, /too many attempts/i);
    assert.equal(users.find({ email: 'buyer@example.com' }), null);
  });

  test('an expired code is refused', async (t) => {
    const guest = client(app.port);
    const started = await guest('POST', '/api/auth/guest', { email: 'buyer@example.com' });
    await paidGuestOrder(started.body.guest);
    await guest('POST', '/api/auth/guest/convert/code', {});
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 16 * 60 * 1000 });
    const r = await guest('POST', '/api/auth/guest/convert', {
      password: BUYER_PASSWORD,
      code: sentCodes[0].code,
    });
    t.mock.timers.reset();
    assert.equal(r.status, 400);
    assert.match(r.body.error, /expired/i);
    assert.equal(users.find({ email: 'buyer@example.com' }), null);
  });

  test('code requests have a cooldown', async () => {
    const guest = client(app.port);
    const started = await guest('POST', '/api/auth/guest', { email: 'buyer@example.com' });
    await paidGuestOrder(started.body.guest);
    assert.equal((await guest('POST', '/api/auth/guest/convert/code', {})).status, 200);
    const second = await guest('POST', '/api/auth/guest/convert/code', {});
    assert.equal(second.status, 429);
    assert.equal(sentCodes.length, 1);
  });

  test('changing the guest email drops a pending code', async () => {
    const guest = client(app.port);
    const started = await guest('POST', '/api/auth/guest', { email: 'buyer@example.com' });
    await paidGuestOrder(started.body.guest);
    await guest('POST', '/api/auth/guest/convert/code', {});
    await guest('POST', '/api/auth/guest', { email: VICTIM });
    const r = await guest('POST', '/api/auth/guest/convert', {
      password: BUYER_PASSWORD,
      code: sentCodes[0].code,
    });
    assert.notEqual(r.status, 200);
    assert.equal(users.find({ email: VICTIM }), null);
    assert.equal(users.find({ email: 'buyer@example.com' }), null);
  });
});
