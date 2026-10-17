import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startAgentBridgeRelay, stopAgentBridgeRelay } from '../src/bridge/relayServer.mjs';
import { RelaySession } from '../src/relay.mjs';
import { PAIR_MSG } from '../src/relayMessages.mjs';
import { liveTab, waitFor } from './liveTab.mjs';

const FAST_FAIL_MS = 2000;
const quiet = () => {};

async function startRelay(port = 0, heartbeatMs = 5000) {
  const relay = await startAgentBridgeRelay({ port, heartbeatMs, onLog: quiet });
  return { relay, url: `ws://127.0.0.1:${relay.port}` };
}

async function pairedWithLiveTab(url, token = 'ABC234') {
  const tab = liveTab(url, token);
  tab.connect();
  await waitFor(() => tab.conn.getState() === 'advertising');
  const session = new RelaySession({ url, onLog: quiet, reconnectDelaysMs: [50, 100, 200] });
  await session.pair(token.toLowerCase());
  await waitFor(() => tab.conn.getLink() === 'connected');
  return { tab, session };
}

async function timed(promise) {
  const start = Date.now();
  try {
    await promise;
    return { ms: Date.now() - start, error: null };
  } catch (error) {
    return { ms: Date.now() - start, error };
  }
}

test('after the tab socket dies, calls fail fast with pairing_lost, then work again without a new Allow', async () => {
  const { relay, url } = await startRelay();
  const { tab, session } = await pairedWithLiveTab(url);
  try {
    assert.deepEqual(await session.call('status', {}), { command: 'status' });
    assert.equal(tab.prompts, 1);

    tab.killSocket();
    await waitFor(() => session.state === 'lost', FAST_FAIL_MS);
    const lost = await timed(session.call('status', {}));
    assert.equal(lost.error?.code, 'pairing_lost');
    assert.match(lost.error.hint, /Open SurfCAD in Chrome and keep the tab open; it will reconnect/);
    assert.ok(lost.ms < FAST_FAIL_MS, `pairing_lost took ${lost.ms}ms`);
    assert.equal(tab.conn.getLink(), 'reconnecting');

    tab.goOnline();
    await waitFor(() => session.isPaired(), 5000);
    assert.deepEqual(await session.call('list_faces', {}), { command: 'list_faces' });
    assert.equal(tab.prompts, 1, 'resume did not show the approval prompt again');
    assert.equal(tab.conn.getLink(), 'connected');
  } finally {
    session.disconnect();
    tab.close();
    await stopAgentBridgeRelay(relay);
  }
});

test('an in-flight call is rejected with pairing_lost within 2 s when the tab drops', async () => {
  const { relay, url } = await startRelay();
  let release;
  const { tab, session } = await pairedWithLiveTab(url);
  tab.conn.disconnect();
  const slowTab = liveTab(url, 'DEF567', {
    call: () => new Promise((resolve) => { release = resolve; }),
  });
  slowTab.connect();
  await waitFor(() => slowTab.conn.getState() === 'advertising');
  await session.pair('DEF567');
  try {
    const call = session.call('export_stl', {});
    await waitFor(() => typeof release === 'function');
    slowTab.killSocket();
    const outcome = await timed(call);
    assert.equal(outcome.error?.code, 'pairing_lost');
    assert.ok(outcome.ms < FAST_FAIL_MS, `in-flight rejection took ${outcome.ms}ms`);
  } finally {
    release?.({ ok: true, result: null });
    session.disconnect();
    slowTab.close();
    tab.close();
    await stopAgentBridgeRelay(relay);
  }
});

