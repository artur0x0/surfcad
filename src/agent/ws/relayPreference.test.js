import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forcesServerRelay,
  isSafariFamily,
  isTouchAppleDevice,
  readPhoneWidth,
  readRelayPreference,
  resolveRelayTarget,
  serverAgentWsUrl,
  shouldProbeLocalRelay,
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

const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';
const IOS_FIREFOX = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/128.0 Mobile/15E148 Safari/605.1.15';
const IPAD_DESKTOP_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.111 Safari/605.1.15';

test('Safari, iPhone, and iOS WebKit shells use the server even when Local is stored', () => {
  assert.equal(isSafariFamily(SAFARI), true);
  assert.equal(isSafariFamily(IPHONE), true);
  assert.equal(isSafariFamily(IOS_CHROME), true);
  assert.equal(isSafariFamily(IOS_FIREFOX), true);
  assert.equal(isSafariFamily(CHROME), false);
  for (const userAgent of [SAFARI, IPHONE, IOS_CHROME, IOS_FIREFOX]) {
    assert.equal(resolveRelayTarget({ preference: 'local', userAgent, isMobile: false, innerWidth: 1280 }), 'server');
    assert.equal(forcesServerRelay({ userAgent, isSecureContext: false }), true);
    assert.equal(shouldProbeLocalRelay({ preference: 'local', userAgent, isSecureContext: false }), false);
  }
});

test('iPad desktop-mode (MacIntel, maxTouchPoints > 1) uses the server', () => {
  const input = {
    preference: 'local',
    userAgent: IPAD_DESKTOP_CHROME,
    platform: 'MacIntel',
    maxTouchPoints: 5,
    isMobile: false,
    innerWidth: 1024,
    isSecureContext: false,
  };
  assert.equal(isSafariFamily(IPAD_DESKTOP_CHROME), false);
  assert.equal(isTouchAppleDevice(input), true);
  assert.equal(resolveRelayTarget(input), 'server');
  assert.equal(shouldProbeLocalRelay(input), false);
  assert.equal(isTouchAppleDevice({ userAgent: IPAD_DESKTOP_CHROME, platform: 'MacIntel', maxTouchPoints: 0 }), false);
  assert.equal(resolveRelayTarget({
    preference: 'local',
    userAgent: CHROME,
    platform: 'MacIntel',
    maxTouchPoints: 5,
    innerWidth: 1280,
  }), 'server');
});

test('a 390px page uses the server even in desktop Chrome', () => {
  const input = {
    preference: 'local',
    userAgent: CHROME,
    isMobile: false,
    innerWidth: 390,
    isSecureContext: true,
  };
  assert.equal(resolveRelayTarget(input), 'server');
  assert.equal(forcesServerRelay({ isMobile: true, userAgent: CHROME, innerWidth: 1280 }), true);
  assert.equal(readPhoneWidth({ innerWidth: 390, matchMedia: () => ({ matches: false }) }), true);
  assert.equal(readPhoneWidth({ innerWidth: 0, matchMedia: () => ({ matches: true }) }), true);
  assert.equal(readPhoneWidth({ innerWidth: 0, matchMedia: () => ({ matches: false }) }), false);
  assert.equal(readPhoneWidth(null), false);
});

test('desktop Chrome keeps Auto, Local, and Server', () => {
  const desktop = { userAgent: CHROME, isMobile: false, innerWidth: 1280, maxTouchPoints: 0, isSecureContext: true };
  assert.equal(resolveRelayTarget({ ...desktop, preference: 'auto' }), 'auto');
  assert.equal(resolveRelayTarget({ ...desktop, preference: 'local' }), 'local');
  assert.equal(resolveRelayTarget({ ...desktop, preference: 'server' }), 'server');
  assert.equal(shouldProbeLocalRelay({ ...desktop, preference: 'auto', relayTarget: 'auto' }), true);
  assert.equal(shouldProbeLocalRelay({ ...desktop, preference: 'local', relayTarget: 'local' }), false);
  assert.equal(shouldProbeLocalRelay({ ...desktop, preference: 'server', relayTarget: 'server' }), false);
});

test('a non-secure context does not change the routing decision', () => {
  const insecure = { isSecureContext: false, isMobile: false, innerWidth: 1280, maxTouchPoints: 0 };
  assert.equal(resolveRelayTarget({ ...insecure, preference: 'local', userAgent: IPHONE }), 'server');
  assert.equal(resolveRelayTarget({ ...insecure, preference: 'local', userAgent: SAFARI }), 'server');
  assert.equal(resolveRelayTarget({ ...insecure, preference: 'auto', userAgent: CHROME }), 'auto');
  assert.equal(resolveRelayTarget({ ...insecure, preference: 'local', userAgent: CHROME }), 'local');
  assert.equal(resolveRelayTarget({ ...insecure, preference: 'server', userAgent: CHROME }), 'server');
  assert.equal(shouldProbeLocalRelay({ ...insecure, preference: 'auto', userAgent: CHROME, relayTarget: 'auto' }), true);
  assert.equal(shouldProbeLocalRelay({ ...insecure, preference: 'local', userAgent: IPHONE }), false);
});
