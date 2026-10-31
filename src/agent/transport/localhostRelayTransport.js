/**
 * Localhost relay transport. Wraps the loopback WebSocket (or the Safari
 * popup socket, which has the same shape) in the command-transport interface.
 *
 * `captureSend` is not part of that interface. The tab connection uses it so
 * a reply for a call stays on the socket that received the call. A reconnect
 * must not deliver that reply on the replacement socket.
 */

import { assertAgentTransport } from './transport.js';

const SOCKET_OPEN = 1;

/**
 * @param {{
 *   url: string,
 *   createSocket?: (url: string) => {
 *     readyState: number,
 *     send: (data: string) => void,
 *     close: () => void,
 *     addEventListener: (type: string, cb: (event: any) => void) => void,
 *   },
 *   onOpen?: () => void,
 *   onClose?: (event: { code?: number, reason?: string }) => void,
 *   onError?: (event: any) => void,
 *   onRelay?: () => void,
 * }} opts
 */
export function createLocalhostRelayTransport(opts) {
  const createSocket = opts.createSocket || ((url) => new globalThis.WebSocket(url));
  /** @type {ReturnType<typeof createSocket> | null} */
  let socket = null;
  /** @type {import('./transport.js').AgentTransportStatus} */
  let state = 'closed';
  let generation = 0;
  /** @type {Set<(message: object) => void>} */
  const messageHandlers = new Set();

  /**
   * @param {object} message
   */
  function emitMessage(message) {
    for (const handler of [...messageHandlers]) handler(message);
  }

  function connect() {
    const prev = socket;
    const myGen = ++generation;
    state = 'connecting';
    const next = createSocket(opts.url);
    socket = next;
    const live = () => generation === myGen && socket === next;
    next.addEventListener('relay', () => {
      if (live()) opts.onRelay?.();
    });
    next.addEventListener('open', () => {
      if (!live()) return;
      state = 'open';
      opts.onOpen?.();
    });
    next.addEventListener('message', (event) => {
      if (!live()) return;
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;
      emitMessage(message);
    });
    next.addEventListener('error', (event) => {
      if (live()) opts.onError?.(event);
    });
    next.addEventListener('close', (event) => {
      if (!live()) return;
      socket = null;
      state = 'closed';
      opts.onClose?.(event);
    });
    if (prev && prev !== next) {
      try { prev.close(); } catch { /* noop */ }
    }
  }

  /**
   * @param {object} message
   */
  function send(message) {
    if (!socket || socket.readyState !== SOCKET_OPEN) return;
    socket.send(JSON.stringify(message));
  }

  /**
   * Send bound to the socket that is current right now.
   * @returns {(message: object) => void}
   */
  function captureSend() {
    const gen = generation;
    const sock = socket;
    return (message) => {
      if (generation !== gen || socket !== sock) return;
      if (!sock || sock.readyState !== SOCKET_OPEN) return;
      sock.send(JSON.stringify(message));
    };
  }

  /**
   * @param {(message: object) => void} handler
   */
  function onMessage(handler) {
    messageHandlers.add(handler);
    return () => { messageHandlers.delete(handler); };
  }

  function close() {
    generation += 1;
    state = 'closed';
    if (!socket) return;
    const prev = socket;
    socket = null;
    try { prev.close(); } catch { /* noop */ }
  }

  function status() {
    return state;
  }

  return assertAgentTransport({
    connect,
    send,
    onMessage,
    close,
    status,
    captureSend,
  });
}
