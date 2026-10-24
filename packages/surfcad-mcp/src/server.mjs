import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
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
import { augmentScreenshotTool, callPairedBridgeTool } from './screenshotFile.mjs';
import {
  callPromptTool,
  isPromptTool,
  PROMPT_ONBOARDING_NOTE,
  PROMPT_SERVER_INSTRUCTIONS,
  PROMPT_WEBHOOK_ACTIVE,
  promptToolDefinitions,
} from './prompt/promptTools.mjs';
import {
  callGuideTool,
  GUIDE_TOOL_NAME,
  guideResourceContents,
  guideResourceList,
  guideToolDefinition,
  SERVER_INSTRUCTIONS,
} from './prompt/guide.mjs';
import { withErrorHint, withRowHints } from './prompt/errorHints.mjs';

const PAIR_TOOL_NAME = 'pair';

/** One line in the pair result; the guidance itself is guide { topic: "start" }. */
const PAIR_GUIDE_POINTER = 'Before the first model call read guide { topic: "start" } (how to build in SurfCAD: block out first, features first, hardware as patterned parts); guide {} lists every topic.';

const STATUS_PROMPT_NOTE = ' This process also adds webhookRegistered (true when a prompt webhook is registered; the URL and any bearer are not included), queued (prompt messages waiting for read_messages; cancelled prompts are not counted), counts ({ queued, delivered, replied, cancelled }), and last ({ id, state } of the latest prompt, or null).';

/**
 * MCP-only fields on the bridge status tool. The host command and commands.json stay unchanged.
 * @param {{ name: string, description?: string }} tool
 */
function augmentStatusTool(tool) {
  if (!tool || tool.name !== 'status') return tool;
  return {
    ...tool,
    description: `${tool.description || ''}${STATUS_PROMPT_NOTE}`,
  };
}

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

/**
 * Compact JSON. Pretty printing put every number of a bbox or a face key on
 * its own line and made each payload about 2.4 times larger (list_commands
 * was 240 KB indented, 99 KB compact).
 */
function textResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    isError,
  };
}

/**
 * Every error payload leaves with a hint (and a see pointer when the code
 * has an errors.<code> topic); the tool name feeds the fallback hint.
 * @param {unknown} payload
 * @param {string} [tool]
 */
function errorResult(payload, tool) {
  return textResult(withErrorHint(payload, { tool }), true);
}

/** The `return` default over MCP. The page keeps `full`; an agent reads the script with get_script. */
const MCP_RETURN_DEFAULT = 'status';

/**
 * Tools whose catalog row takes `return` (mutating tools, undo, redo,
 * status) get `return: "status"` when the caller left it out. A catalog
 * row without the property is an older tab contract and is left alone.
 * @param {{ args?: { properties?: Record<string, unknown> } } | undefined} row
 * @param {Record<string, unknown>} args
 */
export function withDefaultReturn(row, args) {
  if (!row?.args?.properties || !Object.prototype.hasOwnProperty.call(row.args.properties, 'return')) return args;
  if (Object.prototype.hasOwnProperty.call(args, 'return')) return args;
  return { ...args, return: MCP_RETURN_DEFAULT };
}

/**
 * Pair success is ordinary text content so every MCP client, including Claude Code,
 * shows the note. No structuredContent and no _meta.
 * @param {Record<string, unknown>} result
 * @param {{ webhookRegistered: () => boolean }} prompts
 */
/**
 * Does this bridge tool change the model? The catalog row says so
 * (`mutates`); the name is the fallback for a catalog copy that predates it.
 * @param {string} name
 */
function mutatingTool(name) {
  return /^(set_script|run|insert_|invoke_helper|confirm_feature|delete_feature|rollback_to|undo|redo|create_|delete_|rename_|part_set_transform|insert_part|open_|paint_confirm|paint$|joint_commit|sheet_commit|sheet_set_params|sheet_edit|sketch_commit|slot_commit|hole_commit|git_|export_|edit_feature|pick_done|select_)/.test(name);
}

