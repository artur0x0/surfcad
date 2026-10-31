/**
 * Stdio surfcad-mcp in remote mode against the in-process server relay.
 * The child is started with --remote and a temp token file. Loopback
 * pairing env vars are removed so a saved login cannot fall back to the
 * local relay. The token is never logged.
 */
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createAgentRelay } from '../../../backend/agent/createRelay.js';
import { attachAgentWebSocket } from '../../../backend/agent/wsServer.js';
import { saveLogin } from '../src/remote/tokenStore.mjs';

const USER_ID = 'user-a';

/**
 * @param {import('ws').WebSocket} ws
 */
function waitOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    ws.once('open', resolve);
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => {
      const status = res.statusCode || 0;
      res.resume();
      reject(new Error(`tab upgrade failed (${status})`));
    });
  });
}

/**
 * @param {import('node:http').Server} server
 * @param {string} dir
 */
async function shutdown(server, dir) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  if (dir) await rm(dir, { recursive: true, force: true });
}

/**
 * @param {ReturnType<typeof createAgentRelay>} relay
 */
async function waitForAgent(relay) {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    if (relay.registry.agentConnected(USER_ID)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for the remote agent hello');
}

/**
 * @param {NodeJS.ProcessEnv} base
 * @param {string} dir
 * @param {string} origin
 */
function remoteChildEnv(base, dir, origin) {
  const env = { ...base };
  delete env.SURFCAD_AGENT_BRIDGE_WS_URL;
  delete env.SURFCAD_AGENT_BRIDGE_WS_PORT;
  delete env.SURFCAD_PAIRING_CODE;
  delete env.SURFCAD_MCP_TRANSPORT;
  delete env.SURFCAD_AGENT_NAME;
  env.SURFCAD_MCP_CONFIG_DIR = dir;
  env.SURFCAD_AGENT_SERVER = origin;
  env.SURFCAD_MCP_START_RELAY = '0';
  return env;
}

/**
 * Spawn bin/surfcad-mcp.js --remote and a browser-origin tab on the same user.
 * `onTabMessage` sees every frame the tab receives, including command requests.
 * @param {{
 *   serverBin: string,
 *   clientName?: string,
 *   clientVersion?: string,
 *   onTabMessage?: (msg: object, tab: import('ws').WebSocket) => void,
 * }} options
 */
export async function openRemoteStdio(options) {
  const relay = createAgentRelay();
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
  /** @type {Client | null} */
  let client = null;
  /** @type {import('ws').WebSocket | null} */
  let tab = null;
  try {
    const issued = await relay.tokens.issue({ userId: USER_ID, label: 'remote-e2e' });
    dir = await mkdtemp(join(tmpdir(), 'surfcad-mcp-remote-e2e-'));
    await saveLogin({
      token: issued.token,
      server: origin,
      name: 'remote-e2e',
      machine: 'test',
    }, { SURFCAD_MCP_CONFIG_DIR: dir });

    /** @type {object[]} */
    const inbound = [];
    tab = new WebSocket(`${origin.replace(/^http/, 'ws')}/agent`, {
      headers: {
        origin: 'https://surfcad.com',
        'x-test-user': USER_ID,
      },
    });
    const liveTab = tab;
    liveTab.on('message', (raw) => {
      /** @type {object} */
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      inbound.push(msg);
      if (options.onTabMessage) options.onTabMessage(msg, liveTab);
    });
    await waitOpen(liveTab);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [options.serverBin, '--remote'],
      env: remoteChildEnv(process.env, dir, origin),
    });
    client = new Client({
      name: options.clientName || 'surfcad-mcp-remote-e2e',
      version: options.clientVersion || '1.0.0',
    });
    await client.connect(transport);
    await waitForAgent(relay);
    const liveClient = client;
    const configDir = dir;
    client = null;
    tab = null;
    dir = '';
    return {
      client: liveClient,
      tab: liveTab,
      inbound,
      relay,
      origin,
      async close() {
        await liveClient.close().catch(() => {});
        try { liveTab.close(); } catch { /* already closed */ }
        await shutdown(server, configDir);
      },
    };
  } catch (err) {
    if (client) await client.close().catch(() => {});
    if (tab) {
      try { tab.close(); } catch { /* already closed */ }
    }
    await shutdown(server, dir);
    throw err;
  }
}
