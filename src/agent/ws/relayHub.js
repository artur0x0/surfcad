/**
 * In-memory hub for pairing a browser tab with one local peer over WebSocket.
 * Runs on the Vite dev/preview relay (127.0.0.1 only).
 */

import { isAllowedHttpOrigin, isLoopbackAddress } from './localAddress.js';

const PAIR_MSG = Object.freeze({
  ERROR: 'error',
  REGISTER_TAB: 'register_tab',
  PAIR: 'pair',
  PAIR_REQUEST: 'pair_request',
  PAIR_APPROVE: 'pair_approve',
  PAIR_REJECT: 'pair_reject',
  PAIRED: 'paired',
  UNPAIRED: 'unpaired',
  CALL: 'call',
  RESPONSE: 'response',
});

/**
 * @typedef {{ send: (data: string) => void, close: () => void, on: (event: string, cb: (...args: unknown[]) => void) => void, remoteAddress?: string, origin?: string }} RelaySocket
 */

function sendJson(socket, payload) {
  socket.send(JSON.stringify(payload));
}

function parseMessage(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const msg = JSON.parse(raw);
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
    return msg;
  } catch {
    return null;
  }
}

/**
 * @param {RelaySocket} socket
 * @param {string} code
 * @param {string} message
 */
function refuse(socket, code, message) {
  sendJson(socket, { type: PAIR_MSG.ERROR, code, message });
  try { socket.close(); } catch { /* already closed */ }
}

/**
 * @param {{ onLog?: (line: string) => void }} [opts]
 */
