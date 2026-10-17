import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browserBlockedHint,
  detectBrowserFamily,
  isWebKitLoopbackPairingBrowser,
  issueFromCloseEvent,
  issueFromErrorEvent,
  issueFromRelayMessage,
  shouldPreemptWebKitHttpsPairing,
} from './connectionErrors.js';

const UA = {
  macSafari18: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
  desktopChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
};

test('detectBrowserFamily identifies Safari vs Chrome', () => {
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  assert.equal(detectBrowserFamily(safari), 'safari');
  assert.equal(detectBrowserFamily(chrome), 'chrome');
});

test('issueFromRelayMessage maps origin_blocked', () => {
  assert.equal(issueFromRelayMessage({ type: 'error', code: 'origin_blocked' }), 'origin_rejected');
  assert.equal(issueFromRelayMessage({ type: 'pair_request' }), null);
});

test('issueFromCloseEvent before open means relay missing', () => {
  assert.equal(issueFromCloseEvent({}, { sawOpen: false }), 'relay_missing');
  assert.equal(issueFromCloseEvent({}, { sawOpen: true, relayErrorCode: 'origin_blocked' }), 'origin_rejected');
});

test('issueFromErrorEvent on https pages suggests browser blocked', () => {
  assert.equal(issueFromErrorEvent({}, { pageSecure: true }), 'browser_blocked');
  assert.equal(issueFromErrorEvent({}, { pageSecure: false }), 'relay_missing');
});

test('browserBlockedHint mentions Safari mixed content', () => {
  assert.match(browserBlockedHint('safari'), /Safari/i);
});

test('isWebKitLoopbackPairingBrowser: iOS (all engines) and desktop Safari', () => {
  assert.equal(isWebKitLoopbackPairingBrowser(UA.macSafari18), true);
  assert.equal(isWebKitLoopbackPairingBrowser(UA.iosSafari), true);
  assert.equal(isWebKitLoopbackPairingBrowser(UA.iosChrome), true);
  assert.equal(isWebKitLoopbackPairingBrowser(UA.desktopChrome), false);
  assert.equal(isWebKitLoopbackPairingBrowser(UA.edge), false);
  assert.equal(isWebKitLoopbackPairingBrowser(UA.firefox), false);
});

test('shouldPreemptWebKitHttpsPairing on https prod, not on local dev', () => {
  assert.equal(shouldPreemptWebKitHttpsPairing({
    protocol: 'https:',
    hostname: 'surfcad.com',
    userAgent: UA.macSafari18,
  }), true);
  assert.equal(shouldPreemptWebKitHttpsPairing({
    protocol: 'https:',
    hostname: 'surfcad.com',
    userAgent: UA.desktopChrome,
  }), false);
  assert.equal(shouldPreemptWebKitHttpsPairing({
    protocol: 'https:',
    hostname: 'localhost',
    userAgent: UA.macSafari18,
  }), false);
  assert.equal(shouldPreemptWebKitHttpsPairing({
    protocol: 'http:',
    hostname: '127.0.0.1',
    userAgent: UA.iosSafari,
  }), false);
});
