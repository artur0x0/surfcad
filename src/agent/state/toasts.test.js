import assert from 'node:assert/strict';
import test from 'node:test';
import { buildToasts, viewportToastRows } from './toasts.js';

test('viewport toasts include the execution error the popup shows', () => {
  const rows = viewportToastRows({
    executionError: 'Hole failed: result is not a valid solid (NotManifold)',
    shellToast: { text: 'shell hint', undo: false },
  });
  assert.deepEqual(buildToasts(rows), {
    toasts: [
      {
        id: 'execution-error',
        kind: 'error',
        message: 'Hole failed: result is not a valid solid (NotManifold)',
      },
      { id: 'viewport-toast', kind: 'info', message: 'shell hint' },
    ],
  });
  assert.deepEqual(viewportToastRows({}), []);
});

test('buildToasts drops empty messages', () => {
  assert.deepEqual(buildToasts([
    { id: 'a', message: 'hello' },
    { id: 'b', message: '' },
  ]), {
    toasts: [{ id: 'a', kind: 'info', message: 'hello' }],
  });
});
