/**
 * E2E: surfcad-mcp over stdio + loopback relay + the real tab client.
 * Pair, kill the tab socket, call (fast pairing_lost), reconnect, call (success).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startAgentBridgeRelay, stopAgentBridgeRelay } from '../src/bridge/relayServer.mjs';
import { liveTab, waitFor } from './liveTab.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_BIN = join(PKG_ROOT, 'bin/surfcad-mcp.js');
const TOKEN = 'ZXC234';

function parse(out) {
  return JSON.parse(out.content[0].text);
}

async function timedCall(client, name) {
  const start = Date.now();
  const out = await client.callTool({ name, arguments: {} }, undefined, { timeout: 10_000 });
  return { ms: Date.now() - start, out, body: parse(out) };
}

test('relay e2e: pair, kill the tab socket, fast pairing_lost, reconnect, success', async () => {
  const relayLog = [];
  const relay = await startAgentBridgeRelay({
    port: 0,
    onLog: (line, level) => relayLog.push({ line, level, at: new Date().toISOString() }),
  });
  const url = `ws://127.0.0.1:${relay.port}`;
  const tab = liveTab(url, TOKEN, {
    call: async (name) => ({ ok: true, result: { command: name, volume: 42 } }),
  });
  tab.connect();
  await waitFor(() => tab.conn.getState() === 'advertising');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_BIN],
    env: {
      ...process.env,
      SURFCAD_MCP_START_RELAY: '0',
      SURFCAD_AGENT_BRIDGE_WS_URL: url,
      SURFCAD_PAIRING_CODE: '',
    },
    stderr: 'pipe',
  });
  let serverStderr = '';
  transport.stderr?.on('data', (chunk) => { serverStderr += String(chunk); });
  const client = new Client({ name: 'surfcad-mcp-reconnect-e2e', version: '1.0.0' });
  await client.connect(transport);

  try {
    const paired = await client.callTool({ name: 'pair', arguments: { code: TOKEN.toLowerCase() } });
    assert.equal(paired.isError, false, paired.content[0].text);
    const ok = await timedCall(client, 'status');
    assert.equal(ok.out.isError, false);
    assert.equal(ok.body.volume, 42);

    tab.killSocket();
    await waitFor(() => relayLog.some((l) => l.line.startsWith('tab dropped')), 2000);

    const lost = await timedCall(client, 'status');
    assert.equal(lost.out.isError, true);
    assert.equal(lost.body.code, 'pairing_lost', JSON.stringify(lost.body));
    assert.equal(lost.body.hint, 'Open SurfCAD in Chrome and keep the tab open; it will reconnect.');
    assert.ok(lost.ms < 2000, `pairing_lost took ${lost.ms}ms`);

    tab.goOnline();
    let back;
    await waitFor(() => tab.conn.getLink() === 'connected', 8000);
    for (let i = 0; i < 40; i += 1) {
      back = await timedCall(client, 'status');
      if (!back.out.isError) break;
      assert.ok(back.ms < 2000, `retry while recovering took ${back.ms}ms`);
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(back.out.isError, false, JSON.stringify(back.body));
    assert.equal(back.body.volume, 42);
    assert.equal(tab.prompts, 1, 'recovery reused the approval');

    const drop = relayLog.find((l) => l.line.startsWith('tab dropped'));
    assert.equal(drop.level, 'warn');
    assert.match(drop.line, /reason=socket_closed code=1006 peer=paired/);
    assert.match(serverStderr, /\d{4}-\d{2}-\d{2}T[\d:.]+Z \[surfcad-mcp\] pairing lost token=ZX\*\*\*\* reason=tab_disconnected/);
    assert.match(serverStderr, /pairing restored token=ZX\*\*\*\*/);
    for (const text of [serverStderr, ...relayLog.map((l) => l.line)]) {
      assert.ok(!text.includes(TOKEN), 'pairing code must not be logged in full');
    }
  } finally {
    await client.close();
    tab.close();
    await stopAgentBridgeRelay(relay);
  }
});
