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
  if (input.forcedServer === true) return false;
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

/**
 * Join-code connection the user can see.
 * A redeem or an agent-up latches connected and asks the chat to open.
 * A socket blip or a late "still pending" resume cannot drop that latch
 * or reopen the waiting card. An agent-down frame or Disconnect can.
 *
 * @param {{ connected?: boolean, waiting?: boolean }} state
 * @param {'redeemed' | 'agent-up' | 'agent-down' | 'user-disconnect' | 'socket-down' | 'socket-up' | 'resume-pending'} event
 * @returns {{ connected: boolean, waiting: boolean, openChat: boolean }}
 */
export function stepJoinConnection(state, event) {
  const connected = state?.connected === true;
  const waiting = state?.waiting === true;
  if (event === 'redeemed' || event === 'agent-up') {
    return { connected: true, waiting: false, openChat: !connected };
  }
  if (event === 'agent-down' || event === 'user-disconnect') {
    return { connected: false, waiting: false, openChat: false };
  }
  if (event === 'resume-pending') {
    if (connected) return { connected: true, waiting: false, openChat: false };
    return { connected: false, waiting: true, openChat: false };
  }
  return { connected, waiting: connected ? false : waiting, openChat: false };
}

/**
 * Open the agent chat on the rising edge of a latched connection.
 * A socket blip that never clears `connected` does not open it again.
 *
 * @param {boolean} wasConnected
 * @param {boolean} connected
 */
export function shouldOpenAgentChatOnConnect(wasConnected, connected) {
  return connected === true && wasConnected !== true;
}

/** Green "Agent connected" / "Agent disconnected" toasts. Not a banner. */
export const AGENT_CONNECTED_TOAST_MS = 3000;
export const AGENT_CONNECTED_TOAST_COPY = 'Agent connected';
export const AGENT_DISCONNECTED_TOAST_COPY = 'Agent disconnected';

/** Presence-frame reasons. Older frames omit `reason` and use the generic copy. */
export const AGENT_DISCONNECT_REASON_COPY = Object.freeze({
  inactive: 'Agent disconnected: inactive for 10 min',
  closed: 'Agent ended the session',
  revoked: 'Agent access revoked',
});

/**
 * @param {unknown} reason
 * @param {string} [fallback]
 */
export function agentDisconnectToastCopy(reason, fallback = AGENT_DISCONNECTED_TOAST_COPY) {
  if (typeof reason === 'string' && Object.prototype.hasOwnProperty.call(AGENT_DISCONNECT_REASON_COPY, reason)) {
    return AGENT_DISCONNECT_REASON_COPY[reason];
  }
  return fallback;
}

/**
 * Phone chat hides on a prompt that just started, and again on each
 * progress update. Desktop fold is separate.
 * @param {{ isMobile?: boolean, promptStarted?: boolean, progressEdge?: boolean }} [input]
 * @returns {'prompt' | 'progress' | null}
 */
export function mobileChatHideReason(input = {}) {
  if (input.isMobile !== true) return null;
  if (input.progressEdge === true) return 'progress';
  if (input.promptStarted === true) return 'prompt';
  return null;
}

/** How long a progress update keeps the phone spinner after the frame. */
export const AGENT_PROGRESS_RECENT_MS = 60_000;

/**
 * @param {{ open?: boolean, kind?: string | null, hideAt?: number } | null | undefined} state
 * @param {'connected' | 'disconnected' | 'dismiss' | 'tick'} event
 * @param {number} now
 * @param {{ reason?: string | null }} [extra]
 */
export function stepAgentSessionToast(state, event, now, extra) {
  const cur = state && typeof state === 'object'
    ? state
    : { open: false, kind: null, hideAt: 0 };
  const at = Number(now) || 0;
  if (event === 'dismiss') return { open: false, kind: null, hideAt: 0 };
  if (event === 'tick') {
    if (cur.open && at >= cur.hideAt) return { open: false, kind: null, hideAt: 0 };
    return cur;
  }
  if (event === 'connected' || event === 'disconnected') {
    const next = { open: true, kind: event, hideAt: at + AGENT_CONNECTED_TOAST_MS };
    if (event === 'disconnected' && extra && typeof extra.reason === 'string' && extra.reason) {
      next.reason = extra.reason;
    }
    return next;
  }
  return cur;
}

/**
 * The pairing dialog just closed because an agent is connected.
 * A reload never has the dialog open, so it does not toast.
 *
 * @param {{ dialogWasOpen?: boolean, dialogOpen?: boolean, connected?: boolean }} [input]
 */
export function shouldToastAgentConnected(input = {}) {
  return input.dialogWasOpen === true && input.dialogOpen !== true && input.connected === true;
}

/**
 * A live session dropped. Pairing passes `wasLive` only. A Safari reload
 * never sets that flag, so the grace window does not flash this toast.
 *
 * @param {{ wasLive?: boolean }} [input]
 */
export function shouldToastAgentDisconnect(input = {}) {
  return input.wasLive === true;
}

/**
 * The phone bot button opens the agent chat, and the next tap folds it.
 * @param {boolean} open
 * @returns {'close' | 'open'}
 */
export function agentChatToggleAction(open) {
  return open === true ? 'close' : 'open';
}

/**
 * Disconnect in the profile menu / Connect Agent dialog drops the local
 * WebSocket relay (`disconnectPairing`), not the GitHub write-grant.
 * Show it only while a client is paired or the link is connected.
 *
 * @param {{ paired?: boolean, link?: string | null }} input
 */
export function shouldShowAgentBridgeDisconnect(input = {}) {
  return input.paired === true || input.link === 'connected';
}

/**
 * The server path hides Connect agent only while that socket is still being
 * tried or is open. Auto keeps the button until the server socket opens.
 * Desktop Chrome "Server only" that never opens the socket falls back so
 * local pairing stays available. A forced server client (Safari, iOS, phone
 * width) keeps Connect agent, and that click is the server dialog, not local.
 *
 * @param {{
 *   flowOpen?: boolean,
 *   paired?: boolean,
 *   relayTarget?: string,
 *   usingServer?: boolean,
 *   serverUnreachable?: boolean,
 *   forcedServer?: boolean,
 * }} input
 */
export function shouldShowLocalAgentConnect(input = {}) {
  if (input.flowOpen || input.paired) return false;
  if (input.forcedServer === true) return true;
  if (serverBlocksLocalPairing(input)) return false;
  return true;
}

/**
 * @param {{
 *   relayTarget?: string,
 *   usingServer?: boolean,
 *   serverUnreachable?: boolean,
 *   forcedServer?: boolean,
 * }} input
 */
export function serverBlocksLocalPairing(input = {}) {
  if (input.forcedServer === true) return true;
  if (input.usingServer) return true;
  if (input.relayTarget === 'server' && input.serverUnreachable !== true) return true;
  return false;
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
export const SERVER_PAIRING_WAITING_COPY = 'Waiting for your agent…';
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
