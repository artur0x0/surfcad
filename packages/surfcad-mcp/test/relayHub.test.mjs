import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createAgentBridgeRelayHub,
  redactToken,
  DEFAULT_TAB_RESERVATION_TTL_MS,
} from '../src/bridge/relayHub.mjs';
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
  assert.equal(hub.hasTab(TOKEN), true, 'drop keeps a reservation so a squatter cannot take the code');
  assert.equal(hub.isPaired(TOKEN), false);
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
  assert.equal(hub.hasTab(TOKEN), true, 'heartbeat drop still reserves the token for that tabKey');
  assert.equal(hub.isPaired(TOKEN), false);
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

test('PAIR_REQUEST never carries the resume secret; matching resume auto-pairs at the hub', () => {
  const { hub } = setup();
  const tab = fakeSocket();
  const peer = fakeSocket();
  hub.attachSocket(tab);
  hub.attachSocket(peer);
  tab.receive({ type: PAIR_MSG.REGISTER_TAB, token: TOKEN, tabKey: TAB_KEY });
  peer.receive({ type: PAIR_MSG.PAIR, token: TOKEN });
  const firstRequest = tab.last(PAIR_MSG.PAIR_REQUEST);
  assert.equal(firstRequest.resume, undefined);
  tab.receive({ type: PAIR_MSG.PAIR_APPROVE, resumeKey: RESUME });
  assert.equal(peer.last(PAIR_MSG.PAIRED).resumeKey, RESUME);
  assert.equal(tab.last(PAIR_MSG.PAIRED).resumeKey, undefined);
  peer.emit('close', 1000, '');
  assert.equal(hub.isPaired(TOKEN), false);

  const peer2 = fakeSocket();
  hub.attachSocket(peer2);
  peer2.receive({ type: PAIR_MSG.PAIR, token: TOKEN, resume: RESUME });
  assert.equal(peer2.last(PAIR_MSG.PAIRED).resumeKey, RESUME);
  assert.equal(tab.last(PAIR_MSG.PAIRED).resume, true);
  assert.ok(tab.sent.every((m) => m.resume !== RESUME), 'tab must never see the resume secret');
});

test('after drop, a different tabKey cannot register and a stolen resume is not forwarded', () => {
  const { hub } = setup();
  const { tab, peer } = pairedTrio(hub);
  tab.emit('close', 1006, '');
  assert.equal(peer.closed, true);

  const squatter = fakeSocket();
  hub.attachSocket(squatter);
  squatter.receive({ type: PAIR_MSG.REGISTER_TAB, token: TOKEN, tabKey: 'other-key-0123456789abcdef' });
  assert.equal(squatter.last(PAIR_MSG.ERROR).code, 'token_in_use');
  assert.equal(squatter.closed, true);
  assert.equal(hub.hasTab(TOKEN), true);

  const other = fakeSocket();
  const thief = fakeSocket();
  hub.attachSocket(other);
  hub.attachSocket(thief);
  other.receive({ type: PAIR_MSG.REGISTER_TAB, token: 'QRS567', tabKey: 'other-key-0123456789abcdef' });
  thief.receive({ type: PAIR_MSG.PAIR, token: 'QRS567', resume: RESUME });
  const request = other.last(PAIR_MSG.PAIR_REQUEST);
  assert.ok(request, 'a different tab still gets a normal Allow prompt');
  assert.equal(request.resume, undefined);
  assert.equal(other.last(PAIR_MSG.PAIRED), undefined, 'stolen resume must not auto-pair a different tab');
  assert.ok(other.sent.every((m) => m.resume !== RESUME && m.resumeKey !== RESUME));
});

