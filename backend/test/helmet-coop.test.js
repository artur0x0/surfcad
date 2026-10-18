/**
 * Helmet on the real serverApp must not send COOP same-origin on /api
 * (Safari loopback popup bridge). No live Mongo: we listen on `app` and
 * skip startServer().
 * Run: cd backend && node --test test/helmet-coop.test.js
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';

process.env.SESSION_SECRET ||= 'helmet-coop-test-secret';
delete process.env.MONGODB_URI;

const { app } = await import('../serverApp.js');

function listen(expressApp) {
  return new Promise((resolve) => {
    const server = http.createServer(expressApp);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

describe('helmet COOP on /api', () => {
  let server;
  let port;

  before(async () => {
    ({ server, port } = await listen(app));
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  for (const path of ['/api/health', '/api/config']) {
    test(`${path} sends COOP same-origin-allow-popups, never same-origin`, async () => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(res.status, 200);
      const coop = res.headers.get('cross-origin-opener-policy');
      assert.equal(coop, 'same-origin-allow-popups');
      assert.notEqual(coop, 'same-origin');
    });
  }
});
