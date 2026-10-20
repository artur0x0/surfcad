/**
 * Live in-viewer prompt: create the real transport from the paired tab
 * connection and map ack / working / context for the UI.
 *
 * `createAgentPromptTransport` is the MCP Lead's adapter. This file only
 * calls it. Do not edit `agentPromptTransport.js`.
 */
import { createAgentPromptTransport } from './agentPromptTransport.js';
import { shouldShowAgentBridgeDisconnect } from './ws/pairingFlow.js';
import { PAIR_MSG } from './ws/relayMessages.js';
import { modeFromStatus } from './agentPromptTyping.js';

/** Match the MCP auto-idle: working false after 120s with no activity. */
export const AGENT_PROMPT_WORKING_TIMEOUT_MS = 120_000;

/**
 * @param {{ createTransport?: Function, getBridge?: Function } | null | undefined} [api]
 * @returns {{ send: Function, onReply: Function, onWorking: Function, onAck: Function } | null}
 */
export function createLiveAgentPromptTransport(api) {
  const promptApi = api ?? (typeof window !== 'undefined' ? window.surfcadAgentPrompt : null);
  const bridge = typeof promptApi?.getBridge === 'function' ? promptApi.getBridge() : null;
  if (!bridge || typeof bridge.send !== 'function' || typeof bridge.subscribe !== 'function') {
    return null;
  }
  try {
    const transport = typeof promptApi.createTransport === 'function'
      ? promptApi.createTransport(bridge)
      : createAgentPromptTransport(bridge);
    return withAgentState(transport, bridge);
  } catch {
    return null;
  }
}

/**
 * Add `onState(cb)` to a transport: the agent's mode (typing | working |
 * idle) from the status message's `state`, or from the legacy `working`
 * boolean. The adapter itself only forwards the boolean and is not edited.
 *
 * @param {{ onReply: Function, onWorking: Function, onAck: Function } | null} transport
 * @param {{ subscribe: Function }} bridge
 */
export function withAgentState(transport, bridge) {
  if (!transport || typeof bridge?.subscribe !== 'function') return transport;
  if (typeof transport.onState === 'function') return transport;
  const listeners = new Set();
  let off = null;
  function ensure() {
    if (off) return;
    off = bridge.subscribe((msg) => {
      if (!msg || typeof msg !== 'object' || msg.type !== PAIR_MSG.AGENT_STATUS || msg.v !== 1) return;
      const mode = modeFromStatus(msg);
      if (!mode) return;
      const event = { mode, id: typeof msg.id === 'string' ? msg.id : null };
      if (typeof msg.label === 'string' && msg.label) event.label = msg.label;
      for (const cb of [...listeners]) {
        try { cb(event); } catch { /* listener threw */ }
      }
    });
  }
  const onState = (cb) => {
    if (typeof cb !== 'function') return () => {};
    listeners.add(cb);
    ensure();
    return () => {
      listeners.delete(cb);
      if (!listeners.size && off) { try { off(); } catch { /* gone */ } off = null; }
    };
  };
  const dispose = typeof transport.dispose === 'function'
    ? () => { listeners.clear(); if (off) { try { off(); } catch { /* gone */ } off = null; } transport.dispose(); }
    : undefined;
  return dispose ? { ...transport, onState, dispose } : { ...transport, onState };
}

/**
 * @param {{ partId?: unknown, assemblyId?: unknown }} [ids]
 * @returns {{ part_id?: string, assembly_id?: string } | undefined}
 */
export function agentPromptContext(ids = {}) {
  const context = {};
  if (typeof ids.partId === 'string' && ids.partId) context.part_id = ids.partId;
  if (typeof ids.assemblyId === 'string' && ids.assemblyId) context.assembly_id = ids.assemblyId;
  return Object.keys(context).length ? context : undefined;
}

/**
 * @param {{ delivery?: string, error?: unknown } | null | undefined} ack
 * @returns {{ kind: 'failed' | 'queued', text: string } | null}
 */
export function ackNotice(ack) {
  if (!ack || typeof ack !== 'object') return null;
  if (ack.delivery === 'failed') {
    if (ack.error === 'rate_limited') {
      return { kind: 'failed', text: 'Too many messages. Wait a second and try again.' };
    }
    if (ack.error === 'not_paired') {
      return { kind: 'failed', text: 'Agent disconnected.' };
    }
    return { kind: 'failed', text: 'Agent not listening' };
  }
  if (ack.delivery === 'queued') {
    return { kind: 'queued', text: 'Waiting for agent' };
  }
  return null;
}

/**
 * Subscribe to a transport. Returns an unsubscribe that drops every listener.
 *
 * @param {{
 *   onReply?: Function,
 *   onWorking?: Function,
 *   onAck?: Function,
 * } | null} transport
 * @param {{
 *   onReply?: Function,
 *   onWorking?: Function,
 *   onAck?: Function,
 * }} handlers
 * @returns {() => void}
 */
export function bindAgentPromptTransport(transport, handlers = {}) {
  if (!transport) return () => {};
  const offReply = typeof handlers.onReply === 'function'
    ? transport.onReply?.(handlers.onReply)
    : null;
  // onState carries the mode (typing | working | idle) on transports that
  // have it; onWorking is the legacy boolean. The prompt binds one or the
  // other, never both, so the two cannot race on the same status message.
  const offState = typeof handlers.onState === 'function'
    ? transport.onState?.(handlers.onState)
    : null;
  const offWorking = typeof handlers.onWorking === 'function'
    ? transport.onWorking?.(handlers.onWorking)
    : null;
  const offAck = typeof handlers.onAck === 'function'
    ? transport.onAck?.(handlers.onAck)
    : null;
  return () => {
    offReply?.();
    offState?.();
    offWorking?.();
    offAck?.();
  };
}

/**
 * True while Disconnect would show: paired, or the link is still connected.
 * Used to create / tear down the live transport.
 *
 * @param {{ paired?: boolean, link?: string | null }} pairing
 */
export function shouldUseLiveAgentPrompt(pairing) {
  return shouldShowAgentBridgeDisconnect(pairing) === true;
}
