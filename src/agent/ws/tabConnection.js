/**
 * Browser-side WebSocket client: pairs with a local process and dispatches
 * bridge commands through `window.surfcad.call`.
 */

import { PAIR_MSG } from './relayMessages.js';
import {
  issueFromCloseEvent,
  issueFromErrorEvent,
  issueFromRelayMessage,
} from './connectionErrors.js';

/**
 * @typedef {'idle' | 'advertising' | 'pending' | 'paired' | 'reconnecting'} TabPairState
 * @typedef {'relay_missing' | 'origin_rejected' | 'browser_blocked' | 'relay_error' | null} AgentBridgeConnectionIssue
 * @typedef {'connected' | 'reconnecting' | 'lost' | null} AgentBridgeLink
 * @typedef {{
 *   readyState: number,
 *   send: (data: string) => void,
 *   close: () => void,
 *   addEventListener: (type: string, cb: (event: any) => void) => void,
 * }} AgentBridgeSocket
 * @typedef {{
 *   setTimeout: (cb: () => void, ms: number) => unknown,
 *   clearTimeout: (handle: unknown) => void,
 *   now: () => number,
 * }} AgentBridgeTimers
 */

const SOCKET_OPEN = 1;

export const DEFAULT_TAB_RECONNECT_DELAYS_MS = Object.freeze([500, 1000, 2000, 4000, 8000, 10000]);
/** After this long without a working pairing the ring shows "lost" (retries continue). */
export const DEFAULT_LOST_AFTER_MS = 60_000;

/** Relay refusals that a retry cannot fix. */
const FATAL_RELAY_CODES = new Set(['origin_blocked', 'remote_blocked']);

function randomKey() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

const defaultTimers = {
  setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(/** @type {any} */ (handle)),
  now: () => Date.now(),
};

/**
 * @param {{
 *   url: string,
 *   token: string,
 *   call: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean, result?: unknown, error?: { code?: string, message?: string } }>,
 *   onState?: (state: TabPairState) => void,
 *   onIssue?: (issue: AgentBridgeConnectionIssue) => void,
 *   onLink?: (link: AgentBridgeLink) => void,
 *   pageSecure?: boolean,
 *   suppressMissingRelayIssue?: boolean,
 *   createSocket?: (url: string) => AgentBridgeSocket,
 *   isAutoApprove?: () => boolean,
 *   reconnectDelaysMs?: readonly number[],
 *   lostAfterMs?: number,
 *   timers?: AgentBridgeTimers,
 * }} opts
 */
