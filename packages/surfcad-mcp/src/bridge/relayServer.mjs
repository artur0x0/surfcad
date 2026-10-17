/**
 * Loopback HTTP/WebSocket server for the M1 agent-bridge relay.
 * Binds 127.0.0.1 only. Handles CORS / Private Network Access preflight for
 * https://surfcad.com → ws://127.0.0.1 upgrades.
 */

import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createAgentBridgeRelayHub } from './relayHub.mjs';
import { isAllowedHttpOrigin, isLoopbackAddress } from './localAddress.mjs';

export const DEFAULT_RELAY_PORT = 17341;

function parsePort(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_RELAY_PORT;
}

/**
 * @param {string | undefined} origin
 * @returns {Record<string, string>}
 */
function corsHeadersForOrigin(origin) {
  if (!origin || !isAllowedHttpOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Private-Network': 'true',
    'Vary': 'Origin',
  };
}

/**
 * @param {string} url
 * @param {number} [timeoutMs]
 */
export function probeRelayAtUrl(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      finish(false);
      return;
    }
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* noop */ }
      finish(false);
    }, timeoutMs);
    ws.once('open', () => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* noop */ }
      finish(true);
    });
    ws.once('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

/**
 * @param {{ port?: number, host?: string, onReady?: (url: string) => void, onLog?: (line: string) => void }} [options]
 */
export function startAgentBridgeRelay(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = options.port ?? parsePort(process.env.SURFCAD_AGENT_BRIDGE_WS_PORT);
  const hub = createAgentBridgeRelayHub({
    onLog: options.onLog || ((line) => {
      if (process.env.SURFCAD_AGENT_BRIDGE_WS_VERBOSE === '1') {
        console.log(`[agent-bridge-ws] ${line}`);
      }
    }),
  });

  const server = createServer((req, res) => {
    const origin = req.headers.origin;
    const cors = corsHeadersForOrigin(origin);

    if (req.method === 'OPTIONS') {
      if (!origin || !isAllowedHttpOrigin(origin)) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.writeHead(204, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Sec-WebSocket-Protocol, Sec-WebSocket-Extensions',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    res.writeHead(404, cors);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });

  wss.on('headers', (headers, req) => {
    const origin = req.headers.origin;
    const cors = corsHeadersForOrigin(origin);
    for (const [key, value] of Object.entries(cors)) {
      headers.push(`${key}: ${value}`);
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const remote = req.socket.remoteAddress || '';
    if (!isLoopbackAddress(remote)) {
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    if (origin && !isAllowedHttpOrigin(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nOrigin not allowed\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
      hub.attachSocket({
        send: (data) => { ws.send(data); },
        close: () => { ws.close(); },
        on: (event, cb) => { ws.on(event, cb); },
        remoteAddress: remote,
        origin,
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const bound = server.address();
      const actualPort = bound && typeof bound === 'object' ? bound.port : port;
      const url = `ws://${host}:${actualPort}`;
      options.onReady?.(url);
      resolve({ server, wss, hub, url, port: actualPort, host, ownsServer: true });
    });
    server.on('error', reject);
  });
}

/** @type {Map<number, Promise<unknown>>} */
const sharedRelayByPort = new Map();

/**
 * Start the relay or attach to one already listening on the default loopback port.
 *
 * @param {{ port?: number, onReady?: (url: string) => void }} [options]
 */
export async function ensureAgentBridgeRelay(options = {}) {
  const host = '127.0.0.1';
  const port = options.port ?? parsePort(process.env.SURFCAD_AGENT_BRIDGE_WS_PORT);
  const url = `ws://${host}:${port}`;

  const existing = sharedRelayByPort.get(port);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      const started = await startAgentBridgeRelay({ ...options, host, port });
      return started;
    } catch (err) {
      if (err && typeof err === 'object' && err.code === 'EADDRINUSE') {
        const alive = await probeRelayAtUrl(url);
        if (alive) {
          options.onReady?.(url);
          return { url, server: null, wss: null, hub: null, port, host, ownsServer: false, reused: true };
        }
      }
      sharedRelayByPort.delete(port);
      throw err;
    }
  })();

  sharedRelayByPort.set(port, promise);
  return promise;
}
