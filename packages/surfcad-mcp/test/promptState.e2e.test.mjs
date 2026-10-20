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
 * Agent prompt states (acceptance 11): typing, working, and idle reach the
 * tab as `state` on the status message. Explicit set_status { state },
 * implicit working on the first model-changing tool call, implicit typing
 * on a streamed reply, idle on the final reply, and the legacy boolean.
 */

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

test('typing, working, and idle reach the tab as state, explicitly and implicitly', async () => {
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
  const statuses = [];
  const acks = [];
  const waiters = [];
  tab.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === PAIR_MSG.AGENT_STATUS) {
      statuses.push(msg);
      for (const w of waiters.splice(0)) w();
      return;
    }
    if (msg.type === PAIR_MSG.AGENT_PROMPT_ACK) {
      acks.push(msg);
      for (const w of waiters.splice(0)) w();
      return;
    }
    if (typeof msg.command === 'string') {
      const reply = (result) => tab.send(JSON.stringify({ id: msg.id, ok: true, result }));
      if (msg.command === 'status') reply({ partId: 'p1', runState: 'ok', volume: 1000, featureCount: 1, bodyCount: 1 });
      else reply({ ok: true, errors: [], status: { partId: 'p1', runState: 'ok' } });
    }
  });
  const waitUntil = (pred, what) => new Promise((resolve, reject) => {
    if (pred()) { resolve(); return; }
    const timer = setTimeout(() => reject(new Error(`no ${what} in time`)), 5000);
    const tick = () => { if (pred()) { clearTimeout(timer); resolve(); } else waiters.push(tick); };
    waiters.push(tick);
  });
  const nextStatus = async (after) => {
    await waitUntil(() => statuses.length > after, 'status');
    return statuses[statuses.length - 1];
  };
  const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

  try {
  // Pair first: a prompt from the tab is only accepted by a paired session.
  const pairing = client.callTool({ name: 'pair', arguments: { code: token } });
  const pairRequest = await onceJson(tab);
  assert.equal(pairRequest.type, PAIR_MSG.PAIR_REQUEST);
  tab.send(JSON.stringify({ type: PAIR_MSG.PAIR_APPROVE }));
  const paired = await pairing;
  assert.equal(paired.isError, false, JSON.stringify(paired).slice(0, 200));

  // A prompt from the user, so there is something to be working on.
  const promptId = '22222222-2222-4222-8222-222222222222';
  tab.send(JSON.stringify({ type: PAIR_MSG.AGENT_PROMPT, v: 1, id: promptId, text: 'Add four holes', ts: new Date().toISOString() }));
  await waitUntil(() => acks.some((a) => a.id === promptId), 'prompt ack');
  // The agent reads it (no webhook): that is when it becomes the prompt being worked on.
  const read = await client.callTool({ name: 'read_messages', arguments: {} });
  assert.equal(read.isError, false, JSON.stringify(read).slice(0, 200));
  await settle();
  const base = statuses.length;

  // Explicit typing.
  const typing = await client.callTool({ name: 'set_status', arguments: { state: 'typing', label: 'Writing the plan' } });
  assert.equal(typing.isError, false, JSON.stringify(typing));
  const s1 = await nextStatus(base);
  assert.equal(s1.state, 'typing');
  assert.equal(s1.working, true, 'legacy boolean is true while typing');
  assert.equal(s1.label, 'Writing the plan');
  assert.equal(s1.id, promptId, JSON.stringify({ acks, read: read.content?.map((c) => c.text), s1 }));
  assert.deepEqual(JSON.parse(typing.content[0].text), { working: true, state: 'typing' });

  // A read-only tool does not change the state.
  await client.callTool({ name: 'status', arguments: {} });
  await settle();
  assert.equal(statuses.length, base + 1, 'status (read-only) sent no state');

  // The first model-changing tool switches to working on its own.
  await client.callTool({ name: 'insert_cube', arguments: {} });
  const s2 = await nextStatus(base + 1);
  assert.equal(s2.state, 'working');
  assert.equal(s2.working, true);

  // A second model-changing tool does not repeat it.
  await client.callTool({ name: 'insert_cylinder', arguments: {} });
  await settle();
  assert.equal(statuses.length, base + 2);

  // A streamed reply means typing again; the final reply means idle.
  await client.callTool({ name: 'reply_to_user', arguments: { in_reply_to: promptId, text: 'Added ', final: false } });
  const s3 = await nextStatus(base + 2);
  assert.equal(s3.state, 'typing');
  await client.callTool({ name: 'reply_to_user', arguments: { in_reply_to: promptId, text: 'four holes.', final: true } });
  const s4 = await nextStatus(base + 3);
  assert.equal(s4.state, 'idle');
  assert.equal(s4.working, false);

  // The legacy boolean still works, and a bad state is refused.
  await settle(1100);
  tab.send(JSON.stringify({ type: PAIR_MSG.AGENT_PROMPT, v: 1, id: '33333333-3333-4333-8333-333333333333', text: 'Now a fillet', ts: new Date().toISOString() }));
  await waitUntil(() => acks.some((a) => a.id === '33333333-3333-4333-8333-333333333333'), 'second prompt ack');
  await client.callTool({ name: 'read_messages', arguments: {} });
  await settle();
  const before = statuses.length;
  const legacy = await client.callTool({ name: 'set_status', arguments: { working: true } });
  assert.equal(legacy.isError, false);
  const s5 = await nextStatus(before);
  assert.equal(s5.state, 'working');
  const bad = await client.callTool({ name: 'set_status', arguments: { state: 'dancing' } });
  assert.equal(bad.isError, true);
  const none = await client.callTool({ name: 'set_status', arguments: {} });
  assert.equal(none.isError, true);

  // The tool text tells the agent when to set typing.
  const { tools } = await client.listTools();
  const setStatus = tools.find((t) => t.name === 'set_status');
  assert.match(setStatus.description, /typing/);
  assert.deepEqual(setStatus.inputSchema.properties.state.enum, ['typing', 'working', 'idle']);
  assert.equal(setStatus.inputSchema.required, undefined);
  } finally {
    await client.close().catch(() => {});
    tab.close();
    await stopAgentBridgeRelay(relay);
  }
});
