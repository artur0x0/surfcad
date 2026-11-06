import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerTabConnection } from './serverTabConnection.js';

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
        if (type === 'close') this.readyState = 3;
        for (const cb of listeners.get(type) || []) cb(event);
      },
    };
    sockets.push(socket);
    return socket;
  };
  return { sockets, create, latest: () => sockets.at(-1) };
}

test('a registered tab stays advertising until an agent connects', () => {
  const factory = fakeSocketFactory();
  const states = [];
  const links = [];
  const conn = createServerTabConnection({
    url: 'ws://localhost/agent',
    call: async () => ({ ok: true, result: { ok: true } }),
    createSocket: factory.create,
    reconnectDelaysMs: [5000],
    onState: (state) => states.push(state),
    onLink: (link) => links.push(link),
  });
  conn.connect();
  const socket = factory.latest();
  socket.fire('open');
  socket.fire('message', { data: JSON.stringify({ type: 'registered', v: 1, tabId: 't1', agentConnected: false }) });
  assert.equal(conn.getState(), 'advertising');
  assert.equal(conn.getLink(), null);
  socket.fire('message', { data: JSON.stringify({ type: 'agent', v: 1, connected: true }) });
  assert.equal(conn.getState(), 'paired');
  assert.equal(conn.getLink(), 'connected');
  const heard = [];
  conn.subscribe((frame) => heard.push(frame));
  socket.fire('message', { data: JSON.stringify({ type: 'agent.prompt', v: 1, text: 'hi' }) });
  assert.equal(heard[0].text, 'hi');
  assert.equal(conn.send({ type: 'agent.reply', v: 1, text: 'yo' }), true);
  assert.equal(socket.sent.at(-1).text, 'yo');
  socket.fire('message', { data: JSON.stringify({ type: 'agent', v: 1, connected: false }) });
  assert.equal(conn.getState(), 'advertising');
  assert.equal(conn.getLink(), null);
  assert.equal(states.includes('paired'), true);
  assert.equal(links.includes('connected'), true);
  conn.disconnect();
});

test('a session note is delivered inbound and the page cannot send one', () => {
  const factory = fakeSocketFactory();
  const conn = createServerTabConnection({
    url: 'ws://localhost/agent',
    call: async () => ({ ok: true }),
    createSocket: factory.create,
    reconnectDelaysMs: [5000],
  });
  conn.connect();
  const socket = factory.latest();
  socket.fire('open');
  socket.fire('message', { data: JSON.stringify({ type: 'agent', v: 1, connected: true }) });
  const heard = [];
  conn.subscribe((frame) => heard.push(frame));
  socket.fire('message', { data: JSON.stringify({ type: 'agent.message', v: 1, text: '<b>hi</b>' }) });
  assert.equal(heard.length, 1);
  assert.equal(heard[0].text, '<b>hi</b>');
  assert.equal(heard[0].id, undefined);
  assert.equal(conn.send({ type: 'agent.message', v: 1, text: 'nope' }), false);
  assert.equal(socket.sent.some((msg) => msg.type === 'agent.message'), false);
  conn.disconnect();
});

test('a prompt leaves an open server socket before the agent frame arrives', () => {
  const factory = fakeSocketFactory();
  const conn = createServerTabConnection({
    url: 'ws://localhost/agent',
    call: async () => ({ ok: true }),
    createSocket: factory.create,
    reconnectDelaysMs: [5000],
  });
  conn.connect();
  const socket = factory.latest();
  socket.fire('open');
  socket.fire('message', { data: JSON.stringify({ type: 'registered', v: 1, agentConnected: false }) });
  assert.equal(conn.getState(), 'advertising');
  assert.equal(conn.send({ type: 'agent.prompt', v: 1, id: 'p1', text: 'draw a box' }), true);
  assert.equal(socket.sent.at(-1).text, 'draw a box');
  assert.equal(conn.send({ type: 'agent.reply', v: 1, text: 'no' }), false);
  conn.disconnect();
});

test('closing the tab socket is not an agent leaving', () => {
  const factory = fakeSocketFactory();
  const agents = [];
  const conn = createServerTabConnection({
    url: 'ws://localhost/agent',
    call: async () => ({ ok: true }),
    createSocket: factory.create,
    reconnectDelaysMs: [5000],
    onAgent: (connected, info) => agents.push({ connected, source: info.source, was: info.was }),
  });
  conn.connect();
  const socket = factory.latest();
  socket.fire('open');
  socket.fire('message', { data: JSON.stringify({ type: 'registered', v: 1, agentConnected: false }) });
  socket.fire('message', { data: JSON.stringify({ type: 'agent', v: 1, connected: true }) });
  socket.fire('close');
  assert.deepEqual(agents, [
    { connected: false, source: 'registered', was: false },
    { connected: true, source: 'agent', was: false },
  ]);
  conn.disconnect();
});

function memoryClaimStore(initial = null) {
  let value = initial;
  return {
    read: () => value,
    write: (claim) => { value = claim; },
    clear: () => { value = null; },
  };
}

const frame = (payload) => ({ data: JSON.stringify(payload) });
const claims = (socket) => socket.sent.filter((msg) => msg.type === 'tab.claim');

