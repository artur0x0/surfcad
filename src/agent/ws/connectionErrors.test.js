import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browserBlockedHint,
  detectBrowserFamily,
  issueFromCloseEvent,
  issueFromErrorEvent,
  issueFromRelayMessage,
} from './connectionErrors.js';

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
