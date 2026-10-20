import assert from 'node:assert/strict';
import test from 'node:test';
import { fitCylinderPatch } from './cylinderFit.js';

/**
 * Triangulated cylinder wall of radius r about an axis through `at` along
 * `dir`, covering `fromDeg..toDeg` only, so a cut wall can be built.
 */
function wall({ at = [0, 0, 0], dir = [0, 0, 1], r = 10, h = 20, segments = 48, fromDeg = 0, toDeg = 360 }) {
  const d = unit(dir);
  const u = unit(cross(d, Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const v = cross(d, u);
  const positions = [];
  const indices = [];
  const steps = Math.max(1, Math.round((toDeg - fromDeg) / (360 / segments)));
  for (let i = 0; i <= steps; i += 1) {
    const a = ((fromDeg + (i * (toDeg - fromDeg)) / steps) * Math.PI) / 180;
    const c = Math.cos(a) * r;
    const s = Math.sin(a) * r;
    for (const z of [-h / 2, h / 2]) {
      positions.push(
        at[0] + u[0] * c + v[0] * s + d[0] * z,
        at[1] + u[1] * c + v[1] * s + d[1] * z,
        at[2] + u[2] * c + v[2] * s + d[2] * z,
      );
    }
  }
  for (let i = 0; i < steps; i += 1) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const tris = Array.from({ length: indices.length / 3 }, (_, i) => i);
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), tris };
}

function unit(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function axisDistance(point, at, dir) {
  const d = [point[0] - at[0], point[1] - at[1], point[2] - at[2]];
  const along = d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2];
  return Math.hypot(d[0] - dir[0] * along, d[1] - dir[1] * along, d[2] - dir[2] * along);
}

test('a full 48-segment wall fits its radius and axis', () => {
  const w = wall({ at: [5, -3, 2], r: 12.5 });
  const fit = fitCylinderPatch(w.positions, w.indices, w.tris);
  assert.ok(fit);
  assert.ok(Math.abs(fit.radius - 12.5) < 1e-3, `radius ${fit.radius}`);
  assert.ok(Math.abs(Math.abs(fit.dir[2]) - 1) < 1e-6);
  assert.ok(axisDistance(fit.at, [5, -3, 2], [0, 0, 1]) < 1e-3);
});

test('a 300 mm wall with only a 100 degree arc left still lands on the true axis', () => {
  const w = wall({ at: [0, 0, 350], dir: [0, 1, 0], r: 300, h: 25, segments: 128, fromDeg: 40, toDeg: 140 });
  const fit = fitCylinderPatch(w.positions, w.indices, w.tris);
  assert.ok(fit);
  assert.ok(Math.abs(fit.radius - 300) < 0.05, `radius ${fit.radius}`);
  assert.ok(axisDistance(fit.at, [0, 0, 350], [0, 1, 0]) < 0.1, `axis off by ${axisDistance(fit.at, [0, 0, 350], [0, 1, 0])}`);
  assert.ok(Math.abs(Math.abs(fit.dir[1]) - 1) < 1e-6);
});

test('a tilted 24-segment wall fits', () => {
  const dir = unit([-0.309, 0, 0.951]);
  const w = wall({ at: [830, 0, 700], dir, r: 14.3, h: 200, segments: 24 });
  const fit = fitCylinderPatch(w.positions, w.indices, w.tris);
  assert.ok(fit);
  assert.ok(Math.abs(fit.radius - 14.3) < 1e-2, `radius ${fit.radius}`);
  assert.ok(Math.abs(Math.abs(fit.dir[0] * dir[0] + fit.dir[1] * dir[1] + fit.dir[2] * dir[2]) - 1) < 1e-6);
  assert.ok(axisDistance(fit.at, [830, 0, 700], dir) < 1e-2);
});

test('a flat quad and a single facet do not fit', () => {
  const flat = {
    positions: Float32Array.from([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 5, 5, 0, 2, 8, 0]),
    indices: Uint32Array.from([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4, 3, 4, 5, 5, 4, 0]),
  };
  assert.equal(fitCylinderPatch(flat.positions, flat.indices, [0, 1, 2, 3, 4, 5]), null);
  const facet = wall({ r: 10, segments: 48, fromDeg: 0, toDeg: 7.5 });
  assert.equal(fitCylinderPatch(facet.positions, facet.indices, facet.tris), null);
});
