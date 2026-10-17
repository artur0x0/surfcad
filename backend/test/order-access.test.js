/**
 * Order lookup (H1). Unauthenticated requests must not read a signed-in
 * user's order. No live Mongo or Stripe: models are array-backed.
 * Run: cd backend && npm install && node --test test/order-access.test.js
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import User from '../db/models/User.js';
import Order from '../db/models/Order.js';
import LoginEvent from '../db/models/LoginEvent.js';
import email from '../services/email.js';
import authRoutes from '../routes/auth.js';
import orderRoutes from '../routes/orders.js';
import { initializePassport } from '../auth/passport.js';
import { createOrderLookupLimiter } from '../auth/orderAccess.js';
import { resetRegisterCooldowns } from '../auth/registerCooldown.js';
import { client, installFakeModel, patch, startApp } from './helpers/fakeDb.js';

const OWNER_EMAIL = 'owner@example.com';
const OWNER_PASSWORD = 'owner-pass-1';
const GUEST_EMAIL = 'guest@example.com';
const OWNER_ORDER = 'ORD-202610-0001ABCD';
const GUEST_ORDER = 'ORD-202610-0002ABCD';

let users;
let orders;
let app;
let sentCodes = [];
const restores = [];

function sensitiveFields(order) {
  return {
    ip: order?.metadata?.['ip-address'],
    ua: order?.metadata?.['user-agent'],
    stripeCustomer: order?.payment?.['stripe-customer-id'],
    cardLast4: order?.payment?.['card-last4'],
    cardBrand: order?.payment?.['card-brand'],
    internalNote: order?.notes?.internal,
    phone: order?.shipping?.address?.phone,
    street: order?.shipping?.address?.['address-1'],
    name: order?.shipping?.address?.name,
  };
}

function hasLeak(order) {
  const s = sensitiveFields(order);
  return Boolean(s.ip || s.ua || s.stripeCustomer || s.cardLast4 || s.cardBrand || s.internalNote);
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
    shipping: {
      address: {
        name: 'Ada Lovelace',
        'address-1': '1 Secret St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        country: 'US',
        phone: '5125550100',
      },
      method: 'ground',
      service: 'UPS Ground',
      'tracking-number': '1Z999',
      'tracking-url': 'https://www.ups.com/track?1Z999',
    },
    payment: {
      'stripe-customer-id': 'cus_secret',
      'stripe-payment-intent-id': 'pi_secret',
      'card-last4': '4242',
      'card-brand': 'visa',
    },
    notes: { internal: 'chargeback risk', customer: 'leave at door' },
    metadata: { 'ip-address': '203.0.113.9', 'user-agent': 'SecretUA/1.0' },
    ...extra,
  };
}

async function registerVerifyLogin() {
  const c = client(app.port);
  await c('POST', '/api/auth/register', { email: OWNER_EMAIL, password: OWNER_PASSWORD, firstName: 'Ada' });
  await c('POST', '/api/auth/verify', {
    email: OWNER_EMAIL,
    code: sentCodes.at(-1).code,
    password: OWNER_PASSWORD,
  });
  return c;
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

beforeEach(async () => {
  users.rows.length = 0;
  orders.rows.length = 0;
  sentCodes = [];
  resetRegisterCooldowns();
});

describe('exploit H1', () => {
  test('unauthenticated request without email must not read a signed-in user order', async () => {
    const owner = await users.insert({
      email: OWNER_EMAIL,
      authProvider: 'local',
      emailVerified: true,
    });
    await orders.insert(orderDoc(OWNER_ORDER, { 'user-id': owner._id }));

    const r = await client(app.port)('GET', `/api/orders/${OWNER_ORDER}`);
    assert.equal(r.status, 404);
    assert.equal(r.body?.error, 'Order not found');
    assert.equal(r.body?.order, undefined);
  });
});

describe('order-projection', () => {
  test('guest lookup omits IP, UA, Stripe, card, and internal notes', async () => {
    await orders.insert(orderDoc(GUEST_ORDER, { 'guest-email': GUEST_EMAIL }));
    const r = await client(app.port)('GET', `/api/orders/${GUEST_ORDER}?email=${encodeURIComponent(GUEST_EMAIL)}`);
    assert.equal(r.status, 200);
    assert.ok(!hasLeak(r.body.order));
    assert.equal(r.body.order.shipping?.address, undefined);
    assert.equal(r.body.order.shipping?.phone, undefined);
  });

  test('empty email query must not match a missing guest-email', async () => {
    const owner = await users.insert({
      email: OWNER_EMAIL,
      authProvider: 'local',
      emailVerified: true,
    });
    await orders.insert(orderDoc(OWNER_ORDER, { 'user-id': owner._id }));
    const r = await client(app.port)('GET', `/api/orders/${OWNER_ORDER}?email=`);
    assert.notEqual(r.status, 200);
    assert.equal(r.body?.order, undefined);
  });
});

describe('regression', () => {
  test('signed-in owner can view their own order', async () => {
    const c = await registerVerifyLogin();
    const owner = users.find({ email: OWNER_EMAIL });
    await orders.insert(orderDoc(OWNER_ORDER, { 'user-id': owner._id }));

    const r = await c('GET', `/api/orders/${OWNER_ORDER}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.order.orderNumber || r.body.order['order-number'], OWNER_ORDER);
    assert.equal(r.body.order.status, 'paid');
    assert.equal(r.body.order.quote.total, 7.5);
  });

  test('guest can look up their order by matching email', async () => {
    await orders.insert(orderDoc(GUEST_ORDER, { 'guest-email': GUEST_EMAIL }));
    const r = await client(app.port)('GET', `/api/orders/${GUEST_ORDER}?email=${encodeURIComponent(GUEST_EMAIL)}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.order.status, 'paid');
    assert.equal(r.body.order.quote.total, 7.5);
    const tracking = r.body.order.shipping?.['tracking-number'] || r.body.order.shipping?.trackingNumber;
    assert.equal(tracking, '1Z999');
  });

  test('guest lookup is case-insensitive', async () => {
    await orders.insert(orderDoc(GUEST_ORDER, { 'guest-email': GUEST_EMAIL }));
    const r = await client(app.port)('GET', `/api/orders/${GUEST_ORDER}?email=${encodeURIComponent('Guest@Example.com')}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.order.status, 'paid');
  });

  test('lookup route is rate-limited', async () => {
    const limitedApp = await startApp((a) => {
      a.get('/lookup', createOrderLookupLimiter({ windowMs: 60_000, limit: 2 }), (_req, res) => {
        res.json({ ok: true });
      });
    });
    try {
      const c = client(limitedApp.port);
      assert.equal((await c('GET', '/lookup')).status, 200);
      assert.equal((await c('GET', '/lookup')).status, 200);
      const third = await c('GET', '/lookup');
      assert.equal(third.status, 429);
    } finally {
      await limitedApp.close();
    }
  });

  test('wrong guest email does not reveal the order', async () => {
    await orders.insert(orderDoc(GUEST_ORDER, { 'guest-email': GUEST_EMAIL }));
    const r = await client(app.port)('GET', `/api/orders/${GUEST_ORDER}?email=${encodeURIComponent('other@example.com')}`);
    assert.notEqual(r.status, 200);
    assert.equal(r.body?.order, undefined);
  });
});
