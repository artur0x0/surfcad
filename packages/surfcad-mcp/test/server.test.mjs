import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
import { agentPromptStallMinutes, AGENT_PROMPT_STALL_MS } from '../src/prompt/promptStall.mjs';
import { MCP_ONLY_GROUP } from '../src/listCommandsMerge.mjs';
import { RelaySession } from '../src/relay.mjs';
import { RemoteSession } from '../src/remote/session.mjs';
import { openRemoteStdio } from './remoteStdio.mjs';

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

/**
 * @param {Client} client
 * @param {ReturnType<typeof loadCommandsCatalog>} catalog
 */
async function assertRegisteredTools(client, catalog) {
  const { tools } = await client.listTools();
  assert.equal(tools.length, catalog.count + 3 + PROMPT_TOOL_NAMES.length, 'bridge commands, pair, guide, list_helpers, and local prompt tools');
  const names = tools.map((t) => t.name).sort();
  const expected = [...catalog.commands.map((c) => c.name), 'pair', 'guide', 'list_helpers', ...PROMPT_TOOL_NAMES].sort();
  assert.deepEqual(names, expected);
  for (const name of PROMPT_TOOL_NAMES) {
    assert.equal(catalog.commands.some((command) => command.name === name), false);
  }
  const setStatus = tools.find((tool) => tool.name === 'set_status');
  assert.match(setStatus.description, /responding/);
  assert.match(setStatus.description, /building/);
  assert.match(setStatus.description, new RegExp(`${agentPromptStallMinutes()} minutes`));

  const out = await client.callTool({ name: 'status', arguments: {} });
  assert.equal(out.isError, false);
  const parsed = JSON.parse(out.content[0].text);
  assert.equal(parsed.volume, 42);
}

/**
 * @param {object} msg
 * @param {import('ws').WebSocket} tab
 */
function answerStatus(msg, tab) {
  if (typeof msg.command === 'string' && msg.command === 'status') {
    tab.send(JSON.stringify({
      id: msg.id,
      ok: true,
      result: { volume: 42, featureCount: 1 },
    }));
  }
}

/**
 * @param {Client} client
 */
async function assertListCommandsMerge(client) {
  const { tools } = await client.listTools();
  const listed = await client.callTool({ name: 'list_commands', arguments: {} });
  assert.equal(listed.isError, false, JSON.stringify(listed));
  const body = JSON.parse(listed.content[0].text);
  const names = new Set(body.commands.map((row) => row.name));
  for (const tool of tools) {
    assert.equal(names.has(tool.name), true, tool.name);
  }
  assert.equal(names.size, tools.length);
  assert.equal(body.commands.find((row) => row.name === 'reply_to_user')?.group, MCP_ONLY_GROUP);
  assert.equal(body.commands.find((row) => row.name === 'set_status')?.group, MCP_ONLY_GROUP);
  const described = tools.find((tool) => tool.name === 'list_commands');
  assert.match(described.description, /reply_to_user/);
  assert.match(described.description, /set_status/);
}

/**
 * @param {import('ws').WebSocket} tab
 * @param {ReturnType<typeof loadCommandsCatalog>} catalog
 * @param {object} msg
 */
function answerListCommands(tab, catalog, msg) {
  if (msg.command !== 'list_commands' || typeof msg.id !== 'string') return;
  tab.send(JSON.stringify({
    id: msg.id,
    ok: true,
    result: {
      commands: catalog.commands.map((row) => ({
        name: row.name,
        schema: row.inputSchema || { type: 'object' },
        example: {},
        group: row.group || 'core',
      })),
      total: catalog.count,
      groups: { core: catalog.count },
    },
  }));
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
    answerStatus(msg, tab);
  });

  await assertRegisteredTools(client, catalog);

  await client.close();
  tab.close();
  await stopAgentBridgeRelay(relay);
});

test('surfcad-mcp lists bridge tools and calls status through the remote relay', async () => {
  const catalog = loadCommandsCatalog();
  const session = await openRemoteStdio({
    serverBin: SERVER_BIN,
    clientName: 'surfcad-mcp-remote-tools',
    onTabMessage: answerStatus,
  });
  try {
    await assertRegisteredTools(session.client, catalog);
  } finally {
    await session.close();
  }
});

test('list_commands includes every tool the server registers', async () => {
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
    try { msg = JSON.parse(String(raw)); } catch { return; }
    answerListCommands(tab, catalog, msg);
  });

  try {
    await assertListCommandsMerge(client);
  } finally {
    await client.close();
    tab.close();
    await stopAgentBridgeRelay(relay);
  }
});

test('list_commands includes every tool the server registers over the remote relay', async () => {
  const catalog = loadCommandsCatalog();
  const session = await openRemoteStdio({
    serverBin: SERVER_BIN,
    clientName: 'surfcad-mcp-remote-tools',
    onTabMessage(msg, tab) {
      answerListCommands(tab, catalog, msg);
    },
  });
  try {
    await assertListCommandsMerge(session.client);
  } finally {
    await session.close();
  }
});

test('local and remote sessions keep the 15 minute prompt stall', () => {
  assert.equal(AGENT_PROMPT_STALL_MS, 15 * 60 * 1000);
  const local = new RelaySession();
  const remote = new RemoteSession({
    serverUrl: 'http://127.0.0.1:9',
    token: 't'.repeat(40),
    name: 'desk',
  });
  try {
    assert.equal(local.prompts.idleMs, AGENT_PROMPT_STALL_MS);
    assert.equal(remote.prompts.idleMs, AGENT_PROMPT_STALL_MS);
  } finally {
    remote.disconnect();
  }
});

test('surfcad-mcp returns not_paired without a code', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_BIN, '--local'],
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

test('remote mode without a saved login tells the user to log in', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'surfcad-mcp-remote-nologin-'));
  const env = { ...process.env };
  delete env.SURFCAD_AGENT_BRIDGE_WS_URL;
  delete env.SURFCAD_AGENT_BRIDGE_WS_PORT;
  delete env.SURFCAD_PAIRING_CODE;
  delete env.SURFCAD_MCP_TRANSPORT;
  env.SURFCAD_MCP_CONFIG_DIR = dir;
  env.SURFCAD_MCP_START_RELAY = '0';
  const child = spawn(process.execPath, [SERVER_BIN, '--remote'], { env });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('remote server stayed up without a login'));
      }, 5000);
      child.on('exit', (status) => {
        clearTimeout(timer);
        resolve(status);
      });
    });
    assert.equal(code, 1);
    assert.match(stderr, /No saved login\. Run npx surfcad-mcp login\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

