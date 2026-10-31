/**
 * Command transport. Implementations move JSON frames. They do not interpret
 * commands. The localhost relay (`localhostRelayTransport.js`) is the first
 * one. A later server relay implements the same five methods.
 *
 * `connect` starts one connection. `send` writes one already-built frame and
 * does nothing when the connection is not open. `onMessage` subscribes to
 * parsed frames and returns an unsubscribe. `close` drops the connection.
 * `status` is `'closed'`, `'connecting'`, or `'open'`.
 *
 * This is not `createAgentBridgeTransport` in `src/agent/ws/agentBridgeTransport.js`.
 * That one only chooses how the page opens a socket to the loopback relay
 * (direct WebSocket, or the Safari popup window).
 */

/** @typedef {'closed' | 'connecting' | 'open'} AgentTransportStatus */

/**
 * @typedef {{
 *   connect: () => void,
 *   send: (message: object) => void,
 *   onMessage: (handler: (message: object) => void) => () => void,
 *   close: () => void,
 *   status: () => AgentTransportStatus,
 * }} AgentTransport
 */

export const AGENT_TRANSPORT_METHODS = Object.freeze([
  'connect',
  'send',
  'onMessage',
  'close',
  'status',
]);

/**
 * @param {AgentTransport} transport
 * @returns {AgentTransport}
 */
export function assertAgentTransport(transport) {
  if (!transport || typeof transport !== 'object') {
    throw new TypeError('Agent transport is missing');
  }
  for (const name of AGENT_TRANSPORT_METHODS) {
    if (typeof transport[name] !== 'function') {
      throw new TypeError(`Agent transport is missing ${name}`);
    }
  }
  return transport;
}
