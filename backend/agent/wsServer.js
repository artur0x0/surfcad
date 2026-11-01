import { randomUUID } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import {
  AGENT_HANDSHAKE_UPDATE_MESSAGE,
  checkAgentHandshakeVersion,
  commandResponse,
  readCommandRequest,
  readCommandResponse,
} from '../../packages/surfcad-mcp/src/commandProtocol.mjs';
import {
  AGENT_SOCKET_CLOSE_CODE,
  TOKEN_EXPIRED_REASON,
  TOKEN_REVOKED_REASON,
  TOO_MANY_CONNECTIONS_CODE,
  TOO_MANY_CONNECTIONS_REASON,
} from './agentSockets.js';
import { clientAddress } from './clientIp.js';
import { logRelay } from './log.js';
import { isAllowedBrowserOrigin } from './origins.js';
import { readBearer } from './router.js';
import { deliverTabAgentFrame } from './tabPrompt.js';
import { TAB_SESSION_ENDED_CODE, TAB_SESSION_ENDED_REASON } from './tabSockets.js';

/**
 * @param {import('node:net').Socket} socket
 * @param {number} status
 * @param {string} message
 */
function rejectUpgrade(socket, status, message) {
  if (socket.destroyed) return;
  let reason = 'Bad Request';
  if (status === 401) reason = 'Unauthorized';
  else if (status === 403) reason = 'Forbidden';
  else if (status === 429) reason = 'Too Many Requests';
  const body = JSON.stringify({ error: message });
  const raw = `HTTP/1.1 ${status} ${reason}\r\n`
    + 'Content-Type: application/json\r\n'
    + 'Connection: close\r\n'
    + `Content-Length: ${Buffer.byteLength(body)}\r\n`
    + '\r\n'
    + body;
  socket.end(raw);
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {object} payload
 */
function sendJson(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

/**
 * @param {import('node:http').Server} httpServer
 * @param {{
 *   tokens: import('./tokens.js').createTokenService extends (...args: any) => infer R ? R : never,
 *   registry: ReturnType<import('./registry.js').createMemoryTabRegistry>,
 *   commandLimiter: { check: (key: string) => { allowed: boolean, retryAfterSec?: number } },
 *   maxMessageBytes: number,
 *   agentSockets: { add: (tokenId: string, ws: import('ws').WebSocket, userId: string) => boolean },
 *   connectLimiter: { check: (key: string) => { allowed: boolean, retryAfterSec?: number } },
 *   pingIntervalMs: number,
 * }} relay
 * @param {{
 *   authenticateUpgrade: (req: import('node:http').IncomingMessage) => Promise<{ id: string } | null>,
 *   trustProxyHops?: number,
 * }} options
 */
export function attachAgentWebSocket(httpServer, relay, options) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: relay.maxMessageBytes,
    perMessageDeflate: false,
  });
  // Upgraded sockets leave Node's HTTP connection list, so
  // closeAllConnections() does not see them and server.close() waits forever.
  /** @type {Set<import('node:net').Socket>} */
  const upgraded = new Set();
  const closeHttpServer = httpServer.close.bind(httpServer);
  httpServer.close = function close(callback) {
    for (const socket of [...upgraded]) socket.destroy();
    return closeHttpServer(callback);
  };

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    } catch {
      rejectUpgrade(socket, 400, 'Bad request');
      return;
    }
    if (pathname !== '/agent') return;

    const ip = clientAddress(req, options.trustProxyHops ?? 1);
    const connect = relay.connectLimiter.check(`ip:${ip}`);
    if (!connect.allowed) {
      rejectUpgrade(socket, 429, 'rate_limited');
      return;
    }

    upgraded.add(socket);
    socket.on('close', () => upgraded.delete(socket));

    const bearer = readBearer(req.headers.authorization);
    if (bearer) {
      relay.tokens.authenticate(bearer).then((auth) => {
        if (!auth || socket.destroyed) {
          if (!socket.destroyed) rejectUpgrade(socket, 401, 'Authentication required');
          return;
        }
        try {
          wss.handleUpgrade(req, socket, head, (ws) => {
            bindAgent(ws, auth, relay);
            wss.emit('connection', ws, req);
          });
        } catch {
          rejectUpgrade(socket, 401, 'Authentication required');
        }
      }).catch(() => {
        rejectUpgrade(socket, 401, 'Authentication required');
      });
      return;
    }

    const origin = req.headers.origin;
    if (!isAllowedBrowserOrigin(typeof origin === 'string' ? origin : '')) {
      rejectUpgrade(socket, 403, 'Origin not allowed');
      return;
    }
    options.authenticateUpgrade(req).then((user) => {
      if (!user) {
        rejectUpgrade(socket, 401, 'Authentication required');
        return;
      }
      if (socket.destroyed) return;
      try {
        wss.handleUpgrade(req, socket, head, (ws) => {
          bindTab(ws, user, relay, req);
          wss.emit('connection', ws, req);
        });
      } catch {
        rejectUpgrade(socket, 401, 'Authentication required');
      }
    }).catch(() => {
      rejectUpgrade(socket, 401, 'Authentication required');
    });
  });

  // handleUpgrade does not emit this on its own. Both upgrade paths emit
  // it after bind. The listener is what records pongs; without that, the
  // next heartbeat treats every socket as a missed pong and terminates it.
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  const pingMs = relay.pingIntervalMs > 0 ? relay.pingIntervalMs : 30_000;
  const heartbeat = setInterval(() => {
    sweepSockets(wss, relay, options.authenticateUpgrade).catch(() => {});
  }, pingMs);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  httpServer.on('close', () => {
    clearInterval(heartbeat);
    wss.close();
  });

  return wss;
}

