import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startAgentBridgeRelay, stopAgentBridgeRelay } from '../src/bridge/relayServer.mjs';
import { PAIR_MSG } from '../src/relayMessages.mjs';
import { createPairingToken } from '../../../src/agent/ws/pairingToken.js';
import { BUILD_GUIDANCE, BUILD_FLOW_NOTE, FEATURE_GAP_PREFIX } from '../src/prompt/buildGuidance.mjs';
import * as canonical from '../../../src/agent/buildGuidance.js';

/**
 * Every client that speaks stdio gets the same build guidance: in the
 * initialize instructions, in the pair result text, and in the tool
 * descriptions. No client is special-cased.
 */

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_BIN = join(PKG_ROOT, 'bin/surfcad-mcp.js');

function waitOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function onceJson(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => {
      try { resolve(JSON.parse(String(raw))); } catch (err) { reject(err); }
    });
    ws.once('error', reject);
  });
}

test('the package copy of the build guidance matches src/agent/buildGuidance.js', () => {
  assert.equal(BUILD_GUIDANCE, canonical.BUILD_GUIDANCE);
  assert.equal(BUILD_FLOW_NOTE, canonical.BUILD_FLOW_NOTE);
  assert.equal(FEATURE_GAP_PREFIX, canonical.FEATURE_GAP_PREFIX);
});

test('the guidance names the real rail sections and the gap comment format', () => {
  assert.match(BUILD_GUIDANCE, /Block, Build, Shape, Polish, Move/);
  assert.doesNotMatch(BUILD_GUIDANCE, /Refine/);
  assert.match(BUILD_GUIDANCE, /\/\/ FEATURE-GAP: <missing feature or option> \| <why the existing feature did not work>/);
  assert.match(BUILD_GUIDANCE, /one part per unique|its own part named by its spec/);
  assert.match(BUILD_GUIDANCE, /screenshot/);
  assert.match(BUILD_GUIDANCE, /insert_rounded_box/);
  assert.match(BUILD_GUIDANCE, /insert_cross_section/);
  assert.match(BUILD_GUIDANCE, /insert_workplane/);
  assert.match(BUILD_FLOW_NOTE, /FEATURE-GAP/);
});

test('instructions, the pair result, and the tool descriptions carry the same guidance over stdio', async () => {
  const token = createPairingToken(6);
  const relay = await startAgentBridgeRelay({ port: 0 });
  const port = relay.server.address().port;
  const url = `ws://127.0.0.1:${port}`;
  const tab = new WebSocket(url);
  await waitOpen(tab);
  tab.send(JSON.stringify({ type: PAIR_MSG.REGISTER_TAB, token }));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_BIN],
    env: { ...process.env, SURFCAD_MCP_START_RELAY: '0', SURFCAD_AGENT_BRIDGE_WS_URL: url, SURFCAD_PAIRING_CODE: token },
  });
  const client = new Client({ name: 'surfcad-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  const pairRequest = await onceJson(tab);
  assert.equal(pairRequest.type, PAIR_MSG.PAIR_REQUEST);
  tab.send(JSON.stringify({ type: PAIR_MSG.PAIR_APPROVE }));

  const instructions = client.getInstructions();
  assert.ok(typeof instructions === 'string' && instructions.includes(BUILD_GUIDANCE), 'initialize instructions carry the guidance');
  assert.match(instructions, /register_webhook/);

  const paired = await client.callTool({ name: 'pair', arguments: { code: token } });
  assert.equal(paired.isError, false, JSON.stringify(paired).slice(0, 300));
  const texts = paired.content.filter((c) => c.type === 'text').map((c) => c.text);
  assert.ok(texts.some((t) => t === BUILD_GUIDANCE), 'the pair result has the guidance as its own text block');
  assert.ok(texts.some((t) => /webhook/i.test(t)), 'the webhook onboarding note is still there');

  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t.description || '']));
  assert.match(byName.set_script, /FEATURE-GAP/);
  assert.match(byName.set_script, /fallback/i);
  assert.match(byName.insert_cube, /block out|Build in ribbon order/i);
  assert.match(byName.create_part, /block out/i);
  assert.match(byName.create_assembly, /block out/i);
  assert.match(byName.invoke_helper, /ribbon order/i);
  assert.match(byName.pair, /How to build|build guidance/i);

  await client.close();
  tab.close();
  await stopAgentBridgeRelay(relay);
});
