import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'vite.config.js'), 'utf8');
const AGENT_KEY = '^/agent(/|\\?|$)';

test('vite dev proxies /agent to the backend and leaves /agentx on the SPA', () => {
  assert.ok(config.server.proxy[AGENT_KEY]);
  assert.equal(config.server.proxy[AGENT_KEY].ws, true);
  assert.equal(config.server.proxy[AGENT_KEY].target, 'http://localhost:3000');
  assert.equal(config.server.proxy[AGENT_KEY].changeOrigin, true);
  const re = new RegExp(AGENT_KEY);
  assert.equal(re.test('/agent'), true);
  assert.equal(re.test('/agent/'), true);
  assert.equal(re.test('/agent?code=1'), true);
  assert.equal(re.test('/agentx'), false);
  assert.equal(re.test('/agents'), false);
  assert.equal(re.test('/api/agent'), false);
  assert.match(src, /'\^\/agent\(\/\|\\\\\?\|\$\)'/);
});

test('vite preview does not proxy /agent', () => {
  assert.ok(config.preview.proxy['/api']);
  assert.equal(config.preview.proxy[AGENT_KEY], undefined);
  assert.equal(Object.keys(config.preview.proxy).some((key) => key.includes('agent')), false);
});
