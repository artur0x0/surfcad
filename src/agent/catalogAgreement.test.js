/**
 * One bridge catalog: list_commands, GET /tools, the MCP bridge tools,
 * and both commands.json copies. pair and the in-process prompt tools
 * are MCP-only and must not appear in the bridge catalog.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v1Registry } from './commands/index.js';
import { bridgeToolDefinitions, loadCommandsCatalog } from '../../packages/surfcad-mcp/src/catalog.mjs';
import { PROMPT_TOOL_NAMES } from '../../packages/surfcad-mcp/src/prompt/promptTools.mjs';
import { startAgentBridgeRelay, stopAgentBridgeRelay } from '../../packages/surfcad-mcp/src/bridge/relayServer.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const HOST_JSON = join(ROOT, 'src/agent/commands.json');
const MCP_JSON = join(ROOT, 'packages/surfcad-mcp/data/commands.json');

const CONFIRM_TOOLS = [
  'delete_part',
  'delete_assembly',
  'git_upgrade_vault',
  'git_behind_resolve',
  'git_branch_switch',
  'git_branch_delete',
  'git_force_overwrite',
];

const FORBIDDEN_ARG_KEYS = new Set(['path', 'part', 'source_assembly']);

function namesOf(doc) {
  return doc.commands.map((row) => row.name);
}

test('list_commands, commands.json, and the MCP bridge tools are the same catalog', () => {
  const host = JSON.parse(readFileSync(HOST_JSON, 'utf8'));
  const mcp = JSON.parse(readFileSync(MCP_JSON, 'utf8'));
  const listed = v1Registry.catalog().map((row) => row.name);
  const bridge = bridgeToolDefinitions(loadCommandsCatalog()).map((row) => row.name);

  assert.deepEqual(namesOf(host), listed);
  assert.deepEqual(namesOf(mcp), listed);
  assert.deepEqual(bridge, listed);
  assert.equal(host.count, listed.length);

  for (const name of ['pair', ...PROMPT_TOOL_NAMES]) {
    assert.equal(listed.includes(name), false, `${name} is MCP-only`);
  }
  for (const name of ['list_assemblies', 'delete_part', 'delete_assembly', 'rename_assembly', 'part_get_transform', 'part_set_transform', 'agent_prompt']) {
    assert.equal(listed.includes(name), true, name);
  }

  const byName = new Map(host.commands.map((row) => [row.name, row]));
  for (const row of v1Registry.catalog()) {
    assert.deepEqual(byName.get(row.name).args, row.schema, `${row.name} args`);
  }
});

test('bridge tools take ids, not paths, and destructive tools expose confirm', () => {
  const host = JSON.parse(readFileSync(HOST_JSON, 'utf8'));
  for (const row of host.commands) {
    const keys = Object.keys(row.args?.properties || {});
    for (const key of keys) {
      assert.equal(FORBIDDEN_ARG_KEYS.has(key), false, `${row.name} accepts ${key}`);
    }
  }
  const byName = new Map(host.commands.map((row) => [row.name, row]));
  for (const name of CONFIRM_TOOLS) {
    assert.equal(typeof byName.get(name).args.properties.confirm, 'object', `${name} confirm`);
  }
  const setScript = byName.get('set_script');
  assert.deepEqual(setScript.args.required, ['part_id', 'source']);
  assert.equal(byName.get('open_assembly').args.properties.name, undefined);
  assert.equal(byName.get('part_get_transform').args.properties.part, undefined);
  assert.deepEqual(byName.get('part_get_transform').args.required, ['part_id']);
});

test('GET /tools matches commands.json', async () => {
  const host = JSON.parse(readFileSync(HOST_JSON, 'utf8'));
  const relay = await startAgentBridgeRelay({ port: 0 });
  try {
    const port = relay.server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/tools`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.tools.map((tool) => tool.name), namesOf(host));
    assert.deepEqual(
      body.tools.map((tool) => tool.description),
      host.commands.map((row) => row.description),
    );
    const setScript = body.tools.find((tool) => tool.name === 'set_script');
    assert.deepEqual(setScript.inputSchema, host.commands.find((row) => row.name === 'set_script').args);
  } finally {
    await stopAgentBridgeRelay(relay);
  }
});
