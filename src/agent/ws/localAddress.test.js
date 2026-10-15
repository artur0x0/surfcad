import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedHttpOrigin, isLoopbackAddress } from './localAddress.js';

test('loopback addresses are accepted', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('192.168.1.1'), false);
});

test('only local http origins are allowed', () => {
  assert.equal(isAllowedHttpOrigin('http://127.0.0.1:5173'), true);
  assert.equal(isAllowedHttpOrigin('http://localhost:4173'), true);
  assert.equal(isAllowedHttpOrigin('https://evil.example'), false);
});
