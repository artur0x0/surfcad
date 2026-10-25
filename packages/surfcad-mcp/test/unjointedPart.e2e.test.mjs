/**
 * stdio: part_set_transform on an unjointed part in a two-part assembly
 * returns warning unjointed_part, and the same call after joint_create
 * does not. The fake tab runs the real bridge, so the warning is the
 * command's, not a canned reply.
 */
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
import { UNJOINTED_PART_HINT } from '../../../src/agent/state/unjointedParts.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_BIN = join(PKG_ROOT, 'bin/surfcad-mcp.js');

const PICKS = [
  { part_id: 'frame', face_id: 'f4', key: { at: [0, 0, 10], n: [0, 0, 1], area: 1200 } },
  { part_id: 'wheel', face_id: 'f1', key: { at: [0, 0, 0], n: [0, 0, -1], area: 1200 } },
];

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

function bikeHost() {
  const joints = [];
  const poses = {
    frame: { position: [0, 0, 0], rotation: [0, 0, 0] },
    wheel: { position: [40, 0, 0], rotation: [0, 0, 0] },
  };
  return {
    readParts: () => ({
      assemblyId: 'bike',
      activeId: 'wheel',
      assemblyName: 'Bike',
      parts: [
        { id: 'frame', name: 'Frame', visible: true },
        { id: 'wheel', name: 'Wheel', visible: true },
      ],
    }),
    readJoints: () => joints.map((joint) => JSON.parse(JSON.stringify(joint))),
    agentSetPartTransform({ partId, position, rotation }) {
      const pose = poses[partId];
      if (!pose) return { error: { code: 'unknown_part', message: `missing ${partId}` } };
      if (position) pose.position = position.slice();
      if (rotation) pose.rotation = rotation.slice();
      return {
        result: {
          part: partId,
          partId,
          position: pose.position.slice(),
          rotation: pose.rotation.slice(),
          eulerOrder: 'XYZ',
        },
      };
    },
    agentGetPartTransform({ partId }) {
      const pose = poses[partId];
      if (!pose) return { error: { code: 'unknown_part', message: `missing ${partId}` } };
      return { result: { part: partId, position: pose.position.slice(), rotation: pose.rotation.slice() } };
    },
    jointOpen() { return { result: { open: true } }; },
    jointApplyPicks() { return { result: { count: 2, pickCount: 2 } }; },
    jointSetParams({ patch }) {
      return { result: { ok: true, type: patch.type, name: 'Wheel seat', valueMm: null, sense: 1, opposed: true } };
    },
    prepareJointCommit() {
      joints.push({ id: 'j1', type: 'coincident', a: { part: 'frame' }, b: { part: 'wheel' } });
      return { ok: true, jointId: 'j1', jointCount: 1, unchanged: false };
    },
    finishJointCommit() {},
    jointCancel() { return { result: { cancelled: true } }; },
  };
}

async function toolJson(client, name, args) {
  const out = await client.callTool({ name, arguments: args });
  assert.equal(out.isError, false, JSON.stringify(out).slice(0, 500));
  return JSON.parse(out.content[0].text);
}

test('part_set_transform warns on an unjointed part and stops after joint_create', async () => {
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
  const client = new Client({ name: 'surfcad-mcp-unjointed-test', version: '1.0.0' });
  await client.connect(transport);
  const pairRequest = await onceJson(tab);
  assert.equal(pairRequest.type, PAIR_MSG.PAIR_REQUEST);
  tab.send(JSON.stringify({ type: PAIR_MSG.PAIR_APPROVE }));

  const host = bikeHost();
  const api = createSurfcadBridge({ resolve: () => host });
  tab.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (typeof msg.command !== 'string' || msg.id == null) return;
    const env = await api.call(msg.command, msg.args || {});
    tab.send(JSON.stringify({
      id: msg.id,
      ok: env.ok === true,
      result: env.ok === true ? env.result : undefined,
      error: env.ok === true ? undefined : env.error,
    }));
  });

  try {
    const before = await toolJson(client, 'parts', {});
    assert.deepEqual(before.unjointedParts, ['frame', 'wheel']);

    const moved = await toolJson(client, 'part_set_transform', { part_id: 'wheel', position: [80, 0, 0] });
    assert.equal(moved.partId, 'wheel');
    assert.deepEqual(moved.position, [80, 0, 0]);
    assert.equal(moved.warning.code, 'unjointed_part');
    assert.equal(moved.warning.part_id, 'wheel');
    assert.equal(moved.warning.hint, UNJOINTED_PART_HINT);
    assert.equal(moved.warning.see, 'guide { topic: "errors.unjointed_part" }');

    const joint = await toolJson(client, 'joint_create', { type: 'coincident', picks: PICKS });
    assert.equal(joint.ok, true);
    assert.equal(joint.jointId, 'j1');

    const after = await toolJson(client, 'part_set_transform', { part_id: 'wheel', position: [0, 0, 0] });
    assert.equal(after.warning, undefined);
    const listed = await toolJson(client, 'parts', {});
    assert.deepEqual(listed.unjointedParts, []);
  } finally {
    await client.close();
    tab.close();
    await stopAgentBridgeRelay(relay);
  }
});
