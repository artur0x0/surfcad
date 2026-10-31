/**
 * The real serverApp mounts /agent without Mongo. WebSocket upgrade uses
 * the session cookie path; this file only checks that wiring stays up.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { after, describe, test } from 'node:test';
import { WebSocket } from 'ws';
import { MAX_AGENT_MESSAGE_BYTES } from '../agent/limits.js';

process.env.SESSION_SECRET ||= 'agent-relay-mount-test';
delete process.env.MONGODB_URI;

const { app } = await import('../serverApp.js');
const { attachAgentSockets } = await import('../agent/install.js');

const server = http.createServer(app);
attachAgentSockets(server);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

after(() => new Promise((resolve) => server.close(resolve)));

function unexpectedStatus(url, headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.on('error', () => {});
    ws.on('open', () => {
      ws.close();
      reject(new Error('socket opened'));
    });
    ws.on('unexpected-response', (_req, res) => {
      res.resume();
      resolve(res.statusCode);
    });
  });
}

describe('serverApp /agent mount', () => {
  test('health stays up and the approval page requires a session', async () => {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    const page = await fetch(`http://127.0.0.1:${port}/agent`);
    assert.equal(page.status, 401);
    assert.match(await page.text(), /Sign in to SurfCAD/);
    assert.equal(page.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  });

  test('pair start works and the browser socket checks Origin', async () => {
    const bytes = randomBytes(32);
    const deviceSecret = bytes.toString('base64url');
    const started = await fetch(`http://127.0.0.1:${port}/agent/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Cursor',
        machine: 'laptop',
        deviceSecretHash: createHash('sha256').update(bytes).digest('hex'),
      }),
    });
    assert.equal(started.status, 201);
    const body = await started.json();
    assert.match(body.userCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(body.deviceSecret, undefined);
    assert.equal(JSON.stringify(body).includes(deviceSecret), false);
    const url = `ws://127.0.0.1:${port}/agent`;
    assert.equal(await unexpectedStatus(url, { origin: 'https://evil.example' }), 403);
    assert.equal(await unexpectedStatus(url, { origin: 'https://surfcad.com' }), 401);
  });

  test('an /agent JSON body over 256 KiB is rejected before the 10mb parser', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/agent/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Cursor',
        machine: 'laptop',
        blob: 'x'.repeat(MAX_AGENT_MESSAGE_BYTES),
      }),
    });
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.equal(body.error, 'Message exceeds the size cap');
  });
});
