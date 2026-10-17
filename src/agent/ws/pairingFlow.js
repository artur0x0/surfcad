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

const TERMINAL_PROBE_ISSUES = new Set([
  'origin_rejected',
  'browser_blocked',
  'bridge_closed',
  'popup_blocked',
]);

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

/** @typedef {'closed' | 'unsupported' | 'prompt' | 'code' | 'approval'} PairingDialogStage */

/**
 * Guided pairing lives in its own dialog, not the profile menu.
 * Prompt (Copy prompt) only while no relay is up; Allow/Deny replaces the
 * pairing code — the two never share the dialog.
 *
 * @param {{
 *   flowOpen?: boolean,
 *   webkitHttpsBlocked?: boolean,
 *   relayReachable?: boolean,
 *   pending?: boolean,
 * }} input
 * @returns {PairingDialogStage}
 */
export function pairingDialogStage(input = {}) {
  if (!input.flowOpen) return 'closed';
  if (input.webkitHttpsBlocked) return 'unsupported';
  if (input.pending) return 'approval';
  if (input.relayReachable) return 'code';
  return 'prompt';
}

/** @param {PairingDialogStage} stage */
export function shouldShowPairingPrompt(stage) {
  return stage === 'prompt';
}

/** @param {PairingDialogStage} stage */
export function shouldShowPairingCode(stage) {
  return stage === 'code';
}

/** @param {PairingDialogStage} stage */
export function shouldShowPairingApproval(stage) {
  return stage === 'approval';
}

/**
 * After Allow, the dialog closes itself once the link is connected.
 *
 * @param {{ paired?: boolean, link?: string | null }} input
 */
export function shouldClosePairingDialogOnConnect(input = {}) {
  return input.paired === true && input.link === 'connected';
}

export const AGENT_CONNECTED_TOAST_MS = 5000;
export const AGENT_CONNECTED_TOAST_COPY = 'Agent connected';

/**
 * @param {{ open?: boolean, hideAt?: number }} state
 * @param {'show' | 'dismiss' | 'timeout' | 'tick'} action
 * @param {number} [now]
 */
export function agentConnectedToastReducer(state, action, now = 0) {
  const current = state && typeof state === 'object'
    ? { open: !!state.open, hideAt: Number(state.hideAt) || 0 }
    : { open: false, hideAt: 0 };
  if (action === 'show') return { open: true, hideAt: now + AGENT_CONNECTED_TOAST_MS };
  if (action === 'dismiss' || action === 'timeout') return { open: false, hideAt: 0 };
  if (action === 'tick' && current.open && now >= current.hideAt) {
    return { open: false, hideAt: 0 };
  }
  return current;
}

/**
 * The tab WebSocket lives in AgentBridgePairing, hosted once on App via
 * AgentBridgeHost (above the isMobile split) for the whole time
 * `agentBridgeLive` is on. Closing the account panel, or crossing 768px,
 * must not unmount it (an orphan socket cannot update the ring, and
 * Allow/Deny would vanish).
 *
 * @param {{ agentBridgeLive?: boolean, panelOpen?: boolean }} input
 */
export function shouldKeepAgentBridgeHostMounted(input) {
  return input.agentBridgeLive === true;
}

/**
 * Viewport, PartFeed, and CodeEditor each mount a ProfileChip. A single
 * close-menu callback would let the last registrant win and an unmount
 * clear it for every chip, leaving the menu open behind the pairing dialog.
 *
 * @returns {{
 *   register: (fn: unknown) => () => void,
 *   closeAll: () => void,
 *   size: () => number,
 * }}
 */
export function createCloseMenuRegistry() {
  const closers = new Set();
  return {
    register(fn) {
      if (typeof fn !== 'function') return () => {};
      closers.add(fn);
      return () => { closers.delete(fn); };
    },
    closeAll() {
      for (const fn of [...closers]) fn();
    },
    size() {
      return closers.size;
    },
  };
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
