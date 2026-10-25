import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startAgentBridgeRelay, stopAgentBridgeRelay } from '../src/bridge/relayServer.mjs';
import { PAIR_MSG as NODE_MSG } from '../src/relayMessages.mjs';
import { PAIR_MSG as BROWSER_MSG } from '../../../src/agent/ws/relayMessages.js';
import { RelaySession } from '../src/relay.mjs';
import { createPairingToken } from '../../../src/agent/ws/pairingToken.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PROMPT_ID = '11111111-1111-4111-8111-111111111111';

test('page and MCP relay message names stay in sync', () => {
  assert.deepEqual(BROWSER_MSG, NODE_MSG);
  const browser = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../src/agent/ws/relayMessages.js'), 'utf8');
  const node = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/relayMessages.mjs'), 'utf8');
  for (const name of ['agent.prompt', 'agent.prompt.ack', 'agent.prompt.cancel', 'agent.prompt.cancel.result', 'agent.reply', 'agent.status', 'agent.activity']) {
    assert.equal(browser.includes(name), true);
    assert.equal(node.includes(name), true);
  }
});

function waitOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function collect(ws) {
  const inbound = [];
  ws.on('message', (raw) => inbound.push(JSON.parse(String(raw))));
  return inbound;
}

async function waitFor(inbound, pred, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = inbound.find(pred);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('timed out waiting for a relay frame');
}

test('a paired tab prompt is queued, read with its image, and replies reach the tab', async () => {
  const relay = await startAgentBridgeRelay({ port: 0, onLog() {} });
  const token = createPairingToken(6);
  const tab = new WebSocket(relay.url);
  await waitOpen(tab);
  const inbound = collect(tab);
  tab.send(JSON.stringify({ type: NODE_MSG.REGISTER_TAB, token }));

  const session = new RelaySession({ url: relay.url, onLog() {} });
  const pairing = session.pair(token);
  await waitFor(inbound, (msg) => msg.type === NODE_MSG.PAIR_REQUEST);
  tab.send(JSON.stringify({ type: NODE_MSG.PAIR_APPROVE }));
  await pairing;
  assert.equal(session.isPaired(), true);

  tab.send(JSON.stringify({
    type: NODE_MSG.AGENT_PROMPT,
    v: 1,
    id: PROMPT_ID,
    text: 'How wide is this?',
    ts: '2026-10-18T00:00:00.000Z',
    context: { part_id: 'part-1' },
    screenshot: { mime: 'image/png', data: PNG, width: 1, height: 1 },
  }));
  const ack = await waitFor(inbound, (msg) => msg.type === NODE_MSG.AGENT_PROMPT_ACK);
  assert.equal(ack.delivery, 'queued');
  assert.equal(ack.id, PROMPT_ID);

  const read = session.prompts.readMessages();
  assert.equal(read.messages.length, 1);
  assert.equal(read.messages[0].text, 'How wide is this?');
  assert.equal(read.messages[0].context.part_id, 'part-1');
  assert.equal(read.images[0].data, PNG);
  assert.equal(JSON.stringify(read.messages).includes(PNG), false);
  assert.equal(session.prompts.queuedCount(), 0);

  session.noteAgentToolCall();
  const working = await waitFor(inbound, (msg) => msg.type === NODE_MSG.AGENT_STATUS && msg.working === true);
  assert.equal(working.id, PROMPT_ID);

  session.prompts.reply({ in_reply_to: PROMPT_ID, text: '40 mm across.', final: true });
  const reply = await waitFor(inbound, (msg) => msg.type === NODE_MSG.AGENT_REPLY);
  assert.equal(reply.text, '40 mm across.');
  assert.equal(reply.final, true);
  assert.equal(reply.v, 1);
  const idle = await waitFor(inbound, (msg) => msg.type === NODE_MSG.AGENT_STATUS && msg.working === false);
  assert.equal(idle.id, PROMPT_ID);

  await session.prompts.registerWebhook('https://8.8.8.8/hook');
  assert.equal(session.prompts.webhookRegistered(), true);
  session.disconnect();
  assert.equal(session.prompts.webhookRegistered(), false);
  assert.equal(session.prompts.queuedCount(), 0);

  tab.close();
  await stopAgentBridgeRelay(relay);
});

test('a page cancel of a queued prompt is reported cancelled and leaves the queue empty', async () => {
  const relay = await startAgentBridgeRelay({ port: 0, onLog() {} });
  const token = createPairingToken(6);
  const tab = new WebSocket(relay.url);
  await waitOpen(tab);
  const inbound = collect(tab);
  tab.send(JSON.stringify({ type: NODE_MSG.REGISTER_TAB, token }));
  const session = new RelaySession({ url: relay.url, onLog() {} });
  const pairing = session.pair(token);
  await waitFor(inbound, (msg) => msg.type === NODE_MSG.PAIR_REQUEST);
  tab.send(JSON.stringify({ type: NODE_MSG.PAIR_APPROVE }));
  await pairing;

  const cancelId = '33333333-3333-4333-8333-333333333333';
  tab.send(JSON.stringify({
    type: NODE_MSG.AGENT_PROMPT,
    v: 1,
    id: cancelId,
    text: 'stop this',
    ts: '2026-10-18T00:00:00.000Z',
  }));
  await waitFor(inbound, (msg) => msg.type === NODE_MSG.AGENT_PROMPT_ACK && msg.id === cancelId);
  tab.send(JSON.stringify({ type: NODE_MSG.AGENT_PROMPT_CANCEL, v: 1, id: cancelId }));
  const result = await waitFor(inbound, (msg) => msg.type === NODE_MSG.AGENT_PROMPT_CANCEL_RESULT && msg.id === cancelId);
  assert.equal(result.state, 'cancelled');
  assert.equal(result.v, 1);
  assert.equal(session.prompts.queuedCount(), 0);
  assert.equal(session.prompts.readMessages().messages.length, 0);
  const status = session.prompts.deliveryStatus();
  assert.equal(status.queued, 0);
  assert.deepEqual(status.last, { id: cancelId, state: 'cancelled' });
  assert.equal(status.counts.cancelled, 1);

  tab.close();
  session.disconnect();
  await stopAgentBridgeRelay(relay);
});
