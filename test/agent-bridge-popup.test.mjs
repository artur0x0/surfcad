/**
 * Integration: SurfCAD tab ↔ popup bridge (postMessage) ↔ real relay ↔ Node
 * peer. Windows are faked; the relay, sockets, popup script and tab
 * connection are the shipped code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startAgentBridgeRelay, stopAgentBridgeRelay } from '../packages/surfcad-mcp/src/bridge/relayServer.mjs';
import { startPopupBridge } from '../packages/surfcad-mcp/src/bridge/bridgePopup.mjs';
import { FakeWindow, linkWindows, tick } from '../packages/surfcad-mcp/test/fakeWindows.mjs';
import { createPopupBridgeSession } from '../src/agent/ws/popupTransport.js';
import { createAgentBridgeTabConnection } from '../src/agent/ws/tabConnection.js';
import { bridgeCall } from '../src/agent/ws/nodeClient.js';
import { connectPeer } from '../packages/surfcad-mcp/src/nodeClient.mjs';
import { createPairingToken } from '../src/agent/ws/pairingToken.js';

async function waitFor(predicate, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await tick(10);
  }
  return false;
}

/**
 * An opener page whose `window.open` loads the real popup script against
 * the relay, with the popup's socket carrying the bridge page's Origin.
 */
function openerFor(pageOrigin, port, popups) {
  const opener = new FakeWindow({ origin: pageOrigin });
  const bridgeOrigin = `http://127.0.0.1:${port}`;
  class PopupSocket extends WebSocket {
    constructor(url) {
      super(url, { headers: { Origin: bridgeOrigin } });
    }
  }
  opener.openImpl = (url) => {
    const u = new URL(url);
    const popup = new FakeWindow({ origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash });
    const link = linkWindows(opener, popup);
    const statuses = [];
    const bridge = startPopupBridge({
      win: popup,
      WebSocketCtor: PopupSocket,
      wsUrl: `ws://127.0.0.1:${port}`,
      onStatus: (s) => statuses.push(s),
      readyIntervalMs: 20,
      openerPollMs: 20,
    });
    popups.push({ popup, link, statuses, bridge });
    return link.toPopup;
  };
  return opener;
}

test('tab pairs through the popup bridge, needs Allow, and runs a bridge call', async () => {
  const relay = await startAgentBridgeRelay({ port: 0 });
  const port = relay.server.address().port;
  const url = `ws://127.0.0.1:${port}`;
  const popups = [];
  const opener = openerFor('https://surfcad.com', port, popups);
  const states = [];
  const issues = [];
  const calls = [];
  const token = createPairingToken(6);
  const session = createPopupBridgeSession({ win: opener, pollMs: 20 });
  const conn = createAgentBridgeTabConnection({
    url,
    token,
    pageSecure: true,
    call: async (name, args) => {
      calls.push([name, args]);
      return { ok: true, result: { partId: 'p0', faces: [] } };
    },
    onState: (s) => states.push(s),
    onIssue: (i) => issues.push(i),
    createSocket: (u) => session.createSocket(u),
  });

  try {
    conn.connect();
    assert.equal(popups.length, 1);
    assert.ok(await waitFor(() => popups[0].statuses.includes('connected')), 'popup socket open');
    assert.ok(await waitFor(() => relay.wss.clients.size === 1));

    const peerPromise = connectPeer(url, token);
    assert.ok(await waitFor(() => conn.getState() === 'pending'), 'pair request reached the tab');
    let peerSettled = false;
    peerPromise.then(() => { peerSettled = true; }, () => { peerSettled = true; });
    await tick(50);
    assert.equal(peerSettled, false, 'nothing pairs before Allow');

    conn.approvePair();
    const peer = await peerPromise;
    assert.ok(await waitFor(() => conn.getState() === 'paired'));

    const result = await bridgeCall(peer.ws, 'list_faces', {}, 'p1');
    assert.deepEqual(result, { partId: 'p0', faces: [] });
    assert.deepEqual(calls, [['list_faces', {}]]);

    const unpaired = new Promise((resolve) => {
      peer.ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'unpaired') resolve(msg);
      });
    });
    popups[0].link.toPopup.close();
    assert.ok(await waitFor(() => issues.at(-1) === 'bridge_closed'), 'panel sees bridge_closed');
    assert.equal(conn.getState(), 'idle');
    assert.equal((await unpaired).reason, 'tab_disconnected');
    assert.ok(await waitFor(() => relay.wss.clients.size <= 1));
    peer.ws.close();

    conn.connect();
    assert.equal(popups.length, 2, 'user-closed window: Reconnect may window.open from the click');
    assert.ok(await waitFor(() => popups[1].statuses.includes('connected')));
    assert.ok(await waitFor(() => conn.getState() === 'advertising'));
    const peer2Promise = connectPeer(url, token, { resume: peer.resumeKey });
    assert.ok(await waitFor(() => conn.getState() === 'pending'), 'user-closed window still needs Allow');
    conn.approvePair();
    const peer2 = await peer2Promise;
    peer2.ws.close();
  } finally {
    conn.disconnect();
    session.dispose();
    for (const { bridge } of popups) bridge.stop();
    await stopAgentBridgeRelay(relay);
  }
});

test('evil opener cannot reach the relay through the bridge page', async () => {
  const relay = await startAgentBridgeRelay({ port: 0 });
  const port = relay.server.address().port;
  const popups = [];
  for (const claimed of ['https://surfcad.com', 'https://evil.example']) {
    const evil = new FakeWindow({ origin: 'https://evil.example' });
    const popup = new FakeWindow({
      origin: `http://127.0.0.1:${port}`,
      pathname: '/bridge',
      hash: `#nonce=evilevilevilevilevilevil&origin=${encodeURIComponent(claimed)}`,
    });
    const link = linkWindows(evil, popup);
    const seen = [];
    evil.addEventListener('message', (e) => seen.push(e));
    const statuses = [];
    const bridge = startPopupBridge({
      win: popup,
      wsUrl: `ws://127.0.0.1:${port}`,
      WebSocketCtor: class extends WebSocket {
        constructor(u) { super(u, { headers: { Origin: `http://127.0.0.1:${port}` } }); }
      },
      onStatus: (s) => statuses.push(s),
      readyIntervalMs: 10,
    });
    for (const target of ['*', `http://127.0.0.1:${port}`]) {
      link.toPopup.postMessage({ channel: 'surfcad-agent-bridge', nonce: 'evilevilevilevilevilevil', type: 'bridge_hello' }, target);
      link.toPopup.postMessage({ channel: 'surfcad-agent-bridge', nonce: 'evilevilevilevilevilevil', type: 'bridge_frame', data: '{"type":"register_tab","token":"EVIL01"}' }, target);
    }
    popups.push({ popup, seen, statuses, bridge });
  }
  try {
    await tick(150);
    assert.equal(relay.wss.clients.size, 0, 'no relay socket was opened');
    assert.equal(relay.hub.hasTab('EVIL01'), false);
    for (const { seen } of popups) assert.equal(seen.length, 0, 'evil opener received nothing');
    assert.deepEqual(popups[1].statuses, ['forbidden']);
    assert.ok(!popups[0].statuses.includes('connecting'));
  } finally {
    for (const { bridge } of popups) bridge.stop();
    await stopAgentBridgeRelay(relay);
  }
});
