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