test('Connect agent in this window claims the agent window, and the claim is kept for a reload', () => {
  const factory = fakeSocketFactory();
  const store = memoryClaimStore();
  const conn = createServerTabConnection({
    url: 'ws://localhost/agent',
    call: async () => ({ ok: true }),
    createSocket: factory.create,
    reconnectDelaysMs: [5000],
    claimStore: store,
  });
  conn.connect();
  const socket = factory.latest();
  socket.fire('open');
  socket.fire('message', frame({ type: 'registered', v: 1, tabId: 't1', agentConnected: false }));
  // A window nobody paired in says nothing: it must not take the agent.
  assert.deepEqual(claims(socket), []);

  conn.claim();
  assert.deepEqual(claims(socket), [{ type: 'tab.claim', v: 1 }]);
  socket.fire('message', frame({ type: 'tab.claimed', v: 1, claim: 'c-1' }));
  assert.equal(store.read(), 'c-1');

  // The socket drops and comes back: a new tab id on the server, the same claim.
  socket.fire('close');
  conn.connect();
  const again = factory.latest();
  assert.notEqual(again, socket);
  again.fire('open');
  again.fire('message', frame({ type: 'registered', v: 1, tabId: 't2', agentConnected: true }));
  assert.deepEqual(claims(again), [{ type: 'tab.claim', v: 1, claim: 'c-1' }]);
  conn.disconnect();
  assert.equal(store.read(), 'c-1', 'a reload (the connection going away) keeps the claim');
});

test('a claim made before the socket registered is sent with the registration', () => {
  const factory = fakeSocketFactory();
  const store = memoryClaimStore('stale');
  const conn = createServerTabConnection({
    url: 'ws://localhost/agent',
    call: async () => ({ ok: true }),
    createSocket: factory.create,
    reconnectDelaysMs: [5000],
    claimStore: store,
  });
  conn.claim();
  conn.connect();
  const socket = factory.latest();
  socket.fire('open');
  assert.deepEqual(claims(socket), [], 'nothing before the server knows the tab');
  socket.fire('message', frame({ type: 'registered', v: 1, tabId: 't1', agentConnected: false }));
  // The user asked now: a fresh claim, not the stored one.
  assert.deepEqual(claims(socket), [{ type: 'tab.claim', v: 1 }]);
  socket.fire('message', frame({ type: 'tab.claimed', v: 1, claim: 'c-2' }));
  assert.equal(store.read(), 'c-2');
  conn.disconnect();
});

test('a refused resume forgets the claim; Disconnect releases it; neither reaches the prompt listeners', () => {
  const factory = fakeSocketFactory();
  const store = memoryClaimStore('old-claim');
  const conn = createServerTabConnection({
    url: 'ws://localhost/agent',
    call: async () => ({ ok: true }),
    createSocket: factory.create,
    reconnectDelaysMs: [5000],
    claimStore: store,
  });
  const heard = [];
  conn.subscribe((msg) => heard.push(msg));
  conn.connect();
  const socket = factory.latest();
  socket.fire('open');
  socket.fire('message', frame({ type: 'registered', v: 1, tabId: 't1', agentConnected: true }));
  assert.deepEqual(claims(socket), [{ type: 'tab.claim', v: 1, claim: 'old-claim' }]);
  // Another window paired since: the server keeps the agent there.
  socket.fire('message', frame({ type: 'tab.claimed', v: 1, claim: null }));
  assert.equal(store.read(), null);
  assert.deepEqual(heard, [], 'claim frames are not chat frames');

  conn.claim();
  socket.fire('message', frame({ type: 'tab.claimed', v: 1, claim: 'c-3' }));
  assert.equal(store.read(), 'c-3');
  conn.release();
  assert.equal(store.read(), null);
  socket.fire('close');
  conn.connect();
  const again = factory.latest();
  again.fire('open');
  again.fire('message', frame({ type: 'registered', v: 1, tabId: 't2', agentConnected: true }));
  assert.deepEqual(claims(again), [], 'after Disconnect the window does not take the agent back');
  conn.disconnect();
});

test('Disconnect: revokeAgent sends tab.disconnect once the tab is registered, and only then', () => {
  const factory = fakeSocketFactory();
  const conn = createServerTabConnection({
    url: 'ws://localhost/agent',
    call: async () => ({ ok: true, result: { ok: true } }),
    createSocket: factory.create,
    reconnectDelaysMs: [5000],
    claimStore: { read: () => null, write() {}, clear() {} },
  });
  // No socket yet: nothing to tell.
  assert.equal(conn.revokeAgent(), false);
  conn.connect();
  const socket = factory.latest();
  socket.fire('open');
  // Open but not registered: the server does not know this tab yet.
  assert.equal(conn.revokeAgent(), false);
  socket.fire('message', { data: JSON.stringify({ type: 'registered', v: 1, tabId: 't1', agentConnected: true }) });
  assert.equal(conn.revokeAgent(), true);
  assert.deepEqual(socket.sent.at(-1), { type: 'tab.disconnect', v: 1 });
  // The frame is queued before the close: Disconnect calls revokeAgent, then disconnect.
  conn.disconnect();
  assert.equal(conn.revokeAgent(), false, 'nothing is sent on a closed connection');
  // A reconnect, a reload or a sleeping tab never sends it by itself.
  assert.equal(socket.sent.filter((frame) => frame.type === 'tab.disconnect').length, 1);
});
