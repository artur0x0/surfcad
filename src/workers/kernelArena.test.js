import assert from 'node:assert/strict';
import test from 'node:test';
import { getManifoldModule, runScript } from '../lib/surfcad/index.js';
import { beginKernelArena, endKernelArena, kernelArenaSize, retainFromKernelArena, wasmHeapMB } from './kernelArena.js';

/**
 * Every handle a run creates is freed when the run ends, except the solid
 * it returns. Before this, each execute leaked every intermediate into the
 * wasm heap (about 200 MB per rebuild of the fastened bike) and the heap
 * never shrinks.
 */

// Heavy enough that a leak shows in the heap size: ~60 unions of 96-segment
// rings, each a few handles.
function heavy(n = 24) {
  const lines = ['let part = Manifold.cube([200, 200, 2], true);'];
  for (let i = 0; i < n; i++) {
    const x = -90 + (i % 6) * 36;
    const y = -60 + Math.floor(i / 6) * 40;
    lines.push(`part = part.add(Manifold.cylinder(6, 12, 12, 96).subtract(Manifold.cylinder(8, 8, 8, 96).translate([0, 0, -1])).translate([${x}, ${y}, 0]));`);
  }
  lines.push('return part;');
  return lines.join('\n');
}

test('repeated runs free their intermediates: the wasm heap stops growing and the mesh is the same each time', async () => {
  const src = heavy();
  const first = await runScript(src);
  assert.equal(first.status, 'NoError');
  assert.ok(first.kernelFreed > 40, `kernelFreed ${first.kernelFreed}`);
  assert.equal(typeof first.wasmHeapMB, 'number');
  // The returned solid is the caller's: it is not swept, and the caller
  // deletes it (the worker frees the one it replaces itself).
  assert.equal(first.manifold.isDeleted(), false);
  assert.ok(Math.abs(first.manifold.volume() - first.volume) < 1e-6);
  first.manifold.delete();
  const second = await runScript(src);
  second.manifold.delete();
  const heapAfterSecond = second.wasmHeapMB;
  let last = second;
  for (let i = 0; i < 4; i++) {
    last = await runScript(src);
    last.manifold.delete();
  }
  assert.ok(last.wasmHeapMB <= heapAfterSecond * 1.1 + 1, `heap grew ${heapAfterSecond} → ${last.wasmHeapMB} MB`);
  assert.equal(last.tris, first.tris);
  assert.equal(last.volume, first.volume);
});

test('a run that throws frees what it made and the next run is healthy', async () => {
  const bad = 'const a = Manifold.cube([1, 1, 1]);\nconst b = a.translate([2, 0, 0]);\nthrow new Error("stop here");';
  await assert.rejects(runScript(bad), /stop here/);
  assert.equal(kernelArenaSize(), -1);
  const ok = await runScript('return Manifold.cube([2, 2, 2]);');
  assert.equal(ok.status, 'NoError');
  assert.ok(Math.abs(ok.volume - 8) < 1e-9);
});

test('cross-section handles are swept too', async () => {
  const src = [
    'const cs = CrossSection.circle(10, 32).offset(2, "Round");',
    'let part = cs.extrude(5);',
    'return part;',
  ].join('\n');
  const ran = await runScript(src);
  assert.equal(ran.status, 'NoError');
  assert.ok(ran.kernelFreed >= 2, `kernelFreed ${ran.kernelFreed}`);
});

test('endKernelArena deletes what was recorded except the kept handles', async () => {
  await runScript('return Manifold.cube([1, 1, 1]);');
  const { Manifold } = getManifoldModule();
  const outside = Manifold.cube([1, 1, 1]);
  const arena = beginKernelArena();
  const a = Manifold.cube([1, 1, 1]);            // static
  const b = a.translate([1, 0, 0]);               // prototype method
  const c = new Manifold(b.getMesh());            // constructor
  const composed = Manifold.compose([a, b]);      // static, two touching bodies
  const parts = composed.decompose();             // array result
  assert.equal(parts.length, 2);
  assert.equal(kernelArenaSize(), 6);
  retainFromKernelArena(c);
  assert.equal(kernelArenaSize(), 5);
  const freed = endKernelArena(arena, { keep: [a] });
  assert.equal(freed, 4);
  assert.equal(a.isDeleted(), false);
  assert.equal(b.isDeleted(), true);
  assert.equal(c.isDeleted(), false);
  assert.equal(composed.isDeleted(), true);
  assert.equal(parts[0].isDeleted(), true);
  assert.equal(parts[1].isDeleted(), true);
  assert.equal(outside.isDeleted(), false);
  assert.equal(kernelArenaSize(), -1);
  a.delete();
  c.delete();
  outside.delete();
});

test('a nested arena leaves the sweep to the outermost one', async () => {
  await runScript('return Manifold.cube([1, 1, 1]);');
  const { Manifold } = getManifoldModule();
  const outer = beginKernelArena();
  const inner = beginKernelArena();
  const a = Manifold.cube([1, 1, 1]);
  assert.equal(endKernelArena(inner), 0);
  assert.equal(a.isDeleted(), false);
  assert.equal(endKernelArena(outer), 1);
  assert.equal(a.isDeleted(), true);
});

test('wasmHeapMB reads the module heap', async () => {
  await runScript('return Manifold.cube([1, 1, 1]);');
  const mb = wasmHeapMB(getManifoldModule());
  assert.ok(mb >= 1, `wasmHeapMB ${mb}`);
  assert.equal(wasmHeapMB(null), null);
});
