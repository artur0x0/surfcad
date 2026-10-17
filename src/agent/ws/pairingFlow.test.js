import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCurrentPairingConnection,
  isRelayTabConnected,
  shouldKeepAgentBridgeHostMounted,
  shouldPollRelay,
  shouldRevealPairingCode,
} from './pairingFlow.js';

test('shouldPollRelay only while flow is open and relay is not reachable', () => {
  assert.equal(shouldPollRelay({ flowOpen: false, relayReachable: false, state: 'idle' }), false);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: true, state: 'idle' }), false);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: false, state: 'advertising' }), false);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: false, state: 'idle' }), true);
});

test('pairing code stays hidden until relay is reachable', () => {
  assert.equal(shouldRevealPairingCode(false), false);
  assert.equal(shouldRevealPairingCode(true), true);
});

test('isRelayTabConnected tracks live tab session states', () => {
  assert.equal(isRelayTabConnected('idle'), false);
  assert.equal(isRelayTabConnected('advertising'), true);
  assert.equal(isRelayTabConnected('paired'), true);
  assert.equal(isRelayTabConnected('reconnecting'), true);
});

test('the pairing host stays mounted on the chip while the panel is closed', () => {
  assert.equal(shouldKeepAgentBridgeHostMounted({ agentBridgeLive: true, panelOpen: false }), true);
  assert.equal(shouldKeepAgentBridgeHostMounted({ agentBridgeLive: true, panelOpen: true }), true);
  assert.equal(shouldKeepAgentBridgeHostMounted({ agentBridgeLive: false, panelOpen: true }), false);
});

test('stale connection callbacks are ignored after a swap', () => {
  const current = { id: 2 };
  assert.equal(isCurrentPairingConnection(current, current), true);
  assert.equal(isCurrentPairingConnection(current, { id: 1 }), false);
  assert.equal(isCurrentPairingConnection(null, current), false);
});
