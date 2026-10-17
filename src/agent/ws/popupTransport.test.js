import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIDGE_WINDOW_NAME,
  DEFAULT_RETRY_DELAYS_MS,
  bridgePageUrlForWsUrl,
  createBridgeNonce,
  createPopupBridgeSocket,
} from './popupTransport.js';
import { BRIDGE_CHANNEL, BRIDGE_CLOSE_REASON, BRIDGE_MSG } from './bridgeMessages.js';
import { issueFromCloseEvent } from './connectionErrors.js';
import { createAgentBridgeTransport, probeRelayDirect } from './agentBridgeTransport.js';
import * as popupSide from '../../../packages/surfcad-mcp/src/bridge/bridgePopup.mjs';
import { FakeWindow, linkWindows, tick } from '../../../packages/surfcad-mcp/test/fakeWindows.mjs';

const BRIDGE_ORIGIN = 'http://127.0.0.1:17341';
const NONCE = 'nonce-nonce-nonce-nonce-0123';

/** Opener at `pageOrigin` whose window.open yields a popup at `popupOrigin`. */
function harness({ pageOrigin = 'https://surfcad.com', popupOrigin = BRIDGE_ORIGIN, blocked = false } = {}) {
  const opener = new FakeWindow({ origin: pageOrigin });
  const ctx = { opener, popup: null, link: null, fromOpener: [] };
  opener.openImpl = () => {
    if (blocked) return null;
    ctx.popup = new FakeWindow({ origin: popupOrigin, pathname: '/bridge' });
    ctx.link = linkWindows(opener, ctx.popup);
    ctx.popup.addEventListener('message', (e) => ctx.fromOpener.push(e));
    return ctx.link.toPopup;
  };
  ctx.fromPopup = (payload, { nonce = NONCE, channel = BRIDGE_CHANNEL } = {}) => {
    ctx.link.toOpener.postMessage({ channel, nonce, ...payload }, pageOrigin);
  };
  return ctx;
}

function record(socket) {
  const events = [];
  for (const type of ['open', 'message', 'close', 'error']) {
    socket.addEventListener(type, (e) => events.push(e));
  }
  return events;
}

test('protocol constants match the relay-served popup script', () => {
  assert.equal(BRIDGE_CHANNEL, popupSide.BRIDGE_CHANNEL);
  assert.deepEqual({ ...BRIDGE_MSG }, { ...popupSide.BRIDGE_MSG });
  assert.match(createBridgeNonce(), popupSide.BRIDGE_NONCE_RE);
});

test('bridgePageUrlForWsUrl maps loopback relay URLs only', () => {
  assert.equal(bridgePageUrlForWsUrl('ws://127.0.0.1:17341'), 'http://127.0.0.1:17341/bridge');
  assert.equal(bridgePageUrlForWsUrl('ws://localhost:17341'), 'http://localhost:17341/bridge');
  assert.equal(bridgePageUrlForWsUrl('wss://127.0.0.1:17341'), null);
  assert.equal(bridgePageUrlForWsUrl('ws://evil.example:17341'), null);
  assert.equal(bridgePageUrlForWsUrl('ws://127.0.0.1'), null);
  assert.equal(bridgePageUrlForWsUrl('nope'), null);
});

test('opens a named popup carrying the nonce and page origin in the fragment', () => {
  const h = harness();
  const sock = createPopupBridgeSocket({ wsUrl: 'ws://127.0.0.1:17341', win: h.opener, nonce: NONCE });
  assert.equal(h.opener.openCalls.length, 1);
  const { url, name, features } = h.opener.openCalls[0];
  assert.equal(name, BRIDGE_WINDOW_NAME);
  assert.match(features, /popup/);
  const parsed = new URL(url);
  assert.equal(parsed.origin, BRIDGE_ORIGIN);
  assert.equal(parsed.pathname, '/bridge');
  assert.ok(parsed.searchParams.get('s'));
  assert.deepEqual(popupSide.parseBridgeFragment(parsed.hash), { nonce: NONCE, origin: 'https://surfcad.com' });
  sock.close();
});

