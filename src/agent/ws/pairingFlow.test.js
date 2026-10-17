import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAIRING_ORIGIN_REJECTED_COPY,
  PAIRING_WAITING_COPY,
  disposePairingHost,
  isCurrentPairingConnection,
  isRelayTabConnected,
  pairingProbeUserCopy,
  shouldKeepAgentBridgeHostMounted,
  shouldPollRelay,
  shouldRevealPairingCode,
} from './pairingFlow.js';

test('shouldPollRelay only while flow is open and relay is not reachable', () => {
  assert.equal(shouldPollRelay({ flowOpen: false, relayReachable: false, state: 'idle' }), false);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: true, state: 'idle' }), false);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: false, state: 'advertising' }), false);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: false, state: 'idle' }), true);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: false, state: 'idle', issue: 'origin_rejected' }), false);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: false, state: 'idle', issue: 'browser_blocked' }), false);
  assert.equal(shouldPollRelay({ flowOpen: true, relayReachable: false, state: 'idle', issue: null }), true);
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

test('the pairing host stays mounted while the panel is closed', () => {
  assert.equal(shouldKeepAgentBridgeHostMounted({ agentBridgeLive: true, panelOpen: false }), true);
  assert.equal(shouldKeepAgentBridgeHostMounted({ agentBridgeLive: true, panelOpen: true }), true);
  assert.equal(shouldKeepAgentBridgeHostMounted({ agentBridgeLive: false, panelOpen: true }), false);
  assert.equal(shouldKeepAgentBridgeHostMounted({ agentBridgeLive: false, panelOpen: false }), false);
});

test('stale connection callbacks are ignored after a swap', () => {
  const current = { id: 2 };
  assert.equal(isCurrentPairingConnection(current, current), true);
  assert.equal(isCurrentPairingConnection(current, { id: 1 }), false);
  assert.equal(isCurrentPairingConnection(null, current), false);
});

test('disposePairingHost disconnects the socket and stops the poller', () => {
  const conn = { disconnectCalls: 0, disconnect() { this.disconnectCalls += 1; } };
  const poller = { stopCalls: 0, stop() { this.stopCalls += 1; } };
  assert.deepEqual(disposePairingHost({ conn, poller }), { conn: null, poller: null });
  assert.equal(conn.disconnectCalls, 1);
  assert.equal(poller.stopCalls, 1);
  assert.deepEqual(disposePairingHost(null), { conn: null, poller: null });
  assert.deepEqual(disposePairingHost({}), { conn: null, poller: null });
});

test('a 403 origin rejection and a probe timeout have distinct user messages', () => {
  const origin = pairingProbeUserCopy('origin_rejected');
  const timeout = pairingProbeUserCopy(null);
  assert.equal(origin, PAIRING_ORIGIN_REJECTED_COPY);
  assert.equal(timeout, PAIRING_WAITING_COPY);
  assert.notEqual(origin, timeout);
  assert.match(origin, /origin was rejected/i);
  assert.match(timeout, /Waiting for relay/i);
  assert.doesNotMatch(origin, /\bEdge\b/);
  assert.doesNotMatch(timeout, /\bEdge\b/);
  assert.equal(pairingProbeUserCopy('browser_blocked'), null);
});
