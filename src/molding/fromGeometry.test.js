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
  // 10 mm faces read that wall. The 20 mm direction stays a corridor, so it is not the max.
  assert.ok(Math.abs(result.wall.max - 10) < 1e-3, `max ${result.wall.max}`);
  const byRole = Object.fromEntries(result.parting.faces.map((face) => [face.name, face.role]));
  const roleOf = (suffix) => byRole[Object.keys(byRole).find((name) => name.endsWith(`.${suffix}`))];
  assert.equal(roleOf('top'), 'cavity');
  assert.equal(roleOf('bottom'), 'core');
  for (const side of ['left', 'right', 'front', 'back']) assert.equal(roleOf(side), 'parting');
  assert.ok(result.parting.lines.length >= 8);
  assert.ok(result.parting.lines.every((line) => line.name && /(\.top~|\.bottom~|~[^.]*\.top|~[^.]*\.bottom)/.test(line.name)));
  assert.ok(result.parting.lines.every((line) => !/\.(left|right|front|back)~.*\.(left|right|front|back)/.test(line.name)));
});
