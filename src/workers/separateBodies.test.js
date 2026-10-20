import assert from 'node:assert/strict';
import test from 'node:test';
import { getManifoldModule, runScript } from '../lib/surfcad/index.js';
import { compactRuns, meshRunCounts, runTableBloated, RUN_BLOAT_MIN } from './separateBodies.js';

/**
 * Run-table growth on multi-body parts (fastened bike, Clamps & Retainers).
 * The kernel's decompose() gives every component the parent's whole run
 * table and compose() concatenates them, so a decompose → compose per add
 * multiplied the runs by the body count on every add until the 4 GB heap
 * cap aborted the module. See the header of separateBodies.js.
 */

// Two bodies whose boxes overlap: the per-body paths are taken from here on.
const OVERLAPPING = [
  'let part = Manifold.cube([20, 20, 20], true);',
  'part = part.add(Manifold.cube([20, 20, 20], true).translate([12, 12, 0]).rotate([0, 0, 30]), { merge: false });',
].join('\n');

function disjointAdds(n) {
  const lines = [];
  for (let i = 0; i < n; i++) {
    // Far from the pair and from each other: every add is the no-touch case.
    lines.push(`part = part.add(Manifold.cylinder(4, 3, 3, 24).translate([${100 + i * 20}, 0, 0]));`);
  }
  return lines.join('\n');
}

test('a disjoint add onto overlapping bodies composes the receiver as it is: runs stay linear', async () => {
  const n = 30;
  const t0 = performance.now();
  const ran = await runScript(`${OVERLAPPING}\n${disjointAdds(n)}\nreturn part;\n`);
  const ms = performance.now() - t0;
  assert.equal(ran.status, 'NoError');
  assert.equal(ran.bodyCount, n + 2);
  // One run per source (2 cubes + n cylinders). Before: 2 · 3^n-ish.
  assert.ok(ran.mesh.numRun <= n + 2, `numRun ${ran.mesh.numRun} > ${n + 2}`);
  assert.ok(ms < 3000, `took ${ms.toFixed(0)} ms`);
  // Volume is the plain sum: nothing fused, nothing lost. A 24-gon, not a circle.
  const cyl = 12 * 9 * Math.sin(Math.PI / 12) * 4;
  const { Manifold } = getManifoldModule();
  const a = Manifold.cube([20, 20, 20], true);
  const b = Manifold.cube([20, 20, 20], true).translate([12, 12, 0]).rotate([0, 0, 30]);
  const pairVolume = a.volume() + b.volume();
  a.delete();
  b.delete();
  assert.ok(Math.abs(ran.volume - (pairVolume + n * cyl)) < 1, `volume ${ran.volume}`);
});

test('a disjoint add onto overlapping bodies keeps the mesh the plain union path produces', async () => {
  // A receiver whose bodies do not overlap takes the kernel's own add; the
  // shortcut must give the same triangles for the disjoint tool.
  const base = 'let part = Manifold.cube([20, 20, 20], true);\npart = part.add(Manifold.cube([10, 10, 10], true).translate([40, 0, 0]));\n';
  const tool = 'part = part.add(Manifold.cylinder(4, 3, 3, 24).translate([100, 0, 0]));\n';
  // The cylinder body (x ≈ 100) has the same triangles either way.
  const cylinderTris = (ran) => {
    const bodies = ran.manifold.decompose();
    const hit = bodies.find((b) => b.boundingBox().min[0] > 90);
    const n = hit.numTri();
    for (const b of bodies) b.delete();
    return n;
  };
  const plain = await runScript(`${base}${tool}return part;\n`);
  assert.equal(plain.status, 'NoError');
  assert.equal(plain.bodyCount, 3);
  const plainTris = cylinderTris(plain);
  const viaOverlap = await runScript(`${OVERLAPPING}\n${tool}return part;\n`);
  assert.equal(viaOverlap.status, 'NoError');
  assert.equal(viaOverlap.bodyCount, 3);
  assert.equal(cylinderTris(viaOverlap), plainTris);
});

