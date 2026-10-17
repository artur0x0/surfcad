import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('createInlineExecutor is removed so main-thread new Function is gone', () => {
  const src = readFileSync(new URL('./scriptExecutor.js', import.meta.url), 'utf8');
  assert.equal(/export const createInlineExecutor/.test(src), false);
  assert.equal(src.includes('new Function'), false);
});
