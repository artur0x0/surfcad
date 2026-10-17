import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentBridgeRelayHub, redactToken } from '../src/bridge/relayHub.mjs';
import { defaultRelayLog } from '../src/bridge/relayServer.mjs';
import { PAIR_MSG } from '../src/relayMessages.mjs';

const TOKEN = 'ABC234';
const TAB_KEY = 'tab-key-0123456789abcdef';
const RESUME = 'resume-key-0123456789abcdef';

function fakeSocket({ origin = 'https://surfcad.com', pongs = true } = {}) {
  const handlers = new Map();
  const socket = {
    origin,
    remoteAddress: '127.0.0.1',
    sent: [],
    closed: false,
    terminated: false,
    pings: 0,
    send(data) { this.sent.push(JSON.parse(data)); },
    close() { this.emit('close', 1000, ''); },
    terminate() { this.terminated = true; this.emit('close', 1006, ''); },
    ping() {
      this.pings += 1;
      if (pongs) this.emit('pong');
    },
    on(event, cb) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(cb);
    },
    emit(event, ...args) {
      if (event === 'close') {
        if (this.closed) return;
        this.closed = true;
      }
      for (const cb of handlers.get(event) || []) cb(...args);
    },
    receive(payload) { this.emit('message', JSON.stringify(payload)); },
    last(type) { return [...this.sent].reverse().find((m) => !type || m.type === type); },
  };
  return socket;
}

function setup() {
  const lines = [];
  const hub = createAgentBridgeRelayHub({ onLog: (line, level) => lines.push({ line, level }) });
  return { hub, lines };
}

function pairedTrio(hub, { pongs = true } = {}) {
  const tab = fakeSocket({ pongs });
  const peer = fakeSocket();
  hub.attachSocket(tab);
  hub.attachSocket(peer);
  tab.receive({ type: PAIR_MSG.REGISTER_TAB, token: TOKEN, tabKey: TAB_KEY });
  peer.receive({ type: PAIR_MSG.PAIR, token: TOKEN });
  tab.receive({ type: PAIR_MSG.PAIR_APPROVE, resumeKey: RESUME });
  assert.equal(hub.isPaired(TOKEN), true);
  return { tab, peer };
}

test('redactToken never returns the full pairing code', () => {
  assert.equal(redactToken('ABC234'), 'AB****');
  assert.equal(redactToken(''), '-');
  assert.ok(!redactToken('XYZ987').includes('Z987'));
});

test('tab socket close unpairs and closes the peer, and logs a redacted drop', () => {
  const { hub, lines } = setup();
  const { tab, peer } = pairedTrio(hub);
  tab.emit('close', 1006, '');
  assert.equal(hub.hasTab(TOKEN), false);
  const unpaired = peer.last(PAIR_MSG.UNPAIRED);
  assert.equal(unpaired.reason, 'tab_disconnected');
  assert.match(unpaired.detail, /socket_closed code=1006/);
  assert.equal(peer.closed, true, 'peer socket is closed so old clients do not keep sending');
  const drop = lines.find((l) => l.line.startsWith('tab dropped'));
  assert.equal(drop.level, 'warn');
  assert.match(drop.line, /reason=socket_closed code=1006 peer=paired/);
  for (const { line } of lines) {
    assert.ok(!line.includes(TOKEN), `full token leaked in: ${line}`);
    assert.ok(!line.includes(TAB_KEY) && !line.includes(RESUME), `secret leaked in: ${line}`);
  }
});

test('heartbeat terminates a tab that misses a pong and reports heartbeat_timeout', () => {
  const { hub, lines } = setup();
  const { tab, peer } = pairedTrio(hub, { pongs: false });
  hub.heartbeat();
  assert.equal(tab.pings, 1);
  assert.equal(tab.terminated, false, 'one sweep without a pong is tolerated');
  hub.heartbeat();
  assert.equal(tab.terminated, true);
  assert.equal(hub.hasTab(TOKEN), false);
  assert.equal(peer.last(PAIR_MSG.UNPAIRED).detail, 'heartbeat_timeout');
  assert.ok(lines.some((l) => l.level === 'warn' && /reason=heartbeat_timeout/.test(l.line)));
});

test('heartbeat keeps sockets that answer pings or send traffic', () => {
  const { hub } = setup();
  const { tab, peer } = pairedTrio(hub);
  for (let i = 0; i < 5; i += 1) hub.heartbeat();
  assert.equal(tab.terminated, false);
  assert.equal(peer.terminated, false);
  assert.equal(hub.isPaired(TOKEN), true);

  const quiet = fakeSocket({ pongs: false });
  hub.attachSocket(quiet);
  quiet.receive({ type: PAIR_MSG.REGISTER_TAB, token: 'QRS567' });
  hub.heartbeat();
  quiet.receive({ id: 'x', ok: true });
  hub.heartbeat();
  assert.equal(quiet.terminated, false, 'a message counts as liveness');
});

