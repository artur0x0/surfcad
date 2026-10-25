import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentPromptTransport } from './agentPromptTransport.js';
import { PAIR_MSG } from './ws/relayMessages.js';
import { shouldShowAgentBridgeDisconnect } from './ws/pairingFlow.js';
import { createAgentPrompt } from './createAgentPrompt.js';
import { sendAgentPromptText } from './agentPromptStub.js';
import { shouldShowAgentPrompt, readAgentPromptDemo } from './agentPromptDemo.js';
import {
  AGENT_PROMPT_WORKING_TIMEOUT_MS,
  ackNotice,
  agentPromptStallCopy,
  agentPromptContext,
  bindAgentPromptTransport,
  createLiveAgentPromptTransport,
  shouldUseLiveAgentPrompt,
} from './agentPromptLive.js';

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

function fakePromptApi(bridge) {
  return {
    createTransport(next) {
      return createAgentPromptTransport(next || bridge);
    },
    getBridge() {
      return bridge;
    },
  };
}

test('createLiveAgentPromptTransport send, reply, working, and failed ack', () => {
  const bridge = fakeBridge();
  const transport = createLiveAgentPromptTransport(fakePromptApi(bridge));
  assert.ok(transport);

  const replies = [];
  const working = [];
  const acks = [];
  const off = bindAgentPromptTransport(transport, {
    onReply: (event) => replies.push(event),
    onWorking: (event) => working.push(event),
    onAck: (event) => acks.push(event),
  });

  const context = agentPromptContext({ partId: 'part-1', assemblyId: 'asm-1' });
  const id = transport.send('How wide?', {
    context,
    screenshot: { mime: 'image/png', data: PNG, width: 8, height: 8 },
  });
  assert.equal(bridge.sent.length, 1);
  assert.equal(bridge.sent[0].type, PAIR_MSG.AGENT_PROMPT);
  assert.equal(bridge.sent[0].text, 'How wide?');
  assert.deepEqual(bridge.sent[0].context, { part_id: 'part-1', assembly_id: 'asm-1' });
  assert.equal(bridge.sent[0].screenshot.data, PNG);
  assert.equal(bridge.sent[0].screenshot.mime, 'image/png');

  bridge.emit({ type: PAIR_MSG.AGENT_REPLY, v: 1, id, text: '<b>40 mm</b>', final: false });
  bridge.emit({ type: PAIR_MSG.AGENT_STATUS, v: 1, working: true, id });
  bridge.emit({ type: PAIR_MSG.AGENT_PROMPT_ACK, id, delivery: 'failed', error: 'agent not listening' });

  assert.deepEqual(replies, [{ id, text: '<b>40 mm</b>', final: false }]);
  assert.deepEqual(working, [true]);
  assert.deepEqual(acks, [{ id, delivery: 'failed', error: 'agent not listening' }]);
  assert.equal(ackNotice(acks[0]).kind, 'failed');
  assert.match(ackNotice(acks[0]).text, /Agent not listening/);

  off();
  bridge.emit({ type: PAIR_MSG.AGENT_REPLY, v: 1, id, text: 'later', final: true });
  bridge.emit({ type: PAIR_MSG.AGENT_STATUS, v: 1, working: false });
  assert.equal(replies.length, 1);
  assert.deepEqual(working, [true]);
});

test('unsubscribe on unpair drops reply, working, and ack listeners', () => {
  const bridge = fakeBridge();
  const transport = createLiveAgentPromptTransport(fakePromptApi(bridge));
  const replies = [];
  const working = [];
  const acks = [];
  const off = bindAgentPromptTransport(transport, {
    onReply: (event) => replies.push(event),
    onWorking: (event) => working.push(event),
    onAck: (event) => acks.push(event),
  });

  const id = transport.send('ping');
  assert.equal(shouldUseLiveAgentPrompt({ paired: true, link: 'connected' }), true);
  off();
  assert.equal(shouldUseLiveAgentPrompt({ paired: false, link: null }), false);

  bridge.emit({ type: PAIR_MSG.AGENT_REPLY, v: 1, id, text: 'gone', final: true });
  bridge.emit({ type: PAIR_MSG.AGENT_STATUS, v: 1, working: true });
  bridge.emit({ type: PAIR_MSG.AGENT_PROMPT_ACK, id, delivery: 'queued' });
  assert.deepEqual(replies, []);
  assert.deepEqual(working, []);
  assert.deepEqual(acks, []);
});

