import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_PROTOCOL_VERSION } from '../../../packages/surfcad-mcp/src/commandProtocol.mjs';
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
  assert.equal(ctx.conn.getTabKey(), reg.tabKey);
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
  ws2.receive({ type: PAIR_MSG.PAIR_REQUEST, token: 'ABC234', resume: true });
  assert.ok(!ctx.states.includes('pending'), 'no approval popup');
  assert.equal(ws2.last(PAIR_MSG.PAIR_APPROVE).resumeKey, resumeKey);
  ws2.receive({ type: PAIR_MSG.PAIRED, token: 'ABC234' });
  assert.equal(ctx.conn.getState(), 'paired');
  assert.equal(ctx.conn.getLink(), 'connected');
  assert.deepEqual(ctx.links, ['connected', 'reconnecting', 'connected']);
});

test('a stolen string resume on PAIR_REQUEST does not auto-approve', () => {
  const ctx = setup();
  const { ws, resumeKey } = pair(ctx);
  ws.fire('close', { code: 1006 });
  ctx.timers.advance(500);
  const ws2 = ctx.factory.latest();
  ws2.fire('open');
  ctx.states.length = 0;
  ws2.receive({ type: PAIR_MSG.PAIR_REQUEST, token: 'ABC234', resume: resumeKey });
  assert.equal(ctx.conn.getState(), 'pending');
  assert.ok(ctx.states.includes('pending'));
  assert.equal(ws2.last(PAIR_MSG.PAIR_APPROVE), undefined);
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
  const { ws } = pair(ctx);
  ctx.conn.disconnect();
  assert.equal(ws.readyState, 3, 'live socket must close on unmount/disconnect');
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

test('a call reply is skipped once a newer socket exists', async () => {
  let release;
  const ctx = setup({
    call: () => new Promise((resolve) => { release = resolve; }),
  });
  const { ws } = pair(ctx);
  ws.receive({ id: 'c1', command: 'status' });
  ws.fire('close', { code: 1006 });
  ctx.timers.advance(500);
  const ws2 = ctx.factory.latest();
  ws2.fire('open');
  release({ ok: true, result: { volume: 1 } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(ws2.sent.filter((m) => m.id === 'c1').length, 0, 'must not reply on the newer socket');
  assert.equal(ws.sent.filter((m) => m.id === 'c1').length, 0);
});

test('closing the bridge window does not open another one from a timer', () => {
  const ctx = setup();
  pair(ctx);
  ctx.factory.latest().fire('close', { code: 4000, reason: 'bridge_closed' });
  assert.equal(ctx.conn.getState(), 'idle');
  assert.equal(ctx.conn.getLink(), null);
  ctx.timers.advance(60_000);
  assert.equal(ctx.factory.sockets.length, 1, 'no reconnect createSocket — Safari needs a click');
});

test('Reconnect after the user closed the window asks the hub to forget resume', () => {
  const ctx = setup();
  pair(ctx);
  ctx.factory.latest().fire('close', { code: 4000, reason: 'bridge_closed' });
  ctx.conn.connect();
  const ws = ctx.factory.latest();
  ws.fire('open');
  const reg = ws.last(PAIR_MSG.REGISTER_TAB);
  assert.equal(reg.forgetResume, true);
  ws.receive({ type: PAIR_MSG.PAIR_REQUEST, token: 'ABC234' });
  assert.equal(ctx.conn.getState(), 'pending');
  assert.equal(ws.last(PAIR_MSG.PAIR_APPROVE), undefined);
});

test('popup blocked is not retried', () => {
  const ctx = setup();
  ctx.conn.connect();
  ctx.factory.latest().fire('close', { code: 4000, reason: 'popup_blocked' });
  assert.equal(ctx.conn.getState(), 'idle');
  ctx.timers.advance(60_000);
  assert.equal(ctx.factory.sockets.length, 1);
});

test('prompt frames are sent only while paired and replies unsubscribe', () => {
  const ctx = setup();
  ctx.conn.connect();
  const early = ctx.factory.latest();
  early.fire('open');
  assert.equal(ctx.conn.send({ type: PAIR_MSG.AGENT_PROMPT, v: 1, id: 'x', text: 'no' }), false);
  assert.equal(early.sent.some((msg) => msg.type === PAIR_MSG.AGENT_PROMPT), false);

  const { ws } = pair(ctx);
  const seen = [];
  const off = ctx.conn.subscribe((msg) => seen.push(msg));
  const id = '22222222-2222-4222-8222-222222222222';
  assert.equal(ctx.conn.send({
    type: PAIR_MSG.AGENT_PROMPT, v: 1, id, text: 'hi', ts: '2026-10-18T00:00:00.000Z',
  }), true);
  assert.equal(ws.last(PAIR_MSG.AGENT_PROMPT).text, 'hi');
  assert.equal(ctx.conn.send({ type: PAIR_MSG.AGENT_PROMPT_CANCEL, v: 1, id }), true);
  assert.equal(ws.last(PAIR_MSG.AGENT_PROMPT_CANCEL).id, id);
  ws.receive({ type: PAIR_MSG.AGENT_PROMPT_CANCEL_RESULT, v: 1, id, state: 'cancelled' });
  ws.receive({ type: PAIR_MSG.AGENT_REPLY, v: 1, id, text: 'answer', final: true });
  ws.receive({ type: PAIR_MSG.AGENT_STATUS, v: 1, working: false });
  off();
  ws.receive({ type: PAIR_MSG.AGENT_REPLY, v: 1, id, text: 'ignored', final: true });
  assert.equal(seen.length, 3);
  assert.equal(seen[0].state, 'cancelled');
  assert.equal(seen[1].text, 'answer');
  assert.equal(seen[2].working, false);
});

test('a session note reaches prompt listeners and the page cannot send one', () => {
  const ctx = setup();
  const { ws } = pair(ctx);
  const seen = [];
  ctx.conn.subscribe((msg) => seen.push(msg));
  ws.receive({ type: PAIR_MSG.AGENT_MESSAGE, v: 1, text: '<b>hi</b>' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, '<b>hi</b>');
  assert.equal(seen[0].id, undefined);
  assert.equal(ctx.conn.send({ type: PAIR_MSG.AGENT_MESSAGE, v: 1, text: 'nope' }), false);
  assert.equal(ws.sent.some((msg) => msg.type === PAIR_MSG.AGENT_MESSAGE), false);
});

test('a bridge command is prompt activity until the call returns', async () => {
  let release;
  const done = new Promise((resolve) => { release = resolve; });
  const ctx = setup({
    call: () => done.then(() => ({ ok: true, result: { ok: true } })),
  });
  const { ws } = pair(ctx);
  const seen = [];
  ctx.conn.subscribe((msg) => seen.push(msg));
  ws.receive({ type: PAIR_MSG.AGENT_ACTIVITY, v: 1, id: 'p1' });
  assert.equal(seen.at(-1).type, PAIR_MSG.AGENT_ACTIVITY);
  assert.equal(seen.at(-1).id, 'p1');
  ws.receive({ id: 7, command: 'insert_cube', args: { size: 10 } });
  assert.equal(seen.at(-1).hold, true);
  assert.equal(ws.sent.some((msg) => msg.id === 7), false);
  release();
  await done;
  // handleCall's continuation, its reply, then the activity finally.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(seen.at(-1).hold, false);
  const reply = ws.sent.find((msg) => msg.id === 7 && msg.ok === true);
  assert.equal(reply.v, AGENT_PROTOCOL_VERSION);
  assert.deepEqual(reply.result, { ok: true });
});

test('relay event marks the popup bridge as reachable', () => {
  const relays = [];
  const ctx = setup({ onRelay: (ok) => relays.push(ok) });
  ctx.conn.connect();
  ctx.factory.latest().fire('relay', {});
  assert.deepEqual(relays, [true]);
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
