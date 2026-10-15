/**
 * Vite plugin: localhost WebSocket relay for M1 agent-bridge pairing.
 * Binds 127.0.0.1 only (separate port from the HTTP server).
 */
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createAgentBridgeRelayHub } from '../src/agent/ws/relayHub.js';
import { isLoopbackAddress } from '../src/agent/ws/localAddress.js';

const DEFAULT_PORT = 17341;

function parsePort(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

/**
 * @param {{ port?: number, onReady?: (url: string) => void }} [options]
 */
export function startAgentBridgeRelay(options = {}) {
  const port = options.port ?? parsePort(process.env.SURFCAD_AGENT_BRIDGE_WS_PORT);
  const hub = createAgentBridgeRelayHub({
    onLog: (line) => {
      if (process.env.SURFCAD_AGENT_BRIDGE_WS_VERBOSE === '1') {
        console.log(`[agent-bridge-ws] ${line}`);
      }
    },
  });

  const server = createServer();
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const remote = req.socket.remoteAddress || '';
    if (!isLoopbackAddress(remote)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const origin = req.headers.origin;
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
    server.listen(port, '127.0.0.1', () => {
      const bound = server.address();
      const actualPort = bound && typeof bound === 'object' ? bound.port : port;
      const url = `ws://127.0.0.1:${actualPort}`;
      options.onReady?.(url);
      resolve({ server, wss, hub, url, port: actualPort });
    });
    server.on('error', reject);
  });
}

let relayPromise;

function ensureRelay() {
  if (!relayPromise) {
    relayPromise = startAgentBridgeRelay({
      onReady: (url) => {
        console.log(`[surfcad] Agent bridge WebSocket relay on ${url} (127.0.0.1 only)`);
      },
    });
  }
  return relayPromise;
}

/** @returns {import('vite').Plugin} */
export default function viteAgentBridgeWs() {
  const wsUrl = `ws://127.0.0.1:${parsePort(process.env.SURFCAD_AGENT_BRIDGE_WS_PORT)}`;
  return {
    name: 'surfcad-agent-bridge-ws',
    config() {
      return {
        env: {
          VITE_SURFCAD_AGENT_WS_URL: wsUrl,
        },
      };
    },
    configureServer() {
      void ensureRelay();
    },
    configurePreviewServer() {
      void ensureRelay();
    },
  };
}