test('re-pairing creates a fresh transport on a new bridge', () => {
  const first = fakeBridge();
  const second = fakeBridge();
  const t1 = createLiveAgentPromptTransport(fakePromptApi(first));
  const t2 = createLiveAgentPromptTransport(fakePromptApi(second));
  assert.notEqual(t1, t2);
  t1.send('old');
  t2.send('new');
  assert.equal(first.sent[0].text, 'old');
  assert.equal(second.sent[0].text, 'new');
  assert.equal(first.sent.length, 1);
  assert.equal(second.sent.length, 1);
});

test('prod with no pairing stays hidden and never falls back to the stub', () => {
  const prod = { DEV: false };
  assert.equal(createAgentPrompt(undefined, prod), null);
  assert.equal(createLiveAgentPromptTransport(null), null);
  assert.equal(createLiveAgentPromptTransport({}), null);
  assert.equal(shouldUseLiveAgentPrompt({ paired: false, link: null }), false);
  assert.equal(shouldShowAgentPrompt({
    paired: false,
    link: null,
    hasTransport: false,
    demo: readAgentPromptDemo('?agentPromptDemo=1', prod),
    demoAllowed: false,
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
  }), false);
});

test('rate-limited ack is a friendly failed notice; queued is waiting', () => {
  assert.deepEqual(ackNotice({ delivery: 'failed', error: 'rate_limited' }), {
    kind: 'failed',
    text: 'Too many messages. Wait a second and try again.',
  });
  assert.deepEqual(ackNotice({ delivery: 'queued' }), {
    kind: 'queued',
    text: 'Waiting for agent',
  });
  assert.equal(ackNotice({ delivery: 'webhook' }), null);
  assert.equal(AGENT_PROMPT_WORKING_TIMEOUT_MS, 120_000);
  assert.equal(
    agentPromptStallCopy(),
    'No activity from the agent for 2 min — it may have stalled',
  );
});

test('activity frames and a stalled status reach the prompt', () => {
  const bridge = fakeBridge();
  const transport = createLiveAgentPromptTransport(fakePromptApi(bridge));
  const states = [];
  const activity = [];
  const off = bindAgentPromptTransport(transport, {
    onState: (event) => states.push(event),
    onActivity: (event) => activity.push(event),
  });
  bridge.emit({ type: PAIR_MSG.AGENT_ACTIVITY, v: 1, id: 'p1' });
  bridge.emit({ type: PAIR_MSG.AGENT_ACTIVITY, v: 1, hold: true });
  bridge.emit({ type: PAIR_MSG.AGENT_ACTIVITY, v: 1, hold: false });
  bridge.emit({ type: PAIR_MSG.AGENT_STATUS, v: 1, working: true, state: 'working', stalled: true, id: 'p1' });
  assert.deepEqual(activity, [
    { id: 'p1' },
    { id: null, hold: true },
    { id: null, hold: false },
  ]);
  assert.equal(states.length, 1);
  assert.equal(states[0].mode, 'working');
  assert.equal(states[0].stalled, true);
  assert.equal(states[0].id, 'p1');
  off();
  bridge.emit({ type: PAIR_MSG.AGENT_ACTIVITY, v: 1, id: 'p1' });
  bridge.emit({ type: PAIR_MSG.AGENT_STATUS, v: 1, working: true, state: 'working', stalled: true });
  assert.equal(activity.length, 3);
  assert.equal(states.length, 1);
});

test('sendAgentPromptText passes screenshot and context in the agreed shape', () => {
  const bridge = fakeBridge();
  const transport = createLiveAgentPromptTransport(fakePromptApi(bridge));
  const shot = { mime: 'image/png', data: PNG, width: 8, height: 8 };
  const sent = sendAgentPromptText(
    transport,
    '  look  ',
    { screenshot: shot, context: agentPromptContext({ partId: 'p1', assemblyId: 'a1' }) },
  );
  assert.equal(sent.ok, true);
  assert.equal(bridge.sent[0].text, 'look');
  assert.deepEqual(bridge.sent[0].screenshot, shot);
  assert.deepEqual(bridge.sent[0].context, { part_id: 'p1', assembly_id: 'a1' });
});

test('agentPromptContext omits unknown ids', () => {
  assert.equal(agentPromptContext({}), undefined);
  assert.equal(agentPromptContext({ partId: '', assemblyId: null }), undefined);
  assert.deepEqual(agentPromptContext({ partId: 'p1' }), { part_id: 'p1' });
});
