/**
 * Vite plugin: localhost WebSocket relay for M1 agent-bridge pairing.
 * Binds 127.0.0.1 only (separate port from the HTTP server).
 */
import {
  DEFAULT_RELAY_PORT,
  ensureAgentBridgeRelay,
} from '../packages/surfcad-mcp/src/bridge/relayServer.mjs';

function parsePort(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_RELAY_PORT;
}

function shouldStartRelay() {
  // Same flag as surfcad-mcp: '0' means another process owns the relay
  // (playtest MCP bin, or a test-started server). Preview must not bind the port.
  return process.env.SURFCAD_MCP_START_RELAY !== '0';
}

function ensureRelay() {
  if (!shouldStartRelay()) return Promise.resolve(null);
  return ensureAgentBridgeRelay({
    onReady: (url) => {
      console.log(`[surfcad] Agent bridge WebSocket relay on ${url} (127.0.0.1 only)`);
    },
  });
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

export { ensureAgentBridgeRelay, startAgentBridgeRelay } from '../packages/surfcad-mcp/src/bridge/relayServer.mjs';
