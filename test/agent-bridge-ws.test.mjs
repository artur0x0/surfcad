import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startAgentBridgeRelay } from '../scripts/vite-agent-bridge-ws.mjs';
import { PAIR_MSG } from '../src/agent/ws/relayHub.js';
import { connectPeer, bridgeCall } from '../src/agent/ws/nodeClient.js';
import { createPairingToken } from '../src/agent/ws/pairingToken.js';

function waitOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function onceJson(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => {
      try {
        resolve(JSON.parse(String(raw)));
      } catch (err) {
        reject(err);
      }
    });
    ws.once('error', reject);
  });
}

test('M1 relay pairs tab and peer and runs list_faces', async () => {
  const token = createPairingToken(6);
  const relay = await startAgentBridgeRelay({ port: 0 });
  const port = relay.server.address().port;
  const url = `ws://127.0.0.1:${port}`;

  const tab = new WebSocket(url);
  await waitOpen(tab);
  tab.send(JSON.stringify({ type: PAIR_MSG.REGISTER_TAB, token }));

  const peerPromise = connectPeer(url, token);

  const pairRequest = await onceJson(tab);
  assert.equal(pairRequest.type, PAIR_MSG.PAIR_REQUEST);
  tab.send(JSON.stringify({ type: PAIR_MSG.PAIR_APPROVE }));

  const peer = await peerPromise;

  const callMsgPromise = new Promise((resolve, reject) => {
    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch (err) {
        reject(err);
        return;
      }
      if (typeof msg.command === 'string') {
        tab.off('message', onMessage);
        resolve(msg);
      }
    };
    tab.on('message', onMessage);
    tab.once('error', reject);
  });
  const resultPromise = bridgeCall(peer, 'list_faces', {}, 't1');
  const callMsg = await callMsgPromise;
  assert.equal(callMsg.command, 'list_faces');
  tab.send(JSON.stringify({
    id: 't1',
    ok: true,
    result: { partId: 'p0', faces: [] },
  }));

  const faces = await resultPromise;
  assert.deepEqual(faces, { partId: 'p0', faces: [] });

  tab.close();
  peer.close();
  await new Promise((r) => relay.server.close(r));
});
