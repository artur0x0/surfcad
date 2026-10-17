import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRelayTabConnected,
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
});