test('handshake: ready → hello, open, frames both ways', async () => {
  const h = harness();
  const sock = createPopupBridgeSocket({ wsUrl: 'ws://127.0.0.1:17341', win: h.opener, nonce: NONCE });
  const events = record(sock);
  assert.equal(sock.readyState, 0);
  let relaySeen = false;
  sock.addEventListener('relay', () => { relaySeen = true; });
  h.fromPopup({ type: BRIDGE_MSG.READY });
  await tick();
  assert.equal(relaySeen, true, 'bridge page answering means the relay is up');
  assert.equal(h.fromOpener[0].data.type, BRIDGE_MSG.HELLO);
  assert.ok(h.link.toPopupLog.every((m) => m.targetOrigin === BRIDGE_ORIGIN));
  h.fromPopup({ type: BRIDGE_MSG.OPEN });
  await tick();
  assert.equal(sock.readyState, 1);
  assert.equal(events[0].type, 'open');
  sock.send('{"type":"register_tab"}');
  await tick();
  assert.equal(h.fromOpener.at(-1).data.type, BRIDGE_MSG.FRAME);
  assert.equal(h.fromOpener.at(-1).data.data, '{"type":"register_tab"}');
  h.fromPopup({ type: BRIDGE_MSG.FRAME, data: '{"type":"pair_request"}' });
  await tick();
  assert.deepEqual(events.filter((e) => e.type === 'message').map((e) => e.data), ['{"type":"pair_request"}']);
  sock.close();
  assert.equal(sock.readyState, 3);
  assert.equal(h.popup.closed, true, 'close() closes the popup');
});

test('ignores messages from another origin, another window, or with the wrong nonce', async () => {
  const h = harness();
  const sock = createPopupBridgeSocket({ wsUrl: 'ws://127.0.0.1:17341', win: h.opener, nonce: NONCE });
  const events = record(sock);
  h.fromPopup({ type: BRIDGE_MSG.READY }, { nonce: 'wrong-wrong-wrong-wrong-wrong' });
  h.fromPopup({ type: BRIDGE_MSG.READY }, { channel: 'x' });
  h.opener.dispatch('message', {
    origin: 'http://127.0.0.1:9999',
    source: h.link.toPopup,
    data: { channel: BRIDGE_CHANNEL, nonce: NONCE, type: BRIDGE_MSG.OPEN },
  });
  h.opener.dispatch('message', {
    origin: BRIDGE_ORIGIN,
    source: {},
    data: { channel: BRIDGE_CHANNEL, nonce: NONCE, type: BRIDGE_MSG.OPEN },
  });
  await tick();
  assert.equal(h.fromOpener.length, 0, 'no hello sent');
  assert.equal(sock.readyState, 0);
  assert.equal(events.length, 0);
  sock.close();
});

test('popup blocked → close with popup_blocked', async () => {
  const h = harness({ blocked: true });
  const sock = createPopupBridgeSocket({ wsUrl: 'ws://127.0.0.1:17341', win: h.opener, nonce: NONCE });
  const events = record(sock);
  await tick(5);
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, BRIDGE_CLOSE_REASON.POPUP_BLOCKED);
  assert.equal(issueFromCloseEvent(events[0], { sawOpen: false }), 'popup_blocked');
});

test('user closes the popup → close with bridge_closed', async () => {
  const h = harness();
  const sock = createPopupBridgeSocket({ wsUrl: 'ws://127.0.0.1:17341', win: h.opener, nonce: NONCE, pollMs: 5 });
  const events = record(sock);
  h.fromPopup({ type: BRIDGE_MSG.READY });
  h.fromPopup({ type: BRIDGE_MSG.OPEN });
  await tick();
  h.popup.closed = true;
  await tick(20);
  const close = events.find((e) => e.type === 'close');
  assert.equal(close.reason, BRIDGE_CLOSE_REASON.BRIDGE_CLOSED);
  assert.equal(issueFromCloseEvent(close, { sawOpen: true }), 'bridge_closed');
});

