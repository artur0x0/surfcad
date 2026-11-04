import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MEASURE_UNIT,
  MEASURE_UNIT_KEY,
  loadMeasureUnit,
  measureLegendModel,
  measurePart,
  measurePayload,
  normalizeMeasureUnit,
  pullLabel,
  saveMeasureUnit,
} from './measure.js';

function boxMesh(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const positions = [
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ];
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    1, 2, 6, 1, 6, 5,
    0, 4, 7, 0, 7, 3,
    3, 7, 6, 3, 6, 2,
    0, 1, 5, 0, 5, 4,
  ];
  return { positions, indices };
}

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

test('a 20 × 10 × 5 block measures its volume, silhouette along the pull, and extents', () => {
  const measure = measurePart(boxMesh([0, 0, 0], [20, 10, 5]), [0, 0, 1]);
  assert.equal(measure.volumeCm3, 1);
  assert.equal(measure.projectedAreaMm2, 200);
  assert.deepEqual(measure.extentsMm, [20, 10, 5]);
  assert.deepEqual(measure.pull, [0, 0, 1]);
  const alongX = measurePart(boxMesh([0, 0, 0], [20, 10, 5]), [1, 0, 0]);
  assert.equal(alongX.projectedAreaMm2, 50);
  const fallback = measurePart(boxMesh([0, 0, 0], [20, 10, 5]), null);
  assert.deepEqual(fallback.pull, [0, 0, 1]);
  assert.equal(measurePart({ positions: [] }), null);
  assert.equal(measurePart({}), null);
});

test('the legend speaks inches by default and centimetres on request', () => {
  const measure = measurePart(boxMesh([0, 0, 0], [25.4, 25.4, 25.4]), [0, 0, 1]);
  const inches = measureLegendModel(measure);
  assert.equal(inches.unit, 'in');
  assert.equal(inches.volume, '1 in³');
  assert.equal(inches.area, '1 in²');
  assert.equal(inches.extents, '1 × 1 × 1 in');
  assert.equal(inches.pull, '+Z');
  const cm = measureLegendModel(measure, 'cm');
  assert.equal(cm.unit, 'cm');
  assert.equal(cm.volume, '16.3871 cm³');
  assert.equal(cm.area, '6.4516 cm²');
  assert.equal(cm.extents, '2.54 × 2.54 × 2.54 cm');
  assert.equal(measureLegendModel(null), null);
  assert.deepEqual(measureLegendModel(measure, 'furlong').unit, 'in');
});

test('the agent payload carries the mm numbers and the display strings', () => {
  const measure = measurePart(boxMesh([0, 0, 0], [20, 10, 5]), [0, -1, 0]);
  const payload = measurePayload(measure, 'cm');
  assert.equal(payload.on, true);
  assert.equal(payload.unit, 'cm');
  assert.equal(payload.volumeCm3, 1);
  assert.equal(payload.projectedAreaMm2, 100);
  assert.deepEqual(payload.extentsMm, [20, 10, 5]);
  assert.equal(payload.display.volume, '1 cm³');
  assert.equal(payload.display.area, '1 cm²');
  assert.equal(payload.display.extents, '2 × 1 × 0.5 cm');
  assert.equal(pullLabel([0, -1, 0]), '−Y');
  assert.equal(pullLabel([0.6, 0, 0.8]), '[0.6, 0, 0.8]');
  assert.deepEqual(measurePayload(null), { on: false });
});

test('the unit is inches until saved, then remembered, and unknown units fall back', () => {
  const storage = memoryStorage();
  assert.equal(DEFAULT_MEASURE_UNIT, 'in');
  assert.equal(loadMeasureUnit(storage), 'in');
  assert.equal(saveMeasureUnit('cm', storage), 'cm');
  assert.equal(storage.getItem(MEASURE_UNIT_KEY), 'cm');
  assert.equal(loadMeasureUnit(storage), 'cm');
  assert.equal(saveMeasureUnit('mm', storage), 'in');
  assert.equal(normalizeMeasureUnit(undefined), 'in');
  assert.equal(normalizeMeasureUnit('cm'), 'cm');
});
