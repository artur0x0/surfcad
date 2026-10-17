import test from 'node:test';
import assert from 'node:assert/strict';
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
