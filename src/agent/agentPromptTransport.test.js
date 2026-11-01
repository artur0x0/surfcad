import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_PROMPT_SCREENSHOT_MAX_BYTES,
  AGENT_PROMPT_TEXT_MAX,
  createAgentPromptTransport,
} from './agentPromptTransport.js';
import { PAIR_MSG } from './ws/relayMessages.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function fakeBridge() {
  const listeners = new Set();
  const sent = [];
  return {
    sent,
    paired: true,
    send(message) {
      if (!this.paired) return false;
      sent.push(message);
      return true;
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit(message) {
      for (const cb of [...listeners]) cb(message);
    },
  };
}

test('send returns an id and subscriptions unsubscribe', () => {
  const bridge = fakeBridge();
  const transport = createAgentPromptTransport(bridge);
  const replies = [];
  const working = [];
  const acks = [];
  const offReply = transport.onReply((event) => replies.push(event));
  const offWorking = transport.onWorking((event) => working.push(event));
  transport.onAck((event) => acks.push(event));

  const id = transport.send('How wide?', {
    context: { part_id: 'part-1', assembly_id: 'asm-1', extra: 'drop' },
    screenshot: { mime: 'image/png', data: PNG, width: 8, height: 8 },
  });
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(bridge.sent.length, 1);
  assert.equal(bridge.sent[0].type, PAIR_MSG.AGENT_PROMPT);
  assert.equal(bridge.sent[0].v, 1);
  assert.equal(bridge.sent[0].id, id);
  assert.equal(bridge.sent[0].text, 'How wide?');
  assert.deepEqual(bridge.sent[0].context, { part_id: 'part-1', assembly_id: 'asm-1' });
  assert.equal(bridge.sent[0].screenshot.data, PNG);
  assert.equal(typeof bridge.sent[0].ts, 'string');

  bridge.emit({ type: PAIR_MSG.AGENT_REPLY, v: 1, id, text: '<b>40 mm</b>', final: false });
  bridge.emit({ type: PAIR_MSG.AGENT_STATUS, v: 1, working: true, id });
  bridge.emit({ type: PAIR_MSG.AGENT_PROMPT_ACK, id, delivery: 'queued' });
  offReply();
  offWorking();
  bridge.emit({ type: PAIR_MSG.AGENT_REPLY, v: 1, id, text: 'later', final: true });
  bridge.emit({ type: PAIR_MSG.AGENT_STATUS, v: 1, working: false });

  assert.deepEqual(replies, [{ id, text: '<b>40 mm</b>', final: false }]);
  assert.deepEqual(working, [true]);
  assert.deepEqual(acks, [{ id, delivery: 'queued' }]);
});

test('dispose unsubscribes so a new transport does not stack listeners', () => {
  const bridge = fakeBridge();
  const first = createAgentPromptTransport(bridge);
  const seen = [];
  first.onReply((event) => seen.push(`a:${event.text}`));
  first.dispose();
  const second = createAgentPromptTransport(bridge);
  second.onReply((event) => seen.push(`b:${event.text}`));
  const id = second.send('ping');
  bridge.emit({ type: PAIR_MSG.AGENT_REPLY, v: 1, id, text: 'hi', final: true });
  assert.deepEqual(seen, ['b:hi']);
  second.dispose();
  bridge.emit({ type: PAIR_MSG.AGENT_REPLY, v: 1, id, text: 'later', final: true });
  assert.deepEqual(seen, ['b:hi']);
});

test('a reply for a prompt another transport sent on this bridge is delivered', () => {
  const bridge = fakeBridge();
  const viewer = createAgentPromptTransport(bridge);
  const sender = createAgentPromptTransport(bridge);
  const replies = [];
  viewer.onReply((event) => replies.push(event));
  const id = sender.send('How wide?');
  bridge.emit({ type: PAIR_MSG.AGENT_REPLY, v: 1, id: 'x', text: 'probe', final: true });
  bridge.emit({ type: PAIR_MSG.AGENT_REPLY, v: 1, id, text: '40 mm', final: true });
  assert.deepEqual(replies, [{ id, text: '40 mm', final: true }]);
  sender.dispose();
  bridge.emit({ type: PAIR_MSG.AGENT_REPLY, v: 1, id, text: ' still here', final: false });
  assert.deepEqual(replies, [
    { id, text: '40 mm', final: true },
    { id, text: ' still here', final: false },
  ]);
  viewer.dispose();
});

