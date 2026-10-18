import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldShowAgentBridgeDisconnect } from './ws/pairingFlow.js';
import {
  agentPromptDemoAllowed,
  readAgentPromptDemo,
  shouldShowAgentPrompt,
} from './agentPromptDemo.js';

const DEV = { DEV: true };
const PROD = { DEV: false };

test('demo query pins the prompt and hidden hides it', () => {
  assert.equal(readAgentPromptDemo('', DEV), null);
  assert.deepEqual(readAgentPromptDemo('?agentPromptDemo=1', DEV), { enabled: true, state: 'idle' });
  assert.deepEqual(readAgentPromptDemo('?agentPromptDemo=1&agentPromptState=shot-on', DEV), {
    enabled: true,
    state: 'shot-on',
  });
  assert.deepEqual(readAgentPromptDemo('?agentPromptDemo=1&agentPromptState=nope', DEV), {
    enabled: true,
    state: 'idle',
  });
});

test('shouldShowAgentPrompt matches Disconnect unless a demo state overrides', () => {
  assert.equal(shouldShowAgentPrompt({
    paired: false,
    link: null,
    hasTransport: true,
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
  }), false);
  assert.equal(shouldShowAgentPrompt({
    paired: true,
    link: 'reconnecting',
    hasTransport: true,
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
  }), true);
  assert.equal(shouldShowAgentPrompt({
    paired: false,
    link: 'connected',
    hasTransport: true,
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
  }), true);
  assert.equal(shouldShowAgentPrompt({
    paired: false,
    link: null,
    demo: { enabled: true, state: 'idle' },
    demoAllowed: true,
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
  }), true);
  assert.equal(shouldShowAgentPrompt({
    paired: true,
    link: 'connected',
    demo: { enabled: true, state: 'hidden' },
    demoAllowed: true,
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
  }), false);
});

test('prod with a live transport shows the prompt when paired', () => {
  assert.equal(shouldShowAgentPrompt({
    paired: true,
    link: 'connected',
    hasTransport: true,
    demoAllowed: false,
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
  }), true);
});

test('prod with no transport hides the prompt even when paired', () => {
  assert.equal(shouldShowAgentPrompt({
    paired: true,
    link: 'connected',
    hasTransport: false,
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
  }), false);
  assert.equal(shouldShowAgentPrompt({
    paired: true,
    link: 'connected',
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
  }), false);
});

test('non-DEV build ignores ?agentPromptDemo=1 and keeps the card hidden', () => {
  assert.equal(agentPromptDemoAllowed(PROD), false);
  assert.equal(readAgentPromptDemo('?agentPromptDemo=1', PROD), null);
  assert.equal(readAgentPromptDemo('?agentPromptDemo=1&agentPromptState=reply-long', PROD), null);
  assert.equal(shouldShowAgentPrompt({
    paired: true,
    link: 'connected',
    demo: readAgentPromptDemo('?agentPromptDemo=1', PROD),
    demoAllowed: agentPromptDemoAllowed(PROD),
    hasTransport: false,
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
  }), false);
  assert.equal(shouldShowAgentPrompt({
    paired: false,
    link: null,
    demo: { enabled: true, state: 'reply-short' },
    demoAllowed: false,
    hasTransport: false,
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
  }), false);
});
