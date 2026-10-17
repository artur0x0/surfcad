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
 * The tab WebSocket lives in AgentBridgePairing, hosted once on App via
 * AgentBridgeHost for the whole time `agentBridgeLive` is on. Closing the
 * account panel, or a desktop/mobile remount at 768px, must not unmount it
 * (an orphan socket cannot update the ring, and Allow/Deny would vanish).
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

/**
 * Tear down the tab socket and poller. Used from unmount so a dropped host
 * cannot leave a live WebSocket behind.
 *
 * @param {{ conn?: { disconnect?: () => void } | null, poller?: { stop?: () => void } | null } | null | undefined} host
 * @returns {{ conn: null, poller: null }}
 */
export function disposePairingHost(host) {
  host?.conn?.disconnect?.();
  host?.poller?.stop?.();
  return { conn: null, poller: null };
}

export const PAIRING_WAITING_COPY = 'Waiting for relay…';
export const PAIRING_ORIGIN_REJECTED_COPY =
  'This page origin was rejected by the local relay. Open https://surfcad.com (not a copy) and try again.';

/**
 * Distinct user-facing copy for a 403 origin rejection vs a probe timeout
 * (timeout keeps the waiting spinner; origin rejection is a hard error).
 *
 * @param {string | null | undefined} issue
 * @returns {string | null}
 */
export function pairingProbeUserCopy(issue) {
  if (issue === 'origin_rejected') return PAIRING_ORIGIN_REJECTED_COPY;
  if (issue == null || issue === '') return PAIRING_WAITING_COPY;
  return null;
}
