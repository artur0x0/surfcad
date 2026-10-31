import assert from 'node:assert/strict';
import test from 'node:test';
import { MOLD_NEUTRAL_DEG, MOLD_REGION_NORMAL_DEG, analyzePullDirection } from './pullDirection.js';
import { PARTING_CLUSTER_DEG, PARTING_NEUTRAL_DEG, partingLegendModel, triangleRole } from './parting.js';

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

test('the parting band matches the pull scorer', () => {
  assert.equal(PARTING_NEUTRAL_DEG, MOLD_NEUTRAL_DEG);
  assert.equal(PARTING_CLUSTER_DEG, MOLD_REGION_NORMAL_DEG);
  assert.equal(triangleRole([0, 0, 1], [0, 0, 1]), 'cavity');
  assert.equal(triangleRole([0, 0, -1], [0, 0, 1]), 'core');
  assert.equal(triangleRole([1, 0, 0], [0, 0, 1]), 'parting');
});

test('a box along +Z splits into cavity, core, and two parting loops', () => {
  const result = analyzePullDirection({ ...boxMesh([0, 0, 0], [10, 10, 10]), pull: [0, 0, 1] });
  const parting = result.parting;
  assert.equal(parting.counts.cavity, 1);
  assert.equal(parting.counts.core, 1);
  assert.equal(parting.counts.parting, 4);
  assert.equal(parting.faces.find((face) => face.role === 'cavity').area, 100);
  assert.equal(parting.faces.find((face) => face.role === 'core').area, 100);
  assert.equal(parting.lines.length, 2);
  assert.ok(parting.lines.every((line) => line.closed && line.name == null));
  assert.ok(parting.lines.every((line) => Math.abs(line.length - 40) < 1e-6));
  const legend = partingLegendModel(parting);
  assert.deepEqual(legend.rows.map((row) => row.label), ['Cavity', 'Core', 'Parting']);
  assert.equal(legend.lineCount, 2);
});

test('reversing the pull swaps core and cavity', () => {
  const up = analyzePullDirection({ ...boxMesh([0, 0, 0], [10, 10, 10]), pull: [0, 0, 1] });
  const down = analyzePullDirection({ ...boxMesh([0, 0, 0], [10, 10, 10]), pull: [0, 0, -1] });
  assert.equal(up.parting.counts.cavity, down.parting.counts.core);
  assert.equal(up.parting.counts.core, down.parting.counts.cavity);
  const upCavity = up.parting.triangles.filter((row) => row.role === 'cavity').map((row) => row.index).sort();
  const downCore = down.parting.triangles.filter((row) => row.role === 'core').map((row) => row.index).sort();
  assert.deepEqual(upCavity, downCore);
});
