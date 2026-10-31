import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_PROTOCOL_VERSION, commandRequest } from '../../../packages/surfcad-mcp/src/commandProtocol.mjs';
import { attachCommandDispatch } from './commandDispatch.js';
import { createLocalhostRelayTransport } from './localhostRelayTransport.js';
import { createMemoryTransportPair } from './memoryTransport.js';
import { AGENT_TRANSPORT_METHODS } from './transport.js';

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
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
      receive(raw) { this.fire('message', { data: raw }); },
    };
    sockets.push(socket);
    return socket;
  };
  return { sockets, create, latest: () => sockets.at(-1) };
}

test('the transport interface is connect, send, onMessage, close, and status', () => {
  assert.deepEqual([...AGENT_TRANSPORT_METHODS], ['connect', 'send', 'onMessage', 'close', 'status']);
  const { local } = createMemoryTransportPair();
  for (const name of AGENT_TRANSPORT_METHODS) {
    assert.equal(typeof local[name], 'function');
  }
  assert.equal(local.status(), 'closed');
});

test('a memory transport drives a command end to end', async () => {
  const { local, remote } = createMemoryTransportPair();
  const seen = [];
  attachCommandDispatch(local, {
    call: async (command, args) => {
      seen.push({ command, args });
      return { ok: true, result: { command, echo: args.part_id } };
    },
  });
  const replies = [];
  remote.onMessage((msg) => replies.push(msg));
  local.connect();
  remote.connect();
  assert.equal(local.status(), 'open');

  remote.send({ id: 'c1', command: 'list_faces', args: { part_id: 'p' } });
  remote.send(commandRequest({ id: 'c2', command: 'status', args: {} }));
  remote.send({ type: 'pair_request', token: 'ABC234' });
  remote.send({ v: 2, id: 'c3', command: 'run' });
  await flush();

  assert.deepEqual(seen, [
    { command: 'list_faces', args: { part_id: 'p' } },
    { command: 'status', args: {} },
  ]);
  assert.equal(replies.length, 3);
  const byId = Object.fromEntries(replies.map((msg) => [msg.id, msg]));
  assert.equal(byId.c1.v, AGENT_PROTOCOL_VERSION);
  assert.equal(byId.c1.ok, true);
  assert.deepEqual(byId.c1.result, { command: 'list_faces', echo: 'p' });
  assert.equal(byId.c2.v, AGENT_PROTOCOL_VERSION);
  assert.equal(byId.c2.ok, true);
  assert.equal(byId.c2.result.command, 'status');
  assert.equal(byId.c3.ok, false);
  assert.equal(byId.c3.error.code, 'bad_call');
  assert.match(byId.c3.error.message, /version: 2/);
});

test('dispatch reports a refused command and a thrown command', async () => {
  const { local, remote } = createMemoryTransportPair();
  let mode = 'refuse';
  attachCommandDispatch(local, {
    call: async () => {
      if (mode === 'throw') throw new Error('boom');
      return { ok: false, error: { code: 'unknown_command', message: 'no such command' } };
    },
  });
  const replies = [];
  remote.onMessage((msg) => replies.push(msg));
  local.connect();
  remote.connect();
  remote.send({ id: 'a', command: 'nope' });
  mode = 'throw';
  remote.send({ id: 'b', command: 'nope' });
  await flush();
  assert.equal(replies[0].ok, false);
  assert.equal(replies[0].error.code, 'unknown_command');
  assert.equal(replies[1].ok, false);
  assert.equal(replies[1].error.code, 'internal');
  assert.match(replies[1].error.message, /boom/);
});

test('a closed memory transport does not deliver', async () => {
  const { local, remote } = createMemoryTransportPair();
  let calls = 0;
  attachCommandDispatch(local, {
    call: async () => {
      calls += 1;
      return { ok: true, result: null };
    },
  });
  local.connect();
  remote.connect();
  local.close();
  remote.send({ id: 'c', command: 'status' });
  await flush();
  assert.equal(calls, 0);
  assert.equal(local.status(), 'closed');
});

test('the localhost relay transport sends and receives frames on its socket', () => {
  const factory = fakeSocketFactory();
  const inbound = [];
  const transport = createLocalhostRelayTransport({
    url: 'ws://127.0.0.1:17341',
    createSocket: factory.create,
  });
  for (const name of AGENT_TRANSPORT_METHODS) {
    assert.equal(typeof transport[name], 'function');
  }
  const unsubscribe = transport.onMessage((msg) => inbound.push(msg));
  assert.equal(transport.status(), 'closed');
  transport.send({ type: 'register_tab' });
  assert.equal(factory.sockets.length, 0, 'send before connect does nothing');

  transport.connect();
  assert.equal(transport.status(), 'connecting');
  const socket = factory.latest();
  transport.send({ type: 'early' });
  assert.equal(socket.sent.length, 0, 'send waits until the socket is open');
  socket.fire('open');
  assert.equal(transport.status(), 'open');
  transport.send({ type: 'register_tab', token: 'ABC234' });
  assert.deepEqual(socket.sent[0], { type: 'register_tab', token: 'ABC234' });

  socket.receive('not json');
  socket.receive(JSON.stringify({ id: 'c1', command: 'status' }));
  assert.deepEqual(inbound, [{ id: 'c1', command: 'status' }]);

  const reply = transport.captureSend();
  socket.fire('close', { code: 1006 });
  assert.equal(transport.status(), 'closed');
  reply({ id: 'c1', ok: true, result: 1 });
  assert.equal(socket.sent.length, 1, 'a captured send does not write after close');

  transport.connect();
  const next = factory.latest();
  next.fire('open');
  reply({ id: 'c1', ok: true, result: 1 });
  assert.equal(next.sent.length, 0, 'a captured send does not write on the replacement socket');
  transport.send({ type: 'register_tab' });
  assert.equal(next.sent[0].type, 'register_tab');

  unsubscribe();
  next.receive(JSON.stringify({ id: 'c2', command: 'run' }));
  assert.equal(inbound.length, 1);
  transport.close();
  assert.equal(transport.status(), 'closed');
  assert.equal(next.readyState, 3);
});
