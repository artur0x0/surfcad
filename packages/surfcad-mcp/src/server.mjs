import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { bridgeToolDefinitions, loadCommandsCatalog } from './catalog.mjs';
import {
  formatBridgeError,
  notPairedError,
  pairPendingError,
  pairingEnvHint,
} from './errors.mjs';
import { loadPackageVersion } from './packageVersion.mjs';
import {
  ensureAgentBridgeRelay,
  resetAgentBridgeRelayCache,
  stopAgentBridgeRelay,
} from './bridge/relayServer.mjs';
import { RelaySession } from './relay.mjs';

const PAIR_TOOL_NAME = 'pair';

/** A bridge call that has to pair first waits this long for Allow, then fails. */
const AUTO_PAIR_WAIT_MS = 1000;
/** The pair tool returns pair_pending before typical MCP client timeouts (60 s). */
const PAIR_TOOL_WAIT_MS = 30_000;

/**
 * @param {Promise<unknown>} attempt
 * @param {number} waitMs
 */
async function waitForPairing(attempt, waitMs) {
  attempt.catch(() => {});
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(timeout), waitMs);
  });
  try {
    const outcome = await Promise.race([attempt, timeout]);
    if (outcome === timeout) throw pairPendingError();
    return outcome;
  } finally {
    clearTimeout(timer);
  }
}

function textResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    isError,
  };
}

function toolErrorPayload(err) {
  if (err && typeof err === 'object' && err.code) {
    return formatBridgeError({
      code: err.code,
      message: err.message,
      details: err.details,
      hint: err.hint,
      retryable: err.retryable,
    });
  }
  return formatBridgeError({ message: String(err?.message || err) });
}

/**
 * @param {{ catalog?: ReturnType<typeof loadCommandsCatalog>, session?: RelaySession, autoPair?: boolean }} [options]
 */
export async function createSurfcadMcpServer(options = {}) {
  const catalog = options.catalog || loadCommandsCatalog();
  const session = options.session || new RelaySession();
  const bridgeTools = bridgeToolDefinitions(catalog);

  const server = new Server(
    { name: 'surfcad-mcp', version: loadPackageVersion() },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: PAIR_TOOL_NAME,
        description: `Pair this MCP server to an open SurfCAD tab via the local WebSocket relay. ${pairingEnvHint()}`,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: {
              type: 'string',
              description: '6-character pairing code from the SurfCAD Local agent panel',
            },
          },
        },
      },
      ...bridgeTools,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments && typeof request.params.arguments === 'object'
      ? request.params.arguments
      : {};

    if (name === PAIR_TOOL_NAME) {
      const code = typeof args.code === 'string' && args.code.trim()
        ? args.code.trim()
        : (process.env.SURFCAD_PAIRING_CODE || '').trim();
      if (!code) {
        return textResult({
          code: 'bad_pairing_code',
          message: `Missing pairing code. Pass { "code": "......" } or set SURFCAD_PAIRING_CODE. ${pairingEnvHint()}`,
        }, true);
      }
      try {
        const result = await waitForPairing(session.pair(code), PAIR_TOOL_WAIT_MS);
        return textResult(result);
      } catch (err) {
        return textResult(toolErrorPayload(err), true);
      }
    }

    const known = bridgeTools.some((t) => t.name === name);
    if (!known) {
      return textResult({ code: 'unknown_tool', message: `Unknown tool: ${name}` }, true);
    }

    // A lost session is already re-pairing in the background; session.call
    // fails fast with pairing_lost until it is back.
    if (!session.isPaired() && session.state !== 'lost') {
      const envCode = (process.env.SURFCAD_PAIRING_CODE || '').trim();
      if (envCode) {
        try {
          await waitForPairing(session.pair(envCode), AUTO_PAIR_WAIT_MS);
        } catch (err) {
          return textResult(toolErrorPayload(err), true);
        }
      } else if (session.state !== 'pairing') {
        return textResult(notPairedError(), true);
      }
    }

    try {
      const result = await session.call(name, args);
      return textResult(result);
    } catch (err) {
      const code = err?.code;
      if (code === 'real_repo_blocked' || code === 'confirm_required' || code === 'pair_rejected') {
        return textResult(formatBridgeError({
          code,
          message: err.message,
          details: err.details,
        }), true);
      }
      return textResult(toolErrorPayload(err), true);
    }
  });

  return { server, session, catalog, bridgeTools };
}

/**
 * @param {{ autoPairFromEnv?: boolean }} [options]
 */
export async function runSurfcadMcpServer(options = {}) {
  /** @type {Awaited<ReturnType<typeof ensureAgentBridgeRelay>> | null} */
  let ownedRelay = null;
  const startRelay = options.startRelay !== false && process.env.SURFCAD_MCP_START_RELAY !== '0';
  const relayOptions = {
    onReady: (url) => {
      if (process.env.SURFCAD_AGENT_BRIDGE_WS_VERBOSE === '1') {
        console.error(`[surfcad-mcp] Agent bridge relay on ${url}`);
      }
    },
  };
  if (startRelay) {
    const relay = await ensureAgentBridgeRelay(relayOptions);
    if (relay.ownsServer) ownedRelay = relay;
  }

  // Another surfcad-mcp process may own the relay; when it exits, take over
  // the port so the tab and this session can reconnect.
  const takeOverRelay = async () => {
    if (!startRelay || ownedRelay) return;
    resetAgentBridgeRelayCache();
    const relay = await ensureAgentBridgeRelay(relayOptions);
    if (relay.ownsServer) {
      ownedRelay = relay;
      console.error(`${new Date().toISOString()} [surfcad-mcp] relay owner went away; now serving ${relay.url}`);
    }
  };

  const onStdinClosed = () => {
    if (ownedRelay) {
      const closing = ownedRelay;
      ownedRelay = null;
      void stopAgentBridgeRelay(closing).finally(() => {
        setTimeout(() => process.exit(0), 0).unref();
      });
      return;
    }
    setTimeout(() => process.exit(0), 0).unref();
  };
  process.stdin.once('end', onStdinClosed);

  const { server, session } = await createSurfcadMcpServer({
    session: new RelaySession({ ensureRelay: takeOverRelay }),
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const envCode = (process.env.SURFCAD_PAIRING_CODE || '').trim();
  if (options.autoPairFromEnv !== false && envCode) {
    session.pair(envCode).catch(() => {
      /* user may approve later; tools will retry */
    });
  }

  return { server, session, transport };
}
