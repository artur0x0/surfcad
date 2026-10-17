import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIDGE_CHANNEL,
  BRIDGE_MSG,
  formatBridgeFragment,
  isAllowedOpenerOrigin,
  parseBridgeFragment,
  popupBridgeStatusText,
  startPopupBridge,
} from '../src/bridge/bridgePopup.mjs';
import { FakeWindow, linkWindows, tick } from './fakeWindows.mjs';

const NONCE = 'abcdefghijklmnopqrstuvwxyz012345';
const BRIDGE_ORIGIN = 'http://127.0.0.1:17341';

class FakeSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.listeners = new Map();
    FakeSocket.instances.push(this);
  }

  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(cb);
  }

  fire(type, event = {}) {
    for (const cb of this.listeners.get(type) || []) cb(event);
  }

  open() {
    this.readyState = 1;
    this.fire('open');
  }

  send(data) { this.sent.push(data); }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.fire('close', { code: 1000, reason: '' });
  }
}

function setup({ claimedOrigin = 'https://surfcad.com', openerOrigin = claimedOrigin, nonce = NONCE, hash } = {}) {
  FakeSocket.instances = [];
  const opener = new FakeWindow({ origin: openerOrigin });
  const popup = new FakeWindow({
    origin: BRIDGE_ORIGIN,
    pathname: '/bridge',
    search: '?s=abcd',
    hash: hash ?? `#${formatBridgeFragment({ nonce, origin: claimedOrigin })}`,
  });
  const link = linkWindows(opener, popup);
  const received = [];
  opener.addEventListener('message', (e) => received.push(e));
  const statuses = [];
  const bridge = startPopupBridge({
    win: popup,
    WebSocketCtor: FakeSocket,
    onStatus: (s) => statuses.push(s),
    readyIntervalMs: 5,
    readyAttempts: 5,
    openerPollMs: 5,
  });
  const hello = (extra = {}) => link.toPopup.postMessage(
    { channel: BRIDGE_CHANNEL, nonce, type: BRIDGE_MSG.HELLO, ...extra },
    BRIDGE_ORIGIN,
  );
  return { opener, popup, link, received, statuses, bridge, hello };
}

test('opener allowlist matches the relay: surfcad.com, www, loopback dev', () => {
  assert.equal(isAllowedOpenerOrigin('https://surfcad.com'), true);
  assert.equal(isAllowedOpenerOrigin('https://www.surfcad.com'), true);
  assert.equal(isAllowedOpenerOrigin('http://localhost:5173'), true);
  assert.equal(isAllowedOpenerOrigin('http://127.0.0.1:4173'), true);
  assert.equal(isAllowedOpenerOrigin('https://evil.example'), false);
  assert.equal(isAllowedOpenerOrigin('https://surfcad.com.evil.example'), false);
  assert.equal(isAllowedOpenerOrigin('https://app.surfcad.com'), false);
  assert.equal(isAllowedOpenerOrigin('https://surfcad.com/path'), false);
  assert.equal(isAllowedOpenerOrigin('null'), false);
  assert.equal(isAllowedOpenerOrigin(''), false);
  assert.equal(isAllowedOpenerOrigin(undefined), false);
  assert.equal(isAllowedOpenerOrigin('file:///tmp/x'), false);
  assert.equal(isAllowedOpenerOrigin('https://staging.example', ['https://staging.example']), true);
});

test('parseBridgeFragment requires a long nonce and an origin', () => {
  assert.deepEqual(parseBridgeFragment(`#${formatBridgeFragment({ nonce: NONCE, origin: 'https://surfcad.com' })}`), {
    nonce: NONCE,
    origin: 'https://surfcad.com',
  });
  assert.equal(parseBridgeFragment('#nonce=short&origin=https%3A%2F%2Fsurfcad.com'), null);
  assert.equal(parseBridgeFragment(`#nonce=${NONCE}`), null);
  assert.equal(parseBridgeFragment(''), null);
});

test('popup scrubs the nonce from its URL and handshakes with an allowlisted opener', async () => {
  const { popup, received, statuses, bridge, hello, link } = setup();
  assert.equal(popup.location.hash, '');
  assert.equal(popup.location.search, '?s=abcd');
  await tick();
  const ready = received.find((e) => e.data.type === BRIDGE_MSG.READY);
  assert.ok(ready, 'ready delivered');
  assert.equal(ready.origin, BRIDGE_ORIGIN);
  assert.equal(ready.data.nonce, NONCE);
  assert.ok(link.toOpenerLog.every((m) => m.targetOrigin === 'https://surfcad.com'));
  assert.equal(FakeSocket.instances.length, 0, 'no socket before hello');

  hello();
  await tick();
  assert.equal(FakeSocket.instances.length, 1);
  assert.equal(FakeSocket.instances[0].url, 'ws://127.0.0.1:17341');
  FakeSocket.instances[0].open();
  assert.equal(statuses.at(-1), 'connected');
  await tick();
  assert.ok(received.some((e) => e.data.type === BRIDGE_MSG.OPEN));
  bridge.stop();
});