test('relay heartbeat drops a tab that stops answering pings, and the session fails fast', async () => {
  const { relay, url } = await startRelay(0, 100);
  // A raw tab with pongs off stands in for a frozen or half-open browser socket.
  const tab = new WebSocket(url, { headers: { Origin: 'https://surfcad.com' }, autoPong: false });
  await new Promise((resolve, reject) => { tab.once('open', resolve); tab.once('error', reject); });
  tab.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.type === PAIR_MSG.PAIR_REQUEST) tab.send(JSON.stringify({ type: PAIR_MSG.PAIR_APPROVE }));
  });
  tab.send(JSON.stringify({ type: PAIR_MSG.REGISTER_TAB, token: 'HJK789' }));
  const session = new RelaySession({ url, onLog: quiet });
  try {
    await session.pair('HJK789');
    const start = Date.now();
    await waitFor(() => session.state === 'lost', 2000);
    assert.ok(Date.now() - start < 1000, 'two missed heartbeats at 100 ms should drop the tab quickly');
    assert.match(session.status().lostReason, /heartbeat_timeout/);
    const outcome = await timed(session.call('status', {}));
    assert.equal(outcome.error?.code, 'pairing_lost');
    assert.ok(outcome.ms < FAST_FAIL_MS);
  } finally {
    session.disconnect();
    tab.terminate();
    await stopAgentBridgeRelay(relay);
  }
});

test('when the relay process goes away the session restarts it and both ends re-pair', async () => {
  const first = await startRelay();
  const port = first.relay.port;
  let restarted = null;
  const tab = liveTab(first.url, 'LMN234', { reconnectDelaysMs: [50, 100] });
  tab.connect();
  await waitFor(() => tab.conn.getState() === 'advertising');
  const session = new RelaySession({
    url: first.url,
    onLog: quiet,
    reconnectDelaysMs: [50, 100],
    ensureRelay: async () => {
      restarted ??= await startAgentBridgeRelay({ port, onLog: quiet });
    },
  });
  try {
    await session.pair('LMN234');
    await stopAgentBridgeRelay(first.relay);
    await waitFor(() => session.state === 'lost', FAST_FAIL_MS);
    const outcome = await timed(session.call('status', {}));
    assert.equal(outcome.error?.code, 'pairing_lost');
    assert.ok(outcome.ms < FAST_FAIL_MS);

    await waitFor(() => session.isPaired(), 8000);
    assert.ok(restarted, 'the session took over the relay port');
    assert.deepEqual(await session.call('status', {}), { command: 'status' });
    assert.equal(tab.prompts, 1);
  } finally {
    session.disconnect();
    tab.close();
    if (restarted) await stopAgentBridgeRelay(restarted);
  }
});

test('a client without the resume key still needs Allow in SurfCAD', async () => {
  const { relay, url } = await startRelay();
  const { tab, session } = await pairedWithLiveTab(url, 'PQR567');
  try {
    session.disconnect();
    await waitFor(() => tab.conn.getLink() === 'reconnecting');
    const other = new RelaySession({ url, onLog: quiet });
    await other.pair('PQR567');
    assert.equal(tab.prompts, 2, 'a new client is prompted even with the same code');
    other.disconnect();
  } finally {
    tab.close();
    await stopAgentBridgeRelay(relay);
  }
});

test('calls while never paired or while waiting for Allow fail at once', async () => {
  const session = new RelaySession({ url: 'ws://127.0.0.1:1', onLog: quiet });
  const notPaired = await timed(session.call('status', {}));
  assert.equal(notPaired.error?.code, 'not_paired');
  assert.ok(notPaired.ms < 50);

  const { relay, url } = await startRelay();
  const tab = new WebSocket(url, { headers: { Origin: 'https://surfcad.com' } });
  await new Promise((resolve) => tab.once('open', resolve));
  tab.send(JSON.stringify({ type: PAIR_MSG.REGISTER_TAB, token: 'STV234' }));
  const pending = new RelaySession({ url, onLog: quiet });
  const pairing = pending.pair('STV234');
  pairing.catch(() => {});
  try {
    await new Promise((resolve) => tab.once('message', resolve));
    const outcome = await timed(pending.call('status', {}));
    assert.equal(outcome.error?.code, 'pair_pending');
    assert.ok(outcome.ms < 50);
  } finally {
    pending.disconnect();
    tab.terminate();
    await stopAgentBridgeRelay(relay);
  }
});

test('unknown pairing code maps to unknown_token with the reconnect hint', async () => {
  const { relay, url } = await startRelay();
  const session = new RelaySession({ url, onLog: quiet });
  try {
    await assert.rejects(session.pair('WXY567'), (err) => {
      assert.equal(err.code, 'unknown_token');
      assert.match(err.hint, /keep the tab open/);
      return true;
    });
  } finally {
    await stopAgentBridgeRelay(relay);
  }
});
