/**
 * The normal external-MCP flow: a fresh surfcad-mcp process per tool call.
 * Five real children, each spawn → one tools/call → close, with a 1–3s gap.
 * The tab must not see connected:false or the generic disconnect toast.
 * Offline only after close_session, revoke, or the 10-minute idle clock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket } from 'ws';
import { createAgentRelay } from '../../../backend/agent/createRelay.js';
import { createManualClock } from '../../../backend/agent/clock.js';
import { AGENT_PRESENCE_TTL_MS } from '../../../backend/agent/limits.js';
import { revokeRelayUser } from '../../../backend/agent/install.js';
import { attachAgentWebSocket } from '../../../backend/agent/wsServer.js';
import { saveLogin } from '../src/remote/tokenStore.mjs';
import {
  AGENT_DISCONNECTED_TOAST_COPY,
  agentDisconnectToastCopy,
  shouldToastAgentDisconnect,
  stepAgentSessionToast,
} from '../../../src/agent/ws/pairingFlow.js';
import { oneShotToolCall, remoteChildEnv } from './perCallChild.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_BIN = join(PKG_ROOT, 'bin/surfcad-mcp.js');
const USER_ID = 'user-per-call';
/** Inside the 1–3s gap a per-call harness leaves between tool processes. */
const GAP_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The pairing page's disconnect decision, fed the frames the tab socket got.
 */
function watchPage() {
  let wasLive = false;
  /** @type {string[]} */
  const toasts = [];
  /** @type {{ connected: boolean, reason: string | null }[]} */
  const agentFrames = [];
  return {
    toasts,
    agentFrames,
    observe(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type !== 'agent' && msg.type !== 'registered') return;
      const connected = msg.type === 'registered'
        ? msg.agentConnected === true
        : msg.connected === true;
      const source = msg.type === 'registered' ? 'registered' : 'agent';
      const reason = typeof msg.reason === 'string' ? msg.reason : null;
      if (msg.type === 'agent') agentFrames.push({ connected, reason });
      if (connected) {
        wasLive = true;
        return;
      }
      if (source === 'agent' || wasLive) {
        const live = wasLive;
        wasLive = false;
        if (shouldToastAgentDisconnect({ wasLive: live })) {
          const toast = stepAgentSessionToast(null, 'disconnected', 1, { reason });
          toasts.push(agentDisconnectToastCopy(toast.reason, AGENT_DISCONNECTED_TOAST_COPY));
        }
      }
    },
  };
}

function waitOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

/**
 * @param {() => boolean} pred
 * @param {string} label
 */
async function waitFor(pred, label) {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (pred()) return;
    await sleep(20);
  }
  throw new Error(label);
}