test('a dead peer is detected by heartbeat and the tab hears unpaired', () => {
  const { hub } = setup();
  const tab = fakeSocket();
  const peer = fakeSocket({ pongs: false });
  hub.attachSocket(tab);
  hub.attachSocket(peer);
  tab.receive({ type: PAIR_MSG.REGISTER_TAB, token: TOKEN });
  peer.receive({ type: PAIR_MSG.PAIR, token: TOKEN });
  tab.receive({ type: PAIR_MSG.PAIR_APPROVE });
  hub.heartbeat();
  hub.heartbeat();
  assert.equal(peer.terminated, true);
  assert.equal(tab.last(PAIR_MSG.UNPAIRED).reason, 'peer_heartbeat_timeout');
  assert.equal(hub.hasTab(TOKEN), true, 'the tab keeps advertising for a new peer');
});

test('a reconnecting tab with the same tabKey replaces its stale socket', () => {
  const { hub } = setup();
  const { tab, peer } = pairedTrio(hub);
  const tab2 = fakeSocket();
  hub.attachSocket(tab2);
  tab2.receive({ type: PAIR_MSG.REGISTER_TAB, token: TOKEN, tabKey: TAB_KEY });
  assert.equal(tab.terminated, true);
  assert.equal(tab2.closed, false);
  assert.equal(hub.hasTab(TOKEN), true);
  assert.equal(peer.last(PAIR_MSG.UNPAIRED).detail, 'replaced_by_reconnect');
});

test('a different page cannot take over a registered code', () => {
  const { hub } = setup();
  pairedTrio(hub);
  for (const tabKey of [undefined, 'other-key-0123456789abcdef', 'short']) {
    const intruder = fakeSocket();
    hub.attachSocket(intruder);
    intruder.receive({ type: PAIR_MSG.REGISTER_TAB, token: TOKEN, tabKey });
    assert.equal(intruder.last(PAIR_MSG.ERROR).code, 'token_in_use');
    assert.equal(intruder.closed, true);
  }
  assert.equal(hub.isPaired(TOKEN), true);
});

test('resume key goes to the tab on pair and to the peer (only) on approve', () => {
  const { hub } = setup();
  const tab = fakeSocket();
  const peer = fakeSocket();
  hub.attachSocket(tab);
  hub.attachSocket(peer);
  tab.receive({ type: PAIR_MSG.REGISTER_TAB, token: TOKEN, tabKey: TAB_KEY });
  peer.receive({ type: PAIR_MSG.PAIR, token: TOKEN, resume: RESUME });
  assert.equal(tab.last(PAIR_MSG.PAIR_REQUEST).resume, RESUME);
  tab.receive({ type: PAIR_MSG.PAIR_APPROVE, resumeKey: RESUME });
  assert.equal(peer.last(PAIR_MSG.PAIRED).resumeKey, RESUME);
  assert.equal(tab.last(PAIR_MSG.PAIRED).resumeKey, undefined);

  const tab2 = fakeSocket();
  const peer2 = fakeSocket();
  hub.attachSocket(tab2);
  hub.attachSocket(peer2);
  tab2.receive({ type: PAIR_MSG.REGISTER_TAB, token: 'QRS567' });
  peer2.receive({ type: PAIR_MSG.PAIR, token: 'QRS567', resume: 'bad key!' });
  assert.equal(tab2.last(PAIR_MSG.PAIR_REQUEST).resume, undefined, 'malformed resume keys are dropped');
});

test('origin and loopback checks still refuse before any pairing', () => {
  const { hub } = setup();
  const evil = fakeSocket({ origin: 'https://evil.example' });
  hub.attachSocket(evil);
  assert.equal(evil.last(PAIR_MSG.ERROR).code, 'origin_blocked');
  assert.equal(evil.closed, true);
  const remote = fakeSocket();
  remote.remoteAddress = '10.0.0.5';
  hub.attachSocket(remote);
  assert.equal(remote.last(PAIR_MSG.ERROR).code, 'remote_blocked');
});

test('defaultRelayLog writes timestamped warn lines to stderr, info only when verbose', (t) => {
  const written = [];
  t.mock.method(console, 'error', (line) => { written.push(line); });
  t.mock.method(console, 'log', () => { throw new Error('relay must not log to stdout'); });
  const prev = process.env.SURFCAD_AGENT_BRIDGE_WS_VERBOSE;
  delete process.env.SURFCAD_AGENT_BRIDGE_WS_VERBOSE;
  try {
    defaultRelayLog('paired token=AB****', 'info');
    defaultRelayLog('tab dropped token=AB**** reason=heartbeat_timeout', 'warn');
    assert.equal(written.length, 1);
    assert.match(written[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[surfcad-relay\] WARN tab dropped/);
    process.env.SURFCAD_AGENT_BRIDGE_WS_VERBOSE = '1';
    defaultRelayLog('paired token=AB****', 'info');
    assert.equal(written.length, 2);
  } finally {
    if (prev === undefined) delete process.env.SURFCAD_AGENT_BRIDGE_WS_VERBOSE;
    else process.env.SURFCAD_AGENT_BRIDGE_WS_VERBOSE = prev;
  }
});