test('reconnect with forgetResume does not silent-resume a matching key', () => {
  const { hub } = setup();
  const { tab } = pairedTrio(hub);
  tab.emit('close', 1006, '');

  const tab2 = fakeSocket();
  const peer2 = fakeSocket();
  hub.attachSocket(tab2);
  hub.attachSocket(peer2);
  tab2.receive({ type: PAIR_MSG.REGISTER_TAB, token: TOKEN, tabKey: TAB_KEY, forgetResume: true });
  peer2.receive({ type: PAIR_MSG.PAIR, token: TOKEN, resume: RESUME });
  assert.equal(hub.isPaired(TOKEN), false);
  assert.ok(tab2.last(PAIR_MSG.PAIR_REQUEST), 'user-closed bridge must prompt Allow again');
  assert.equal(tab2.last(PAIR_MSG.PAIRED), undefined);
});

test('same-tabKey reconnect with the matching resume still auto-pairs', () => {
  const { hub } = setup();
  const { tab } = pairedTrio(hub);
  tab.emit('close', 1006, '');

  const tab2 = fakeSocket();
  const peer2 = fakeSocket();
  hub.attachSocket(tab2);
  hub.attachSocket(peer2);
  tab2.receive({ type: PAIR_MSG.REGISTER_TAB, token: TOKEN, tabKey: TAB_KEY });
  peer2.receive({ type: PAIR_MSG.PAIR, token: TOKEN, resume: RESUME });
  assert.equal(hub.isPaired(TOKEN), true);
  assert.equal(tab2.last(PAIR_MSG.PAIR_REQUEST), undefined);
  assert.equal(tab2.last(PAIR_MSG.PAIRED).resume, true);
  assert.equal(peer2.last(PAIR_MSG.PAIRED).resumeKey, RESUME);
  assert.ok(tab2.sent.every((m) => m.resume !== RESUME));
});

test('expired reservations leave hasTab and can be reused', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 0 });
  const hub = createAgentBridgeRelayHub({
    reservationTtlMs: 1000,
    reservationSweepMs: 500,
  });
  t.after(() => hub.dispose());
  const { tab } = pairedTrio(hub);
  tab.emit('close', 1006, '');
  assert.equal(hub.hasTab(TOKEN), true, 'drop keeps a reservation inside the TTL');

  t.mock.timers.tick(1000);
  assert.equal(hub.hasTab(TOKEN), true, 'TTL is exclusive (> ttl, not >=)');

  t.mock.timers.tick(1);
  assert.equal(hub.hasTab(TOKEN), false, 'hasTab and liveTab respect expiry');
  assert.equal(hub.isPaired(TOKEN), false);

  const replacement = fakeSocket();
  hub.attachSocket(replacement);
  replacement.receive({ type: PAIR_MSG.REGISTER_TAB, token: TOKEN, tabKey: 'other-key-0123456789abcdef' });
  assert.equal(replacement.last(PAIR_MSG.ERROR), undefined, 'expired code can be advertised by a new tabKey');
  assert.equal(hub.hasTab(TOKEN), true);
});

