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
