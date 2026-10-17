/**
 * In-memory hub for pairing a browser tab with one local peer over WebSocket.
 * Canonical implementation shared by surfcad-mcp and the SurfCAD dev server.
 */

import { PAIR_MSG } from '../relayMessages.mjs';
import { isAllowedHttpOrigin, isLoopbackAddress } from './localAddress.mjs';

/**
 * @typedef {{
 *   send: (data: string) => void,
 *   close: () => void,
 *   on: (event: string, cb: (...args: unknown[]) => void) => void,
 *   ping?: () => void,
 *   terminate?: () => void,
 *   remoteAddress?: string,
 *   origin?: string,
 * }} RelaySocket
 * @typedef {'info' | 'warn'} RelayLogLevel
 */

/** Opaque secrets (tab key, resume key) are random URL-safe strings. */
const SECRET_RE = /^[A-Za-z0-9_-]{16,128}$/;

function sendJson(socket, payload) {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    /* socket already gone */
  }
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

function secretOrNull(value) {
  return typeof value === 'string' && SECRET_RE.test(value) ? value : null;
}

/**
 * Logs must never carry a full pairing code: keep the first two characters.
 * @param {string} token
 */
export function redactToken(token) {
  const t = String(token || '');
  if (!t) return '-';
  return `${t.slice(0, 2)}${'*'.repeat(Math.max(2, t.length - 2))}`;
}

