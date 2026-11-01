/**
 * One surfcad-mcp process, one tools/call, then close.
 * This is the normal external-MCP flow. The process must not call
 * close_session on the way out.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * @param {NodeJS.ProcessEnv} base
 * @param {string} dir
 * @param {string} origin
 */
export function remoteChildEnv(base, dir, origin) {
  const env = { ...base };
  delete env.SURFCAD_AGENT_BRIDGE_WS_URL;
  delete env.SURFCAD_AGENT_BRIDGE_WS_PORT;
  delete env.SURFCAD_PAIRING_CODE;
  delete env.SURFCAD_MCP_TRANSPORT;
  delete env.SURFCAD_AGENT_NAME;
  env.SURFCAD_MCP_CONFIG_DIR = dir;
  env.SURFCAD_AGENT_SERVER = origin;
  env.SURFCAD_MCP_START_RELAY = '0';
  return env;
}

/**
 * @param {{
 *   bin: string,
 *   env: NodeJS.ProcessEnv,
 *   name: string,
 *   args?: Record<string, unknown>,
 *   timeoutMs?: number,
 * }} options
 */
export async function oneShotToolCall(options) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [options.bin, '--remote'],
    env: options.env,
  });
  const client = new Client({ name: 'surfcad-mcp-per-call', version: '0.0.0' });
  try {
    await client.connect(transport);
    return await client.callTool(
      { name: options.name, arguments: options.args || {} },
      undefined,
      { timeout: options.timeoutMs ?? 20_000 },
    );
  } finally {
    await client.close().catch(() => {});
  }
}
