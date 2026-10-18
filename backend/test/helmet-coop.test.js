/**
 * Helmet on /api must not send COOP same-origin (Safari loopback popup bridge).
 * Run: cd backend && node --test test/helmet-coop.test.js
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import http from 'node:http';

const SERVER_APP = fileURLToPath(new URL('../serverApp.js', import.meta.url));

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

describe('helmet COOP on /api', () => {
  let server;
  let port;

  before(async () => {
    const app = express();
    app.use(helmet({
      contentSecurityPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }));
    app.get('/api/config', (_req, res) => {
      res.json({ ok: true });
    });
    ({ server, port } = await listen(app));
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  test('serverApp sets COOP same-origin-allow-popups', async () => {
    const src = await readFile(SERVER_APP, 'utf8');
    assert.match(
      src,
      /crossOriginOpenerPolicy:\s*\{\s*policy:\s*'same-origin-allow-popups'\s*\}/,
    );
    assert.doesNotMatch(
      src,
      /crossOriginOpenerPolicy:\s*\{\s*policy:\s*'same-origin'\s*\}/,
    );
  });

  test('/api responses send COOP same-origin-allow-popups, not same-origin', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/config`);
    assert.equal(res.status, 200);
    const coop = res.headers.get('cross-origin-opener-policy');
    assert.equal(coop, 'same-origin-allow-popups');
    assert.notEqual(coop, 'same-origin');
  });
});