test('relay not running: quiet reloads with backoff, then relay detected', async () => {
  const h = harness();
  const sock = createPopupBridgeSocket({
    wsUrl: 'ws://127.0.0.1:17341', win: h.opener, nonce: NONCE, retryDelaysMs: [5, 10, 20],
  });
  const events = [];
  for (const type of ['relay', 'open', 'close']) sock.addEventListener(type, (e) => events.push(e.type));
  await tick(60);
  assert.deepEqual(events, [], 'no events while retrying');
  assert.equal(h.popup.closed, false);
  const navs = h.popup.navigations.length;
  assert.ok(navs >= 3 && navs <= 5, `backoff, not a tight loop (${navs} reloads)`);
  assert.equal(h.popup.navigations[0], h.opener.openCalls[0].url);
  h.fromPopup({ type: BRIDGE_MSG.READY });
  await tick(60);
  assert.equal(h.popup.navigations.length, navs, 'retries stop once the relay answers');
  assert.deepEqual(events, ['relay']);
  sock.close();
});

test('relay never comes up: keeps retrying at the capped interval, no give-up', async () => {
  const h = harness();
  const sock = createPopupBridgeSocket({ wsUrl: 'ws://127.0.0.1:17341', win: h.opener, nonce: NONCE, retryDelaysMs: [2, 5] });
  const events = record(sock);
  await tick(150);
  assert.deepEqual(events, [], 'no close, no error');
  assert.equal(sock.readyState, 0);
  assert.equal(h.popup.closed, false);
  const navs = h.popup.navigations.length;
  await tick(60);
  assert.ok(h.popup.navigations.length > navs, 'still reloading');
  assert.equal(DEFAULT_RETRY_DELAYS_MS.at(-1) <= 3000, true, 'cap stays at a few seconds');
  sock.close();
});

test('a popup that loads some other origin cannot drive the transport', async () => {
  const h = harness({ popupOrigin: 'https://evil.example' });
  const sock = createPopupBridgeSocket({ wsUrl: 'ws://127.0.0.1:17341', win: h.opener, nonce: NONCE });
  const events = record(sock);
  sock.addEventListener('relay', (e) => events.push(e));
  h.fromPopup({ type: BRIDGE_MSG.READY });
  h.fromPopup({ type: BRIDGE_MSG.OPEN });
  await tick(40);
  assert.equal(h.fromOpener.length, 0);
  assert.equal(events.length, 0, 'no relay, open, or frames from a foreign window');
  assert.equal(sock.readyState, 0);
  sock.close();
});

test('transport abstraction: direct probes, popup signals relay through the socket', async () => {
  const direct = createAgentBridgeTransport({ mode: 'direct' });
  assert.equal(direct.opensWindow, false);
  assert.equal(typeof direct.probeRelay, 'function');
  const popup = createAgentBridgeTransport({ mode: 'popup', win: harness().opener });
  assert.equal(popup.opensWindow, true);
  assert.equal(popup.probeRelay, null);
  const sock = popup.createSocket('ws://127.0.0.1:17341');
  assert.equal(sock.transport, 'popup');
  sock.close();
});

test('probeRelayDirect resolves true on open and false on error or timeout', async () => {
  class Opens {
    constructor() { this.l = {}; setTimeout(() => this.l.open?.(), 1); }
    addEventListener(t, cb) { this.l[t] = cb; }
    close() {}
  }
  class Fails {
    constructor() { this.l = {}; setTimeout(() => this.l.error?.(), 1); }
    addEventListener(t, cb) { this.l[t] = cb; }
    close() {}
  }
  class Hangs { addEventListener() {} close() {} }
  assert.equal(await probeRelayDirect('ws://x', { WebSocketCtor: Opens }), true);
  assert.equal(await probeRelayDirect('ws://x', { WebSocketCtor: Fails }), false);
  assert.equal(await probeRelayDirect('ws://x', { WebSocketCtor: Hangs, timeoutMs: 10 }), false);
});
