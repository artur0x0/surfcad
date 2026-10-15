import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { bridgeToolDefinitions, loadCommandsCatalog } from './catalog.mjs';
import { formatBridgeError, notPairedError, pairingEnvHint } from './errors.mjs';
import { RelaySession } from './relay.mjs';

const PAIR_TOOL_NAME = 'pair';

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
    { name: 'surfcad-mcp', version: String(catalog.version || '1') },
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
        const result = await session.pair(code);
        return textResult(result);
      } catch (err) {
        return textResult(toolErrorPayload(err), true);
      }
    }

    const known = bridgeTools.some((t) => t.name === name);
    if (!known) {
      return textResult({ code: 'unknown_tool', message: `Unknown tool: ${name}` }, true);
    }

    if (!session.isPaired()) {
      const envCode = (process.env.SURFCAD_PAIRING_CODE || '').trim();
      if (envCode) {
        try {
          await session.pair(envCode);
        } catch (err) {
          return textResult(toolErrorPayload(err), true);
        }
      } else {
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
  const { server, session } = await createSurfcadMcpServer();
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
