import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feaOpenCommand, feaSetForceCommand, feaRunCommand, feaStateCommand } from './fea.js';

test('fea commands route to host handlers', async () => {
  const calls = [];
  const ctx = {
    feaOpen: async () => {
      calls.push('open');
      return { result: { open: true } };
    },
    feaSetForce: (args) => {
      calls.push(['force', args?.magnitudeN]);
      return { result: { ok: true } };
    },
    feaRun: async () => {
      calls.push('run');
      return { result: { status: 'done', maxVonMises_MPa: 12 } };
    },
    feaState: () => ({ result: { open: true, fixtureCount: 1, loadCount: 1 } }),
  };
  const open = await feaOpenCommand.run(ctx);
  assert.equal(open.result.open, true);
  feaSetForceCommand.run(ctx, { magnitudeN: 50 });
  const run = await feaRunCommand.run(ctx);
  assert.equal(run.result.status, 'done');
  assert.equal(feaStateCommand.run(ctx).result.loadCount, 1);
  assert.deepEqual(calls, ['open', ['force', 50], 'run']);
});
