import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentBridgeTabConnection } from './tabConnection.js';
import { PAIR_MSG } from './relayMessages.js';

function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  return {
    setTimeout(cb, ms) {
      seq += 1;
      pending.set(seq, { at: now + ms, cb });
      return seq;
    },
    clearTimeout(id) { pending.delete(id); },
    now: () => now,
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > until) break;
        pending.delete(next[0]);
        now = next[1].at;
        next[1].cb();
      }
      now = until;
    },
    delays: () => [...pending.values()].map((t) => t.at - now),
  };
}

function fakeSocketFactory() {
  const sockets = [];
  const create = () => {
    const listeners = new Map();
    const socket = {
      readyState: 0,
      sent: [],
      send(data) { this.sent.push(JSON.parse(data)); },
      close() { this.fire('close', { code: 1000 }); },
      addEventListener(type, cb) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(cb);
      },
      fire(type, event = {}) {
        if (type === 'open') this.readyState = 1;
        if (type === 'close') {
          if (this.readyState === 3) return;
          this.readyState = 3;
        }
        for (const cb of listeners.get(type) || []) cb(event);
      },
      receive(msg) { this.fire('message', { data: JSON.stringify(msg) }); },
      last(type) { return [...this.sent].reverse().find((m) => m.type === type); },
    };
    sockets.push(socket);
    return socket;
  };
  return { sockets, create, latest: () => sockets.at(-1) };
}

function setup(extra = {}) {
  const timers = fakeTimers();
  const factory = fakeSocketFactory();
  const states = [];
  const links = [];
  const conn = createAgentBridgeTabConnection({
    url: 'ws://127.0.0.1:17341',
    token: 'ABC234',
    call: async () => ({ ok: true, result: 1 }),
    createSocket: factory.create,
    timers,
    reconnectDelaysMs: [500, 1000, 2000],
    lostAfterMs: 10_000,
    onState: (s) => states.push(s),
    onLink: (l) => links.push(l),
    ...extra,
  });
  return { conn, timers, factory, states, links };
}

function pair(ctx) {
  ctx.conn.connect();
  const ws = ctx.factory.latest();
  ws.fire('open');
  ws.receive({ type: PAIR_MSG.PAIR_REQUEST, token: 'ABC234' });
  assert.equal(ctx.conn.getState(), 'pending');
  ctx.conn.approvePair();
  const resumeKey = ws.last(PAIR_MSG.PAIR_APPROVE).resumeKey;
  ws.receive({ type: PAIR_MSG.PAIRED, token: 'ABC234' });
  return { ws, resumeKey };
}

test('registers with a stable tabKey and hands out a resume key on Allow', () => {
  const ctx = setup();
  const { ws, resumeKey } = pair(ctx);
  const reg = ws.last(PAIR_MSG.REGISTER_TAB);
  assert.equal(reg.token, 'ABC234');
  assert.match(reg.tabKey, /^[0-9a-f]{36}$/);
  assert.match(resumeKey, /^[0-9a-f]{36}$/);
  assert.notEqual(resumeKey, reg.tabKey);
  assert.equal(ctx.conn.getLink(), 'connected');
});

test('relay disconnect is detected and retried with backoff on the same tabKey', () => {
  const ctx = setup();
  const { ws } = pair(ctx);
  const tabKey = ws.last(PAIR_MSG.REGISTER_TAB).tabKey;
  ws.fire('close', { code: 1006 });
  assert.equal(ctx.conn.getState(), 'reconnecting');
  assert.equal(ctx.conn.getLink(), 'reconnecting');
  assert.deepEqual(ctx.timers.delays().sort((a, b) => a - b), [500, 10_000]);

  ctx.timers.advance(500);
  assert.equal(ctx.factory.sockets.length, 2);
  ctx.factory.latest().fire('close', { code: 1006 });
  ctx.timers.advance(999);
  assert.equal(ctx.factory.sockets.length, 2, 'second retry waits 1000 ms');
  ctx.timers.advance(1);
  const ws3 = ctx.factory.latest();
  assert.equal(ctx.factory.sockets.length, 3);
  ws3.fire('open');
  assert.equal(ws3.last(PAIR_MSG.REGISTER_TAB).tabKey, tabKey);
  assert.equal(ctx.conn.getState(), 'reconnecting', 'not connected until the peer is back');
});

test('a resume request with the issued key is re-approved without a prompt', () => {
  const ctx = setup();
  const { ws, resumeKey } = pair(ctx);
  ws.fire('close', { code: 1006 });
  ctx.timers.advance(500);
  const ws2 = ctx.factory.latest();
  ws2.fire('open');
  ctx.states.length = 0;
  ws2.receive({ type: PAIR_MSG.PAIR_REQUEST, token: 'ABC234', resume: resumeKey });
  assert.ok(!ctx.states.includes('pending'), 'no approval popup');
  assert.equal(ws2.last(PAIR_MSG.PAIR_APPROVE).resumeKey, resumeKey);
  ws2.receive({ type: PAIR_MSG.PAIRED, token: 'ABC234' });
  assert.equal(ctx.conn.getState(), 'paired');
  assert.equal(ctx.conn.getLink(), 'connected');
  assert.deepEqual(ctx.links, ['connected', 'reconnecting', 'connected']);
});

