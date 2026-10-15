/**
 * POST /api/partners — validation, honeypot, rate limit, persistence, email.
 * Run via root `node --test` (CI).
 */
import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'node:test';
import { handlePartnerPost } from '../backend/services/partnerSubmit.js';
import { validatePartnerPayload } from '../backend/services/partnerLeads.js';
import { resetPartnerRateLimits } from '../backend/services/partnerRateLimit.js';

const VALID = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines Ltd',
  website: 'https://example.com',
  partnerType: 'software',
  message: 'We would like to integrate our CAM pipeline.',
  company_fax: '',
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

describe('handlePartnerPost', () => {
  beforeEach(() => resetPartnerRateLimits());
  afterEach(() => resetPartnerRateLimits());

  test('stores a valid entry and notifies admin', async () => {
    const model = mockLeadModel();
    const emails = [];
    const out = await invoke(VALID, {
      ...noopMail,
      PartnerLeadModel: model,
      sendNotification: (lead) => { emails.push(lead); return Promise.resolve(true); },
    });
    assert.equal(out.statusCode, 201);
    assert.equal(out.body.ok, true);
    assert.equal(model.saved.length, 1);
    assert.equal(model.saved[0].email, 'ada@example.com');
    assert.equal(emails.length, 1);
  });

  test('honeypot returns ok without saving', async () => {
    const model = mockLeadModel();
    const out = await invoke({ ...VALID, company_fax: 'bot' }, { ...noopMail, PartnerLeadModel: model });
    assert.equal(out.statusCode, 200);
    assert.equal(out.body.ok, true);
    assert.equal(model.saved.length, 0);
  });

  test('rate limit blocks after five posts per IP', async () => {
    const model = mockLeadModel();
    const deps = { ...noopMail, PartnerLeadModel: model };
    for (let i = 0; i < 5; i += 1) {
      const out = await invoke({ ...VALID, email: `user${i}@example.com` }, deps);
      assert.equal(out.statusCode, 201);
    }
    const blocked = await invoke({ ...VALID, email: 'blocked@example.com' }, deps);
    assert.equal(blocked.statusCode, 429);
    assert.match(blocked.body.error, /Too many submissions/);
    assert.equal(model.saved.length, 5);
  });

  test('validation errors are 400', async () => {
    const model = mockLeadModel();
    const out = await invoke({ ...VALID, message: '' }, { ...noopMail, PartnerLeadModel: model });
    assert.equal(out.statusCode, 400);
    assert.equal(out.body.error, 'Message is required');
    assert.equal(model.saved.length, 0);
  });
});
