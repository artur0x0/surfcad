/**
 * In-memory hub for pairing a browser tab with one local peer over WebSocket.
 * Canonical implementation shared by surfcad-mcp and the SurfCAD dev server.
 */

import { AGENT_PROTOCOL_VERSION, commandRequest, commandResponse, readCommandResponse } from '../commandProtocol.mjs';
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

/** How long a dropped tab keeps its pairing code so a squatter cannot take it. */
export const DEFAULT_TAB_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;
/** How often expired reservations are swept from the Map (unref'd timer). */
export const DEFAULT_TAB_RESERVATION_SWEEP_MS = 60 * 1000;
/**
 * A 2 MiB PNG is about 2.8 MB of base64 plus a short JSON envelope.
 * Larger prompt frames are refused before they are forwarded.
 */
export const DEFAULT_MAX_AGENT_PROMPT_FRAME_CHARS = 4 * 1024 * 1024;

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
 * @param {{
 *   onLog?: (line: string, level: RelayLogLevel) => void,
 *   reservationTtlMs?: number,
 *   reservationSweepMs?: number,
 *   maxPromptFrameChars?: number,
 * }} [opts]
 */
export function createAgentBridgeRelayHub(opts = {}) {
  /** @param {string} line @param {RelayLogLevel} [level] */
  const log = (line, level = 'info') => { opts.onLog?.(line, level); };
  const reservationTtlMs = opts.reservationTtlMs ?? DEFAULT_TAB_RESERVATION_TTL_MS;
  const reservationSweepMs = opts.reservationSweepMs ?? DEFAULT_TAB_RESERVATION_SWEEP_MS;
  const maxPromptFrameChars = opts.maxPromptFrameChars ?? DEFAULT_MAX_AGENT_PROMPT_FRAME_CHARS;

  /**
   * @type {Map<string, {
   *   socket: RelaySocket | null,
   *   token: string,
   *   tabKey: string | null,
   *   resumeKey: string | null,
   *   resumeTabKey: string | null,
   *   pairedPeer: RelaySocket | null,
   *   pendingPeer: RelaySocket | null,
   *   reservedAt: number | null,
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

  function reservationExpired(tab) {
    return tab.socket == null
      && tab.reservedAt != null
      && (Date.now() - tab.reservedAt) > reservationTtlMs;
  }

  function liveTab(token) {
    const tab = tabsByToken.get(token);
    if (!tab) return null;
    if (reservationExpired(tab)) {
      tabsByToken.delete(token);
      return null;
    }
    return tab;
  }

  function sweepExpiredReservations() {
    for (const [token, tab] of tabsByToken) {
      if (reservationExpired(tab)) tabsByToken.delete(token);
    }
  }

  const sweepTimer = reservationSweepMs > 0
    ? setInterval(sweepExpiredReservations, reservationSweepMs)
    : null;
  if (typeof sweepTimer?.unref === 'function') sweepTimer.unref();

  function emptyEntry(token, extra = {}) {
    return {
      socket: null,
      token,
      tabKey: extra.tabKey ?? null,
      resumeKey: extra.resumeKey ?? null,
      resumeTabKey: extra.resumeTabKey ?? extra.tabKey ?? null,
      pairedPeer: null,
      pendingPeer: null,
      reservedAt: extra.reservedAt ?? null,
    };
  }

  function dropTab(token, reason) {
    const tab = tabsByToken.get(token);
    if (!tab) return;
    if (tab.socket) socketMeta.delete(tab.socket);
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
    if (tab.tabKey) {
      tabsByToken.set(token, emptyEntry(token, {
        tabKey: tab.tabKey,
        resumeKey: tab.resumeKey,
        resumeTabKey: tab.resumeTabKey || tab.tabKey,
        reservedAt: Date.now(),
      }));
      return;
    }
    tabsByToken.delete(token);
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
      const rawText = typeof raw === 'string' ? raw : String(raw);
      const msg = parseMessage(rawText);
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
        const existing = liveTab(token);
        if (existing) {
          // A reconnecting tab can beat the heartbeat to its own stale socket;
          // only the tab that registered the code knows its tabKey. After a
          // drop the entry is a reservation (socket null) for that same key.
          if (!tabKey || existing.tabKey !== tabKey) {
            refuse(socket, 'token_in_use', 'Another tab is already advertising this pairing code');
            return;
          }
          const stale = existing.socket;
          // Closing the bridge window is a user action: the tab sends
          // forgetResume so the same MCP client cannot silent-resume.
          const forgetResume = msg.forgetResume === true;
          const kept = {
            tabKey: existing.tabKey,
            resumeKey: forgetResume ? null : existing.resumeKey,
            resumeTabKey: existing.resumeTabKey || existing.tabKey,
          };
          if (stale && stale !== socket) {
            dropTab(token, 'replaced_by_reconnect');
            liveness.delete(stale);
            try { (stale.terminate || stale.close).call(stale); } catch { /* gone */ }
          }
          tabsByToken.set(token, { ...emptyEntry(token, kept), socket });
          socketMeta.set(socket, { role: 'tab', token });
          log(`tab registered token=${redactToken(token)} (reconnect)`);
          return;
        }
        tabsByToken.set(token, { ...emptyEntry(token, { tabKey }), socket });
        socketMeta.set(socket, { role: 'tab', token });
        log(`tab registered token=${redactToken(token)}`);
        return;
      }

      if (msg.type === PAIR_MSG.PAIR) {
        if (meta) {
          refuse(socket, 'already_registered', 'Socket already registered');
          return;
        }
        const token = typeof msg.token === 'string' ? msg.token.trim().toUpperCase() : '';
        const tab = liveTab(token);
        if (!tab || !tab.socket) {
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
        const offered = secretOrNull(msg.resume);
        const silentResume = Boolean(
          offered
          && tab.resumeKey
          && offered === tab.resumeKey
          && tab.tabKey
          && tab.resumeTabKey
          && tab.tabKey === tab.resumeTabKey,
        );
        socketMeta.set(socket, { role: 'peer', token });
        if (silentResume) {
          tab.pendingPeer = null;
          tab.pairedPeer = socket;
          sendJson(tab.socket, { type: PAIR_MSG.PAIRED, token, resume: true });
          sendJson(socket, { type: PAIR_MSG.PAIRED, token, resumeKey: tab.resumeKey });
          log(`paired token=${redactToken(token)} (resume)`);
          return;
        }
        tab.pendingPeer = socket;
        sendJson(tab.socket, { type: PAIR_MSG.PAIR_REQUEST, token });
        log(`pair request token=${redactToken(token)}`);
        return;
      }

      if (!meta) {
        refuse(socket, 'not_registered', 'Send register_tab or pair first');
        return;
      }

      const tab = liveTab(meta.token);
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
        tab.resumeKey = resumeKey;
        tab.resumeTabKey = tab.tabKey;
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

      if (msg.type === PAIR_MSG.AGENT_PROMPT || msg.type === PAIR_MSG.AGENT_PROMPT_CANCEL
        || msg.type === PAIR_MSG.AGENT_PROMPT_ACK || msg.type === PAIR_MSG.AGENT_PROMPT_CANCEL_RESULT
        || msg.type === PAIR_MSG.AGENT_REPLY || msg.type === PAIR_MSG.AGENT_MESSAGE
        || msg.type === PAIR_MSG.AGENT_STATUS
        || msg.type === PAIR_MSG.AGENT_ACTIVITY) {
        if (msg.type === PAIR_MSG.AGENT_PROMPT || msg.type === PAIR_MSG.AGENT_PROMPT_CANCEL) {
          if (meta.role !== 'tab') {
            sendJson(socket, {
              type: PAIR_MSG.ERROR,
              code: 'forbidden',
              message: msg.type === PAIR_MSG.AGENT_PROMPT_CANCEL
                ? 'Only the paired tab cancels prompts'
                : 'Only the paired tab sends prompts',
            });
            return;
          }
          const promptId = typeof msg.id === 'string' ? msg.id : undefined;
          if (msg.type === PAIR_MSG.AGENT_PROMPT && rawText.length > maxPromptFrameChars) {
            sendJson(socket, {
              type: PAIR_MSG.AGENT_PROMPT_ACK,
              id: promptId,
              delivery: 'failed',
              error: 'screenshot_too_large',
            });
            return;
          }
          if (tab.pairedPeer == null) {
            if (msg.type === PAIR_MSG.AGENT_PROMPT_CANCEL) {
              sendJson(socket, {
                type: PAIR_MSG.AGENT_PROMPT_CANCEL_RESULT,
                v: 1,
                id: promptId || '',
                state: 'not_found',
              });
              return;
            }
            sendJson(socket, {
              type: PAIR_MSG.AGENT_PROMPT_ACK,
              id: promptId,
              delivery: 'failed',
              error: 'not_paired',
            });
            return;
          }
          sendJson(tab.pairedPeer, msg);
          return;
        }
        if (meta.role !== 'peer' || tab.pairedPeer !== socket || tab.socket == null) {
          const wrongRole = meta.role !== 'peer';
          sendJson(socket, {
            type: PAIR_MSG.ERROR,
            code: wrongRole ? 'forbidden' : 'not_paired',
            message: wrongRole
              ? 'Only the paired agent sends replies, status, and cancel results'
              : 'Pair before sending agent messages',
          });
          return;
        }
        sendJson(tab.socket, msg);
        return;
      }

      if (typeof msg.command === 'string' && msg.type !== PAIR_MSG.PAIR) {
        if (meta.role !== 'peer' || tab.pairedPeer !== socket) {
          refuse(socket, 'not_paired', 'Pair before sending bridge commands');
          return;
        }
        if (msg.v != null && msg.v !== AGENT_PROTOCOL_VERSION) {
          sendJson(socket, commandResponse({
            id: msg.id,
            ok: false,
            error: { code: 'bad_call', message: `Unsupported protocol version: ${msg.v}` },
          }));
          return;
        }
        if (typeof msg.id !== 'string' && typeof msg.id !== 'number') {
          sendJson(socket, commandResponse({
            id: msg.id,
            ok: false,
            error: { code: 'bad_call', message: 'call requires id' },
          }));
          return;
        }
        sendJson(tab.socket, commandRequest({
          id: msg.id,
          command: msg.command,
          args: msg.args == null ? {} : msg.args,
        }));
        return;
      }

      if (Object.prototype.hasOwnProperty.call(msg, 'ok') && msg.type !== PAIR_MSG.PAIR) {
        if (meta.role !== 'tab' || tab.pairedPeer == null) {
          refuse(socket, 'not_paired', 'No paired peer for response');
          return;
        }
        if (msg.v != null && msg.v !== AGENT_PROTOCOL_VERSION) {
          sendJson(tab.pairedPeer, commandResponse({
            id: msg.id,
            ok: false,
            error: { code: 'bad_call', message: `Unsupported protocol version: ${msg.v}` },
          }));
          return;
        }
        const response = readCommandResponse(msg);
        sendJson(tab.pairedPeer, commandResponse({
          id: response?.id ?? msg.id,
          ok: response?.ok === true,
          result: response?.ok === true ? response.result : undefined,
          error: response?.ok === true ? undefined : response?.error,
        }));
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
    const tab = liveTab(token);
    if (!tab) return;
    unpair(token, 'tab_disconnect');
    try { tab.socket.close(); } catch { /* gone */ }
    dropTab(token, 'disconnect_requested');
  }

  function dispose() {
    if (sweepTimer) clearInterval(sweepTimer);
  }

  return {
    attachSocket,
    disconnectToken,
    heartbeat,
    dispose,
    /** @param {string} token */
    hasTab(token) {
      return liveTab(token) != null;
    },
    /** @param {string} token */
    isPaired(token) {
      return liveTab(token)?.pairedPeer != null;
    },
    PAIR_MSG,
  };
}

export { PAIR_MSG };
