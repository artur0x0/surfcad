/**
 * POST /api/partners — validation, honeypot, Turnstile, rate limit, persistence, email.
 * Run via root `node --test` (CI).
 */
import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'node:test';
import { handlePartnerPost } from '../backend/services/partnerSubmit.js';
import { validatePartnerPayload } from '../backend/services/partnerLeads.js';
import { resetPartnerRateLimits } from '../backend/services/partnerRateLimit.js';
import {
  TURNSTILE_TEST_SECRET_ALWAYS_PASS,
  verifyPartnerTurnstile,
} from '../backend/services/partnerTurnstile.js';

const VALID = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines Ltd',
  website: 'https://example.com',
  partnerType: 'software',
  message: 'We would like to integrate our CAM pipeline.',
  company_fax: '',
  turnstileToken: 'test-token',
};

function mockLeadModel() {
  const saved = [];
  return {
    saved,
    create(doc) {
      const row = { _id: `lead-${saved.length + 1}`, createdAt: new Date(), ...doc };
      saved.push(row);
      return Promise.resolve(row);
    },
  };
}

function mockRes() {
  const out = { statusCode: 200, body: undefined, ended: false };
  const res = {
    status(code) {
      out.statusCode = code;
      return res;
    },
    json(payload) {
      out.body = payload;
      out.ended = true;
      return res;
    },
  };
  return { res, out };
}

function mockReq(body, headers = {}) {
  return {
    body,
    headers,
    ip: '203.0.113.10',
    socket: { remoteAddress: '203.0.113.10' },
  };
}

async function invoke(body, deps = {}, headers = {}) {
  const { res, out } = mockRes();
  await handlePartnerPost(mockReq(body, headers), res, deps);
  return out;
}

const passTurnstile = {
  verifyTurnstile: async () => ({ ok: true }),
};

describe('validatePartnerPayload', () => {
  test('accepts a complete payload', () => {
    const result = validatePartnerPayload(VALID);
    assert.equal(result.ok, true);
    assert.equal(result.data.email, 'ada@example.com');
  });

  test('requires core fields', () => {
    assert.equal(validatePartnerPayload({}).ok, false);
    assert.equal(validatePartnerPayload({ ...VALID, email: '' }).error, 'Email is required');
    assert.equal(validatePartnerPayload({ ...VALID, partnerType: 'nope' }).error, 'Partner type is required');
    assert.equal(validatePartnerPayload({ ...VALID, partnerType: 'other', partnerTypeOther: '' }).error,
      'Please describe what you offer');
  });

  test('honeypot is flagged without error text', () => {
    const result = validatePartnerPayload({ ...VALID, company_fax: 'spam' });
    assert.equal(result.ok, false);
    assert.equal(result.honeypot, true);
    assert.equal(result.status, 200);
  });
});

const noopMail = {
  sendNotification: () => Promise.resolve(true),
};

describe('verifyPartnerTurnstile', () => {
  const prevSecret = process.env.TURNSTILE_SECRET_KEY;
  const prevNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = prevSecret;
    process.env.NODE_ENV = prevNodeEnv;
  });

  test('siteverify success accepts token', async () => {
    process.env.TURNSTILE_SECRET_KEY = TURNSTILE_TEST_SECRET_ALWAYS_PASS;
    process.env.NODE_ENV = 'test';
    const fetch = async () => ({
      json: async () => ({ success: true }),
    });
    const result = await verifyPartnerTurnstile('tok', '203.0.113.10', { fetch });
    assert.equal(result.ok, true);
  });

  test('siteverify failure is rejected', async () => {
    process.env.TURNSTILE_SECRET_KEY = TURNSTILE_TEST_SECRET_ALWAYS_PASS;
    process.env.NODE_ENV = 'test';
    const fetch = async () => ({
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    });
    const result = await verifyPartnerTurnstile('bad', '203.0.113.10', { fetch });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.error, /refresh/i);
  });

  test('missing token is rejected when verification is required', async () => {
    process.env.TURNSTILE_SECRET_KEY = TURNSTILE_TEST_SECRET_ALWAYS_PASS;
    process.env.NODE_ENV = 'test';
    const result = await verifyPartnerTurnstile('', '203.0.113.10', {
      fetch: async () => { throw new Error('should not fetch'); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });
});

describe('handlePartnerPost', () => {
  beforeEach(() => resetPartnerRateLimits());
  afterEach(() => resetPartnerRateLimits());

  test('stores a valid entry and notifies admin', async () => {
    const model = mockLeadModel();
    const emails = [];
    const out = await invoke(VALID, {
      ...noopMail,
      ...passTurnstile,
      PartnerLeadModel: model,
      sendNotification: (lead) => { emails.push(lead); return Promise.resolve(true); },
    });
    assert.equal(out.statusCode, 201);
    assert.equal(out.body.ok, true);
    assert.equal(model.saved.length, 1);
    assert.equal(model.saved[0].email, 'ada@example.com');
    assert.equal(emails.length, 1);
  });

  test('honeypot returns ok without saving or verifying turnstile', async () => {
    const model = mockLeadModel();
    let turnstileCalled = false;
    const out = await invoke({ ...VALID, company_fax: 'bot' }, {
      ...noopMail,
      PartnerLeadModel: model,
      verifyTurnstile: async () => {
        turnstileCalled = true;
        return { ok: true };
      },
    });
    assert.equal(out.statusCode, 200);
    assert.equal(out.body.ok, true);
    assert.equal(model.saved.length, 0);
    assert.equal(turnstileCalled, false);
  });

  test('turnstile failure is 400 and does not save', async () => {
    const model = mockLeadModel();
    const out = await invoke(VALID, {
      ...noopMail,
      PartnerLeadModel: model,
      verifyTurnstile: async () => ({
        ok: false,
        status: 400,
        error: 'We could not verify your submission. Please refresh the page and try again.',
      }),
    });
    assert.equal(out.statusCode, 400);
    assert.match(out.body.error, /verify/i);
    assert.equal(model.saved.length, 0);
  });

  test('rate limit blocks after two posts per IP per day', async () => {
    const model = mockLeadModel();
    const deps = { ...noopMail, ...passTurnstile, PartnerLeadModel: model };
    for (let i = 0; i < 2; i += 1) {
      const out = await invoke({ ...VALID, email: `user${i}@example.com` }, deps);
      assert.equal(out.statusCode, 201);
    }
    const blocked = await invoke({ ...VALID, email: 'blocked@example.com' }, deps);
    assert.equal(blocked.statusCode, 429);
    assert.match(blocked.body.error, /Too many submissions/);
    assert.equal(model.saved.length, 2);
  });

  test('validation errors are 400', async () => {
    const model = mockLeadModel();
    const out = await invoke({ ...VALID, message: '' }, {
      ...noopMail,
      ...passTurnstile,
      PartnerLeadModel: model,
    });
    assert.equal(out.statusCode, 400);
    assert.equal(out.body.error, 'Message is required');
    assert.equal(model.saved.length, 0);
  });
});
