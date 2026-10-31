/**
 * In-memory command transport. Two of them, linked, carry frames to each
 * other with no socket. Tests use this to run a command through dispatch.
 */

import { assertAgentTransport } from './transport.js';

export function createMemoryTransport() {
  /** @type {import('./transport.js').AgentTransportStatus} */
  let state = 'closed';
  /** @type {Set<(message: object) => void>} */
  const handlers = new Set();
  /** @type {object[]} */
  const sent = [];
  /** @type {((message: object) => void) | null} */
  let peer = null;

  /**
   * @param {object} message
   */
  function deliver(message) {
    if (state !== 'open') return;
    for (const handler of [...handlers]) handler(message);
  }

  const transport = {
    sent,
    connect() { state = 'open'; },
    /**
     * @param {object} message
     */
    send(message) {
      if (state !== 'open') return;
      sent.push(message);
      peer?.(message);
    },
    /**
     * @param {(message: object) => void} handler
     */
    onMessage(handler) {
      handlers.add(handler);
      return () => { handlers.delete(handler); };
    },
    close() { state = 'closed'; },
    status() { return state; },
    /**
     * @param {(message: object) => void} deliverToPeer
     */
    link(deliverToPeer) { peer = deliverToPeer; },
    deliver,
  };
  return assertAgentTransport(transport);
}

/**
 * `local` and `remote` deliver to each other. A send on one is an onMessage
 * on the other. Nothing is echoed back.
 */
export function createMemoryTransportPair() {
  const local = createMemoryTransport();
  const remote = createMemoryTransport();
  local.link((message) => remote.deliver(message));
  remote.link((message) => local.deliver(message));
  return { local, remote };
}
