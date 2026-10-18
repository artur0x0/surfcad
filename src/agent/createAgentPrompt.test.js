import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentPromptStubAllowed,
  createAgentPrompt,
} from './createAgentPrompt.js';
import { createAgentPromptStub } from './agentPromptStub.js';
import { shouldShowAgentBridgeDisconnect } from './ws/pairingFlow.js';
import { readAgentPromptDemo, shouldShowAgentPrompt } from './agentPromptDemo.js';

test('non-DEV build with no transport does not create a stub or echo', () => {
  const prod = { DEV: false };
  assert.equal(agentPromptStubAllowed(prod), false);
  const transport = createAgentPrompt({}, prod);
  assert.equal(transport, null);

  const stub = createAgentPromptStub({ delayMs: 0, reply: 'should not run' });
  const replies = [];
  stub.onReply((msg) => replies.push(msg));
  assert.equal(typeof transport?.send, 'undefined');
  assert.deepEqual(replies, []);
});

test('non-DEV build with no transport keeps the prompt hidden', () => {
  const transport = createAgentPrompt(undefined, { DEV: false });
  assert.equal(shouldShowAgentPrompt({
    paired: true,
    link: 'connected',
    hasTransport: Boolean(transport),
    demo: readAgentPromptDemo('?agentPromptDemo=1', { DEV: false }),
    demoAllowed: false,
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
  }), false);
});

test('DEV still gets the stub so local pairing can be playtested', () => {
  const transport = createAgentPrompt({ delayMs: 0, reply: 'Echo: hi' }, { DEV: true });
  assert.ok(transport);
  const replies = [];
  transport.onReply((msg) => replies.push(msg));
  const id = transport.send('hi');
  assert.equal(typeof id, 'string');
  assert.equal(replies[0].text, 'Echo: hi');
});
