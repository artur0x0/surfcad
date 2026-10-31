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
});
