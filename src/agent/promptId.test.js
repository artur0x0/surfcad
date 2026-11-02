import assert from 'node:assert/strict';
import test from 'node:test';
import { newPromptId } from './promptId.js';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('newPromptId is a v4 UUID with randomUUID present', () => {
  assert.match(newPromptId(), V4);
});

test('newPromptId still makes a v4 UUID when randomUUID is missing (plain-http page)', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID')
    || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(globalThis.crypto), 'randomUUID');
  // An insecure origin has getRandomValues but no randomUUID.
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
  try {
    assert.equal(typeof globalThis.crypto.randomUUID, 'undefined');
    const a = newPromptId();
    const b = newPromptId();
    assert.match(a, V4);
    assert.match(b, V4);
    assert.notEqual(a, b);
  } finally {
    delete globalThis.crypto.randomUUID;
    if (original && !Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID')
      && typeof globalThis.crypto.randomUUID !== 'function') {
      Object.defineProperty(globalThis.crypto, 'randomUUID', original);
    }
    assert.equal(typeof globalThis.crypto.randomUUID, 'function');
  }
});
