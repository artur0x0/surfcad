import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { helperCommandName } from '../helperPaletteAgent.js';
import { invokeHelperCommand } from './invokeHelper.js';

function host(overrides = {}) {
  return {
    getScript: () => '',
    setEditor: () => {},
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory: () => {},
    execute: async () => ({ ok: true, errors: [], volume: 1, bbox: null, partName: '' }),
    prepareHelperInsert({ helperId }) {
      if (helperId === 'cube') return { source: 'let part = Manifold.cube([1,1,1], true);\nreturn part;\n' };
      return { error: { code: 'insert_failed', message: 'nope' } };
    },
    ...overrides,
  };
}

test('invoke_helper refuses unknown id', async () => {
  const api = createSurfcadBridge({ resolve: () => host() });
  const env = await api.call('invoke_helper', { id: 'not_a_helper' });
  assert.equal(env.ok, false);
  assert.equal(env.error.code, 'unknown_helper');
});

test('invoke_helper inserts and mutates', async () => {
  let wrote = '';
  const h = host({
    setEditor(src) { wrote = src; },
    prepareHelperInsert() {
      return { source: 'let part = Manifold.cube([10,10,10], true);\nreturn part;\n' };
    },
  });
  const api = createSurfcadBridge({ resolve: () => h });
  const env = await api.call('invoke_helper', { id: 'cube', params: {} });
  assert.equal(env.ok, true);
  assert.equal(env.result?.helperId, 'cube');
  assert.match(wrote, /Manifold\.cube/);
});

test('insert_cube alias is registered', () => {
  assert.equal(helperCommandName('cube'), 'insert_cube');
  assert.equal(invokeHelperCommand.name, 'invoke_helper');
});