function closeReason(code, reason) {
  const text = reason == null ? '' : String(reason);
  if (code == null) return 'socket_closed';
  return text ? `socket_closed code=${code} (${text.slice(0, 80)})` : `socket_closed code=${code}`;
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
 * @param {{ onLog?: (line: string, level: RelayLogLevel) => void }} [opts]
 */
export function createAgentBridgeRelayHub(opts = {}) {
  /** @param {string} line @param {RelayLogLevel} [level] */
  const log = (line, level = 'info') => { opts.onLog?.(line, level); };

  /**
   * @type {Map<string, {
   *   socket: RelaySocket,
   *   token: string,
   *   tabKey: string | null,
   *   pairedPeer: RelaySocket | null,
   *   pendingPeer: RelaySocket | null,
   * }>}
   */
  const tabsByToken = new Map();
  /** @type {Map<RelaySocket, { role: 'tab' | 'peer', token: string }>} */
  const socketMeta = new Map();
  /** @type {Map<RelaySocket, { alive: boolean, dropReason: string | null }>} */
  const liveness = new Map();

  function closePeer(peer) {
    socketMeta.delete(peer);
    try { peer.close(); } catch { /* gone */ }
  }

  /**
   * @param {string} token
   * @param {string} reason
   */
  function dropTab(token, reason) {
    const tab = tabsByToken.get(token);
    if (!tab) return;
    tabsByToken.delete(token);
    socketMeta.delete(tab.socket);
    const peerState = tab.pairedPeer ? 'paired' : (tab.pendingPeer ? 'pending' : 'none');
    log(`tab dropped token=${redactToken(token)} reason=${reason} peer=${peerState}`, 'warn');
    if (tab.pairedPeer) {
      sendJson(tab.pairedPeer, { type: PAIR_MSG.UNPAIRED, reason: 'tab_disconnected', detail: reason });
      closePeer(tab.pairedPeer);
    }
    if (tab.pendingPeer) {
      sendJson(tab.pendingPeer, { type: PAIR_MSG.ERROR, code: 'pair_cancelled', message: 'Tab disconnected' });
      closePeer(tab.pendingPeer);
    }
  }

  function unpair(token, reason = 'disconnect') {
    const tab = tabsByToken.get(token);
    if (!tab || !tab.pairedPeer) return;
    const peer = tab.pairedPeer;
    tab.pairedPeer = null;
    log(`pairing ended token=${redactToken(token)} reason=${reason}`, 'warn');
    sendJson(tab.socket, { type: PAIR_MSG.UNPAIRED, reason });
    sendJson(peer, { type: PAIR_MSG.UNPAIRED, reason });
    closePeer(peer);
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
      refuse(socket, 'origin_blocked', 'Origin is not an allowed SurfCAD page (https://surfcad.com or local dev)');
      return;
    }

    const live = { alive: true, dropReason: null };
    if (typeof socket.ping === 'function') liveness.set(socket, live);
    socket.on('pong', () => { live.alive = true; });

    socket.on('message', (raw) => {
      live.alive = true;
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
        const tabKey = secretOrNull(msg.tabKey);
        const existing = tabsByToken.get(token);
        if (existing) {
          // A reconnecting tab can beat the heartbeat to its own stale socket;
          // only the tab that registered the code knows its tabKey.
          if (!tabKey || existing.tabKey !== tabKey) {
            refuse(socket, 'token_in_use', 'Another tab is already advertising this pairing code');
            return;
          }
          const stale = existing.socket;
          dropTab(token, 'replaced_by_reconnect');
          liveness.delete(stale);
          try { (stale.terminate || stale.close).call(stale); } catch { /* gone */ }
        }
        tabsByToken.set(token, { socket, token, tabKey, pairedPeer: null, pendingPeer: null });
        socketMeta.set(socket, { role: 'tab', token });
        log(`tab registered token=${redactToken(token)}${existing ? ' (reconnect)' : ''}`);
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
        const resume = secretOrNull(msg.resume);
        tab.pendingPeer = socket;
        socketMeta.set(socket, { role: 'peer', token });
        sendJson(tab.socket, resume
          ? { type: PAIR_MSG.PAIR_REQUEST, token, resume }
          : { type: PAIR_MSG.PAIR_REQUEST, token });
        log(`pair request token=${redactToken(token)}${resume ? ' (resume)' : ''}`);
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
        const resumeKey = secretOrNull(msg.resumeKey);
        tab.pendingPeer = null;
        tab.pairedPeer = peer;
        sendJson(socket, { type: PAIR_MSG.PAIRED, token: meta.token });
        sendJson(peer, resumeKey
          ? { type: PAIR_MSG.PAIRED, token: meta.token, resumeKey }
          : { type: PAIR_MSG.PAIRED, token: meta.token });
        log(`paired token=${redactToken(meta.token)}`);
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
          closePeer(peer);
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

    socket.on('close', (code, reason) => {
      liveness.delete(socket);
      const m = socketMeta.get(socket);
      if (!m) return;
      const why = live.dropReason || closeReason(code, reason);
      const tabEntry = tabsByToken.get(m.token);
      if (!tabEntry) {
        socketMeta.delete(socket);
        return;
      }
      if (m.role === 'tab') {
        if (tabEntry.socket === socket) dropTab(m.token, why);
        else socketMeta.delete(socket);
        return;
      }
      if (tabEntry.pendingPeer === socket) {
        tabEntry.pendingPeer = null;
        socketMeta.delete(socket);
        return;
      }
      if (tabEntry.pairedPeer === socket) {
        unpair(m.token, live.dropReason ? `peer_${live.dropReason}` : 'peer_disconnected');
      }
      socketMeta.delete(socket);
    });
  }

  /**
   * One heartbeat sweep: terminate sockets that did not answer the previous
   * ping, then ping the rest. Call every `heartbeatMs`.
   */
  function heartbeat() {
    for (const [socket, live] of liveness) {
      if (!live.alive) {
        live.dropReason = 'heartbeat_timeout';
        liveness.delete(socket);
        try { (socket.terminate || socket.close).call(socket); } catch { /* gone */ }
        continue;
      }
      live.alive = false;
      try { socket.ping?.(); } catch { /* gone; next sweep terminates */ }
    }
  }

  function disconnectToken(token) {
    const tab = tabsByToken.get(token);
    if (!tab) return;
    unpair(token, 'tab_disconnect');
    try { tab.socket.close(); } catch { /* gone */ }
    dropTab(token, 'disconnect_requested');
  }

  return {
    attachSocket,
    disconnectToken,
    heartbeat,
    /** @param {string} token */
    hasTab(token) {
      return tabsByToken.has(token);
    },
    /** @param {string} token */
    isPaired(token) {
      return tabsByToken.get(token)?.pairedPeer != null;
    },
    PAIR_MSG,
  };
}

export { PAIR_MSG };
