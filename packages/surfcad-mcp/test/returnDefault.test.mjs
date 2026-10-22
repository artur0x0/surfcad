/**
 * Lean responses over MCP: a tool that takes `return` is sent
 * `return: "status"` when the caller omits it, a caller's value passes
 * through, tools without the property are untouched, and the tool text is
 * compact JSON (the indented form was 2.4 times larger).
 */
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
import { withDefaultReturn } from '../src/server.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_BIN = join(PKG_ROOT, 'bin/surfcad-mcp.js');

function waitOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function onceJson(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => {
      try { resolve(JSON.parse(String(raw))); } catch (err) { reject(err); }
    });
    ws.once('error', reject);
  });
}

test('withDefaultReturn fills return only for rows that declare it', () => {
  const catalog = loadCommandsCatalog();
  const byName = new Map(catalog.commands.map((row) => [row.name, row]));
  assert.deepEqual(withDefaultReturn(byName.get('set_script'), { part_id: 'p1', source: 'x' }), { part_id: 'p1', source: 'x', return: 'status' });
  assert.deepEqual(withDefaultReturn(byName.get('status'), {}), { return: 'status' });
  assert.deepEqual(withDefaultReturn(byName.get('undo'), { return: 'full' }), { return: 'full' });
  assert.deepEqual(withDefaultReturn(byName.get('list_faces'), { part_id: 'p1' }), { part_id: 'p1' });
  assert.deepEqual(withDefaultReturn(byName.get('get_script'), {}), {});
  assert.deepEqual(withDefaultReturn(undefined, { a: 1 }), { a: 1 });
  // An older catalog row without the property is left alone.
  assert.deepEqual(withDefaultReturn({ name: 'set_script', mutates: true, args: { properties: { source: {} } } }, { source: 'x' }), { source: 'x' });
  const mutating = catalog.commands.filter((row) => row.mutates === true);
  assert.ok(mutating.length >= 70);
  for (const row of mutating) {
    assert.equal(withDefaultReturn(row, {}).return, 'status', row.name);
  }
});

test('the MCP server sends return: status to the tab unless the caller chose, and answers compact JSON', async () => {
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
    env: { ...process.env, SURFCAD_MCP_START_RELAY: '0', SURFCAD_AGENT_BRIDGE_WS_URL: url, SURFCAD_PAIRING_CODE: token },
  });
  const client = new Client({ name: 'surfcad-mcp-test', version: '1.0.0' });
  await client.connect(transport);

  const pairRequest = await onceJson(tab);
  assert.equal(pairRequest.type, PAIR_MSG.PAIR_REQUEST);
  tab.send(JSON.stringify({ type: PAIR_MSG.PAIR_APPROVE }));

  const received = [];
  tab.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (typeof msg.command !== 'string') return;
    received.push({ command: msg.command, args: msg.args });
    const reply = (result) => tab.send(JSON.stringify({ id: msg.id, ok: true, result }));
    if (msg.command === 'status') {
      reply({ partId: 'p1', partName: 'Frame', runState: 'ok', volume: 42, bbox: { min: [0, 0, 0], max: [1, 2, 3] }, featureCount: 1, bodyCount: 1 });
      return;
    }
    reply({ ok: true, errors: [], status: { partId: 'p1', runState: 'ok', featureCount: 1 } });
  });

  await client.callTool({ name: 'set_script', arguments: { part_id: 'p1', source: 'return part;' } });
  await client.callTool({ name: 'insert_cube', arguments: { width: 10 } });
  await client.callTool({ name: 'undo', arguments: { return: 'full' } });
  await client.callTool({ name: 'list_faces', arguments: { part_id: 'p1' } });
  const status = await client.callTool({ name: 'status', arguments: {} });

  const byCommand = Object.fromEntries(received.map((row) => [row.command, row.args]));
  assert.deepEqual(byCommand.set_script, { part_id: 'p1', source: 'return part;', return: 'status' });
  assert.deepEqual(byCommand.insert_cube, { width: 10, return: 'status' });
  assert.deepEqual(byCommand.undo, { return: 'full' }, 'a caller value is not replaced');
  assert.deepEqual(byCommand.list_faces, { part_id: 'p1' }, 'a reader without the property is untouched');
  assert.deepEqual(byCommand.status, { return: 'status' });

  const text = status.content[0].text;
  assert.equal(text.includes('\n'), false, 'compact JSON');
  const parsed = JSON.parse(text);
  assert.equal(parsed.volume, 42);
  assert.deepEqual(parsed.bbox, { min: [0, 0, 0], max: [1, 2, 3] });
  assert.equal(typeof parsed.webhookRegistered, 'boolean');

  await client.close();
  tab.close();
  await stopAgentBridgeRelay(relay);
});