test('a reply for an id this page did not send is dropped', () => {
  const bridge = fakeBridge();
  const transport = createAgentPromptTransport(bridge);
  const replies = [];
  transport.onReply((event) => replies.push(event));
  const id = transport.send('How wide?');
  bridge.emit({ type: PAIR_MSG.AGENT_REPLY, v: 1, id: 'x', text: 'probe', final: true });
  assert.deepEqual(replies, []);
  bridge.emit({ type: PAIR_MSG.AGENT_REPLY, v: 1, id, text: '40 mm', final: false });
  bridge.emit({ type: PAIR_MSG.AGENT_REPLY, v: 1, id, text: ' across.', final: true });
  assert.deepEqual(replies, [
    { id, text: '40 mm', final: false },
    { id, text: ' across.', final: true },
  ]);
  bridge.emit({ type: PAIR_MSG.AGENT_MESSAGE, v: 1, id: 'x', text: 'hidden' });
  bridge.emit({ type: PAIR_MSG.AGENT_MESSAGE, v: 1, text: '<b>hello</b>' });
  assert.deepEqual(replies.at(-1), { text: '<b>hello</b>', final: true, session: true });
  assert.equal(replies.some((row) => row.text === 'hidden'), false);
  transport.dispose();
});

test('local failures ack and do not touch the socket', () => {
  assert.equal(AGENT_PROMPT_TEXT_MAX, 8000);
  assert.equal(AGENT_PROMPT_SCREENSHOT_MAX_BYTES, 2 * 1024 * 1024);
  const bridge = fakeBridge();
  const transport = createAgentPromptTransport(bridge);
  const acks = [];
  transport.onAck((event) => acks.push(event));

  const tooLong = transport.send('a'.repeat(AGENT_PROMPT_TEXT_MAX + 1));
  assert.equal(acks.at(-1).id, tooLong);
  assert.equal(acks.at(-1).error, 'prompt_too_long');

  const decoded = AGENT_PROMPT_SCREENSHOT_MAX_BYTES + 1;
  const huge = 'A'.repeat((decoded / 3) * 4);
  const tooBig = transport.send('hi', { screenshot: { mime: 'image/png', data: huge, width: 1, height: 1 } });
  assert.equal(acks.at(-1).id, tooBig);
  assert.equal(acks.at(-1).error, 'screenshot_too_large');

  bridge.paired = false;
  const offline = transport.send('hi');
  assert.equal(acks.at(-1).id, offline);
  assert.equal(acks.at(-1).delivery, 'failed');
  assert.equal(acks.at(-1).error, 'not_paired');
  assert.equal(bridge.sent.length, 0);
});

test('cancel resolves cancelled, not_found, and already_final', async () => {
  const bridge = fakeBridge();
  const transport = createAgentPromptTransport(bridge);
  const id = transport.send('How wide?');
  assert.equal(bridge.sent[0].type, PAIR_MSG.AGENT_PROMPT);

  const cancelled = transport.cancel();
  assert.equal(bridge.sent.at(-1).type, PAIR_MSG.AGENT_PROMPT_CANCEL);
  assert.equal(bridge.sent.at(-1).v, 1);
  assert.equal(bridge.sent.at(-1).id, id);
  bridge.emit({ type: PAIR_MSG.AGENT_PROMPT_CANCEL_RESULT, v: 1, id, state: 'cancelled' });
  assert.deepEqual(await cancelled, { id, state: 'cancelled' });

  const missing = transport.cancel('missing-id');
  bridge.emit({
    type: PAIR_MSG.AGENT_PROMPT_CANCEL_RESULT,
    v: 1,
    id: 'missing-id',
    state: 'not_found',
  });
  assert.deepEqual(await missing, { id: 'missing-id', state: 'not_found' });

  const done = transport.cancel(id);
  bridge.emit({ type: PAIR_MSG.AGENT_PROMPT_CANCEL_RESULT, v: 1, id, state: 'already_final' });
  assert.deepEqual(await done, { id, state: 'already_final' });

  bridge.paired = false;
  assert.deepEqual(await transport.cancel('offline-id'), { id: 'offline-id', state: 'not_found' });
  bridge.emit({ type: PAIR_MSG.AGENT_REPLY, v: 1, id: 'offline-id', text: 'done', final: true });
  assert.deepEqual(await transport.cancel('offline-id'), { id: 'offline-id', state: 'not_found' });
  bridge.emit({ type: PAIR_MSG.AGENT_REPLY, v: 1, id, text: 'done', final: true });
  assert.deepEqual(await transport.cancel(id), { id, state: 'already_final' });

  const empty = createAgentPromptTransport(fakeBridge());
  assert.deepEqual(await empty.cancel(), { id: '', state: 'not_found' });
  empty.dispose();
  transport.dispose();
});
