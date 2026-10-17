/**
 * Pure helpers for local agent pairing UI state (unit-tested).
 */

/** @typedef {'idle' | 'advertising' | 'pending' | 'paired' | 'reconnecting'} TabPairState */

const RELAY_LIVE_STATES = new Set(['advertising', 'pending', 'paired', 'reconnecting']);

/**
 * @param {TabPairState} state
 */
export function isRelayTabConnected(state) {
  return RELAY_LIVE_STATES.has(state);
}

const TERMINAL_PROBE_ISSUES = new Set(['origin_rejected', 'browser_blocked']);

/**
 * @param {{
 *   flowOpen: boolean,
 *   relayReachable: boolean,
 *   state: TabPairState,
 *   issue?: string | null,
 * }} input
 */
export function shouldPollRelay(input) {
  if (!input.flowOpen) return false;
  if (input.relayReachable) return false;
  if (isRelayTabConnected(input.state)) return false;
  if (TERMINAL_PROBE_ISSUES.has(input.issue)) return false;
  return true;
}

/**
 * @param {boolean} relayReachable
 */
export function shouldRevealPairingCode(relayReachable) {
  return relayReachable;
}

/**
 * The tab WebSocket lives in AgentBridgePairing. That host must stay mounted
 * on ProfileChip for the whole time `agentBridgeLive` is on; closing the
 * account panel must not unmount it (an orphan socket cannot update the ring).
 *
 * @param {{ agentBridgeLive?: boolean, panelOpen?: boolean }} input
 */
export function shouldKeepAgentBridgeHostMounted(input) {
  return input.agentBridgeLive === true;
}

/**
 * Ignore onState/onLink/onIssue from a connection that is no longer current
 * (its close may arrive after startPairing has swapped connRef).
 *
 * @param {unknown} current
 * @param {unknown} source
 */
export function isCurrentPairingConnection(current, source) {
  return current != null && current === source;
}
