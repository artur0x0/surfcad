import assert from 'node:assert/strict';
import test from 'node:test';
import { GREY, viridis } from '../fea/colormap.js';
import { thicknessLegendModel, thicknessRampT, thicknessRgb } from './thicknessColor.js';

const scale = { nominal: 2, thinRatio: 0.6, thickRatio: 1.5 };

test('the ramp puts thin, nominal, and thick on 0, 0.5, and 1', () => {
  assert.equal(thicknessRampT(2 * 0.6, scale), 0);
  assert.equal(thicknessRampT(2, scale), 0.5);
  assert.equal(thicknessRampT(2 * 1.5, scale), 1);
  assert.equal(thicknessRampT(0.4, scale), 0);
  assert.equal(thicknessRampT(8, scale), 1);
  assert.ok(Math.abs(thicknessRampT(1.6, scale) - 0.25) < 1e-9);
  assert.equal(thicknessRampT(null, scale), null);
});

test('colours are viridis at those stops and grey when the sample is missing', () => {
  const thin = thicknessRgb(1.2, scale);
  const nominal = thicknessRgb(2, scale);
  const thick = thicknessRgb(3, scale);
  const missing = thicknessRgb(null, scale);
  assert.deepEqual(thin, viridis(0));
  assert.deepEqual(nominal, viridis(0.5));
  assert.deepEqual(thick, viridis(1));
  assert.deepEqual(missing, [GREY[0], GREY[1], GREY[2]]);
  assert.notDeepEqual(thin, nominal);
  assert.notDeepEqual(nominal, thick);
});

test('the legend runs thin, nominal, thick', () => {
  const legend = thicknessLegendModel({
    nominal: 2,
    max: 8,
    thresholds: { thinRatio: 0.6, thickRatio: 1.5 },
  });
  assert.deepEqual(legend.stops.map((stop) => stop.label), ['Thin', 'Nominal', 'Thick']);
  assert.equal(legend.thinMm, 1.2);
  assert.equal(legend.nominalMm, 2);
  assert.equal(legend.thickMm, 3);
  assert.match(legend.css, /^linear-gradient\(90deg, /);
  assert.match(legend.css, /0%, .*50%, .*100%\)$/);
  assert.equal(thicknessLegendModel({ nominal: null }), null);
});
