import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldShowAgentBridgeDisconnect } from './ws/pairingFlow.js';
import {
  readAgentPromptDemo,
  shouldShowAgentPrompt,
} from './agentPromptDemo.js';

test('demo query pins the prompt and hidden hides it', () => {
  assert.equal(readAgentPromptDemo(''), null);
  assert.deepEqual(readAgentPromptDemo('?agentPromptDemo=1'), { enabled: true, state: 'idle' });
  assert.deepEqual(readAgentPromptDemo('?agentPromptDemo=1&agentPromptState=shot-on'), {
    enabled: true,
    state: 'shot-on',
  });
  assert.deepEqual(readAgentPromptDemo('?agentPromptDemo=1&agentPromptState=nope'), {
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
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
  }), true);
  assert.equal(shouldShowAgentPrompt({
    paired: true,
    link: 'connected',
    demo: { enabled: true, state: 'hidden' },
    shouldShowDisconnect: shouldShowAgentBridgeDisconnect,
  }), false);
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
