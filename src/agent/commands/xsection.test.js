import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crossSectionToggleCommand,
  crossSectionStateCommand,
  crossSectionPlaneCommand,
} from './xsection.js';

test('cross-section commands call host handlers', () => {
  const calls = [];
  const ctx = {
    crossSectionToggle: (args) => {
      calls.push(['toggle', args]);
      return { result: { enabled: true, preset: 'XY', optionsOpen: false, offset: 0 } };
    },
    crossSectionState: () => ({ result: { enabled: false } }),
    crossSectionPlane: (args) => {
      calls.push(['plane', args]);
      return { result: { enabled: true, preset: 'XZ' } };
    },
  };
  assert.equal(crossSectionToggleCommand.run(ctx, { enabled: true }).result.enabled, true);
  assert.equal(crossSectionStateCommand.run(ctx).result.enabled, false);
  assert.equal(crossSectionPlaneCommand.run(ctx, { plane: 'XZ' }).result.preset, 'XZ');
  assert.deepEqual(calls, [['toggle', { enabled: true }], ['plane', { plane: 'XZ' }]]);
});