export function createAgentBridgeRelayHub(opts = {}) {
  const log = (line) => { opts.onLog?.(line); };

  /** @type {Map<string, { socket: RelaySocket, token: string, pairedPeer: RelaySocket | null, pendingPeer: RelaySocket | null }>} */
  const tabsByToken = new Map();
  /** @type {Map<RelaySocket, { role: 'tab' | 'peer', token: string }>} */
  const socketMeta = new Map();

  function dropTab(token) {
    const tab = tabsByToken.get(token);
    if (!tab) return;
    tabsByToken.delete(token);
    if (tab.pairedPeer) {
      sendJson(tab.pairedPeer, { type: PAIR_MSG.UNPAIRED, reason: 'tab_disconnected' });
      socketMeta.delete(tab.pairedPeer);
    }
    if (tab.pendingPeer) {
      sendJson(tab.pendingPeer, { type: PAIR_MSG.ERROR, code: 'pair_cancelled', message: 'Tab disconnected' });
      socketMeta.delete(tab.pendingPeer);
    }
    socketMeta.delete(tab.socket);
  }

  function unpair(token, reason = 'disconnect') {
    const tab = tabsByToken.get(token);
    if (!tab || !tab.pairedPeer) return;
    const peer = tab.pairedPeer;
    tab.pairedPeer = null;
    sendJson(tab.socket, { type: PAIR_MSG.UNPAIRED, reason });
    sendJson(peer, { type: PAIR_MSG.UNPAIRED, reason });
    socketMeta.delete(peer);
    try { peer.close(); } catch { /* gone */ }
  }

  /**
   * @param {RelaySocket} socket
   */
  function attachSocket(socket) {
    const remote = socket.remoteAddress || '';
    if (!isLoopbackAddress(remote)) {
      refuse(socket, 'remote_blocked', 'Agent bridge relay accepts loopback connections only');
      return;
    }
    if (!isAllowedHttpOrigin(socket.origin)) {
      refuse(socket, 'origin_blocked', 'Origin is not a local SurfCAD page');
      return;
    }

    socket.on('message', (raw) => {
      const msg = parseMessage(typeof raw === 'string' ? raw : String(raw));
      if (!msg || typeof msg !== 'object') {
        refuse(socket, 'bad_message', 'Expected JSON object');
        return;
      }
      const meta = socketMeta.get(socket);

      if (msg.type === PAIR_MSG.REGISTER_TAB) {
        if (meta) {
          refuse(socket, 'already_registered', 'Socket already registered');
          return;
        }
        const token = typeof msg.token === 'string' ? msg.token.trim().toUpperCase() : '';
        if (!token || token.length < 4) {
          refuse(socket, 'bad_token', 'register_tab requires token');
          return;
        }
        const existing = tabsByToken.get(token);
        if (existing) {
          refuse(socket, 'token_in_use', 'Another tab is already advertising this pairing code');
          return;
        }
        tabsByToken.set(token, { socket, token, pairedPeer: null, pendingPeer: null });
        socketMeta.set(socket, { role: 'tab', token });
        log(`tab registered token=${token}`);
        return;
      }

      if (msg.type === PAIR_MSG.PAIR) {
        if (meta) {
          refuse(socket, 'already_registered', 'Socket already registered');
          return;
        }
        const token = typeof msg.token === 'string' ? msg.token.trim().toUpperCase() : '';
        const tab = tabsByToken.get(token);
        if (!tab) {
          refuse(socket, 'unknown_token', 'No SurfCAD tab is advertising this pairing code');
          return;
        }
        if (tab.pairedPeer) {
          refuse(socket, 'already_paired', 'Tab is already paired with another client');
          return;
        }
        if (tab.pendingPeer && tab.pendingPeer !== socket) {
          refuse(socket, 'pair_pending', 'Tab is already reviewing another pairing request');
          return;
        }
        tab.pendingPeer = socket;
        socketMeta.set(socket, { role: 'peer', token });
        sendJson(tab.socket, { type: PAIR_MSG.PAIR_REQUEST, token });
        log(`pair request token=${token}`);
        return;
      }

      if (!meta) {
        refuse(socket, 'not_registered', 'Send register_tab or pair first');
        return;
      }

      const tab = tabsByToken.get(meta.token);
      if (!tab) {
        refuse(socket, 'session_gone', 'Pairing session ended');
        return;
      }

      if (msg.type === PAIR_MSG.PAIR_APPROVE) {
        if (meta.role !== 'tab') {
          refuse(socket, 'forbidden', 'Only the tab may approve pairing');
          return;
        }
        const peer = tab.pendingPeer;
        if (!peer) {
          sendJson(socket, { type: PAIR_MSG.ERROR, code: 'no_request', message: 'No pairing request to approve' });
          return;
        }
        tab.pendingPeer = null;
        tab.pairedPeer = peer;
        sendJson(socket, { type: PAIR_MSG.PAIRED, token: meta.token });
        sendJson(peer, { type: PAIR_MSG.PAIRED, token: meta.token });
        log(`paired token=${meta.token}`);
        return;
      }

      if (msg.type === PAIR_MSG.PAIR_REJECT) {
        if (meta.role !== 'tab') {
          refuse(socket, 'forbidden', 'Only the tab may reject pairing');
          return;
        }
        const peer = tab.pendingPeer;
        tab.pendingPeer = null;
        if (peer) {
          sendJson(peer, { type: PAIR_MSG.ERROR, code: 'pair_rejected', message: 'Pairing rejected in SurfCAD' });
          socketMeta.delete(peer);
          try { peer.close(); } catch { /* gone */ }
        }
        return;
      }

      if (typeof msg.command === 'string' && msg.type !== PAIR_MSG.PAIR) {
        if (meta.role !== 'peer' || tab.pairedPeer !== socket) {
          refuse(socket, 'not_paired', 'Pair before sending bridge commands');
          return;
        }
        if (typeof msg.id !== 'string' && typeof msg.id !== 'number') {
          sendJson(socket, { id: msg.id, ok: false, error: { code: 'bad_call', message: 'call requires id' } });
          return;
        }
        sendJson(tab.socket, {
          id: msg.id,
          command: msg.command,
          args: msg.args == null ? {} : msg.args,
        });
        return;
      }

      if (Object.prototype.hasOwnProperty.call(msg, 'ok') && msg.type !== PAIR_MSG.PAIR) {
        if (meta.role !== 'tab' || tab.pairedPeer == null) {
          refuse(socket, 'not_paired', 'No paired peer for response');
          return;
        }
        sendJson(tab.pairedPeer, {
          id: msg.id,
          ok: msg.ok === true,
          result: msg.ok === true ? msg.result : undefined,
          error: msg.ok === true ? undefined : msg.error,
        });
        return;
      }

      refuse(socket, 'unknown_type', `Unknown message type: ${msg.type}`);
    });

    socket.on('close', () => {
      const m = socketMeta.get(socket);
      if (!m) return;
      const tabEntry = tabsByToken.get(m.token);
      if (!tabEntry) {
        socketMeta.delete(socket);
        return;
      }
      if (m.role === 'tab') {
        dropTab(m.token);
        log(`tab closed token=${m.token}`);
        return;
      }
      if (tabEntry.pendingPeer === socket) {
        tabEntry.pendingPeer = null;
        socketMeta.delete(socket);
        return;
      }
      if (tabEntry.pairedPeer === socket) {
        unpair(m.token, 'peer_disconnected');
      }
      socketMeta.delete(socket);
    });
  }

  function disconnectToken(token) {
    const tab = tabsByToken.get(token);
    if (!tab) return;
    unpair(token, 'tab_disconnect');
    try { tab.socket.close(); } catch { /* gone */ }
    dropTab(token);
  }

  return {
    attachSocket,
    disconnectToken,
    /** @param {string} token */
    hasTab(token) {
      return tabsByToken.has(token);
    },
    PAIR_MSG,
  };
}

export { PAIR_MSG };
