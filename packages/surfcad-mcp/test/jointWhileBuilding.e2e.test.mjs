import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startAgentBridgeRelay, stopAgentBridgeRelay } from '../src/bridge/relayServer.mjs';
import { PAIR_MSG } from '../src/relayMessages.mjs';
import { createPairingToken } from '../../../src/agent/ws/pairingToken.js';
import { createSurfcadBridge } from '../../../src/utils/agentBridge.js';
import {
  featurePopupAllowed,
  resetAgentFeaturePopupGateForTests,
  setAgentPromptWorking,
} from '../../../src/agent/agentFeaturePopupGate.js';
import { beginAgentJointSession } from '../../../src/agent/jointPromptGate.js';
import { openRemoteStdio } from './remoteStdio.mjs';

/**
 * joint_create through the MCP server while the tab is in building.
 * The feature-popup gate is closed (that is what used to return
 * joints_unavailable). The joint session still opens and commits.
 */

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

function jointHost(seen) {
  let card = null;
  return {
    jointOpen() {
      seen.popupAtOpen = featurePopupAllowed();
      if (!beginAgentJointSession({ game: false, featureSession: false })) {
        return { result: { open: false, suppressed: true } };
      }
      card = { type: null };
      return { result: { open: true } };
    },
    jointApplyPicks({ picks }) {
      return { result: { picked: picks.map((row) => row.part_id), count: picks.length, pickCount: picks.length } };
    },
    jointSetParams({ patch }) {
      card = { ...card, ...patch };
      return {
        result: {
          ok: true,
          type: card.type,
          name: card.name ?? 'seat',
          valueMm: card.valueMm ?? null,
          sense: 1,
          opposed: true,
          mode: 'create',
          pickCount: PICKS.length,
        },
      };
    },
    prepareJointCommit() {
      return { ok: true, jointId: 'j-building', jointCount: 1, unchanged: false };
    },
    finishJointCommit() { card = null; },
    jointCancel() { card = null; return { result: { cancelled: true } }; },
    agentGetPartTransform() {
      return { result: { position: [0, 0, 0], rotation: [0, 0, 0] } };
    },
  };
}

/**
 * responding is the bouncing dots (tab state typing). building is the
 * spinner (tab state working). Either phase closes the feature-popup gate;
 * joint_create still commits.
 * @param {Client} client
 * @param {{ typing: boolean, built: boolean, popupAtOpen: boolean | null }} seen
 */
async function assertJointWhilePending(client, seen) {
  const responding = await client.callTool({ name: 'set_status', arguments: { state: 'responding' } });
  assert.equal(responding.isError, false, JSON.stringify(responding));
  assert.equal(JSON.parse(responding.content[0].text).state, 'typing');
  const typingDeadline = Date.now() + 3000;
  while (!seen.typing) {
    if (Date.now() > typingDeadline) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(seen.typing, true);

  const status = await client.callTool({ name: 'set_status', arguments: { state: 'building' } });
  assert.equal(status.isError, false, JSON.stringify(status));
  assert.equal(JSON.parse(status.content[0].text).state, 'working');
  const statusDeadline = Date.now() + 3000;
  while (!seen.built) {
    if (Date.now() > statusDeadline) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(seen.built, true);

  const created = await client.callTool({
    name: 'joint_create',
    arguments: { type: 'coincident', picks: PICKS, name: 'Wheel seat' },
  });
  assert.equal(created.isError, false, JSON.stringify(created));
  const body = JSON.parse(created.content[0].text);
  assert.equal(body.ok, true);
  assert.equal(body.jointId, 'j-building');
  assert.equal(body.type, 'coincident');
  assert.equal(seen.popupAtOpen, false, 'the feature-popup gate was closed while the joint was created');
}

/**
 * @param {{ typing: boolean, built: boolean, popupAtOpen: boolean | null }} seen
 * @param {ReturnType<typeof createSurfcadBridge>} api
 * @param {import('ws').WebSocket} tab
 * @param {object} msg
 */
function answerJointTab(seen, api, tab, msg) {
  if (msg.type === PAIR_MSG.AGENT_STATUS && (msg.state === 'working' || msg.state === 'typing')) {
    setAgentPromptWorking(true);
    if (msg.state === 'working') seen.built = true;
    if (msg.state === 'typing') seen.typing = true;
    return;
  }
  if (typeof msg.command !== 'string' || typeof msg.id !== 'string') return;
  void api.call(msg.command, msg.args || {}).then((env) => {
    tab.send(JSON.stringify(env.ok
      ? { id: msg.id, ok: true, result: env.result }
      : { id: msg.id, ok: false, error: env.error || { code: 'refused', message: 'Command refused' } }));
  });
}

test('joint_create commits while the tab is in building', async () => {
  resetAgentFeaturePopupGateForTests();
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
    env: { ...process.env, SURFCAD_MCP_START_RELAY: '0', SURFCAD_AGENT_BRIDGE_WS_URL: url, SURFCAD_PAIRING_CODE: '' },
  });
  const client = new Client({ name: 'surfcad-mcp-joint-building', version: '1.0.0' });
  await client.connect(transport);

  const seen = { popupAtOpen: null, built: false, typing: false };
  const api = createSurfcadBridge({ resolve: () => jointHost(seen) });
  tab.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    answerJointTab(seen, api, tab, msg);
  });

  try {
    const pairing = client.callTool({ name: 'pair', arguments: { code: token } });
    const pairRequest = await onceJson(tab);
    assert.equal(pairRequest.type, PAIR_MSG.PAIR_REQUEST);
    tab.send(JSON.stringify({ type: PAIR_MSG.PAIR_APPROVE }));
    const paired = await pairing;
    assert.equal(paired.isError, false, JSON.stringify(paired).slice(0, 240));
    await assertJointWhilePending(client, seen);
  } finally {
    resetAgentFeaturePopupGateForTests();
    await client.close();
    tab.close();
    await stopAgentBridgeRelay(relay);
  }
});

test('joint_create commits while the tab is in building over the remote relay', async () => {
  resetAgentFeaturePopupGateForTests();
  const seen = { popupAtOpen: null, built: false, typing: false };
  const api = createSurfcadBridge({ resolve: () => jointHost(seen) });
  const session = await openRemoteStdio({
    serverBin: SERVER_BIN,
    clientName: 'surfcad-mcp-joint-building-remote',
    onTabMessage(msg, tab) {
      answerJointTab(seen, api, tab, msg);
    },
  });
  try {
    await assertJointWhilePending(session.client, seen);
  } finally {
    resetAgentFeaturePopupGateForTests();
    await session.close();
  }
});
