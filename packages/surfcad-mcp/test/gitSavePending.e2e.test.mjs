/**
 * stdio: a git_save whose host is still talking to GitHub after the budget
 * answers { status: "running", saveId } as valid JSON well before an MCP
 * client's 60 s timeout, other tools answer meanwhile, and git_save_status
 * returns the save result when it lands. The fake tab runs the real bridge
 * with a slow fake host.
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
import { createSurfcadBridge } from '../../../src/utils/agentBridge.js';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('git_save answers running before the client times out; git_save_status returns the commit', async () => {
  // The bridge runs in this process: shorten its budget from 20 s.
  globalThis.__SURFCAD_AGENT_GIT_SAVE_WAIT_MS = 100;
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
  const client = new Client({ name: 'surfcad-mcp-git-save-pending-test', version: '1.0.0' });
  await client.connect(transport);
  const pairRequest = await onceJson(tab);
  assert.equal(pairRequest.type, PAIR_MSG.PAIR_REQUEST);
  tab.send(JSON.stringify({ type: PAIR_MSG.PAIR_APPROVE }));

  let finishSave;
  const host = {
    readAgentGitAdapterKind: () => 'mock',
    agentGitSave: () => new Promise((r) => { finishSave = r; }),
    readParts: () => ({ assemblyId: 'rig', activeId: 'p1', assemblyName: 'Rig', parts: [{ id: 'p1', name: 'Part 1', visible: true }] }),
  };
  const api = createSurfcadBridge({ resolve: () => host });
  tab.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (typeof msg.command !== 'string' || msg.id == null) return;
    const env = await api.call(msg.command, msg.args || {});
    tab.send(JSON.stringify({
      id: msg.id,
      ok: env.ok === true,
      result: env.ok === true ? env.result : undefined,
      error: env.ok === true ? undefined : env.error,
    }));
  });

  try {
    const t0 = Date.now();
    const out = await client.callTool({ name: 'git_save', arguments: { message: 'Slow save' } });
    const waited = Date.now() - t0;
    assert.equal(out.isError, false, JSON.stringify(out).slice(0, 400));
    const running = JSON.parse(out.content[0].text);
    assert.equal(running.status, 'running');
    assert.match(running.saveId, /^save-/);
    assert.ok(waited < 5000, `answered in ${waited} ms, long before a 60 s client timeout`);

    // Another tool answers while the save is still on the wire.
    const parts = JSON.parse((await client.callTool({ name: 'parts', arguments: {} })).content[0].text);
    assert.equal(parts.assemblyId, 'rig');

    const still = JSON.parse((await client.callTool({ name: 'git_save_status', arguments: { save_id: running.saveId } })).content[0].text);
    assert.equal(still.status, 'running');

    finishSave({ status: 'committed', sha: 'feedface', branch: 'main', files: ['parts/p1.js'] });
    await sleep(10);
    const done = await client.callTool({ name: 'git_save_status', arguments: { save_id: running.saveId } });
    assert.equal(done.isError, false, JSON.stringify(done).slice(0, 400));
    const result = JSON.parse(done.content[0].text);
    assert.equal(result.status, 'committed');
    assert.equal(result.sha, 'feedface');
    assert.equal(result.saveId, running.saveId);
    assert.equal('files' in result, false);

    const unknown = await client.callTool({ name: 'git_save_status', arguments: { save_id: 'save-0-none' } });
    assert.equal(unknown.isError, true);
    const err = JSON.parse(unknown.content[0].text);
    assert.equal(err.code, 'unknown_save');
    assert.match(err.hint, /git_save/);
  } finally {
    delete globalThis.__SURFCAD_AGENT_GIT_SAVE_WAIT_MS;
    await client.close();
    tab.close();
    await stopAgentBridgeRelay(relay);
  }
});