test('a pair request with a wrong or missing resume key still prompts', () => {
  const ctx = setup();
  const { ws } = pair(ctx);
  ws.receive({ type: PAIR_MSG.UNPAIRED, reason: 'peer_disconnected' });
  assert.equal(ctx.conn.getLink(), 'reconnecting');
  ws.receive({ type: PAIR_MSG.PAIR_REQUEST, token: 'ABC234', resume: 'f'.repeat(36) });
  assert.equal(ctx.conn.getState(), 'pending');
  ctx.conn.rejectPair();
  ws.receive({ type: PAIR_MSG.PAIR_REQUEST, token: 'ABC234' });
  assert.equal(ctx.conn.getState(), 'pending');
});

test('link goes to lost after lostAfterMs and retries keep running', () => {
  const ctx = setup();
  const { ws } = pair(ctx);
  ws.fire('close', { code: 1006 });
  for (let t = 0; t < 10_000; t += 500) {
    ctx.timers.advance(500);
    const latest = ctx.factory.latest();
    if (latest.readyState !== 3) latest.fire('close', { code: 1006 });
  }
  assert.equal(ctx.conn.getLink(), 'lost');
  const before = ctx.factory.sockets.length;
  ctx.timers.advance(2000);
  assert.ok(ctx.factory.sockets.length > before, 'still retrying while lost');
});

test('reconnectNow skips the backoff wait', () => {
  const ctx = setup({ reconnectDelaysMs: [30_000] });
  const { ws } = pair(ctx);
  ws.fire('close', { code: 1006 });
  assert.equal(ctx.factory.sockets.length, 1);
  ctx.conn.reconnectNow();
  assert.equal(ctx.factory.sockets.length, 2);
});

test('disconnect stops retries and clears the link', () => {
  const ctx = setup();
  pair(ctx);
  ctx.conn.disconnect();
  assert.equal(ctx.conn.getLink(), null);
  assert.equal(ctx.conn.getState(), 'idle');
  ctx.timers.advance(60_000);
  assert.equal(ctx.factory.sockets.length, 1);
});

test('origin refusal is not retried', () => {
  const issues = [];
  const ctx = setup({ onIssue: (i) => issues.push(i) });
  ctx.conn.connect();
  const ws = ctx.factory.latest();
  ws.fire('open');
  ws.receive({ type: PAIR_MSG.ERROR, code: 'origin_blocked', message: 'no' });
  ws.fire('close', { code: 1000 });
  assert.equal(ctx.conn.getState(), 'idle');
  ctx.timers.advance(60_000);
  assert.equal(ctx.factory.sockets.length, 1);
  assert.ok(issues.includes('origin_rejected'));
});

test('a deferred close from an old socket does not mark a newer socket idle', () => {
  const factory = fakeSocketFactory();
  const deferred = [];
  const create = () => {
    const socket = factory.create();
    socket.close = function closeLater() {
      if (this.readyState === 3) return;
      deferred.push(() => this.fire('close', { code: 1006 }));
    };
    return socket;
  };
  const states = [];
  const conn = createAgentBridgeTabConnection({
    url: 'ws://127.0.0.1:17341',
    token: 'ABC234',
    call: async () => ({ ok: true, result: 1 }),
    createSocket: create,
    onState: (s) => states.push(s),
    reconnectDelaysMs: [30_000],
  });
  conn.connect();
  const first = factory.latest();
  first.fire('open');
  assert.equal(conn.getState(), 'advertising');

  conn.connect();
  const second = factory.latest();
  assert.notEqual(second, first);
  second.fire('open');
  assert.equal(conn.getState(), 'advertising');
  states.length = 0;

  for (const flush of deferred.splice(0)) flush();
  assert.equal(conn.getState(), 'advertising', 'stale close must not call onState(idle)');
  assert.ok(!states.includes('idle'));
  assert.equal(second.last(PAIR_MSG.REGISTER_TAB).token, 'ABC234');
});

test('first connect to a missing relay stays idle for the pairing poller', () => {
  const ctx = setup();
  ctx.conn.connect();
  ctx.factory.latest().fire('close', { code: 1006 });
  assert.equal(ctx.conn.getState(), 'idle');
  assert.equal(ctx.conn.getLink(), null);
  ctx.timers.advance(60_000);
  assert.equal(ctx.factory.sockets.length, 1);
});