test('a fresh surfcad-mcp process per tool call stays present', { timeout: 120_000 }, async () => {
  assert.ok(GAP_MS >= 1000 && GAP_MS <= 3000);
  const clock = createManualClock(1_700_000_000_000);
  const relay = createAgentRelay({ clock });
  const app = express();
  app.use(express.json());
  app.use('/agent', relay.router);
  const server = http.createServer(app);
  attachAgentWebSocket(server, relay, {
    authenticateUpgrade: async (req) => {
      const id = req.headers['x-test-user'];
      return typeof id === 'string' && id ? { id } : null;
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  const origin = `http://127.0.0.1:${port}`;
  let dir = '';
  /** @type {import('ws').WebSocket | null} */
  let tab = null;
  try {
    const issued = await relay.tokens.issue({ userId: USER_ID, label: 'per-call' });
    dir = await mkdtemp(join(tmpdir(), 'surfcad-mcp-per-call-'));
    const env = remoteChildEnv(process.env, dir, origin);
    await saveLogin({
      token: issued.token,
      server: origin,
      name: 'per-call',
      machine: 'test',
    }, env);

    const page = watchPage();
    tab = new WebSocket(`${origin.replace(/^http/, 'ws')}/agent`, {
      headers: {
        origin: 'https://surfcad.com',
        'x-test-user': USER_ID,
      },
    });
    tab.on('message', (raw) => {
      /** @type {any} */
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      page.observe(msg);
      if (typeof msg.command === 'string') {
        tab.send(JSON.stringify({
          id: msg.id,
          ok: true,
          result: { runState: 'ok' },
        }));
      }
    });
    await waitOpen(tab);

    for (let i = 0; i < 5; i += 1) {
      const out = await oneShotToolCall({ bin: SERVER_BIN, env, name: 'status' });
      assert.equal(out.isError, false, JSON.stringify(out).slice(0, 400));
      await sleep(GAP_MS);
      assert.equal(
        page.agentFrames.filter((frame) => frame.connected === false).length,
        0,
        JSON.stringify(page.agentFrames),
      );
      assert.deepEqual(page.toasts, []);
      assert.equal(relay.registry.agentConnected(USER_ID), true);
    }
    assert.ok(page.agentFrames.some((frame) => frame.connected === true));

    const closed = await oneShotToolCall({ bin: SERVER_BIN, env, name: 'close_session' });
    assert.equal(closed.isError, false, JSON.stringify(closed).slice(0, 400));
    await waitFor(
      () => page.agentFrames.some((frame) => frame.connected === false && frame.reason === 'closed'),
      'close_session did not mark the agent offline',
    );
    await sleep(GAP_MS);
    assert.deepEqual(
      page.agentFrames.filter((frame) => frame.connected === false),
      [{ connected: false, reason: 'closed' }],
    );
    assert.equal(relay.registry.agentConnected(USER_ID), false);
    assert.deepEqual(page.toasts, ['Agent ended the session']);

    const returned = await oneShotToolCall({ bin: SERVER_BIN, env, name: 'status' });
    assert.equal(returned.isError, false, JSON.stringify(returned).slice(0, 400));
    await sleep(GAP_MS);
    assert.equal(relay.registry.agentConnected(USER_ID), true);
    assert.equal(page.agentFrames.filter((frame) => frame.connected === false).length, 1);

    await revokeRelayUser(relay, USER_ID);
    await waitFor(
      () => page.agentFrames.some((frame) => frame.reason === 'revoked'),
      'revoke did not mark the agent offline',
    );
    assert.equal(relay.registry.agentConnected(USER_ID), false);
    assert.deepEqual(page.toasts, ['Agent ended the session', 'Agent access revoked']);

    const again = await relay.tokens.issue({ userId: USER_ID, label: 'per-call-2' });
    await saveLogin({
      token: again.token,
      server: origin,
      name: 'per-call',
      machine: 'test',
    }, env);
    const afterRevoke = await oneShotToolCall({ bin: SERVER_BIN, env, name: 'status' });
    assert.equal(afterRevoke.isError, false, JSON.stringify(afterRevoke).slice(0, 400));
    await sleep(GAP_MS);
    assert.equal(relay.registry.agentConnected(USER_ID), true);

    clock.advance(AGENT_PRESENCE_TTL_MS - 1);
    assert.equal(relay.registry.agentConnected(USER_ID), true);
    assert.equal(page.agentFrames.filter((frame) => frame.reason === 'inactive').length, 0);
    clock.advance(1);
    assert.equal(relay.registry.agentConnected(USER_ID), false);
    await waitFor(
      () => page.agentFrames.some((frame) => frame.reason === 'inactive'),
      'the 10-minute idle did not mark the agent offline',
    );
    assert.deepEqual(page.toasts, [
      'Agent ended the session',
      'Agent access revoked',
      'Agent disconnected: inactive for 10 min',
    ]);
    assert.equal(page.toasts.includes(AGENT_DISCONNECTED_TOAST_COPY), false);
  } finally {
    if (tab) {
      try { tab.close(); } catch { /* already closed */ }
    }
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});