test('merge: false still keeps a separate body, and a cut through the overlap still runs per body', async () => {
  const two = await runScript(`${OVERLAPPING}\nreturn part;\n`);
  assert.equal(two.bodyCount, 2);
  // A cylinder through the overlap region: the plain boolean would fuse the
  // two bodies into one; the per-body cut keeps two.
  const cut = await runScript(`${OVERLAPPING}\npart = part.subtract(Manifold.cylinder(60, 3, 3, 24).translate([6, 6, -30]));\nreturn part;\n`);
  assert.equal(cut.status, 'NoError');
  assert.equal(cut.bodyCount, 2);
  assert.ok(cut.volume < two.volume);
});

test('a touched add still unions with the body it reaches and leaves the other alone', async () => {
  // The tool overlaps the first cube only (far side from the second).
  const src = `${OVERLAPPING}\npart = part.add(Manifold.cube([10, 10, 10], true).translate([-12, -8, 0]));\nreturn part;\n`;
  const ran = await runScript(src);
  assert.equal(ran.status, 'NoError');
  assert.equal(ran.bodyCount, 2);
});

test('runTableBloated: only a big, mostly empty table', () => {
  assert.equal(runTableBloated({ runs: 3, used: 1 }), false);
  assert.equal(runTableBloated({ runs: RUN_BLOAT_MIN, used: RUN_BLOAT_MIN / 4 }), true);
  assert.equal(runTableBloated({ runs: RUN_BLOAT_MIN, used: RUN_BLOAT_MIN / 4 + 1 }), false);
  assert.equal(runTableBloated({ runs: RUN_BLOAT_MIN - 1, used: 1 }), false);
});

test('compactRuns keeps originalIDs, triangles, and volume; the bloat guard bounds a decompose/compose loop', async () => {
  await runScript('return Manifold.cube([1, 1, 1]);');
  const M = getManifoldModule();
  const { Manifold } = M;
  let m = Manifold.compose([
    Manifold.cube([1, 1, 1]),
    Manifold.cube([1, 1, 1]).translate([3, 0, 0]),
    Manifold.cube([1, 1, 1]).translate([6, 0, 0]),
  ]);
  const ids0 = Array.from(m.getMesh().runOriginalID).sort();
  // Forced compaction on a decomposed copy: same ids, same triangles, same volume.
  const [first] = m.decompose();
  const before = meshRunCounts(first.getMesh());
  assert.equal(before.runs, 3);
  assert.equal(before.used, 1);
  const compact = compactRuns(M, first, { force: true });
  assert.notEqual(compact, first);
  assert.equal(first.isDeleted(), true);
  const after = compact.getMesh();
  assert.equal(after.numRun, 1);
  assert.ok(ids0.includes(after.runOriginalID[0]));
  assert.equal(after.triVerts.length / 3, 12);
  assert.ok(Math.abs(compact.volume() - 1) < 1e-9);
  compact.delete();
  // Unguarded this is 3^12 = 531441 runs. The patched decompose compacts a
  // body once its table reaches RUN_BLOAT_MIN, so the table stays bounded.
  let peak = 0;
  for (let round = 0; round < 12; round++) {
    const parts = m.decompose();
    const next = Manifold.compose(parts);
    for (const p of parts) p.delete();
    m.delete();
    m = next;
    peak = Math.max(peak, m.getMesh().numRun);
  }
  assert.ok(peak < RUN_BLOAT_MIN * 3 + 1, `peak runs ${peak}`);
  const finalParts = m.decompose();
  assert.equal(finalParts.length, 3);
  for (const part of finalParts) part.delete();
  assert.ok(Math.abs(m.volume() - 3) < 1e-9);
  // The table may still repeat ids (a round below the threshold); the set
  // of sources is unchanged.
  assert.deepEqual([...new Set(m.getMesh().runOriginalID)].sort(), ids0);
  m.delete();
});
