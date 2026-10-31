import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  AGENT_HANDSHAKE_UPDATE_MESSAGE,
  checkAgentHandshakeVersion,
  commandResponse,
  readCommandRequest,
  readCommandResponse,
} from '../../packages/surfcad-mcp/src/commandProtocol.mjs';
import { logRelay } from './log.js';
import { isAllowedBrowserOrigin } from './origins.js';
import { readBearer } from './router.js';

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
 * }} relay
 * @param {{ authenticateUpgrade: (req: import('node:http').IncomingMessage) => Promise<{ id: string } | null> }} options
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
          wss.handleUpgrade(req, socket, head, (ws) => bindAgent(ws, auth, relay));
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
        wss.handleUpgrade(req, socket, head, (ws) => bindTab(ws, user, relay));
      } catch {
        rejectUpgrade(socket, 401, 'Authentication required');
      }
    }).catch(() => {
      rejectUpgrade(socket, 401, 'Authentication required');
    });
  });

  httpServer.on('close', () => {
    wss.close();
  });

  return wss;
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {{ userId: string, id: string, tokenHash: string }} auth
 * @param {{
 *   tokens: { markUsed: (auth: { tokenHash: string }) => Promise<unknown> },
 *   registry: ReturnType<import('./registry.js').createMemoryTabRegistry>,
 *   commandLimiter: { check: (key: string) => { allowed: boolean, retryAfterSec?: number } },
 *   maxMessageBytes: number,
 * }} relay
 */
function bindAgent(ws, auth, relay) {
  let ready = false;
  ws.on('error', () => {});
  ws.on('message', (data, isBinary) => {
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
      sendJson(ws, { type: 'error', error: 'bad_call' });
      return;
    }
    if (!ready) {
      const version = checkAgentHandshakeVersion(msg?.v);
      if (msg?.type !== 'hello' || !version.ok) {
        const error = version.ok ? AGENT_HANDSHAKE_UPDATE_MESSAGE : version.error;
        sendJson(ws, { type: 'error', error });
        ws.close(1008, error);
        return;
      }
      ready = true;
      sendJson(ws, { type: 'hello', v: version.v });
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
    logRelay({
      event: 'command',
      userId: auth.userId,
      command: frame.command,
      bytes: Buffer.byteLength(text),
    });
    relay.tokens.markUsed(auth).catch(() => {});
    relay.registry.submit({ userId: auth.userId, frame }).then((response) => {
      sendJson(ws, response);
    }).catch(() => {
      sendJson(ws, commandResponse({
        id: frame.id,
        ok: false,
        error: { code: 'internal', message: 'Relay failed' },
      }));
    });
  });
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {{ id: string }} user
 * @param {{ registry: ReturnType<import('./registry.js').createMemoryTabRegistry> }} relay
 */
function bindTab(ws, user, relay) {
  const tabId = randomUUID();
  ws.on('error', () => {});
  relay.registry.registerTab({
    userId: user.id,
    tabId,
    send(frame) {
      sendJson(ws, frame);
    },
  });
  sendJson(ws, { type: 'registered', v: 1, tabId });
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
