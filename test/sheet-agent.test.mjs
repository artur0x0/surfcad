import assert from 'node:assert/strict';
import test from 'node:test';
import { sheetParamsFromArgs, sheetPickRowsFromArgs, sheetToolFromArgs } from '../src/agent/sheetAgent.js';

test('sheetToolFromArgs accepts bend', () => {
  assert.deepEqual(sheetToolFromArgs({ tool: 'bend' }), { tool: 'bend' });
});

test('sheetParamsFromArgs maps plane and dims', () => {
  const out = sheetParamsFromArgs({ plane: 'XY', width: 80, angle: 90 });
  assert.equal(out.error, undefined);
  assert.deepEqual(out.patch, { plane: 'XY', width: 80, angle: 90 });
});

test('sheetPickRowsFromArgs accepts panel edge', () => {
  const out = sheetPickRowsFromArgs({ panel: 'base', edge: 'u+' });
  assert.equal(out.error, undefined);
  assert.deepEqual(out.picks, [{ kind: 'edge', panel: 'base', edge: 'u+' }]);
});
