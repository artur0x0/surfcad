import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { buildSolidGeometry } from '../utils/partSolidCache.js';
import { moldFitFromGeometry } from './fromGeometry.js';

test('a stamped cube through the viewport mesh is a good fit along +Z', { timeout: 60_000 }, async () => {
  const ran = await runScript('let part = Manifold.cube([20, 10, 5], true); return part;');
  assert.equal(ran.status, 'NoError', ran.status);
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  ran.manifold?.delete?.();
  const result = moldFitFromGeometry(geometry, faceIDs);
  assert.equal(result.error, undefined);
  assert.equal(result.fit, 'good');
  assert.equal(result.undercutCount, 0);
  assert.deepEqual(result.pull, [0, 0, 1]);
  assert.ok(result.normals.stamped > 0, 'cube faces are stamped');
  assert.equal(result.normals.triangle, 0);
  assert.equal(result.wall.nominalMethod, 'mode');
  assert.ok(Math.abs(result.wall.nominal - 5) < 1e-3, `nominal ${result.wall.nominal}`);
  assert.ok(Math.abs(result.wall.max - 5) < 1e-3, `max ${result.wall.max}`);
  const byRole = Object.fromEntries(result.parting.faces.map((face) => [face.name, face.role]));
  const roleOf = (suffix) => byRole[Object.keys(byRole).find((name) => name.endsWith(`.${suffix}`))];
  assert.equal(roleOf('top'), 'core');
  assert.equal(roleOf('bottom'), 'cavity');
  for (const side of ['left', 'right', 'front', 'back']) assert.equal(roleOf(side), 'cavity');
  assert.equal(result.parting.lines.length, 1);
  const names = result.parting.lines[0].edgeNames;
  assert.ok(names.length >= 4);
  assert.ok(names.every((name) => /(\.top~|\.bottom~|~[^.]*\.top|~[^.]*\.bottom)/.test(name)));
  assert.ok(names.every((name) => !/\.(left|right|front|back)~.*\.(left|right|front|back)/.test(name)));
});

test('the refined wall paints at cell resolution across a triangle that spans two walls', { timeout: 60_000 }, async () => {
  // A 40 × 20 × 5 block with a 3 mm deep pocket under its left half: the top
  // face is two triangles, each spanning a 2 mm wall on the left and 5 mm of
  // solid on the right. The per-triangle reading stays the smallest stable
  // ray (2), and the cells show each half as it is.
  const ran = await runScript(
    'let part = Manifold.cube([40, 20, 5], true).subtract(Manifold.cube([20, 20, 3], true).translate([-10, 0, -1])); return part;',
  );
  assert.equal(ran.status, 'NoError', ran.status);
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  ran.manifold?.delete?.();
  const result = moldFitFromGeometry(geometry, faceIDs, { pull: [0, 0, 1], wallOnly: true });
  const wall = result.wall;
  assert.ok(Math.abs(wall.nominal - 2) < 0.05, `nominal ${wall.nominal}`);
  assert.ok(Math.abs(wall.probeSpacingMm - 0.8) < 1e-6, `spacing ${wall.probeSpacingMm}`);
  const pos = geometry.attributes.position.array;
  const idx = geometry.index.array;
  const topTriangles = [];
  for (let t = 0; t < idx.length / 3; t++) {
    const zs = [0, 1, 2].map((k) => pos[idx[3 * t + k] * 3 + 2]);
    if (zs.every((z) => Math.abs(z - 2.5) < 1e-6)) topTriangles.push(t);
  }
  assert.equal(topTriangles.length, 2, 'the top face is two triangles');
  for (const t of topTriangles) {
    assert.ok(Math.abs(wall.field[t].thickness - 2) < 0.05, `top triangle ${t} reads ${wall.field[t].thickness}`);
  }
  const cells = wall.cells;
  assert.ok(cells && cells.count > 100, 'the refined pass carries cells');
  const left = [];
  const right = [];
  for (let i = 0; i < cells.count; i++) {
    if (!topTriangles.includes(cells.index[i])) continue;
    const x = (cells.positions[i * 9] + cells.positions[i * 9 + 3] + cells.positions[i * 9 + 6]) / 3;
    const mm = cells.thickness[i];
    if (x < -3) {
      left.push(mm);
      assert.ok(mm < 3, `left cell at x ${x.toFixed(1)} reads ${mm}`);
    } else if (x > 6) {
      right.push(mm);
      // The block's own edge band may read the largest sphere in reach, never the 2 mm wall.
      assert.ok(mm > 3, `right cell at x ${x.toFixed(1)} reads ${mm}`);
    }
  }
  const median = (v) => v.slice().sort((p, q) => p - q)[Math.floor(v.length / 2)];
  assert.ok(left.length > 50 && right.length > 50, `cells left ${left.length} right ${right.length}`);
  assert.ok(Math.abs(median(left) - 2) < 0.1, `left median ${median(left)}`);
  assert.ok(Math.abs(median(right) - 5) < 0.1, `right median ${median(right)}`);
});
