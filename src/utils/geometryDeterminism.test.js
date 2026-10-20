import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';

/**
 * Pool acceptance 7: a part's mesh must not depend on which worker built it
 * or on what that worker built before. Each pool member is a fresh module,
 * and the kernel arena frees every run's handles, so building the same
 * parts in two different orders in one module must give identical meshes.
 */

const PARTS = [
  'let part = Manifold.cube([40, 20, 10], true);\nfor (let i = 0; i < 6; i++) part = part.subtract(Manifold.cylinder(20, 2, 2, 24).translate([-15 + i * 6, 0, -10]));\nreturn part;',
  'let part = Manifold.cylinder(30, 15, 15, 96);\npart = part.add(Manifold.cylinder(10, 20, 20, 96).translate([0, 0, 30]));\nreturn part;',
  'let part = Manifold.sphere(12, 48);\npart = part.subtract(Manifold.cube([30, 4, 4], true));\nreturn part;',
  'let part = Manifold.cube([10, 10, 10], true);\nfor (let i = 1; i <= 5; i++) part = part.add(Manifold.cube([10, 10, 10], true).translate([i * 25, 0, 0]));\nreturn part;',
  'let part = Manifold.cube([20, 20, 20], true);\npart = part.add(Manifold.cube([20, 20, 20], true).translate([12, 12, 0]).rotate([0, 0, 30]), { merge: false });\nfor (let i = 0; i < 8; i++) part = part.add(Manifold.cylinder(4, 3, 3, 24).translate([80 + i * 10, 0, 0]));\nreturn part;',
  'let part = Manifold.cylinder(50, 6, 6, 64).rotate([90, 0, 0]);\npart = part.add(Manifold.cylinder(50, 6, 6, 64).rotate([0, 90, 0]));\npart = part.add(Manifold.cylinder(50, 6, 6, 64));\nreturn part;',
];

const fingerprint = (ran) => ({ tris: ran.tris, volume: Number(ran.volume.toFixed(6)), bodies: ran.bodyCount, runs: ran.mesh.numRun });

test('the same parts built in two orders give identical meshes', async () => {
  const forward = [];
  for (const src of PARTS) {
    const ran = await runScript(src);
    assert.equal(ran.status, 'NoError');
    forward.push(fingerprint(ran));
    ran.manifold.delete();
  }
  const reversed = [];
  for (const src of [...PARTS].reverse()) {
    const ran = await runScript(src);
    reversed.push(fingerprint(ran));
    ran.manifold.delete();
  }
  reversed.reverse();
  assert.deepEqual(reversed, forward);
  // And a third time, interleaved with a heavier neighbour.
  const again = [];
  for (const src of PARTS) {
    const heavy = await runScript('let part = Manifold.sphere(20, 128);\nreturn part;');
    heavy.manifold.delete();
    const ran = await runScript(src);
    again.push(fingerprint(ran));
    ran.manifold.delete();
  }
  assert.deepEqual(again, forward);
});