export function createAgentBridgeTabConnection(opts) {
  const { url, token, call, onState, onIssue, onLink, pageSecure, suppressMissingRelayIssue } = opts;
  const createSocket = opts.createSocket || ((u) => new WebSocket(u));
  const isAutoApprove = opts.isAutoApprove || (() => false);
  const delays = opts.reconnectDelaysMs?.length ? opts.reconnectDelaysMs : DEFAULT_TAB_RECONNECT_DELAYS_MS;
  const lostAfterMs = opts.lostAfterMs ?? DEFAULT_LOST_AFTER_MS;
  const timers = opts.timers || defaultTimers;
  /** Proves to the relay that a re-register comes from this tab, not another page. */
  const tabKey = randomKey();
  /** @type {AgentBridgeSocket | null} */
  let ws = null;
  /** @type {TabPairState} */
  let state = 'idle';
  /** @type {AgentBridgeLink} */
  let link = null;
  let sawOpen = false;
  let lastRelayErrorCode = null;
  /** Handed to the peer on Allow; a resume request carrying it skips the prompt. */
  let resumeKey = null;
  let offeredResumeKey = null;
  let wasPaired = false;
  let stopped = true;
  let attempt = 0;
  let droppedAt = 0;
  let reconnectTimer = null;
  let lostTimer = null;
  /** Bumped on every `open()` / `disconnect()` so a deferred close from an old socket is ignored. */
  let generation = 0;

  function setState(next) {
    state = next;
    onState?.(state);
  }

  function setLink(next) {
    if (link === next) return;
    link = next;
    onLink?.(link);
  }

  function setIssue(issue) {
    if (suppressMissingRelayIssue && issue === 'relay_missing') return;
    onIssue?.(issue);
  }

  function send(payload) {
    if (!ws || ws.readyState !== SOCKET_OPEN) return;
    ws.send(JSON.stringify(payload));
  }

  function clearTimers() {
    if (reconnectTimer != null) timers.clearTimeout(reconnectTimer);
    if (lostTimer != null) timers.clearTimeout(lostTimer);
    reconnectTimer = null;
    lostTimer = null;
  }

  function markDropped() {
    if (!wasPaired) return;
    if (link !== 'reconnecting' && link !== 'lost') {
      droppedAt = timers.now();
      setLink('reconnecting');
    }
    if (lostTimer == null && link === 'reconnecting') {
      const remaining = Math.max(0, lostAfterMs - (timers.now() - droppedAt));
      lostTimer = timers.setTimeout(() => {
        lostTimer = null;
        if (link === 'reconnecting') setLink('lost');
      }, remaining);
    }
  }

  function markConnected() {
    if (lostTimer != null) timers.clearTimeout(lostTimer);
    lostTimer = null;
    attempt = 0;
    setLink('connected');
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer != null) return;
    const delay = delays[Math.min(attempt, delays.length - 1)];
    attempt += 1;
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      if (!stopped) open();
    }, delay);
  }

  /** Skip the backoff wait, e.g. when the tab becomes visible again. */
  function reconnectNow() {
    if (stopped || ws || reconnectTimer == null) return;
    timers.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    open();
  }

  const onWake = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    reconnectNow();
  };

  function listenForWake(on) {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('online', onWake);
    window[method]('focus', onWake);
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document[method]('visibilitychange', onWake);
    }
  }

  async function handleCall(msg) {
    const id = msg.id;
    const command = msg.command;
    const args = msg.args && typeof msg.args === 'object' ? msg.args : {};
    try {
      const env = await call(command, args);
      if (env.ok) {
        send({ id, ok: true, result: env.result });
      } else {
        send({ id, ok: false, error: env.error || { code: 'refused', message: 'Command refused' } });
      }
    } catch (err) {
      send({
        id,
        ok: false,
        error: { code: 'internal', message: String(err?.message || err) },
      });
    }
  }

  function approveWith(key) {
    offeredResumeKey = key;
    send({ type: PAIR_MSG.PAIR_APPROVE, resumeKey: key });
  }

  function open() {
    const prev = ws;
    const myGen = ++generation;
    const reconnecting = wasPaired || attempt > 0;
    sawOpen = false;
    lastRelayErrorCode = null;
    if (!reconnecting) setIssue(null);
    setState(reconnecting ? 'reconnecting' : 'advertising');
    const socket = createSocket(url);
    ws = socket;
    let opened = false;
    socket.addEventListener('open', () => {
      if (generation !== myGen || ws !== socket) return;
      opened = true;
      sawOpen = true;
      setIssue(null);
      send({ type: PAIR_MSG.REGISTER_TAB, token, tabKey });
      if (!wasPaired) {
        attempt = 0;
        setState('advertising');
      }
    });
    socket.addEventListener('message', (event) => {
      if (generation !== myGen || ws !== socket) return;
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      const relayIssue = issueFromRelayMessage(msg);
      if (relayIssue) {
        lastRelayErrorCode = msg.code;
        setIssue(relayIssue);
      }
      if (msg.type === PAIR_MSG.ERROR && typeof msg.code === 'string') {
        lastRelayErrorCode = msg.code;
      }
      if (msg.type === PAIR_MSG.PAIR_REQUEST) {
        if (resumeKey && typeof msg.resume === 'string' && msg.resume === resumeKey) {
          approveWith(resumeKey);
          return;
        }
        setState('pending');
        if (isAutoApprove()) {
          approveWith(randomKey());
        }
        return;
      }
      if (msg.type === PAIR_MSG.PAIRED) {
        if (offeredResumeKey) resumeKey = offeredResumeKey;
        offeredResumeKey = null;
        wasPaired = true;
        setState('paired');
        setIssue(null);
        markConnected();
        return;
      }
      if (msg.type === PAIR_MSG.UNPAIRED) {
        setState(wasPaired ? 'reconnecting' : 'advertising');
        markDropped();
        return;
      }
      if (typeof msg.command === 'string') {
        void handleCall(msg);
      }
    });
    socket.addEventListener('error', (event) => {
      if (generation !== myGen || ws !== socket) return;
      if (!opened && !wasPaired) {
        setIssue(issueFromErrorEvent(event, { pageSecure }));
      }
    });
    socket.addEventListener('close', (event) => {
      if (generation !== myGen || ws !== socket) return;
      ws = null;
      const fatal = FATAL_RELAY_CODES.has(lastRelayErrorCode);
      const retry = !stopped && !fatal && (wasPaired || opened || attempt > 0);
      if (retry) {
        setState('reconnecting');
        markDropped();
        scheduleReconnect();
        return;
      }
      const issue = issueFromCloseEvent(event, { sawOpen: opened, relayErrorCode: lastRelayErrorCode });
      if (issue) setIssue(issue);
      setState('idle');
    });
    if (prev && prev !== socket) {
      try { prev.close(); } catch { /* noop */ }
    }
  }

  function connect() {
    clearTimers();
    stopped = false;
    attempt = 0;
    listenForWake(false);
    listenForWake(true);
    open();
  }

  function approvePair() {
    approveWith(randomKey());
  }

  function rejectPair() {
    send({ type: PAIR_MSG.PAIR_REJECT });
    setState(wasPaired ? 'reconnecting' : 'advertising');
  }

  function disconnect() {
    stopped = true;
    generation += 1;
    clearTimers();
    listenForWake(false);
    if (ws) {
      const prev = ws;
      ws = null;
      try { prev.close(); } catch { /* noop */ }
    }
    wasPaired = false;
    resumeKey = null;
    offeredResumeKey = null;
    attempt = 0;
    setIssue(null);
    setLink(null);
    setState('idle');
  }

  return {
    getState: () => state,
    getLink: () => link,
    connect,
    approvePair,
    rejectPair,
    disconnect,
    reconnectNow,
  };
}
