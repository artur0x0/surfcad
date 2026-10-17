import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { fingerprintsFromGeometry } from './facePaint.js';
import { fitJointAxis } from './jointResolve.js';
import { buildSolidGeometry } from './partSolidCache.js';

async function patchesOf(source) {
  const run = await runScript(source);
  assert.ok(run.mesh, `script failed: ${run.error || 'no mesh'}`);
  const solid = buildSolidGeometry(run.mesh);
  run.manifold?.delete?.();
  const faces = fingerprintsFromGeometry(solid.geometry, solid.faceIDs);
  const positions = solid.geometry.attributes.position.array;
  const indices = solid.geometry.index.array;
  return faces.map((face) => ({ ...face, axis: fitJointAxis(positions, indices, face.tris) }));
}

test('a tall thin pin wall is one face, not one face per facet', { timeout: 60_000 }, async () => {
  // Each side quad is ~19% of the cap area, over the flat-lock area gate.
  const faces = await patchesOf('return Manifold.cylinder(30, 5, 5, 64, false);\n');
  assert.equal(faces.length, 3);
  const walls = faces.filter((face) => face.axis);
  assert.equal(walls.length, 1);
  assert.ok(Math.abs(walls[0].axis.radius - 5) < 0.1);
  assert.equal(faces.filter((face) => face.kind === 'planar').length, 2);
});

test('a horizontal pin wall is one face', { timeout: 60_000 }, async () => {
  const faces = await patchesOf('return Manifold.cylinder(20, 4, 4, 48).rotate([0, 90, 0]);\n');
  assert.equal(faces.length, 3);
  assert.equal(faces.filter((face) => face.axis).length, 1);
});

test('real prism sides and box faces stay separate flats', { timeout: 60_000 }, async () => {
  const octagon = await patchesOf('return Manifold.cylinder(30, 5, 5, 8, false);\n');
  assert.equal(octagon.length, 10);
  assert.ok(octagon.every((face) => face.kind === 'planar'));
  const hexagon = await patchesOf('return Manifold.cylinder(30, 5, 5, 6, false);\n');
  assert.equal(hexagon.length, 8);
  const box = await patchesOf('return Manifold.cube([10, 10, 60], true);\n');
  assert.equal(box.length, 6);
  assert.ok(box.every((face) => face.kind === 'planar'));
});
