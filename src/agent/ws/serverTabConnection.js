/**
 * Browser tab on the server relay. The session cookie authenticates the
 * upgrade. Command frames use the shared protocol. Prompt frames (`agent.*`)
 * are forwarded and are not stored here.
 */

import { attachCommandDispatch } from '../transport/commandDispatch.js';
import { createLocalhostRelayTransport } from '../transport/localhostRelayTransport.js';
import { createAgentPromptTransport } from '../agentPromptTransport.js';
import { PAIR_MSG } from './relayMessages.js';

const PROMPT_TYPES = new Set([
  PAIR_MSG.AGENT_PROMPT,
  PAIR_MSG.AGENT_PROMPT_ACK,
  PAIR_MSG.AGENT_REPLY,
  PAIR_MSG.AGENT_STATUS,
  PAIR_MSG.AGENT_ACTIVITY,
  PAIR_MSG.AGENT_PROMPT_CANCEL,
  PAIR_MSG.AGENT_PROMPT_CANCEL_RESULT,
]);

/**
 * @param {{
 *   url: string,
 *   call: (name: string, args: Record<string, unknown>) => Promise<{ ok?: boolean, result?: unknown, error?: unknown }>,
 *   onState?: (state: string) => void,
 *   onLink?: (link: string | null) => void,
 *   onAgent?: (connected: boolean, info: { source: 'registered' | 'agent', was: boolean }) => void,
 *   createSocket?: (url: string) => any,
 *   reconnectDelaysMs?: readonly number[],
 * }} opts
 */
export function createServerTabConnection(opts) {
  const delays = opts.reconnectDelaysMs?.length ? opts.reconnectDelaysMs : [500, 1000, 2000, 4000];
  /** @type {'idle' | 'advertising' | 'paired' | 'reconnecting'} */
  let state = 'idle';
  /** @type {string | null} */
  let link = null;
  let stopped = true;
  let attempt = 0;
  let sawAgent = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reconnectTimer = null;
  const promptListeners = new Set();

  function setState(next) {
    state = next;
    opts.onState?.(state);
  }

  function setLink(next) {
    if (link === next) return;
    link = next;
    opts.onLink?.(link);
  }

  const transport = createLocalhostRelayTransport({
    url: opts.url,
    createSocket: opts.createSocket,
    onOpen() {
      attempt = 0;
      if (!sawAgent) setState('advertising');
    },
    onClose() {
      if (stopped) return;
      setState('reconnecting');
      if (sawAgent) setLink('reconnecting');
      scheduleReconnect();
    },
  });

  transport.onMessage((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'registered') {
      applyAgent(msg.agentConnected === true, 'registered');
      return;
    }
    if (msg.type === 'agent') {
      applyAgent(msg.connected === true, 'agent');
      return;
    }
    if (typeof msg.type === 'string' && PROMPT_TYPES.has(msg.type)) {
      for (const cb of [...promptListeners]) {
        try { cb(msg); } catch { /* listener */ }
      }
    }
  });

  attachCommandDispatch(transport, {
    call: opts.call,
    onActivity(activity) {
      const frame = { type: PAIR_MSG.AGENT_ACTIVITY, v: 1, hold: activity.hold };
      for (const cb of [...promptListeners]) {
        try { cb(frame); } catch { /* listener */ }
      }
    },
  });

  /**
   * @param {boolean} connected
   * @param {'registered' | 'agent'} source
   */
  function applyAgent(connected, source) {
    const was = sawAgent;
    sawAgent = connected;
    // `registered` is a snapshot and may say false before the agent
    // frame arrives. `agent` is the live leave. Socket close is neither.
    opts.onAgent?.(connected, { source, was });
    if (connected) {
      setState('paired');
      setLink('connected');
      return;
    }
    setLink(null);
    setState(stopped ? 'idle' : 'advertising');
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer != null) return;
    const delay = delays[Math.min(attempt, delays.length - 1)];
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!stopped) transport.connect();
    }, delay);
    if (typeof reconnectTimer.unref === 'function') reconnectTimer.unref();
  }

  function sendPrompt(message) {
    if (state !== 'paired' || transport.status() !== 'open') return false;
    if (!message || !PROMPT_TYPES.has(message.type)) return false;
    transport.send(message);
    return true;
  }

  function subscribePrompt(cb) {
    promptListeners.add(cb);
    return () => { promptListeners.delete(cb); };
  }

  function connect() {
    stopped = false;
    attempt = 0;
    transport.connect();
  }

  function disconnect() {
    stopped = true;
    if (reconnectTimer != null) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    transport.close();
    sawAgent = false;
    setLink(null);
    setState('idle');
    unpublish(api);
  }

  const api = {
    getState: () => state,
    getLink: () => link,
    connect,
    disconnect,
    approvePair() {},
    rejectPair() {},
    send: sendPrompt,
    subscribe: subscribePrompt,
  };
  publish(api);
  return api;
}

/**
 * @param {{ send: Function, subscribe: Function }} api
 */
function publish(api) {
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
function unpublish(api) {
  if (typeof window === 'undefined') return;
  if (window.surfcadAgentPrompt?.getBridge?.() === api) {
    delete window.surfcadAgentPrompt;
  }
}
