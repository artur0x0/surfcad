import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRelayHandshakeFailure, probeRelayWebSocket } from './relayProbe.js';

test('classifyRelayHandshakeFailure tells 403 origin rejection apart from a timeout', () => {
  assert.equal(classifyRelayHandshakeFailure({
    corsStatus: 403,
    corsFailed: false,
    opaqueOk: true,
  }), 'origin_rejected');
  assert.equal(classifyRelayHandshakeFailure({
    corsFailed: true,
    opaqueOk: true,
    pageSecure: true,
  }), 'browser_blocked');
  assert.equal(classifyRelayHandshakeFailure({
    corsFailed: true,
    opaqueOk: true,
    pageSecure: false,
  }), null);
  assert.equal(classifyRelayHandshakeFailure({
    corsFailed: true,
    opaqueOk: false,
    timedOut: true,
    pageSecure: true,
  }), null);
});

test('classifyRelayHandshakeFailure maps a live HTTP response + failed WS on https to browser_blocked', () => {
  assert.equal(classifyRelayHandshakeFailure({
    corsStatus: 404,
    corsFailed: false,
    opaqueOk: true,
    pageSecure: true,
  }), 'browser_blocked');
  assert.equal(classifyRelayHandshakeFailure({
    corsStatus: 404,
    corsFailed: false,
    opaqueOk: true,
    pageSecure: false,
  }), null);
});

function fakeWebSocket(behavior) {
  return class FakeWebSocket {
    constructor() {
      this.listeners = new Map();
      queueMicrotask(() => {
        if (behavior === 'open') this._fire('open');
        else if (behavior === 'error') this._fire('error');
      });
    }
    addEventListener(type, cb) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(cb);
    }
    close() { this._fire('close'); }
    _fire(type) {
      for (const cb of this.listeners.get(type) || []) cb({});
    }
  };
}

test('probeRelayWebSocket returns ok on open without setting an issue', async () => {
  const result = await probeRelayWebSocket('ws://127.0.0.1:9', {
    WebSocket: fakeWebSocket('open'),
    fetch: async () => { throw new Error('http should not run on open'); },
  });
  assert.deepEqual(result, { ok: true, issue: null });
});

test('probeRelayWebSocket maps CORS-hidden opaque OK on https to browser_blocked, not origin_rejected', async () => {
  const result = await probeRelayWebSocket('ws://127.0.0.1:9', {
    timeoutMs: 200,
    pageSecure: true,
    WebSocket: fakeWebSocket('error'),
    fetch: async (_url, init) => {
      if (init.mode === 'cors') throw new TypeError('Failed to fetch');
      return { status: 0, type: 'opaque' };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.issue, 'browser_blocked');
});

test('classifyRelayHandshakeFailure only treats a visible 403 as origin_rejected', () => {
  assert.equal(classifyRelayHandshakeFailure({
    corsStatus: 403,
    corsFailed: false,
    opaqueOk: true,
    pageSecure: true,
  }), 'origin_rejected');
  assert.equal(classifyRelayHandshakeFailure({
    corsFailed: true,
    opaqueOk: true,
    pageSecure: true,
  }), 'browser_blocked');
});

test('probeRelayWebSocket maps a 403 HTTP follow-up to origin_rejected without opening', async () => {
  const result = await probeRelayWebSocket('ws://127.0.0.1:9', {
    timeoutMs: 200,
    pageSecure: true,
    WebSocket: fakeWebSocket('error'),
    fetch: async (_url, init) => {
      if (init.mode === 'cors') {
        return { status: 403, type: 'cors' };
      }
      return { status: 0, type: 'opaque' };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.issue, 'origin_rejected');
});

test('probeRelayWebSocket maps a timeout (no error) to a null issue so polling continues', async () => {
  const result = await probeRelayWebSocket('ws://127.0.0.1:9', {
    timeoutMs: 30,
    pageSecure: true,
    WebSocket: fakeWebSocket('hang'),
    fetch: async () => { throw new Error('http should not run on timeout'); },
  });
  assert.deepEqual(result, { ok: false, issue: null });
});

test('connection refused is a missing relay, not origin_rejected', async () => {
  const result = await probeRelayWebSocket('ws://127.0.0.1:1', { timeoutMs: 400, pageSecure: true });
  assert.equal(result.ok, false);
  assert.equal(result.issue, null);
});

test('probeRelayWebSocket maps WS error + reachable HTTP on https to browser_blocked', async () => {
  const result = await probeRelayWebSocket('ws://127.0.0.1:9', {
    timeoutMs: 200,
    pageSecure: true,
    WebSocket: fakeWebSocket('error'),
    fetch: async () => ({ status: 404, type: 'cors' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.issue, 'browser_blocked');
});
