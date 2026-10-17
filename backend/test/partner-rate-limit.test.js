/**
 * Partner form rate limit and client IP (trust proxy).
 * Run: cd backend && npm install && node --test test/partner-rate-limit.test.js
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, test, beforeEach, afterEach } from 'node:test';
import express from 'express';
import { handlePartnerPost } from '../services/partnerSubmit.js';
import { resetPartnerRateLimits } from '../services/partnerRateLimit.js';
import { parseTrustProxyHops } from '../config/index.js';

const PROXY_CLIENT_A = '203.0.113.10';
const PROXY_CLIENT_B = '203.0.113.20';

const VALID_BODY = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines',
  partnerType: 'software',
  message: 'Hello from the test suite.',
  turnstileToken: 'test-token',
};

function jsonRequest(port, { xForwardedFor, body }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/partners',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(xForwardedFor ? { 'X-Forwarded-For': xForwardedFor } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed = {};
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = { _raw: raw };
            }
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** @returns {Promise<{ port: number, close: () => Promise<void> }>} */
function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        close: () => new Promise((done) => server.close(done)),
      });
    });
    server.on('error', reject);
  });
}

function createPartnerApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  const PartnerLeadModel = {
    create: async (doc) => ({ _id: 'lead-test-id', ...doc }),
  };
  app.post('/api/partners', (req, res) =>
    handlePartnerPost(req, res, {
      PartnerLeadModel,
      sendNotification: async () => true,
      verifyTurnstile: async () => ({ ok: true }),
    }),
  );
  return app;
}

describe('parseTrustProxyHops', () => {
  test('defaults empty to 1', () => {
    assert.equal(parseTrustProxyHops(undefined), 1);
    assert.equal(parseTrustProxyHops(''), 1);
  });

  test('accepts non-negative integers', () => {
    assert.equal(parseTrustProxyHops('0'), 0);
    assert.equal(parseTrustProxyHops('2'), 2);
  });
});

describe('POST /api/partners rate limit', () => {
  let port;
  let close;

  beforeEach(async () => {
    resetPartnerRateLimits();
    ({ port, close } = await listen(createPartnerApp()));
  });

  afterEach(async () => {
    if (close) await close();
  });

  function xffFor(clientIp) {
    return `1.2.3.4, ${clientIp}`;
  }

  test('two submissions from one client succeed and the third is rate limited', async () => {
    const xff = xffFor(PROXY_CLIENT_A);
    const first = await jsonRequest(port, { xForwardedFor: xff, body: VALID_BODY });
    const second = await jsonRequest(port, { xForwardedFor: xff, body: VALID_BODY });
    const third = await jsonRequest(port, { xForwardedFor: xff, body: VALID_BODY });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(third.status, 429);
    assert.match(third.body.error, /Too many submissions/);
  });

  test('spoofed X-Forwarded-For first hops do not bypass the limit', async () => {
    const real = PROXY_CLIENT_A;
    for (let i = 0; i < 2; i += 1) {
      const res = await jsonRequest(port, {
        xForwardedFor: `1.2.3.${i + 1}, ${real}`,
        body: VALID_BODY,
      });
      assert.equal(res.status, 201);
    }
    const blocked = await jsonRequest(port, {
      xForwardedFor: `9.9.9.9, 8.8.8.8, 7.7.7.7, ${real}`,
      body: VALID_BODY,
    });
    assert.equal(blocked.status, 429);
  });

  test('two different proxy-added client IPs are counted separately', async () => {
    const a1 = await jsonRequest(port, {
      xForwardedFor: xffFor(PROXY_CLIENT_A),
      body: VALID_BODY,
    });
    const a2 = await jsonRequest(port, {
      xForwardedFor: xffFor(PROXY_CLIENT_A),
      body: VALID_BODY,
    });
    const b1 = await jsonRequest(port, {
      xForwardedFor: xffFor(PROXY_CLIENT_B),
      body: VALID_BODY,
    });
    assert.equal(a1.status, 201);
    assert.equal(a2.status, 201);
    assert.equal(b1.status, 201);
  });
});
