/**
 * S1b leftovers from the #557/#558/#559 review. Each exploit must fail on
 * that stack and pass after the follow-up. No live Mongo or provider network.
 * Run: cd backend && npm install && node --test test/auth-s1b-followups.test.js
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import User from '../db/models/User.js';
import Order from '../db/models/Order.js';
import LoginEvent from '../db/models/LoginEvent.js';
import email from '../services/email.js';
import { fetchGithubUserProfile } from '../services/githubUser.js';
import authRoutes from '../routes/auth.js';
import orderRoutes from '../routes/orders.js';
import { initializePassport } from '../auth/passport.js';
import { resetRegisterCooldowns } from '../auth/registerCooldown.js';
import { client, installFakeModel, patch, startApp } from './helpers/fakeDb.js';

const VICTIM = 'victim@example.com';
const PLANTED = 'planted-pass-1';
const OWNER_PASSWORD = 'owner-pass-12';
const OWNER_ORDER = 'ORD-202610-0001ABCD';
const GUEST_ORDER = 'ORD-202610-0002ABCD';
const MISSING_ORDER = 'ORD-202610-9999DEAD';

let users;
let orders;
let app;
let sentCodes = [];
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

function oauthProfile(id, mail, verified) {
  const emails = verified === undefined
    ? [{ value: mail }]
    : [{ value: mail, verified }];
  return {
    id,
    displayName: 'Vic Tim',
    name: { givenName: 'Vic', familyName: 'Tim' },
    emails,
  };
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

function orderDoc(orderNumber, extra = {}) {
  return {
    'order-number': orderNumber,
    status: 'paid',
    'model-data': {
      script: 'box(1,1,1)', process: 'FDM', material: 'PLA', infill: 20, 'volume-mm3': 10,
    },
    quote: {
      'material-cost': 1, 'machine-cost': 2, subtotal: 3, 'shipping-cost': 4, tax: 0.5, total: 7.5,
    },
    ...extra,
  };
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
  );
  initializePassport();
  app = await startApp((a) => {
    a.use('/api/auth', authRoutes);
    a.use('/api/orders', orderRoutes);
  });
});

after(async () => {
  await app?.close();
  for (const restore of restores.reverse()) restore();
});

function clearRegisterCooldown(email) {
  resetRegisterCooldowns();
  const row = users.find({ email });
  if (row) row.lastVerificationAttempt = null;
}

beforeEach(() => {
  users.rows.length = 0;
  orders.rows.length = 0;
  sentCodes = [];
  resetRegisterCooldowns();
});

describe('exploit S1b-1 register/verify planted password', () => {
  test('the last-register-wins race must not leave a planted password', async () => {
    const attacker = client(app.port);
    const victim = client(app.port);

    const planted = await attacker('POST', '/api/auth/register', {
      email: VICTIM,
      password: PLANTED,
    });
    assert.equal(planted.status, 201);
    assert.equal(users.find({ email: VICTIM }).passwordHash, null);

    clearRegisterCooldown(VICTIM);
    const rereg = await victim('POST', '/api/auth/register', {
      email: VICTIM,
      password: OWNER_PASSWORD,
    });
    assert.equal(rereg.status, 200);

    clearRegisterCooldown(VICTIM);
    const again = await attacker('POST', '/api/auth/register', {
      email: VICTIM,
      password: PLANTED,
    });
    assert.equal(again.status, 200);
    assert.equal(users.find({ email: VICTIM }).passwordHash, null);

    const code = sentCodes.at(-1).code;
    const verified = await victim('POST', '/api/auth/verify', {
      email: VICTIM,
      code,
      password: OWNER_PASSWORD,
    });
    assert.equal(verified.status, 200);

    const withPlanted = await client(app.port)('POST', '/api/auth/login', {
      email: VICTIM,
      password: PLANTED,
    });
    assert.notEqual(withPlanted.status, 200);
    assert.equal(withPlanted.body?.user, undefined);

    const withOwner = await client(app.port)('POST', '/api/auth/login', {
      email: VICTIM,
      password: OWNER_PASSWORD,
    });
    assert.equal(withOwner.status, 200);
    assert.equal(withOwner.body.user.email, VICTIM);
  });

  test('re-register after verify is a no-op on the verified row', async () => {
    const victim = client(app.port);
    await victim('POST', '/api/auth/register', { email: VICTIM, password: OWNER_PASSWORD });
    await victim('POST', '/api/auth/verify', {
      email: VICTIM,
      code: sentCodes.at(-1).code,
      password: OWNER_PASSWORD,
    });

    const attacker = client(app.port);
    const again = await attacker('POST', '/api/auth/register', {
      email: VICTIM,
      password: PLANTED,
    });
    assert.equal(again.status, 409);
    assert.equal(users.find({ email: VICTIM }).emailVerified, true);

    const withPlanted = await client(app.port)('POST', '/api/auth/login', {
      email: VICTIM,
      password: PLANTED,
    });
    assert.equal(withPlanted.status, 401);
    const withOwner = await client(app.port)('POST', '/api/auth/login', {
      email: VICTIM,
      password: OWNER_PASSWORD,
    });
    assert.equal(withOwner.status, 200);
  });

  test('unverified login never succeeds, and register codes have a cooldown', async () => {
    const c = client(app.port);
    assert.equal((await c('POST', '/api/auth/register', {
      email: VICTIM,
      password: PLANTED,
    })).status, 201);
    const login = await c('POST', '/api/auth/login', { email: VICTIM, password: PLANTED });
    assert.equal(login.status, 401);
    assert.equal(login.body?.user, undefined);

    const second = await c('POST', '/api/auth/register', {
      email: VICTIM,
      password: OWNER_PASSWORD,
    });
    assert.equal(second.status, 429);
  });
});

describe('exploit S1b-2 GitHub unverified email link', () => {
  test('unverified GitHub email must not take over a verified account', async () => {
    await users.insert({
      email: VICTIM,
      authProvider: 'local',
      emailVerified: true,
    });

    const gh = await githubSignIn('mallory', {
      user: { id: 4242, login: 'mallory', email: VICTIM, name: 'Mal Lory' },
      emails: [{ email: VICTIM, primary: true, verified: false }],
    });

    const row = users.find({ email: VICTIM });
    assert.equal(row.authProvider, 'local');
    assert.equal(row.githubId, null);
    assert.equal(row.providerId, null);
    assert.notEqual(gh.body?.user?.email, VICTIM);
  });

  test('findOrCreateOAuth auto-links only when provider and account emails are verified', async () => {
    for (const provider of ['github', 'google', 'apple']) {
      users.rows.length = 0;
      await users.insert({
        email: VICTIM,
        authProvider: 'local',
        emailVerified: true,
        passwordHash: 'keep-me',
      });

      await assert.rejects(
        () => User.findOrCreateOAuth(oauthProfile(`${provider}-missing`, VICTIM), provider),
        (e) => e.statusCode === 409,
        `${provider} missing verified flag`,
      );
      await assert.rejects(
        () => User.findOrCreateOAuth(oauthProfile(`${provider}-false`, VICTIM, false), provider),
        (e) => e.statusCode === 409,
        `${provider} verified:false`,
      );

      const linked = await User.findOrCreateOAuth(
        oauthProfile(`${provider}-ok`, VICTIM, true),
        provider,
      );
      assert.equal(linked.isNew, false, provider);
      const row = users.find({ email: VICTIM });
      assert.equal(row.authProvider, provider, provider);
      assert.equal(row.passwordHash, 'keep-me', provider);
    }
  });

  test('verified OAuth email claims a never-verified local row and drops the planted hash', async () => {
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

      const claimed = await User.findOrCreateOAuth(
        oauthProfile(`${provider}-recover`, VICTIM, true),
        provider,
      );
      assert.equal(claimed.isNew, false, provider);
      const row = users.find({ email: VICTIM });
      assert.equal(row.authProvider, provider, provider);
      assert.equal(row.emailVerified, true, provider);
      assert.equal(row.passwordHash, null, provider);
      assert.equal(row.addresses.length, 0, provider);
    }
  });

  test('existing GitHub user rematched by providerId is unaffected by an unverified email', async () => {
    await users.insert({
      email: 'octo@example.com',
      authProvider: 'github',
      providerId: '99',
      githubId: '99',
      emailVerified: true,
    });

    const gh = await githubSignIn('octo', {
      user: { id: 99, login: 'octo', email: VICTIM, name: 'Octo' },
      emails: [{ email: VICTIM, primary: true, verified: false }],
    });
    assert.equal(gh.status, 200);
    assert.equal(gh.body.isNew, false);
    assert.equal(gh.body.user.email, 'octo@example.com');
    assert.equal(users.rows.length, 1);
    assert.equal(users.find({ email: 'octo@example.com' }).githubId, '99');
    assert.equal(users.find({ email: VICTIM }), null);
  });

  test('fetchGithubUserProfile uses only a verified GitHub email', async () => {
    const fetchImpl = async (url) => {
      if (String(url).endsWith('/user')) {
        return {
          ok: true,
          json: async () => ({ id: 7, login: 'mallory', email: VICTIM, name: 'Mal' }),
        };
      }
      return {
        ok: true,
        json: async () => ([{ email: VICTIM, primary: true, verified: false }]),
      };
    };
    const r = await fetchGithubUserProfile({ accessToken: 'tok', fetchImpl });
    assert.equal(r.ok, true);
    assert.notEqual(r.profile.email, VICTIM);
    assert.notEqual(r.profile.emails?.[0]?.verified, true);
  });
});

describe('exploit S1b-3 order existence oracle', () => {
  async function seedOrders() {
    const owner = await users.insert({
      email: 'owner@example.com',
      authProvider: 'local',
      emailVerified: true,
    });
    await orders.insert(orderDoc(OWNER_ORDER, { 'user-id': owner._id }));
    await orders.insert(orderDoc(GUEST_ORDER, { 'guest-email': 'guest@example.com' }));
  }

  test('unauthenticated failures on both lookup routes are indistinguishable 404s', async () => {
    await seedOrders();
    const c = client(app.port);

    const missing = await c('GET', `/api/orders/${MISSING_ORDER}`);
    const owner = await c('GET', `/api/orders/${OWNER_ORDER}`);
    const guestWrong = await c('GET', `/api/orders/${GUEST_ORDER}?email=${encodeURIComponent('other@example.com')}`);
    const lookupMissing = await c('GET', `/api/orders/lookup/${MISSING_ORDER}?email=${encodeURIComponent('other@example.com')}`);
    const lookupOwner = await c('GET', `/api/orders/lookup/${OWNER_ORDER}?email=${encodeURIComponent('other@example.com')}`);
    const lookupGuest = await c('GET', `/api/orders/lookup/${GUEST_ORDER}?email=${encodeURIComponent('other@example.com')}`);

    for (const r of [missing, owner, guestWrong, lookupMissing, lookupOwner, lookupGuest]) {
      assert.equal(r.status, 404, JSON.stringify({ status: r.status, error: r.body?.error }));
      assert.equal(r.body?.error, 'Order not found');
      assert.equal(r.body?.order, undefined);
    }
  });

  test('an authenticated stranger gets the same 404 as a missing order', async () => {
    await seedOrders();
    const stranger = client(app.port);
    await stranger('POST', '/api/auth/register', {
      email: 'stranger@example.com',
      password: OWNER_PASSWORD,
    });
    await stranger('POST', '/api/auth/verify', {
      email: 'stranger@example.com',
      code: sentCodes.at(-1).code,
      password: OWNER_PASSWORD,
    });

    const theirs = await stranger('GET', `/api/orders/${OWNER_ORDER}`);
    const missing = await stranger('GET', `/api/orders/${MISSING_ORDER}`);
    const guestWrong = await stranger('GET', `/api/orders/${GUEST_ORDER}?email=${encodeURIComponent('other@example.com')}`);
    assert.equal(theirs.status, 404);
    assert.equal(missing.status, 404);
    assert.equal(guestWrong.status, 404);
    assert.equal(theirs.body?.error, missing.body?.error);
    assert.equal(theirs.body?.error, 'Order not found');
    assert.equal(theirs.body?.order, undefined);
  });
});

describe('exploit S1b-4 convert/code existence oracle', () => {
  test('without a paid order, existing and unknown emails get the same 403', async () => {
    await users.insert({
      email: VICTIM,
      authProvider: 'local',
      emailVerified: true,
    });

    const existing = client(app.port);
    await existing('POST', '/api/auth/guest', { email: VICTIM });
    const existingCode = await existing('POST', '/api/auth/guest/convert/code', {});

    const unknown = client(app.port);
    await unknown('POST', '/api/auth/guest', { email: 'nobody@example.com' });
    const unknownCode = await unknown('POST', '/api/auth/guest/convert/code', {});

    assert.equal(existingCode.status, 403);
    assert.equal(unknownCode.status, 403);
    assert.equal(existingCode.body?.error, unknownCode.body?.error);
    assert.equal(sentCodes.length, 0);
  });

  test('unpaid convert cannot tell whether the email already exists', async () => {
    await users.insert({
      email: VICTIM,
      authProvider: 'local',
      emailVerified: true,
    });

    const existing = client(app.port);
    await existing('POST', '/api/auth/guest', { email: VICTIM });
    const existingConvert = await existing('POST', '/api/auth/guest/convert', {
      password: OWNER_PASSWORD,
      code: '123456',
    });

    const unknown = client(app.port);
    await unknown('POST', '/api/auth/guest', { email: 'nobody@example.com' });
    const unknownConvert = await unknown('POST', '/api/auth/guest/convert', {
      password: OWNER_PASSWORD,
      code: '123456',
    });

    assert.equal(existingConvert.status, 403);
    assert.equal(unknownConvert.status, 403);
    assert.equal(existingConvert.body?.error, unknownConvert.body?.error);
  });
});

describe('exploit S1b-5 convert cooldown bypass', () => {
  test('flipping guest email must not reset the convert-code cooldown', async () => {
    const guest = client(app.port);
    const started = await guest('POST', '/api/auth/guest', { email: 'buyer@example.com' });
    await paidGuestOrder(started.body.guest);

    const first = await guest('POST', '/api/auth/guest/convert/code', {});
    assert.equal(first.status, 200);
    assert.equal(sentCodes.length, 1);

    await guest('POST', '/api/auth/guest', { email: 'other@example.com' });
    await guest('POST', '/api/auth/guest', { email: 'buyer@example.com' });

    const second = await guest('POST', '/api/auth/guest/convert/code', {});
    assert.equal(second.status, 429);
    assert.equal(sentCodes.length, 1);
  });
});
