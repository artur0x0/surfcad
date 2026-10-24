import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startAgentBridgeRelay, stopAgentBridgeRelay } from '../src/bridge/relayServer.mjs';
import { PAIR_MSG } from '../src/relayMessages.mjs';
import { createPairingToken } from '../../../src/agent/ws/pairingToken.js';
import { loadCommandsCatalog } from '../src/catalog.mjs';
import { PROMPT_TOOL_NAMES } from '../src/prompt/promptTools.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_BIN = join(PKG_ROOT, 'bin/surfcad-mcp.js');

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

function onceJson(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => {
      try {
        resolve(JSON.parse(String(raw)));
      } catch (err) {
        reject(err);
      }
    });
    ws.once('error', reject);
  });
}

test('surfcad-mcp lists bridge tools and calls status through a mocked relay', async () => {
  const catalog = loadCommandsCatalog();
  const token = createPairingToken(6);
  const relay = await startAgentBridgeRelay({ port: 0 });
  const port = relay.server.address().port;
  const url = `ws://127.0.0.1:${port}`;

  const tab = new WebSocket(url);
  await waitOpen(tab);
  tab.send(JSON.stringify({ type: PAIR_MSG.REGISTER_TAB, token }));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_BIN],
    env: {
      ...process.env,
      SURFCAD_MCP_START_RELAY: '0',
      SURFCAD_AGENT_BRIDGE_WS_URL: url,
      SURFCAD_PAIRING_CODE: token,
    },
  });

  const client = new Client({ name: 'surfcad-mcp-test', version: '1.0.0' });
  await client.connect(transport);

  const pairRequest = await onceJson(tab);
  assert.equal(pairRequest.type, PAIR_MSG.PAIR_REQUEST);
  tab.send(JSON.stringify({ type: PAIR_MSG.PAIR_APPROVE }));

  tab.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (typeof msg.command === 'string' && msg.command === 'status') {
      tab.send(JSON.stringify({
        id: msg.id,
        ok: true,
        result: { volume: 42, featureCount: 1 },
      }));
    }
  });

  const { tools } = await client.listTools();
  assert.equal(tools.length, catalog.count + 2 + PROMPT_TOOL_NAMES.length, 'bridge commands, pair, guide, and local prompt tools');
  const names = tools.map((t) => t.name).sort();
  const expected = [...catalog.commands.map((c) => c.name), 'pair', 'guide', ...PROMPT_TOOL_NAMES].sort();
  assert.deepEqual(names, expected);
  for (const name of PROMPT_TOOL_NAMES) {
    assert.equal(catalog.commands.some((command) => command.name === name), false);
  }

  const out = await client.callTool({ name: 'status', arguments: {} });
  assert.equal(out.isError, false);
  const parsed = JSON.parse(out.content[0].text);
  assert.equal(parsed.volume, 42);

  await client.close();
  tab.close();
  await stopAgentBridgeRelay(relay);
});

test('surfcad-mcp returns not_paired without a code', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_BIN],
    env: {
      ...process.env,
      SURFCAD_MCP_START_RELAY: '0',
      SURFCAD_PAIRING_CODE: '',
    },
  });
  const client = new Client({ name: 'surfcad-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  const out = await client.callTool({ name: 'status', arguments: {} });
  assert.equal(out.isError, true);
  const parsed = JSON.parse(out.content[0].text);
  assert.equal(parsed.code, 'not_paired');
  await client.close();
});
