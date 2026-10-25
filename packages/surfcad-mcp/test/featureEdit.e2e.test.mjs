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
import { createSurfcadBridge } from '../../../src/utils/agentBridge.js';
import { confirmFeatureEdit } from '../../../src/utils/featureEdit.js';
import { resolveStripTarget } from '../../../src/agent/featureStripAgent.js';
import { featureEditParamError } from '../../../src/agent/featureEditParams.js';

/**
 * open_feature → edit_feature { dx } → confirm_feature through the MCP stdio
 * server and the loopback relay. The tab runs the real bridge commands and
 * confirmFeatureEdit, so a move's offset changes in the script and a call
 * with no session is no_feature_edit. Nothing here writes git.
 */

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_BIN = join(PKG_ROOT, 'bin/surfcad-mcp.js');

const MOVE_SCRIPT = `// --- cube begin id=cube0 ---
let part = Manifold.cube([20, 20, 20], true);
// --- cube end ---
// --- move begin id=move6 ---
part = move(part, [0, 0, 0], { bodies: [{ at: [0, 0, 0] }] });
// --- move end ---
return part;
`;

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

function moveHost() {
  let script = MOVE_SCRIPT;
  let session = null;
  let target = null;
  let draft = null;
  return {
    getScript: () => script,
    setEditor(src) { script = src; },
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory: () => {},
    execute: async () => ({ ok: true, errors: [], volume: 8000, bbox: { min: [-48, -10, -10], max: [-28, 10, 10] }, partName: 'Part' }),
    readStatus: () => ({ volume: 8000, bbox: null, partName: 'Part', featureCount: 2, runState: 'ok' }),
    openFeature(args) {
      const resolved = resolveStripTarget(script, args);
      if (resolved.error) return resolved;
      session = { id: resolved.chip.id, kind: resolved.chip.kind, index: resolved.chip.index };
      target = resolved.feature;
      draft = {};
      return { result: { id: session.id, kind: session.kind, index: session.index } };
    },
    readFeatureSession: () => ({
      open: !!session,
      id: session?.id ?? null,
      kind: session?.kind ?? null,
      index: session?.index ?? null,
      contourId: null,
      sketchOpen: false,
      tool: null,
    }),
    editFeature({ params } = {}) {
      if (!session || !target) {
        return { error: { code: 'no_feature_edit', message: 'No feature edit session is open' } };
      }
      const bad = featureEditParamError(session.kind, params);
      if (bad) return { error: bad };
      draft = { ...(draft || {}), ...(params || {}) };
      return { result: { params: draft } };
    },
    prepareFeatureConfirm() {
      if (!session || !target) {
        return { error: { code: 'no_feature_edit', message: 'No feature edit session is open' } };
      }
      const result = confirmFeatureEdit(script, target, { fields: draft || {} });
      if (!result.ok) return { error: { code: 'edit_failed', message: result.message } };
      return {
        changed: result.changed === true,
        source: result.changed ? result.buffer : script,
        featureId: target.id,
        kind: target.kind,
        message: 'Edit move',
      };
    },
    dismissFeatureConfirmSession() {
      session = null;
      target = null;
      draft = null;
    },
    cancelFeature() {
      if (!session) return { error: { code: 'no_feature_edit', message: 'No feature edit session is open' } };
      session = null;
      target = null;
      draft = null;
      return { result: { cancelled: true } };
    },
  };
}

function toolJson(out) {
  const text = (out?.content || []).find((block) => block.type === 'text')?.text || '';
  return JSON.parse(text);
}

test('stdio open → edit dx → confirm rewrites a move, and a closed session is no_feature_edit', async () => {
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

  const host = moveHost();
  const api = createSurfcadBridge({ resolve: () => host });
  tab.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (typeof msg.command !== 'string' || typeof msg.id !== 'string') return;
    void api.call(msg.command, msg.args || {}).then((env) => {
      tab.send(JSON.stringify(env.ok
        ? { id: msg.id, ok: true, result: env.result }
        : { id: msg.id, ok: false, error: env.error || { code: 'refused', message: 'Command refused' } }));
    });
  });

  try {
    const { tools } = await client.listTools();
    const editTool = tools.find((tool) => tool.name === 'edit_feature');
    assert.equal(editTool.inputSchema.properties.params.additionalProperties, true);
    assert.equal(editTool.inputSchema.properties.params.properties, undefined);
    assert.equal(editTool.inputSchema.additionalProperties, false);

    const closed = await client.callTool({ name: 'edit_feature', arguments: { params: { dx: -38 } } });
    assert.equal(closed.isError, true);
    const closedBody = toolJson(closed);
    assert.equal(closedBody.code, 'no_feature_edit');

    const opened = await client.callTool({ name: 'open_feature', arguments: { id: 'move6' } });
    assert.equal(opened.isError, false, JSON.stringify(opened));
    assert.equal(toolJson(opened).id, 'move6');

    const unknown = await client.callTool({ name: 'edit_feature', arguments: { params: { height: 12 } } });
    assert.equal(unknown.isError, true);
    assert.equal(toolJson(unknown).code, 'bad_args');

    const edited = await client.callTool({ name: 'edit_feature', arguments: { params: { dx: -38 } } });
    assert.equal(edited.isError, false, JSON.stringify(edited));
    assert.equal(toolJson(edited).params.dx, -38);

    const mid = await client.callTool({ name: 'get_script', arguments: {} });
    assert.equal(mid.isError, false);
    assert.match(toolJson(mid).source, /move\(part, \[0, 0, 0\]/);

    const confirmed = await client.callTool({ name: 'confirm_feature', arguments: {} });
    assert.equal(confirmed.isError, false, JSON.stringify(confirmed));
    const confirmBody = toolJson(confirmed);
    assert.equal(confirmBody.ok, true);
    assert.equal(confirmBody.unchanged, false);
    assert.equal(confirmBody.id, 'move6');

    const after = await client.callTool({ name: 'get_script', arguments: {} });
    assert.match(toolJson(after).source, /move\(part, \[-38, 0, 0\]/);

    const gone = await client.callTool({ name: 'edit_feature', arguments: { params: { dx: 1 } } });
    assert.equal(gone.isError, true);
    assert.equal(toolJson(gone).code, 'no_feature_edit');
  } finally {
    await client.close();
    tab.close();
    await stopAgentBridgeRelay(relay);
  }
});
