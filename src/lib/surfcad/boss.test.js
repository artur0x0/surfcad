/**
 * boss(part, frame, u, v, opts): a screw boss whose base sits exactly on the
 * face plane, so the union is one body (the 2026-11-01 playtest built one by
 * hand with a hair of a gap and got two bodies). Tap-drill pilot by default,
 * clearance or none on request, named faces, loud refusals.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from './index.js';

const TOP = `const fr = workplaneFromFace(part, facesByNormal(part, [0, 0, 1])[0]);`;

async function run(body) {
  const ran = await runScript(`let part = Manifold.cube([40, 30, 10], true);\n${TOP}\n${body}\nreturn part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  return globalThis.__note;
}

test('a default boss is one body with an M3 tap-drill pilot the height of the boss', { timeout: 120_000 }, async () => {
  const n = await run(`
    const before = part.volume();
    part = boss(part, fr, 5, -3, { size: 'M3', height: 8 });
    const bb = part.boundingBox();
    globalThis.__note = { bodies: part.decompose().length, dv: part.volume() - before, zMax: bb.max[2], names: faceNames(part) };`);
  assert.equal(n.bodies, 1);
  assert.ok(Math.abs(n.zMax - 13) < 1e-6, `boss top at z=13, got ${n.zMax}`);
  // Ø7.5 cylinder, 8 tall, minus a Ø2.5 pilot the full height (48 segments).
  const ring = (r, h) => 48 * 0.5 * Math.sin((2 * Math.PI) / 48) * r * r * h;
  const expected = ring(3.75, 8) - ring(1.25, 8);
  assert.ok(Math.abs(n.dv - expected) < 1e-3, `volume delta ${n.dv} vs ${expected}`);
  for (const role of ['side', 'top', 'bore', 'floor']) {
    assert.ok(n.names.some((name) => name.endsWith(`.${role}`) && /^boss/.test(name)), `named ${role} face in ${n.names.join(', ')}`);
  }
});

test('hole none is a solid boss, clearance uses the fit table, and holeDepth cuts on into the part', { timeout: 120_000 }, async () => {
  const n = await run(`
    const base = part.volume();
    const solid = boss(part, fr, 0, 0, { size: 'M4', hole: 'none', height: 6 });
    const clear = boss(part, fr, 0, 0, { size: 'M4', hole: 'clearance', fit: 'loose', height: 6, dia: 12 });
    const deep = boss(part, fr, 0, 0, { size: 'M4', height: 6, holeDepth: 10 });
    globalThis.__note = {
      solidDv: solid.volume() - base, clearDv: clear.volume() - base, deepDv: deep.volume() - base,
      solidBodies: solid.decompose().length, clearBodies: clear.decompose().length, deepBodies: deep.decompose().length,
      deepZmin: (() => { const bb = deep.boundingBox(); return bb.min[2]; })(),
    };`);
  const ring = (r, h) => 48 * 0.5 * Math.sin((2 * Math.PI) / 48) * r * r * h;
  assert.ok(Math.abs(n.solidDv - ring(5, 6)) < 1e-3, `solid M4 boss Ø10: ${n.solidDv}`);
  assert.ok(Math.abs(n.clearDv - (ring(6, 6) - ring(2.4, 6))) < 1e-3, `clearance loose Ø4.8 in Ø12: ${n.clearDv}`);
  // Ø10 boss, Ø3.3 tap drill 10 deep: 6 through the boss and 4 into the plate.
  assert.ok(Math.abs(n.deepDv - (ring(5, 6) - ring(1.65, 10))) < 1e-3, `deep pilot: ${n.deepDv}`);
  assert.deepEqual([n.solidBodies, n.clearBodies, n.deepBodies], [1, 1, 1]);
  assert.ok(Math.abs(n.deepZmin + 5) < 1e-6, 'the plate keeps its underside');
});

test('a boss on the inner floor of a shelled box merges into the wall it stands on', { timeout: 120_000 }, async () => {
  const ran = await runScript(`let part = Manifold.cube([60, 40, 30], true);
part = hollow(part, 2, { center: [0, 0, 15], normal: [0, 0, 1] });
const floor = facesByNormal(part, [0, 0, 1]).find((f) => Math.abs(f.center[2] + 13) < 1e-3);
const fr = workplaneFromFace(part, floor);
part = boss(part, fr, 15, 8, { size: 'M3', height: 10 });
globalThis.__note = { bodies: part.decompose().length };
return part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  assert.equal(globalThis.__note.bodies, 1);
});

test('refusals: a bad frame, a hole as wide as the boss, an unknown hole kind', { timeout: 120_000 }, async () => {
  for (const [body, re] of [
    [`part = boss(part, { center: [0, 0, 5] }, 0, 0, {});`, /boss: frame must come from workplaneFromFace/],
    [`part = boss(part, fr, 0, 0, { size: 'M3', dia: 2 });`, /hole Ø 2\.5 must be smaller than the boss Ø 2/],
    [`part = boss(part, fr, 0, 0, { hole: 'pilot' });`, /hole must be 'tap', 'clearance', or 'none'/],
  ]) {
    await assert.rejects(runScript(`let part = Manifold.cube([40, 30, 10], true);\n${TOP}\n${body}\nreturn part;`), re);
  }
});

test('a boss on a frame from a picked face (float noise at z = 10.000000000000002) is still one body', { timeout: 120_000 }, async () => {
  // The 2026-11-01 playtest: a hand-placed cylinder a hair above the wall
  // left two bodies. The face frame of a part that already carries a boss
  // puts the base at 10.000000000000002; the 0.1 mm sink absorbs that.
  const ran = await runScript(`let part = Manifold.cube([40, 30, 20], true);
${TOP}
part = boss(part, fr, 15, 10, { size: 'M3', height: 8 });
const face = facesByNormal(part, [0, 0, 1]).find((f) => Math.abs(f.center[2] - 10) < 1e-6);
const fr2 = workplaneFromFace(part, face);
part = boss(part, fr2, -15, 10, { size: 'M4', height: 6, hole: 'clearance' });
const bb = part.boundingBox();
globalThis.__note = { bodies: part.decompose().length, zMax: bb.max[2], zMin: bb.min[2] };
return part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  assert.equal(globalThis.__note.bodies, 1);
  assert.ok(Math.abs(globalThis.__note.zMax - 18) < 1e-6, 'tallest boss top at z=18');
  assert.ok(Math.abs(globalThis.__note.zMin + 10) < 1e-6, 'the sink stays inside the plate');
});
