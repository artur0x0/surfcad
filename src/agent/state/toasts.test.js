import assert from 'node:assert/strict';
import test from 'node:test';
import { buildToasts } from './toasts.js';

test('buildToasts drops empty messages', () => {
  assert.deepEqual(buildToasts([
    { id: 'a', message: 'hello' },
    { id: 'b', message: '' },
  ]), {
    toasts: [{ id: 'a', kind: 'info', message: 'hello' }],
  });
});
