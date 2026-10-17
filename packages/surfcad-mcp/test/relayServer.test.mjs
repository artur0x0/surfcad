import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { WebSocket } from 'ws';
import {
  ensureAgentBridgeRelay,
  probeRelayAtUrl,
  resetAgentBridgeRelayCache,
  startAgentBridgeRelay,
  stopAgentBridgeRelay,
} from '../src/bridge/relayServer.mjs';

test.after(() => {
  resetAgentBridgeRelayCache();
});

async function closeRelay(relay) {
  await stopAgentBridgeRelay(relay);
  if (relay?.port != null) resetAgentBridgeRelayCache(relay.port);
}

test('startAgentBridgeRelay binds loopback only', async () => {
  const relay = await startAgentBridgeRelay({ port: 0 });
  const addr = relay.server.address();
  assert.ok(addr && typeof addr === 'object');
  assert.equal(addr.address, '127.0.0.1');
  await closeRelay(relay);
});

test('ensureAgentBridgeRelay reuses an existing listener', async () => {
  const relay = await startAgentBridgeRelay({ port: 0 });
  const port = relay.server.address().port;
  const url = `ws://127.0.0.1:${port}`;
  assert.equal(await probeRelayAtUrl(url), true);

  const second = await ensureAgentBridgeRelay({ port });
  assert.equal(second.url, url);
  assert.equal(second.reused, true);

  await closeRelay(relay);
  resetAgentBridgeRelayCache(port);
});

test('origin allowlist rejects disallowed browser origins on upgrade', async () => {
  const relay = await startAgentBridgeRelay({ port: 0 });
  const port = relay.server.address().port;
  const url = `ws://127.0.0.1:${port}`;

  const ws = new WebSocket(url, { headers: { Origin: 'https://evil.example' } });
  await new Promise((resolve, reject) => {
    ws.once('error', resolve);
    ws.once('open', () => reject(new Error('disallowed origin should not connect')));
  });

  await closeRelay(relay);
});

function rawGet(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET /bridge serves the labelled popup page with locked-down headers', async () => {
  const relay = await startAgentBridgeRelay({ port: 0 });
  const port = relay.server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/bridge?s=abc`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, new RegExp(`connect-src ws://127\\.0\\.0\\.1:${port} ws://localhost:${port}`));
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('cross-origin-opener-policy'), 'unsafe-none');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  const html = await res.text();
  assert.match(html, /<title>SurfCAD local agent bridge<\/title>/);
  assert.match(html, /Keep it open/);
  assert.match(html, /<script type="module" src="\/bridge\.js"><\/script>/);
  assert.doesNotMatch(html, /<script>(?!<)/, 'no inline script');

  const local = await fetch(`http://localhost:${port}/bridge`).catch(() => null);
  if (local) assert.equal(local.status, 200);

  const js = await fetch(`http://127.0.0.1:${port}/bridge.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /^text\/javascript/);
  const source = await js.text();
  assert.equal(source, readFileSync(new URL('../src/bridge/bridgePopup.mjs', import.meta.url), 'utf8'));

  await closeRelay(relay);
});

test('bridge routes refuse a foreign Host header (DNS rebinding)', async () => {
  const relay = await startAgentBridgeRelay({ port: 0 });
  const port = relay.server.address().port;
  const page = await rawGet(port, '/bridge', { Host: `evil.example:${port}` });
  assert.equal(page.status, 403);
  const script = await rawGet(port, '/bridge.js', { Host: 'evil.example' });
  assert.equal(script.status, 403);
  const ok = await rawGet(port, '/bridge', { Host: `127.0.0.1:${port}` });
  assert.equal(ok.status, 200);
  const other = await rawGet(port, '/other', { Host: `127.0.0.1:${port}` });
  assert.equal(other.status, 404);
  await closeRelay(relay);
});

test('bridge page embeds SURFCAD_AGENT_BRIDGE_EXTRA_ORIGINS for the opener check', async () => {
  const prev = process.env.SURFCAD_AGENT_BRIDGE_EXTRA_ORIGINS;
  process.env.SURFCAD_AGENT_BRIDGE_EXTRA_ORIGINS = 'https://staging.example';
  try {
    const relay = await startAgentBridgeRelay({ port: 0 });
    const port = relay.server.address().port;
    const html = await (await fetch(`http://127.0.0.1:${port}/bridge`)).text();
    assert.match(html, /data-extra-origins="\[&quot;https:\/\/staging\.example&quot;\]"/);
    await closeRelay(relay);
  } finally {
    if (prev === undefined) delete process.env.SURFCAD_AGENT_BRIDGE_EXTRA_ORIGINS;
    else process.env.SURFCAD_AGENT_BRIDGE_EXTRA_ORIGINS = prev;
  }
});

test('the bridge page origin may open the relay socket; evil origins still may not', async () => {
  const relay = await startAgentBridgeRelay({ port: 0 });
  const port = relay.server.address().port;
  const url = `ws://127.0.0.1:${port}`;
  const ok = new WebSocket(url, { headers: { Origin: `http://127.0.0.1:${port}` } });
  await new Promise((resolve, reject) => {
    ok.once('open', resolve);
    ok.once('error', reject);
  });
  ok.close();
  const evil = new WebSocket(url, { headers: { Origin: 'https://surfcad.com.evil.example' } });
  await new Promise((resolve, reject) => {
    evil.once('error', resolve);
    evil.once('open', () => reject(new Error('evil origin connected')));
  });
  await closeRelay(relay);
});

test('OPTIONS preflight returns Access-Control-Allow-Private-Network for surfcad.com', async () => {
  const relay = await startAgentBridgeRelay({ port: 0 });
  const port = relay.server.address().port;
  const origin = 'https://surfcad.com';
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Private-Network': 'true',
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), origin);
  assert.equal(res.headers.get('access-control-allow-private-network'), 'true');

  await closeRelay(relay);
});