test('frames flow both ways once open, and not before', async () => {
  const { received, bridge, hello, link } = setup();
  hello();
  await tick();
  const sock = FakeSocket.instances[0];
  link.toPopup.postMessage({ channel: BRIDGE_CHANNEL, nonce: NONCE, type: BRIDGE_MSG.FRAME, data: 'early' }, BRIDGE_ORIGIN);
  await tick();
  assert.deepEqual(sock.sent, []);
  sock.open();
  link.toPopup.postMessage({ channel: BRIDGE_CHANNEL, nonce: NONCE, type: BRIDGE_MSG.FRAME, data: '{"type":"register_tab"}' }, BRIDGE_ORIGIN);
  await tick();
  assert.deepEqual(sock.sent, ['{"type":"register_tab"}']);
  sock.fire('message', { data: '{"type":"pair_request"}' });
  await tick();
  const frame = received.find((e) => e.data.type === BRIDGE_MSG.FRAME);
  assert.equal(frame.data.data, '{"type":"pair_request"}');
  bridge.stop();
});

test('evil opener: claimed surfcad origin gets nothing and cannot open the relay socket', async () => {
  const { received, statuses, bridge, hello, link } = setup({
    claimedOrigin: 'https://surfcad.com',
    openerOrigin: 'https://evil.example',
  });
  await tick(30);
  assert.equal(received.length, 0, 'ready never reaches an opener on another origin');
  assert.ok(link.toOpenerLog.length > 0 && link.toOpenerLog.every((m) => m.dropped));
  hello();
  await tick();
  assert.equal(FakeSocket.instances.length, 0, 'hello from evil origin ignored');
  assert.notEqual(statuses.at(-1), 'connecting');
  bridge.stop();
});

test('evil opener: non-allowlisted origin in the fragment is refused before any message', async () => {
  const { received, statuses, hello } = setup({ claimedOrigin: 'https://evil.example' });
  assert.deepEqual(statuses, ['forbidden']);
  hello();
  await tick(20);
  assert.equal(received.length, 0);
  assert.equal(FakeSocket.instances.length, 0);
});

test('hello with the wrong nonce, channel, or source is ignored', async () => {
  const { popup, bridge, hello } = setup();
  hello({ nonce: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' });
  hello({ channel: 'other' });
  await tick();
  // Same origin as the opener but a different window (e.g. another surfcad tab).
  const otherTab = new FakeWindow({ origin: 'https://surfcad.com' });
  popup.dispatch('message', {
    origin: 'https://surfcad.com',
    source: otherTab,
    data: { channel: BRIDGE_CHANNEL, nonce: NONCE, type: BRIDGE_MSG.HELLO },
  });
  await tick();
  assert.equal(FakeSocket.instances.length, 0);
  bridge.stop();
});

test('missing or malformed fragment and missing opener stay inert', () => {
  FakeSocket.instances = [];
  const statuses = [];
  const popup = new FakeWindow({ origin: BRIDGE_ORIGIN, pathname: '/bridge', hash: '' });
  startPopupBridge({ win: popup, WebSocketCtor: FakeSocket, onStatus: (s) => statuses.push(s) });
  const orphan = new FakeWindow({
    origin: BRIDGE_ORIGIN,
    pathname: '/bridge',
    hash: `#${formatBridgeFragment({ nonce: NONCE, origin: 'https://surfcad.com' })}`,
  });
  startPopupBridge({ win: orphan, WebSocketCtor: FakeSocket, onStatus: (s) => statuses.push(s) });
  assert.deepEqual(statuses, ['invalid', 'no_opener']);
  assert.equal(FakeSocket.instances.length, 0);
});

test('closing the SurfCAD tab closes the relay socket', async () => {
  const { opener, statuses, hello } = setup();
  hello();
  await tick();
  const sock = FakeSocket.instances[0];
  sock.open();
  opener.closed = true;
  await tick(20);
  assert.equal(sock.readyState, 3);
  assert.equal(statuses.at(-1), 'opener_gone');
});

test('relay socket close is reported to the opener', async () => {
  const { received, statuses, bridge, hello } = setup();
  hello();
  await tick();
  const sock = FakeSocket.instances[0];
  sock.open();
  sock.close();
  await tick();
  const close = received.find((e) => e.data.type === BRIDGE_MSG.CLOSE);
  assert.ok(close);
  assert.equal(statuses.at(-1), 'closed');
  bridge.stop();
});

test('closed status tells the user to keep the window open', () => {
  const text = popupBridgeStatusText('closed');
  assert.match(text, /Keep this window open/);
  assert.doesNotMatch(text, /Close this window/);
});
