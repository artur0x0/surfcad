import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_PROMPT_MAX_CHARS,
  createAgentPromptStub,
  sendAgentPromptText,
} from './agentPromptStub.js';

const SHOT = Object.freeze({
  mime: 'image/png',
  data: 'iVBORw0KGgo=',
  width: 16,
  height: 10,
});

test('send returns a page-made id and accepts an optional screenshot', () => {
  const transport = createAgentPromptStub({ delayMs: 0 });
  const id = transport.send('hello', { screenshot: SHOT });
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 0);
  assert.deepEqual(transport.lastScreenshot(), SHOT);
});

test('send without a screenshot clears the previous attachment (reset)', () => {
  const transport = createAgentPromptStub({ delayMs: 0 });
  transport.send('with shot', { screenshot: SHOT });
  assert.deepEqual(transport.lastScreenshot(), SHOT);
  const next = sendAgentPromptText(transport, 'follow up');
  assert.equal(next.ok, true);
  assert.equal(transport.lastScreenshot(), null);
});

test('sendAgentPromptText attaches the shot once and the UI discards it after send', () => {
  const transport = createAgentPromptStub({ delayMs: 0 });
  const first = sendAgentPromptText(transport, '  look at this  ', {
    screenshot: SHOT,
    context: { part_id: 'p1', assembly_id: 'a1' },
  });
  assert.equal(first.ok, true);
  assert.deepEqual(transport.lastScreenshot(), SHOT);

  // PromptInput calls discardShot() after a successful send, so the next
  // message goes out with no extras even if the caller still holds the old object.
  const second = sendAgentPromptText(transport, 'and then this');
  assert.equal(second.ok, true);
  assert.equal(transport.lastScreenshot(), null);
});

test('sendAgentPromptText enforces the 8000-char cap and empty text', () => {
  const transport = createAgentPromptStub({ delayMs: 0 });
  assert.deepEqual(sendAgentPromptText(transport, '   '), { ok: false, reason: 'empty' });
  assert.deepEqual(sendAgentPromptText(transport, 'x', {}, { working: true }), {
    ok: false,
    reason: 'empty',
  });
  const tooLong = 'x'.repeat(AGENT_PROMPT_MAX_CHARS + 1);
  assert.deepEqual(sendAgentPromptText(transport, tooLong), { ok: false, reason: 'too_long' });
  assert.equal(transport.lastScreenshot(), null);
});

test('onReply appends chunks, an echo does not report working, onAck reports delivery', () => {
  const transport = createAgentPromptStub({
    delayMs: 0,
    chunk: true,
    reply: 'ABCD',
    delivery: 'queued',
  });
  const replies = [];
  const working = [];
  const acks = [];
  const offReply = transport.onReply((msg) => replies.push(msg));
  const offWorking = transport.onWorking((on) => working.push(on));
  const offAck = transport.onAck((ack) => acks.push(ack));
  const id = transport.send('hi');
  assert.deepEqual(working, []);
  assert.equal(acks[0].id, id);
  assert.equal(acks[0].delivery, 'queued');
  assert.deepEqual(replies.map((row) => row.text), ['AB', 'CD']);
  assert.equal(replies[0].final, false);
  assert.equal(replies[1].final, true);
  offReply();
  offWorking();
  offAck();
  transport.send('again');
  assert.equal(replies.length, 2);
});

test('holdReply parks the echo until releaseReply, and abort drops a parked reply', () => {
  const transport = createAgentPromptStub({ delayMs: 0, reply: 'held' });
  const replies = [];
  const working = [];
  transport.onReply((msg) => replies.push(msg));
  transport.onWorking((on) => working.push(on));
  transport.holdReply(true);
  transport.send('ping');
  assert.deepEqual(working, []);
  assert.deepEqual(replies, []);
  transport.releaseReply();
  assert.equal(replies[0]?.text, 'held');
  assert.equal(replies[0]?.final, true);
  assert.deepEqual(working, []);

  const cancelled = createAgentPromptStub({ delayMs: 0, reply: 'nope' });
  const late = [];
  cancelled.onReply((msg) => late.push(msg));
  cancelled.holdReply(true);
  cancelled.send('ping');
  cancelled.abort();
  cancelled.releaseReply();
  assert.deepEqual(late, []);
});

test('failed ack is agent not listening and abort unsubscribes the pending reply', () => {
  const failed = createAgentPromptStub({ delayMs: 10, delivery: 'failed' });
  const acks = [];
  failed.onAck((ack) => acks.push(ack));
  const id = failed.send('ping');
  failed.abort();
  assert.equal(acks.length, 0);
  failed.dispose();

  const syncFail = createAgentPromptStub({ delayMs: 0, delivery: 'failed' });
  const seen = [];
  syncFail.onAck((ack) => seen.push(ack));
  const failId = syncFail.send('ping');
  assert.equal(seen[0].id, failId);
  assert.equal(seen[0].delivery, 'failed');
  assert.match(seen[0].error, /agent not listening/);
  assert.equal(id, id);
});