/**
 * A fresh upgrade request with the cookie captured when the tab connected.
 * Session middleware reads that cookie. It does not reuse the live socket.
 * @param {Record<string, string>} headers
 */
function sessionProbe(headers) {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.headers = headers;
  req.method = 'GET';
  req.url = '/agent';
  req.httpVersion = '1.1';
  return req;
}

/**
 * Cookie plus test user. Tabs that present the same session share one
 * recheck per tick. The user id is compared afterwards, per socket.
 * @param {Record<string, string>} headers
 */
function sessionKey(headers) {
  return `${headers.cookie || ''}\n${headers['x-test-user'] || ''}`;
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {number} code
 * @param {string} reason
 */
function closeOpen(ws, code, reason) {
  if (ws.readyState === WebSocket.OPEN) ws.close(code, reason);
}

/**
 * Ping every socket. Terminate one that missed the previous pong.
 * An agent whose token is revoked or expired is closed with 4001 even
 * when it has sent no further frame. A tab whose session is gone is
 * closed with 1000. That is not a revoked agent token.
 * Each tick looks up a token hash once and a session once, then applies
 * that result to every socket that shares it. There is no cache across
 * ticks, so a revoke is enforced on the next heartbeat.
 * A session or token-store error closes every socket that needed that
 * lookup with 1011. Leaving them open would keep a tab or agent connected
 * after the check that should have dropped it failed.
 * @param {import('ws').WebSocketServer} wss
 * @param {{
 *   tokens: { status: (tokenHash: string) => Promise<'ok' | 'revoked' | 'expired' | 'missing'> },
 * }} relay
 * @param {(req: import('node:http').IncomingMessage) => Promise<{ id: string } | null>} [authenticateUpgrade]
 */
async function sweepSockets(wss, relay, authenticateUpgrade) {
  /** @type {Map<string, { headers: Record<string, string>, sockets: import('ws').WebSocket[] }>} */
  const sessions = new Map();
  /** @type {Map<string, import('ws').WebSocket[]>} */
  const byToken = new Map();
  const clients = [...wss.clients];
  for (const ws of clients) {
    const tab = /** @type {{ userId: string, headers: Record<string, string> } | undefined} */ (ws.tabSession);
    if (tab && authenticateUpgrade) {
      const key = sessionKey(tab.headers);
      let group = sessions.get(key);
      if (!group) {
        group = { headers: tab.headers, sockets: [] };
        sessions.set(key, group);
      }
      group.sockets.push(ws);
    }
    const auth = /** @type {{ tokenHash?: string } | undefined} */ (ws.agentAuth);
    if (auth?.tokenHash) {
      let group = byToken.get(auth.tokenHash);
      if (!group) {
        group = [];
        byToken.set(auth.tokenHash, group);
      }
      group.push(ws);
    }
  }

  /** @type {Set<import('ws').WebSocket>} */
  const dropping = new Set();

  await Promise.all([...sessions.entries()].map(async ([, group]) => {
    const probe = sessionProbe(group.headers);
    try {
      const again = await authenticateUpgrade(probe);
      for (const ws of group.sockets) {
        const tab = /** @type {{ userId: string }} */ (ws.tabSession);
        if (!again || again.id !== tab.userId) {
          dropping.add(ws);
          closeOpen(ws, TAB_SESSION_ENDED_CODE, TAB_SESSION_ENDED_REASON);
        }
      }
    } catch (err) {
      console.error('[agent-relay] session recheck failed; closing tab socket', err?.message || err);
      for (const ws of group.sockets) {
        dropping.add(ws);
        closeOpen(ws, 1011, 'internal');
      }
    } finally {
      probe.socket.destroy();
    }
  }));

  await Promise.all([...byToken.entries()].map(async ([tokenHash, sockets]) => {
    try {
      const live = await relay.tokens.status(tokenHash);
      if (live === 'ok') return;
      const expired = live === 'expired';
      for (const ws of sockets) {
        dropping.add(ws);
        closeOpen(ws, AGENT_SOCKET_CLOSE_CODE, expired ? TOKEN_EXPIRED_REASON : TOKEN_REVOKED_REASON);
      }
    } catch (err) {
      console.error('[agent-relay] token status failed; closing agent socket', err?.message || err);
      for (const ws of sockets) {
        dropping.add(ws);
        closeOpen(ws, 1011, 'internal');
      }
    }
  }));

  for (const ws of clients) {
    if (dropping.has(ws)) continue;
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {{ userId: string, id: string, tokenHash: string }} auth
 * @param {{
 *   tokens: {
 *     markUsed: (auth: { tokenHash: string }) => Promise<unknown>,
 *     status: (tokenHash: string) => Promise<'ok' | 'revoked' | 'expired' | 'missing'>,
 *   },
 *   registry: ReturnType<import('./registry.js').createMemoryTabRegistry>,
 *   commandLimiter: { check: (key: string) => { allowed: boolean, retryAfterSec?: number } },
 *   maxMessageBytes: number,
 *   agentSockets: { add: (tokenId: string, ws: import('ws').WebSocket) => void },
 * }} relay
 */
function bindAgent(ws, auth, relay) {
  if (!relay.agentSockets.add(auth.id, ws, auth.userId)) {
    ws.close(TOO_MANY_CONNECTIONS_CODE, TOO_MANY_CONNECTIONS_REASON);
    return;
  }
  ws.agentAuth = auth;
  let ready = false;
  /** @type {string | null} */
  let agentId = null;
  ws.on('error', () => {});
  ws.on('close', () => {
    if (!agentId) return;
    relay.registry.unregisterAgent(auth.userId, agentId);
    agentId = null;
  });
  ws.on('message', (data, isBinary) => {
    handleAgentMessage(ws, auth, relay, data, isBinary, {
      isReady: () => ready,
      markReady() {
        ready = true;
        const id = randomUUID();
        const accepted = relay.registry.registerAgent({
          userId: auth.userId,
          agentId: id,
          send(frame) {
            sendJson(ws, frame);
          },
        });
        if (!accepted) {
          ws.close(TOO_MANY_CONNECTIONS_CODE, TOO_MANY_CONNECTIONS_REASON);
          return;
        }
        agentId = id;
      },
    }).catch(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'internal');
    });
  });
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {string} live
 * @param {string | number | undefined} id
 */
function refuseDeadToken(ws, live, id) {
  const expired = live === 'expired';
  sendJson(ws, commandResponse({
    id,
    ok: false,
    error: {
      code: 'unauthorized',
      message: expired ? 'Token expired' : 'Token revoked',
    },
  }));
  ws.close(AGENT_SOCKET_CLOSE_CODE, expired ? TOKEN_EXPIRED_REASON : TOKEN_REVOKED_REASON);
}

/**
 * Upgrade checks the token once. Every later frame checks it again, so a
 * revoke or expiry on an open socket cannot run a command.
 * @param {import('ws').WebSocket} ws
 * @param {{ userId: string, id: string, tokenHash: string }} auth
 * @param {{
 *   tokens: {
 *     markUsed: (auth: { tokenHash: string }) => Promise<unknown>,
 *     status: (tokenHash: string) => Promise<'ok' | 'revoked' | 'expired' | 'missing'>,
 *   },
 *   registry: ReturnType<import('./registry.js').createMemoryTabRegistry>,
 *   commandLimiter: { check: (key: string) => { allowed: boolean, retryAfterSec?: number } },
 *   maxMessageBytes: number,
 * }} relay
 * @param {import('ws').RawData} data
 * @param {boolean} isBinary
 * @param {{ isReady: () => boolean, markReady: () => void }} ready
 */
async function handleAgentMessage(ws, auth, relay, data, isBinary, ready) {
  if (isBinary) {
    ws.close(1003, 'text only');
    return;
  }
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  if (Buffer.byteLength(text) > relay.maxMessageBytes) {
    sendJson(ws, { type: 'error', error: 'Message exceeds the size cap' });
    ws.close(1009, 'Message exceeds the size cap');
    return;
  }
  /** @type {any} */
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    msg = null;
  }
  const live = await relay.tokens.status(auth.tokenHash);
  if (live !== 'ok') {
    refuseDeadToken(ws, live, msg?.id);
    return;
  }
  if (msg == null) {
    sendJson(ws, { type: 'error', error: 'bad_call' });
    return;
  }
  if (!ready.isReady()) {
    const version = checkAgentHandshakeVersion(msg?.v);
    if (msg?.type !== 'hello' || !version.ok) {
      const error = version.ok ? AGENT_HANDSHAKE_UPDATE_MESSAGE : version.error;
      sendJson(ws, { type: 'error', error });
      ws.close(1008, error);
      return;
    }
    ready.markReady();
    sendJson(ws, { type: 'hello', v: version.v });
    for (const frame of relay.registry.drainPrompts(auth.userId)) {
      sendJson(ws, frame);
    }
    return;
  }
  if (typeof msg?.type === 'string' && msg.type.startsWith('agent.')) {
    relay.registry.forwardToTabs(auth.userId, msg);
    return;
  }
  const frame = readCommandRequest(msg);
  if (!frame || frame.id == null || frame.id === '') {
    sendJson(ws, commandResponse({
      id: msg?.id,
      ok: false,
      error: { code: 'bad_call', message: 'call requires id and command' },
    }));
    return;
  }
  const again = await relay.tokens.status(auth.tokenHash);
  if (again !== 'ok') {
    refuseDeadToken(ws, again, frame.id);
    return;
  }
  const limited = relay.commandLimiter.check(auth.id);
  if (!limited.allowed) {
    sendJson(ws, commandResponse({
      id: frame.id,
      ok: false,
      error: { code: 'rate_limited', message: 'Too many commands' },
    }));
    return;
  }
  if (relay.registry.hasInFlight(auth.userId, frame.id)) {
    sendJson(ws, commandResponse({
      id: frame.id,
      ok: false,
      error: { code: 'duplicate_id', message: 'A command with this id is still in flight' },
    }));
    return;
  }
  const attempt = relay.registry.trySubmit({
    userId: auth.userId,
    tokenId: auth.id,
    frame,
  });
  if (!attempt.accepted) {
    sendJson(ws, attempt.response);
    return;
  }
  logRelay({
    event: 'command',
    userId: auth.userId,
    command: frame.command,
    bytes: Buffer.byteLength(text),
  });
  relay.tokens.markUsed(auth).catch(() => {});
  attempt.done.then((response) => {
    sendJson(ws, response);
  }).catch(() => {
    sendJson(ws, commandResponse({
      id: frame.id,
      ok: false,
      error: { code: 'internal', message: 'Relay failed' },
    }));
  });
}

/**
 * @param {import('ws').WebSocket & { tabSession?: { userId: string, headers: Record<string, string> } }} ws
 * @param {{ id: string }} user
 * @param {{
 *   registry: ReturnType<import('./registry.js').createMemoryTabRegistry>,
 *   tabSockets?: { add: (userId: string, ws: import('ws').WebSocket) => void },
 * }} relay
 * @param {import('node:http').IncomingMessage} req
 */
function bindTab(ws, user, relay, req) {
  const headers = {};
  if (typeof req.headers.cookie === 'string') headers.cookie = req.headers.cookie;
  const testUser = req.headers['x-test-user'];
  if (typeof testUser === 'string') headers['x-test-user'] = testUser;
  ws.tabSession = { userId: String(user.id), headers };
  relay.tabSockets?.add(user.id, ws);
  const tabId = randomUUID();
  ws.on('error', () => {});
  const accepted = relay.registry.registerTab({
    userId: user.id,
    tabId,
    send(frame) {
      sendJson(ws, frame);
    },
  });
  if (!accepted) {
    ws.close(TOO_MANY_CONNECTIONS_CODE, TOO_MANY_CONNECTIONS_REASON);
    return;
  }
  sendJson(ws, {
    type: 'registered',
    v: 1,
    tabId,
    agentConnected: relay.registry.agentConnected(user.id),
  });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    relay.registry.touchTab(user.id, tabId);
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    /** @type {any} */
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof msg?.type === 'string' && msg.type.startsWith('agent.')) {
      deliverTabAgentFrame(relay.registry, user.id, msg, (frame) => {
        if (ws.readyState === WebSocket.OPEN) sendJson(ws, frame);
      });
      return;
    }
    const parsed = readCommandResponse(msg);
    if (!parsed || parsed.id == null) return;
    const response = parsed.ok
      ? commandResponse({ id: parsed.id, ok: true, result: parsed.result })
      : commandResponse({ id: parsed.id, ok: false, error: parsed.error });
    relay.registry.complete(user.id, parsed.id, response);
  });
  ws.on('close', () => {
    relay.registry.unregisterTab(user.id, tabId);
  });
}
