/**
 * Stdio e2e: reply_to_user rejects an id this session never received, a
 * real reply (including several non-final chunks and a final one after
 * read_messages acked the prompt) still reaches the tab, and a later
 * read_messages lists those ids in `recent`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startAgentBridgeRelay, stopAgentBridgeRelay } from '../src/bridge/relayServer.mjs';
import { PAIR_MSG } from '../src/relayMessages.mjs';
import { createPairingToken } from '../../../src/agent/ws/pairingToken.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_BIN = join(PKG_ROOT, 'bin/surfcad-mcp.js');
const PROMPT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const PROMPT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

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
      try { resolve(JSON.parse(String(raw))); } catch (err) { reject(err); }
    });
    ws.once('error', reject);
  });
}

function texts(out) {
  return (out?.content || []).filter((block) => block.type === 'text').map((block) => block.text || '');
}

function jsonBlocks(out) {
  return texts(out).map((text) => JSON.parse(text));
}

function settle(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {Array<object>} inbound
 * @param {(msg: object) => boolean} pred
 * @param {number} [timeoutMs]
 */
async function waitFor(inbound, pred, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = inbound.find(pred);
    if (found) return found;
    await settle(20);
  }
  throw new Error('timed out waiting for a relay frame');
}

async function pairedSession() {
  const token = createPairingToken(6);
  const relay = await startAgentBridgeRelay({ port: 0 });
  const port = relay.server.address().port;
  const url = `ws://127.0.0.1:${port}`;
  const tab = new WebSocket(url);
  await waitOpen(tab);
  const inbound = [];
  tab.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    inbound.push(msg);
    if (typeof msg.command === 'string') {
      tab.send(JSON.stringify({
        id: msg.id,
        ok: true,
        result: { partId: 'p1', runState: 'ok', volume: 1 },
      }));
    }
  });
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
  const pairing = client.callTool({ name: 'pair', arguments: { code: token } });
  const pairRequest = await onceJson(tab);
  assert.equal(pairRequest.type, PAIR_MSG.PAIR_REQUEST);
  tab.send(JSON.stringify({ type: PAIR_MSG.PAIR_APPROVE }));
  const paired = await pairing;
  assert.equal(paired.isError, false, JSON.stringify(paired).slice(0, 240));
  return {
    client,
    tab,
    relay,
    inbound,
    async close() {
      await client.close().catch(() => {});
      tab.close();
      await stopAgentBridgeRelay(relay);
    },
  };
}

/**
 * @param {import('ws').WebSocket} tab
 * @param {Array<object>} inbound
 * @param {string} id
 * @param {string} text
 */
async function sendPrompt(tab, inbound, id, text) {
  tab.send(JSON.stringify({
    type: PAIR_MSG.AGENT_PROMPT,
    v: 1,
    id,
    text,
    ts: new Date().toISOString(),
  }));
  const ack = await waitFor(inbound, (msg) => msg.type === PAIR_MSG.AGENT_PROMPT_ACK && msg.id === id);
  assert.equal(ack.delivery, 'queued');
}

