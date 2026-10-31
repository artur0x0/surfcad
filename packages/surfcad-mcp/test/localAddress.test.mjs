import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedHttpOrigin, isLoopbackAddress } from '../src/bridge/localAddress.mjs';

test('loopback remote addresses are accepted', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.0.0.2'), true);
  assert.equal(isLoopbackAddress('10.0.0.1'), false);
  assert.equal(isLoopbackAddress('127.evil.com'), false);
  assert.equal(isLoopbackAddress('127.0.0.1.attacker.com'), false);
});

test('origin allowlist: prod surfcad, local dev, and missing Origin', () => {
  assert.equal(isAllowedHttpOrigin(undefined), true);
  assert.equal(isAllowedHttpOrigin('https://surfcad.com'), true);
  assert.equal(isAllowedHttpOrigin('https://www.surfcad.com'), true);
  assert.equal(isAllowedHttpOrigin('http://127.0.0.1:5173'), true);
  assert.equal(isAllowedHttpOrigin('http://127.0.0.1'), true);
  assert.equal(isAllowedHttpOrigin('http://localhost:4173'), true);
  assert.equal(isAllowedHttpOrigin('http://localhost'), true);
  assert.equal(isAllowedHttpOrigin('http://[::1]'), true);
  assert.equal(isAllowedHttpOrigin('http://[::1]:5173'), true);
  assert.equal(isAllowedHttpOrigin('https://evil.example'), false);
  assert.equal(isAllowedHttpOrigin('http://127.evil.com'), false);
  assert.equal(isAllowedHttpOrigin('http://127.0.0.1.attacker.com'), false);
  assert.equal(isAllowedHttpOrigin('https://127.evil.com'), false);
});