test('reservation sweep is unrefed so a quiet hub does not keep the process alive', () => {
  assert.equal(DEFAULT_TAB_RESERVATION_TTL_MS, 24 * 60 * 60 * 1000);
  const src = readFileSync(new URL('../src/bridge/relayHub.mjs', import.meta.url), 'utf8');
  assert.match(src, /setInterval\(sweepExpiredReservations/);
  assert.match(src, /sweepTimer\?\.unref/);
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

test('agent prompt frames flow only while paired, and the wrong role cannot spoof them', () => {
  const { hub } = setup();
  const tab = fakeSocket();
  const peer = fakeSocket();
  hub.attachSocket(tab);
  hub.attachSocket(peer);
  tab.receive({ type: PAIR_MSG.REGISTER_TAB, token: TOKEN, tabKey: TAB_KEY });
  tab.receive({ type: PAIR_MSG.AGENT_PROMPT, v: 1, id: 'p1', text: 'early' });
  assert.equal(tab.last(PAIR_MSG.AGENT_PROMPT_ACK).delivery, 'failed');
  assert.equal(tab.last(PAIR_MSG.AGENT_PROMPT_ACK).error, 'not_paired');
  assert.equal(peer.sent.some((msg) => msg.type === PAIR_MSG.AGENT_PROMPT), false);

  peer.receive({ type: PAIR_MSG.PAIR, token: TOKEN });
  tab.receive({ type: PAIR_MSG.PAIR_APPROVE, resumeKey: RESUME });
  tab.receive({ type: PAIR_MSG.AGENT_PROMPT, v: 1, id: 'p2', text: 'hello' });
  assert.equal(peer.last(PAIR_MSG.AGENT_PROMPT).text, 'hello');
  peer.receive({ type: PAIR_MSG.AGENT_REPLY, v: 1, id: 'p2', text: 'ok', final: true, ts: '2026-10-18T00:00:00.000Z' });
  assert.equal(tab.last(PAIR_MSG.AGENT_REPLY).text, 'ok');
  peer.receive({ type: PAIR_MSG.AGENT_STATUS, v: 1, working: true, id: 'p2' });
  assert.equal(tab.last(PAIR_MSG.AGENT_STATUS).working, true);
  peer.receive({ type: PAIR_MSG.AGENT_ACTIVITY, v: 1, id: 'p2' });
  assert.equal(tab.last(PAIR_MSG.AGENT_ACTIVITY).id, 'p2');
  tab.receive({ type: PAIR_MSG.AGENT_ACTIVITY, v: 1, id: 'p2' });
  assert.equal(tab.last(PAIR_MSG.ERROR).code, 'forbidden');

  tab.receive({ type: PAIR_MSG.AGENT_REPLY, v: 1, id: 'p2', text: 'spoof' });
  assert.equal(tab.last(PAIR_MSG.ERROR).code, 'forbidden');
  peer.receive({ type: PAIR_MSG.AGENT_PROMPT, v: 1, id: 'p3', text: 'nope' });
  assert.equal(peer.last(PAIR_MSG.ERROR).code, 'forbidden');
  assert.equal(tab.sent.some((msg) => msg.type === PAIR_MSG.AGENT_PROMPT && msg.id === 'p3'), false);

  tab.receive({ type: PAIR_MSG.AGENT_PROMPT_CANCEL, v: 1, id: 'p2' });
  assert.equal(peer.last(PAIR_MSG.AGENT_PROMPT_CANCEL).id, 'p2');
  peer.receive({ type: PAIR_MSG.AGENT_PROMPT_CANCEL_RESULT, v: 1, id: 'p2', state: 'cancelled' });
  assert.equal(tab.last(PAIR_MSG.AGENT_PROMPT_CANCEL_RESULT).state, 'cancelled');
  peer.receive({ type: PAIR_MSG.AGENT_PROMPT_CANCEL, v: 1, id: 'p2' });
  assert.equal(peer.last(PAIR_MSG.ERROR).code, 'forbidden');
});

test('an oversized agent prompt is refused and not forwarded', () => {
  const hub = createAgentBridgeRelayHub({ maxPromptFrameChars: 80 });
  const tab = fakeSocket();
  const peer = fakeSocket();
  hub.attachSocket(tab);
  hub.attachSocket(peer);
  tab.receive({ type: PAIR_MSG.REGISTER_TAB, token: TOKEN, tabKey: TAB_KEY });
  peer.receive({ type: PAIR_MSG.PAIR, token: TOKEN });
  tab.receive({ type: PAIR_MSG.PAIR_APPROVE });
  tab.receive({ type: PAIR_MSG.AGENT_PROMPT, v: 1, id: 'big', text: 'x'.repeat(200) });
  assert.equal(tab.last(PAIR_MSG.AGENT_PROMPT_ACK).error, 'screenshot_too_large');
  assert.equal(peer.sent.some((msg) => msg.type === PAIR_MSG.AGENT_PROMPT), false);
  hub.dispose();
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
