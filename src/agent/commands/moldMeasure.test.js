import assert from 'node:assert/strict';
import test from 'node:test';
import { moldMeasureCommand } from './moldMeasure.js';

test('mold_measure forwards on and unit and returns the measurements', async () => {
  const seen = [];
  const ctx = {
    moldMeasure: ({ on, unit }) => {
      seen.push([on, unit]);
      return Promise.resolve({ on: true, unit: 'cm', volumeCm3: 1, projectedAreaMm2: 200, extentsMm: [20, 10, 5], display: { volume: '1 cm³' } });
    },
  };
  const out = await moldMeasureCommand.run(ctx, { on: true, unit: 'cm' });
  assert.deepEqual(seen, [[true, 'cm']]);
  assert.equal(out.result.on, true);
  assert.equal(out.result.unit, 'cm');
  assert.equal(out.result.volumeCm3, 1);
  assert.equal(out.result.display.volume, '1 cm³');
});

test('mold_measure toggles when on is omitted, rejects a bad unit, and reports a missing handler', async () => {
  const seen = [];
  const ctx = {
    moldMeasure: ({ on, unit }) => {
      seen.push([on, unit]);
      return { on: false };
    },
  };
  const toggled = await moldMeasureCommand.run(ctx, {});
  assert.deepEqual(seen, [[undefined, undefined]]);
  assert.equal(toggled.result.on, false);
  assert.equal(moldMeasureCommand.checkArgs({ unit: 'mm' }).code, 'bad_args');
  assert.equal(moldMeasureCommand.checkArgs({ unit: 'in' }), null);
  assert.equal(moldMeasureCommand.checkArgs({}), null);
  const missing = await moldMeasureCommand.run({}, { on: true });
  assert.equal(missing.error.code, 'internal');
  assert.deepEqual([...moldMeasureCommand.uiEntry], ['data-mold-measure', 'data-mold-measure-unit-in', 'data-mold-measure-unit-cm']);
});
