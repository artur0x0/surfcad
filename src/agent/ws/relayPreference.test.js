import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSafariFamily,
  readRelayPreference,
  resolveRelayTarget,
  serverAgentWsUrl,
  writeRelayPreference,
} from './relayPreference.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
  };
}

test('preference falls back to auto and only stores the three choices', () => {
  const storage = memoryStorage();
  assert.equal(readRelayPreference(storage), 'auto');
  writeRelayPreference(storage, 'server');
  assert.equal(readRelayPreference(storage), 'server');
  writeRelayPreference(storage, 'nope');
  assert.equal(readRelayPreference(storage), 'server');
  writeRelayPreference(storage, 'local');
  assert.equal(readRelayPreference(storage), 'local');
});

test('Safari and a phone use the server even when the setting is local', () => {
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  assert.equal(isSafariFamily(safari), true);
  assert.equal(isSafariFamily(chrome), false);
  assert.equal(resolveRelayTarget({ preference: 'local', userAgent: safari, isMobile: false }), 'server');
  assert.equal(resolveRelayTarget({ preference: 'local', userAgent: chrome, isMobile: true }), 'server');
  assert.equal(resolveRelayTarget({ preference: 'local', userAgent: chrome, isMobile: false }), 'local');
  assert.equal(resolveRelayTarget({ preference: 'auto', userAgent: chrome, isMobile: false }), 'auto');
  assert.equal(resolveRelayTarget({ preference: 'server', userAgent: chrome, isMobile: false }), 'server');
});

test('the server socket uses the page host', () => {
  assert.equal(serverAgentWsUrl({ protocol: 'https:', host: 'surfcad.com' }), 'wss://surfcad.com/agent');
  assert.equal(serverAgentWsUrl({ protocol: 'http:', host: 'localhost:5173' }), 'ws://localhost:5173/agent');
});
