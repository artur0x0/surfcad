/**
 * Pure helpers for local agent pairing UI state (unit-tested).
 */

/** @typedef {'idle' | 'advertising' | 'pending' | 'paired'} TabPairState */

const RELAY_LIVE_STATES = new Set(['advertising', 'pending', 'paired']);

/**
 * @param {TabPairState} state
 */
export function isRelayTabConnected(state) {
  return RELAY_LIVE_STATES.has(state);
}

/**
 * @param {{ flowOpen: boolean, relayReachable: boolean, state: TabPairState }} input
 */
export function shouldPollRelay(input) {
  if (!input.flowOpen) return false;
  if (input.relayReachable) return false;
  if (isRelayTabConnected(input.state)) return false;
  return true;
}

/**
 * @param {boolean} relayReachable
 */
export function shouldRevealPairingCode(relayReachable) {
  return relayReachable;
}
