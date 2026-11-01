/**
 * Manual per-call presence check against a running SurfCAD.
 *
 * A fresh surfcad-mcp process per tool call, the same shape an external
 * MCP host uses. Leave the signed-in tab open and watch it: the agent
 * stays present and does not toast "Agent disconnected".
 *
 *   export SURFCAD_MCP_CONFIG_DIR=/tmp/surfcad-mcp-presence
 *   node packages/surfcad-mcp/bin/surfcad-mcp.js login \
 *     --server http://127.0.0.1:5173 --code ABCD-EFGH
 *   node packages/surfcad-mcp/scripts/per-call-presence-check.mjs \
 *     --server http://127.0.0.1:5173 --calls 5 --gap-ms 2000
 *
 * `--tool close_session` is a separate one-shot that ends the session.
 * This script never calls close_session unless you name that tool.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { oneShotToolCall, remoteChildEnv } from '../test/perCallChild.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '../bin/surfcad-mcp.js');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

const server = arg('--server', process.env.SURFCAD_AGENT_SERVER || '');
const calls = Number(arg('--calls', '5'));
const gapMs = Number(arg('--gap-ms', '2000'));
const tool = arg('--tool', 'status');
const configDir = process.env.SURFCAD_MCP_CONFIG_DIR || '';

if (!server) throw new Error('--server is required (cleartext only for 127.0.0.1)');
if (!configDir) throw new Error('Set SURFCAD_MCP_CONFIG_DIR to the directory from login');
if (!Number.isInteger(calls) || calls < 1) throw new Error('--calls must be a positive integer');
if (!Number.isInteger(gapMs) || gapMs < 0) throw new Error('--gap-ms must be a non-negative integer');

const env = remoteChildEnv(process.env, configDir, server);

for (let i = 0; i < calls; i += 1) {
  const out = await oneShotToolCall({ bin: BIN, env, name: tool });
  const text = (out?.content || []).filter((block) => block.type === 'text').map((block) => block.text || '').join('\n');
  if (out?.isError) {
    console.error(`call ${i + 1}/${calls} ${tool} failed: ${text.slice(0, 400)}`);
    process.exitCode = 1;
    break;
  }
  console.log(`call ${i + 1}/${calls} ${tool} ok`);
  if (i + 1 < calls && gapMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
}