test('reply_to_user rejects an unknown id and still delivers a real reply', async () => {
  const session = await pairedSession();
  try {
    await sendPrompt(session.tab, session.inbound, PROMPT_A, 'Add four holes');
    const read = await session.client.callTool({ name: 'read_messages', arguments: {} });
    assert.equal(read.isError, false, JSON.stringify(read).slice(0, 240));
    assert.equal(jsonBlocks(read).some((row) => row.id === PROMPT_A), true);

    const before = session.inbound.length;
    const unknown = await session.client.callTool({
      name: 'reply_to_user',
      arguments: { in_reply_to: 'x', text: 'probe' },
    });
    assert.equal(unknown.isError, true);
    const rejected = JSON.parse(texts(unknown)[0] || '{}');
    assert.equal(rejected.code, 'unknown_prompt');
    await settle(200);
    const afterUnknown = session.inbound.slice(before);
    assert.equal(afterUnknown.some((msg) => msg.type === PAIR_MSG.AGENT_REPLY), false);
    assert.equal(afterUnknown.some((msg) => JSON.stringify(msg).includes('probe')), false);

    const partials = [
      { text: 'Added ', final: false },
      { text: 'four holes.', final: false },
    ];
    for (const part of partials) {
      const out = await session.client.callTool({
        name: 'reply_to_user',
        arguments: { in_reply_to: PROMPT_A, text: part.text, final: part.final },
      });
      assert.equal(out.isError, false, JSON.stringify(out).slice(0, 240));
      assert.deepEqual(JSON.parse(texts(out)[0]), { id: PROMPT_A, final: false });
    }
    const closing = await session.client.callTool({
      name: 'reply_to_user',
      arguments: { in_reply_to: PROMPT_A, text: 'Done.', final: true },
    });
    assert.equal(closing.isError, false, JSON.stringify(closing).slice(0, 240));
    assert.deepEqual(JSON.parse(texts(closing)[0]), { id: PROMPT_A, final: true });

    const replies = [];
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && replies.length < 3) {
      replies.splice(0, replies.length, ...session.inbound.filter(
        (msg) => msg.type === PAIR_MSG.AGENT_REPLY && msg.id === PROMPT_A,
      ));
      if (replies.length < 3) await settle(20);
    }
    assert.deepEqual(replies.map((msg) => msg.text), ['Added ', 'four holes.', 'Done.']);
    assert.deepEqual(replies.map((msg) => msg.final), [false, false, true]);
    assert.equal(session.inbound.some((msg) => msg.type === PAIR_MSG.AGENT_REPLY && msg.id === 'x'), false);
  } finally {
    await session.close();
  }
});

test('read_messages lists prompt ids in recent after the ack', async () => {
  const session = await pairedSession();
  try {
    await sendPrompt(session.tab, session.inbound, PROMPT_A, 'first');
    await settle(1100);
    await sendPrompt(session.tab, session.inbound, PROMPT_B, 'second');

    const read = await session.client.callTool({ name: 'read_messages', arguments: {} });
    assert.equal(read.isError, false, JSON.stringify(read).slice(0, 400));
    const summary = jsonBlocks(read).at(-1);
    assert.deepEqual(summary.acked, [PROMPT_A, PROMPT_B]);
    assert.deepEqual(summary.recent, [
      { id: PROMPT_A, state: 'delivered' },
      { id: PROMPT_B, state: 'delivered' },
    ]);

    const status = await session.client.callTool({ name: 'status', arguments: {} });
    assert.equal(status.isError, false, JSON.stringify(status).slice(0, 240));
    assert.deepEqual(jsonBlocks(status)[0].last, { id: PROMPT_B, state: 'delivered' });

    const again = await session.client.callTool({ name: 'read_messages', arguments: {} });
    assert.equal(again.isError, false);
    const recovered = jsonBlocks(again)[0];
    assert.deepEqual(recovered.messages, []);
    assert.deepEqual(recovered.acked, []);
    assert.deepEqual(recovered.recent, [
      { id: PROMPT_A, state: 'delivered' },
      { id: PROMPT_B, state: 'delivered' },
    ]);

    const reply = await session.client.callTool({
      name: 'reply_to_user',
      arguments: { in_reply_to: recovered.recent[0].id, text: 'still here', final: true },
    });
    assert.equal(reply.isError, false, JSON.stringify(reply).slice(0, 240));
    assert.deepEqual(JSON.parse(texts(reply)[0]), { id: PROMPT_A, final: true });
    const frame = await waitFor(
      session.inbound,
      (msg) => msg.type === PAIR_MSG.AGENT_REPLY && msg.id === PROMPT_A && msg.text === 'still here',
    );
    assert.equal(frame.final, true);
  } finally {
    await session.close();
  }
});
