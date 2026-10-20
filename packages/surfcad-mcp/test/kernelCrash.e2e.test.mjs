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

/**
 * Geometry PR 4, acceptance 8: a kernel crash driven through surfcad-mcp.
 * The tab answers set_script the way the bridge does after a wasm abort
 * (the shape src/agent/state/kernelCrashBridge.test.js pins), and the MCP
 * tool result carries it unchanged: ok false, crash with workerRestarted,
 * one geometry_worker_crashed failure, status failed, and no 60 s wait.
 */

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_BIN = join(PKG_ROOT, 'bin/surfcad-mcp.js');

const CRASH = {
  code: 'geometry_worker_crashed',
  reason: 'out_of_memory',
  workerRestarted: true,
  message: 'The geometry engine ran out of memory building this part (heap 4096 MB). It was restarted; other parts are unaffected. Simplify the part, lower segment counts, or split it up.',
  wasmHeapMB: 4096,
  partId: 'p12',
};
const ROW = {
  code: 'geometry_worker_crashed',
  message: CRASH.message,
  reason: 'out_of_memory',
  workerRestarted: true,
  detail: 'The geometry worker was restarted and other parts kept building. Simplify this part, reduce segment counts, or split it into smaller parts before running it again.',
};
const FAILED_STATUS = { partId: 'p12', partName: 'Clamps', script: 'return part;', runState: 'failed', volume: null, bbox: null, featureCount: 1, bodyCount: null };

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

test('a kernel crash under set_script reaches the MCP client as a structured result, fast', async () => {
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

  let crashed = false;
  const seen = [];
  tab.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (typeof msg.command !== 'string') return;
    seen.push(msg.command);
    const reply = (result) => tab.send(JSON.stringify({ id: msg.id, ok: true, result }));
    if (msg.command === 'set_script') {
      crashed = true;
      reply({ ok: false, errors: [CRASH.message], failures: [ROW], status: FAILED_STATUS, crash: CRASH });
      return;
    }
    if (msg.command === 'status') {
      reply(crashed ? FAILED_STATUS : { ...FAILED_STATUS, runState: 'not_run_yet' });
      return;
    }
    if (msg.command === 'errors') {
      reply({ errors: crashed ? [ROW] : [] });
      return;
    }
    if (msg.command === 'parts') {
      reply({ activeId: 'p12', assemblyName: 'Bike', parts: [
        { id: 'p1', name: 'Frame', visible: true, runState: 'ok' },
        { id: 'p12', name: 'Clamps', visible: true, runState: crashed ? 'failed' : 'not_run_yet', ...(crashed ? { crash: { code: CRASH.code, reason: CRASH.reason, workerRestarted: true, message: CRASH.message } } : {}) },
      ] });
      return;
    }
    reply({});
  });

  const t0 = Date.now();
  const out = await client.callTool({ name: 'set_script', arguments: { part_id: 'p12', source: 'return part;' } });
  const ms = Date.now() - t0;
  assert.equal(out.isError, false, JSON.stringify(out));
  const result = JSON.parse(out.content[0].text);
  assert.equal(result.ok, false);
  assert.equal(result.crash.code, 'geometry_worker_crashed');
  assert.equal(result.crash.reason, 'out_of_memory');
  assert.equal(result.crash.workerRestarted, true);
  assert.equal(result.crash.partId, 'p12');
  assert.equal(result.failures[0].code, 'geometry_worker_crashed');
  assert.match(result.failures[0].detail, /Simplify/);
  assert.equal(result.status.runState, 'failed');
  assert.ok(ms < 5000, `set_script took ${ms} ms`);

  const status = JSON.parse((await client.callTool({ name: 'status', arguments: {} })).content[0].text);
  assert.equal(status.runState, 'failed');
  const errors = JSON.parse((await client.callTool({ name: 'errors', arguments: {} })).content[0].text);
  assert.equal(errors.errors.length, 1);
  assert.equal(errors.errors[0].code, 'geometry_worker_crashed');
  assert.equal(errors.errors[0].workerRestarted, true);
  const parts = JSON.parse((await client.callTool({ name: 'parts', arguments: {} })).content[0].text);
  const clamps = parts.parts.find((row) => row.id === 'p12');
  assert.equal(clamps.runState, 'failed');
  assert.equal(clamps.crash.reason, 'out_of_memory');
  assert.equal(parts.parts.find((row) => row.id === 'p1').runState, 'ok');

  // The tool text tells the agent what the crash means.
  const { tools } = await client.listTools();
  const setScript = tools.find((t) => t.name === 'set_script');
  assert.match(setScript.description, /geometry_worker_crashed/);
  assert.match(setScript.description, /workerRestarted/);
  assert.match(setScript.description, /simplify|Simplify/);
  const run = tools.find((t) => t.name === 'run');
  assert.match(run.description, /geometry_worker_crashed/);
  const insertCube = tools.find((t) => t.name === 'insert_cube');
  assert.match(insertCube.description, /geometry_worker_crashed/);
  assert.ok(seen.includes('set_script'));

  await client.close();
  tab.close();
  await stopAgentBridgeRelay(relay);
});
