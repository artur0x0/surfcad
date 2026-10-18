import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { PAIR_MSG } from './relayMessages.js';
import { classifyRelayHandshakeFailure, probeRelayWebSocket } from './relayProbe.js';

test('classifyRelayHandshakeFailure tells a policy close apart from a timeout', () => {
  assert.equal(classifyRelayHandshakeFailure({
    closeCode: 1008,
    closeReason: 'origin_blocked',
  }), 'origin_rejected');
  assert.equal(classifyRelayHandshakeFailure({
    relayErrorCode: 'origin_blocked',
  }), 'origin_rejected');
  assert.equal(classifyRelayHandshakeFailure({
    constructorThrew: true,
    pageSecure: true,
  }), 'browser_blocked');
  assert.equal(classifyRelayHandshakeFailure({
    constructorThrew: true,
    pageSecure: false,
  }), null);
  assert.equal(classifyRelayHandshakeFailure({
    closeCode: 1006,
    closeReason: '',
    pageSecure: true,
  }), null);
});

test('classifyRelayHandshakeFailure only treats a policy close as origin_rejected', () => {
  assert.equal(classifyRelayHandshakeFailure({
    closeCode: 1008,
    pageSecure: true,
  }), 'origin_rejected');
  assert.equal(classifyRelayHandshakeFailure({
    closeCode: 1000,
    pageSecure: true,
  }), null);
});

function fakeWebSocket(behavior) {
  return class FakeWebSocket {
    constructor() {
      this.listeners = new Map();
      this._closed = false;
      queueMicrotask(() => {
        if (behavior === 'open') this._fire('open');
        else if (behavior === 'error') {
          this._fire('error');
          this._fire('close', { code: 1006, reason: '' });
        } else if (behavior === 'origin_rejected_close') {
          this._fire('open');
          this._fire('close', { code: 1008, reason: 'origin_blocked' });
        } else if (behavior === 'origin_rejected_message') {
          this._fire('open');
          this._fire('message', {
            data: JSON.stringify({ type: PAIR_MSG.ERROR, code: 'origin_blocked', message: 'no' }),
          });
          this._fire('close', { code: 1000, reason: '' });
        }
      });
    }
    addEventListener(type, cb) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(cb);
    }
    close() {
      this._fire('close', { code: 1000, reason: '' });
    }
    _fire(type, event = {}) {
      if (type === 'close') {
        if (this._closed) return;
        this._closed = true;
      }
      for (const cb of this.listeners.get(type) || []) cb(event);
    }
  };
}

function withLoopbackHttpSpies(run) {
  const fetches = [];
  const xhrs = [];
  const origFetch = globalThis.fetch;
  const origXHR = globalThis.XMLHttpRequest;
  globalThis.fetch = async (url, init) => {
    fetches.push({ url: String(url), init });
    throw new Error(`unexpected fetch ${url}`);
  };
  globalThis.XMLHttpRequest = class {
    open(method, url) {
      xhrs.push({ method, url: String(url) });
      throw new Error(`unexpected XHR ${method} ${url}`);
    }
  };
  const loopbackHttp = (url) => /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])/i.test(String(url));
  return Promise.resolve()
    .then(run)
    .then((result) => {
      assert.equal(fetches.filter((c) => loopbackHttp(c.url)).length, 0);
      assert.equal(xhrs.filter((c) => loopbackHttp(c.url)).length, 0);
      return result;
    })
    .finally(() => {
      if (origFetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = origFetch;
      if (origXHR === undefined) delete globalThis.XMLHttpRequest;
      else globalThis.XMLHttpRequest = origXHR;
    });
}

describe('probeRelayWebSocket (no loopback http)', { concurrency: false }, () => {
  test('returns ok on open without setting an issue', async () => {
    const result = await withLoopbackHttpSpies(() => probeRelayWebSocket('ws://127.0.0.1:9', {
      settleMs: 0,
      WebSocket: fakeWebSocket('open'),
    }));
    assert.deepEqual(result, { ok: true, issue: null });
  });

  test('never fetches or XHRs a loopback http(s) URL when the ws fails', async () => {
    const result = await withLoopbackHttpSpies(() => probeRelayWebSocket('ws://127.0.0.1:9', {
      timeoutMs: 200,
      pageSecure: true,
      WebSocket: fakeWebSocket('error'),
    }));
    assert.equal(result.ok, false);
    assert.equal(result.issue, null);
  });

  test('maps a policy close 1008 to origin_rejected without treating the relay as reachable', async () => {
    const result = await withLoopbackHttpSpies(() => probeRelayWebSocket('ws://127.0.0.1:9', {
      timeoutMs: 200,
      settleMs: 50,
      pageSecure: true,
      WebSocket: fakeWebSocket('origin_rejected_close'),
    }));
    assert.equal(result.ok, false);
    assert.equal(result.issue, 'origin_rejected');
  });

  test('maps an origin_blocked hub message to origin_rejected', async () => {
    const result = await withLoopbackHttpSpies(() => probeRelayWebSocket('ws://127.0.0.1:9', {
      timeoutMs: 200,
      settleMs: 50,
      pageSecure: true,
      WebSocket: fakeWebSocket('origin_rejected_message'),
    }));
    assert.equal(result.ok, false);
    assert.equal(result.issue, 'origin_rejected');
  });

  test('maps a constructor throw on https to browser_blocked', async () => {
    class Throws {
      constructor() { throw new Error('blocked'); }
    }
    const result = await withLoopbackHttpSpies(() => probeRelayWebSocket('ws://127.0.0.1:9', {
      pageSecure: true,
      WebSocket: Throws,
    }));
    assert.equal(result.ok, false);
    assert.equal(result.issue, 'browser_blocked');
  });

  test('maps a timeout (no error) to a null issue so polling continues', async () => {
    const result = await withLoopbackHttpSpies(() => probeRelayWebSocket('ws://127.0.0.1:9', {
      timeoutMs: 30,
      pageSecure: true,
      WebSocket: fakeWebSocket('hang'),
    }));
    assert.deepEqual(result, { ok: false, issue: null });
  });

  test('connection refused is a missing relay, not origin_rejected', async () => {
    const result = await withLoopbackHttpSpies(() => (
      probeRelayWebSocket('ws://127.0.0.1:1', { timeoutMs: 400, pageSecure: true })
    ));
    assert.equal(result.ok, false);
    assert.equal(result.issue, null);
  });
});
