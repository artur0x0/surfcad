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

test('insert_move with a very large translation fails with the axis and the limit', async () => {
  let executed = 0;
  const api = createSurfcadBridge({
    resolve: () => host({
      async execute() {
        executed += 1;
        return { ok: true, errors: [], volume: 1, bbox: null, partName: '' };
      },
    }),
  });
  // The hard cap is ±1,000,000 mm (bike PR 2); 2,000,000 is beyond it.
  const env = await api.call('insert_move', { dx: 2000000, dy: 0, dz: 0 });
  assert.equal(env.ok, false);
  assert.equal(env.error.code, 'bad_args');
  assert.match(env.error.message, /Move/);
  assert.match(env.error.message, /2000000/);
  assert.match(env.error.message, /1000000/);
  assert.equal(env.error.message.includes('Feature failed'), false);
  assert.equal(executed, 0);
});

test('a refused fillet insert names the missing edge', async () => {
  const api = createSurfcadBridge({
    resolve: () => host({
      prepareHelperInsert() {
        return null;
      },
    }),
  });
  const env = await api.call('insert_fillet_edges', {});
  assert.equal(env.ok, false);
  assert.equal(env.error.code, 'insert_failed');
  assert.match(env.error.message, /Fillet/);
  assert.match(env.error.message, /selected edge/);
  assert.equal(env.error.message.includes('Feature failed'), false);
  assert.equal(env.error.message.includes('check params'), false);
});
