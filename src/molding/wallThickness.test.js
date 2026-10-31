import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePullDirection } from './pullDirection.js';
import { nominalWallFromSamples } from './wallThickness.js';

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

function appendMesh(dstPos, dstIdx, src) {
  const base = dstPos.length / 3;
  for (let i = 0; i < src.positions.length; i++) dstPos.push(src.positions[i]);
  for (let t = 0; t < src.indices.length; t++) dstIdx.push(src.indices[t] + base);
}

function flipIndices(indices) {
  const out = indices.slice();
  for (let t = 0; t < out.length; t += 3) {
    const b = out[t + 1];
    out[t + 1] = out[t + 2];
    out[t + 2] = b;
  }
  return out;
}

/** Closed shell, outer 0..20, wall 2 mm. Inner faces point into the cavity. */
function uniformShell() {
  const positions = [];
  const indices = [];
  const outer = boxMesh([0, 0, 0], [20, 20, 20]);
  const inner = boxMesh([2, 2, 2], [18, 18, 18]);
  appendMesh(positions, indices, outer);
  appendMesh(positions, indices, { positions: inner.positions, indices: flipIndices(inner.indices) });
  return { positions, indices };
}

function withPart(shell, part) {
  const positions = shell.positions.slice();
  const indices = shell.indices.slice();
  appendMesh(positions, indices, part);
  return { positions, indices };
}

/**
 * 4×8×4 boss in the cavity. Faces read 4 mm or 8 mm, both above 1.5× a 2 mm wall.
 * The shell's inward rays hit the shell, not the boss.
 */
function thickBoss() {
  return withPart(uniformShell(), boxMesh([8, 8, 8], [12, 16, 12]));
}

/**
 * 0.8×2.5×2.5 rib in the cavity. The 0.8 mm faces are thin against a 2 mm wall.
 * The 2.5 mm end faces stay inside the nominal band (2.5 < 1.5×2).
 */
function thinRib() {
  return withPart(uniformShell(), boxMesh([10, 9, 9], [10.8, 11.5, 11.5]));
}

function near(actual, expected, eps = 1e-3) {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `expected ${expected}, got ${actual}`,
  );
}

function score(mesh, wall) {
  return analyzePullDirection({ ...mesh, pull: [0, 0, 1], wall });
}

test('nominal is the mode when one thickness dominates, else the band median', () => {
  const mode = nominalWallFromSamples([
    { thickness: 2, area: 100 },
    { thickness: 8, area: 5 },
  ]);
  assert.equal(mode.nominalMethod, 'mode');
  near(mode.nominal, 2);
  near(mode.max, 8);

  const spread = nominalWallFromSamples([
    { thickness: 1, area: 1 },
    { thickness: 2, area: 1 },
    { thickness: 3, area: 1 },
    { thickness: 4, area: 1 },
    { thickness: 5, area: 1 },
  ]);
  assert.equal(spread.nominalMethod, 'median');
  near(spread.nominal, 3);
  near(spread.median, 3);

  const empty = nominalWallFromSamples([]);
  assert.equal(empty.nominal, null);
  assert.equal(empty.nominalMethod, null);
});

test('a uniform-wall shell reports that wall as nominal and max', () => {
  const result = score(uniformShell());
  assert.equal(result.kind, 'mold-analysis');
  assert.equal(result.version, 1);
  assert.equal(result.fit === 'good' || result.fit === 'fixable' || result.fit === 'not_a_fit', true);
  const wall = result.wall;
  assert.equal(wall.nominalMethod, 'mode');
  near(wall.nominal, 2);
  near(wall.max, 2);
  near(wall.min, 2);
  near(wall.mean, 2);
  near(wall.median, 2);
  assert.equal(wall.sampleCount, 24);
  assert.equal(wall.thinCount, 0);
  assert.equal(wall.thickCount, 0);
  assert.equal(wall.thresholds.thinRatio, 0.6);
  assert.equal(wall.thresholds.thickRatio, 1.5);
  assert.equal(wall.field.length, 24);
  for (const sample of wall.field) {
    assert.equal(sample.flag, 'nominal');
    near(sample.thickness, 2);
  }
});

test('a thick boss stays off the nominal and is flagged thick', () => {
  const result = score(thickBoss());
  const wall = result.wall;
  assert.equal(wall.nominalMethod, 'mode');
  near(wall.nominal, 2);
  near(wall.max, 8);
  near(wall.min, 2);
  assert.equal(wall.thinCount, 0);
  assert.ok(wall.thickCount >= 1);
  assert.ok(wall.thickArea > 0);
  const shell = wall.field.slice(0, 24);
  const boss = wall.field.slice(24);
  assert.equal(boss.length, 12);
  for (const sample of shell) {
    assert.equal(sample.flag, 'nominal');
    near(sample.thickness, 2);
  }
  for (const sample of boss) {
    assert.equal(sample.flag, 'thick');
    assert.ok(sample.thickness > wall.nominal * wall.thresholds.thickRatio);
  }
  const yFaces = [24 + 8, 24 + 9, 24 + 10, 24 + 11];
  for (const index of yFaces) near(wall.field[index].thickness, 8);
});

test('a thin rib is flagged thin and does not move nominal', () => {
  const result = score(thinRib());
  const wall = result.wall;
  assert.equal(wall.nominalMethod, 'mode');
  near(wall.nominal, 2);
  near(wall.min, 0.8);
  assert.equal(wall.thickCount, 0);
  assert.equal(wall.thinCount, 2);
  for (const region of wall.thin) near(region.thickness, 0.8);
  const thinFaces = [24 + 4, 24 + 5, 24 + 6, 24 + 7];
  for (const index of thinFaces) {
    assert.equal(wall.field[index].flag, 'thin');
    near(wall.field[index].thickness, 0.8);
  }
  for (const sample of wall.field.slice(0, 24)) {
    assert.equal(sample.flag, 'nominal');
    near(sample.thickness, 2);
  }
});

test('raising a threshold clears the boss and the rib', () => {
  const boss = score(thickBoss(), { thickRatio: 10 }).wall;
  near(boss.nominal, 2);
  near(boss.max, 8);
  assert.equal(boss.thickCount, 0);
  assert.equal(boss.thresholds.thickRatio, 10);
  assert.equal(boss.field.slice(24).every((sample) => sample.flag === 'nominal'), true);

  const rib = score(thinRib(), { thinRatio: 0.3 }).wall;
  near(rib.min, 0.8);
  assert.equal(rib.thinCount, 0);
  assert.equal(rib.thresholds.thinRatio, 0.3);
  assert.equal(rib.field.some((sample) => sample.flag === 'thin'), false);
});

test('a solid cube reports its span as max wall on the mold-analysis result', () => {
  const result = analyzePullDirection(boxMesh([0, 0, 0], [10, 10, 10]));
  assert.equal(result.fit, 'good');
  assert.equal(result.kind, 'mold-analysis');
  near(result.wall.nominal, 10);
  near(result.wall.max, 10);
  assert.equal(result.wall.thinCount, 0);
  assert.equal(result.wall.thickCount, 0);
});

test('a bad wall threshold is bad_args', () => {
  const mesh = uniformShell();
  const equal = analyzePullDirection({ ...mesh, wall: { thinRatio: 1, thickRatio: 1 } });
  assert.equal(equal.error.code, 'bad_args');
  const backwards = analyzePullDirection({ ...mesh, wall: { thinRatio: 2, thickRatio: 0.5 } });
  assert.equal(backwards.error.code, 'bad_args');
});