function pairToolResult(result, prompts) {
  const webhookRegistered = prompts.webhookRegistered() === true;
  const note = webhookRegistered ? PROMPT_WEBHOOK_ACTIVE : PROMPT_ONBOARDING_NOTE;
  const payload = {
    ...(result && typeof result === 'object' ? result : {}),
    webhookRegistered,
    note,
  };
  return {
    content: [
      { type: 'text', text: JSON.stringify(payload, null, 2) },
      { type: 'text', text: note },
      // The build guidance lives in the guide tool; one pointer here, for every client.
      { type: 'text', text: PAIR_GUIDE_POINTER },
    ],
    isError: false,
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
  const bridgeTools = bridgeToolDefinitions(catalog).map((tool) => augmentStatusTool(augmentScreenshotTool(tool)));

  const version = loadPackageVersion();
  const server = new Server(
    { name: 'surfcad-mcp', version },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  // The guide topics as resources (surfcad://guide/<topic>), the same text
  // as guide { topic }, versioned with the package for hosts that index them.
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: guideResourceList(version),
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const contents = guideResourceContents(uri, version);
    if (!contents) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${uri}. resources/list names the surfcad://guide/<topic> resources.`);
    }
    return contents;
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: PAIR_TOOL_NAME,
        description: `Pair this MCP server to an open SurfCAD tab via the local WebSocket relay. ${pairingEnvHint()} ${PROMPT_SERVER_INSTRUCTIONS} After pairing call guide { topic: "start" } (How to build in SurfCAD: block out first, features first, hardware as patterned parts) before the first model call.`,
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
      guideToolDefinition(),
      ...promptToolDefinitions(),
      ...bridgeTools,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments && typeof request.params.arguments === 'object'
      ? request.params.arguments
      : {};

    if (name === GUIDE_TOOL_NAME) {
      return callGuideTool(args);
    }

    if (isPromptTool(name)) {
      if (name !== 'set_status') session.noteAgentToolCall();
      try {
        const out = await callPromptTool(session.prompts, name, args);
        if (out.isError) return errorResult(out.error, name);
        return { content: out.content, isError: false };
      } catch (err) {
        return errorResult(toolErrorPayload(err), name);
      }
    }

    if (name === PAIR_TOOL_NAME) {
      const code = typeof args.code === 'string' && args.code.trim()
        ? args.code.trim()
        : (process.env.SURFCAD_PAIRING_CODE || '').trim();
      if (!code) {
        return errorResult({
          code: 'bad_pairing_code',
          message: `Missing pairing code. Pass { "code": "......" } or set SURFCAD_PAIRING_CODE. ${pairingEnvHint()}`,
        }, name);
      }
      try {
        const result = await waitForPairing(session.pair(code), PAIR_TOOL_WAIT_MS);
        return pairToolResult(result, session.prompts);
      } catch (err) {
        return errorResult(toolErrorPayload(err), name);
      }
    }

    const known = bridgeTools.some((t) => t.name === name);
    if (!known) {
      return errorResult({ code: 'unknown_tool', message: `Unknown tool: ${name}` });
    }

    // A lost session is already re-pairing in the background; session.call
    // fails fast with pairing_lost until it is back.
    if (!session.isPaired() && session.state !== 'lost') {
      const envCode = (process.env.SURFCAD_PAIRING_CODE || '').trim();
      if (envCode) {
        try {
          await waitForPairing(session.pair(envCode), AUTO_PAIR_WAIT_MS);
        } catch (err) {
          return errorResult(toolErrorPayload(err), name);
        }
      } else if (session.state !== 'pairing') {
        return errorResult(notPairedError(), name);
      }
    }

    try {
      // A model-changing tool switches the tab to working on its own.
      const row = catalog.commands.find((c) => c.name === name);
      session.noteAgentToolCall({ mutates: row?.mutates === true || (row?.mutates == null && mutatingTool(name)) });
      const out = await callPairedBridgeTool(session, name, withDefaultReturn(row, args));
      if (name === 'status' && out.isError !== true && out.value && typeof out.value === 'object' && !Array.isArray(out.value)) {
        return textResult({ ...out.value, ...session.prompts.deliveryStatus() });
      }
      if (out.isError === true) return errorResult(out.value, name);
      // A run that failed answers ok: false with errors rows; those carry hints too.
      return textResult(withRowHints(out.value));
    } catch (err) {
      const code = err?.code;
      if (
        code === 'real_repo_blocked'
        || code === 'consent_pending'
        || code === 'confirm_required'
        || code === 'pair_rejected'
      ) {
        return errorResult(formatBridgeError({
          code,
          message: err.message,
          details: err.details,
        }), name);
      }
      return errorResult(toolErrorPayload(err), name);
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

  // Intended MCP stdio lifecycle: when the client closes stdin the process
  // (and the relay it owns) must exit. Playtests that spawn this bin have to
  // keep stdin open; stdio: 'ignore' ends the stream immediately.
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
