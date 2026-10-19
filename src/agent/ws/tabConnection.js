/**
 * Browser-side WebSocket client: pairs with a local process and dispatches
 * bridge commands through `window.surfcad.call`.
 */

import { PAIR_MSG } from './relayMessages.js';
import { BRIDGE_CLOSE_REASON } from './bridgeMessages.js';
import { createAgentPromptTransport } from '../agentPromptTransport.js';
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
/** Popup window gone or blocked: another `window.open` needs a click. */
const USER_ENDED_BRIDGE = new Set([
  BRIDGE_CLOSE_REASON.BRIDGE_CLOSED,
  BRIDGE_CLOSE_REASON.POPUP_BLOCKED,
]);

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
 *   onRelay?: (detected: boolean) => void,
 *   reconnectDelaysMs?: readonly number[],
 *   lostAfterMs?: number,
 *   timers?: AgentBridgeTimers,
 * }} opts
 */
export function createAgentBridgeTabConnection(opts) {
  const { url, token, call, onState, onIssue, onLink, pageSecure, suppressMissingRelayIssue } = opts;
  const createSocket = opts.createSocket || ((u) => new WebSocket(u));
  const isAutoApprove = opts.isAutoApprove || (() => false);
  const onRelay = opts.onRelay || (() => {});
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
  let lastRelayErrorCode = null;
  /** Handed to the peer on Allow; the hub matches it. The tab auto-approves only on resume:true. */
  let resumeKey = null;
  let offeredResumeKey = null;
  let wasPaired = false;
  /** Next register_tab must drop the hub resume (user closed the bridge window). */
  let forgetResume = false;
  let stopped = true;
  let attempt = 0;
  let droppedAt = 0;
  let reconnectTimer = null;
  let lostTimer = null;
  /** Bumped on every `open()` / `disconnect()` so a deferred close from an old socket is ignored. */
  let generation = 0;
  /** Prompt adapter listeners. Replies, acks, status, and cancel results. */
  const promptListeners = new Set();

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

  /**
   * Page → agent prompt frames. Only while this tab is paired.
   * Replies and status are not accepted from the page.
   * @param {object} message
   * @returns {boolean}
   */
  function sendPrompt(message) {
    if (state !== 'paired' || !ws || ws.readyState !== SOCKET_OPEN) return false;
    if (!message || (message.type !== PAIR_MSG.AGENT_PROMPT && message.type !== PAIR_MSG.AGENT_PROMPT_CANCEL)) {
      return false;
    }
    send(message);
    return true;
  }

  /**
   * @param {(message: object) => void} cb
   */
  function subscribePrompt(cb) {
    promptListeners.add(cb);
    return () => { promptListeners.delete(cb); };
  }

  /**
   * @param {object} msg
   */
  function emitPrompt(msg) {
    for (const cb of [...promptListeners]) {
      try { cb(msg); } catch { /* listener */ }
    }
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
    const callGen = generation;
    const callSocket = ws;
    const reply = (payload) => {
      if (generation !== callGen || ws !== callSocket) return;
      if (!callSocket || callSocket.readyState !== SOCKET_OPEN) return;
      callSocket.send(JSON.stringify(payload));
    };
    try {
      const env = await call(command, args);
      if (env.ok) {
        reply({ id, ok: true, result: env.result });
      } else {
        reply({ id, ok: false, error: env.error || { code: 'refused', message: 'Command refused' } });
      }
    } catch (err) {
      reply({
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
    lastRelayErrorCode = null;
    if (!reconnecting) setIssue(null);
    setState(reconnecting ? 'reconnecting' : 'advertising');
    const socket = createSocket(url);
    ws = socket;
    let opened = false;
    socket.addEventListener('relay', () => {
      if (generation !== myGen || ws !== socket) return;
      onRelay(true);
    });
    socket.addEventListener('open', () => {
      if (generation !== myGen || ws !== socket) return;
      opened = true;
      setIssue(null);
      const register = { type: PAIR_MSG.REGISTER_TAB, token, tabKey };
      if (forgetResume) {
        register.forgetResume = true;
        forgetResume = false;
      }
      send(register);
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
        // The hub never forwards the resume secret. A boolean resume:true is
        // the only auto-approve signal; a string (stolen or otherwise) prompts.
        if (resumeKey && msg.resume === true) {
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
      if (msg.type === PAIR_MSG.AGENT_REPLY || msg.type === PAIR_MSG.AGENT_STATUS
        || msg.type === PAIR_MSG.AGENT_PROMPT_ACK || msg.type === PAIR_MSG.AGENT_PROMPT_CANCEL_RESULT) {
        emitPrompt(msg);
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
      const reason = typeof event?.reason === 'string' ? event.reason : '';
      if (USER_ENDED_BRIDGE.has(reason)) {
        stopped = true;
        clearTimers();
        listenForWake(false);
        wasPaired = false;
        resumeKey = null;
        offeredResumeKey = null;
        forgetResume = true;
        const issue = issueFromCloseEvent(event, { sawOpen: opened, relayErrorCode: lastRelayErrorCode });
        if (issue) setIssue(issue);
        setLink(null);
        setState('idle');
        return;
      }
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
    forgetResume = false;
    attempt = 0;
    setIssue(null);
    setLink(null);
    setState('idle');
    unpublishPromptBridge(api);
  }

  const api = {
    getState: () => state,
    getLink: () => link,
    getTabKey: () => tabKey,
    connect,
    approvePair,
    rejectPair,
    disconnect,
    reconnectNow,
    send: sendPrompt,
    subscribe: subscribePrompt,
  };
  publishPromptBridge(api);
  return api;
}

/**
 * The prompt UI imports `createAgentPromptTransport` and passes the tab
 * connection. The built page also exposes that factory so a paired tab can
 * be driven without a second import site.
 * @param {{ send: (message: object) => boolean, subscribe: (cb: (message: object) => void) => (() => void) }} api
 */
function publishPromptBridge(api) {
  if (typeof window === 'undefined') return;
  window.surfcadAgentPrompt = {
    createTransport(bridge) {
      return createAgentPromptTransport(bridge || api);
    },
    getBridge() {
      return api;
    },
  };
}

/**
 * @param {{ send: Function, subscribe: Function }} api
 */
function unpublishPromptBridge(api) {
  if (typeof window === 'undefined') return;
  if (window.surfcadAgentPrompt?.getBridge?.() === api) {
    delete window.surfcadAgentPrompt;
  }
}
