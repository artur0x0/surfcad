import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'vite.config.js'), 'utf8');

test('vite proxies /agent to the backend and leaves /agentx on the SPA', () => {
  assert.match(src, /'\^\/agent\(\/\|\\\\\?\|\$\)'/);
  assert.match(src, /target: 'http:\/\/localhost:3000'/);
  assert.match(src, /ws: true/);
  const re = new RegExp('^/agent(/|\\?|$)');
  assert.equal(re.test('/agent'), true);
  assert.equal(re.test('/agent/'), true);
  assert.equal(re.test('/agent?code=1'), true);
  assert.equal(re.test('/agentx'), false);
  assert.equal(re.test('/agents'), false);
  assert.equal(re.test('/api/agent'), false);
});
