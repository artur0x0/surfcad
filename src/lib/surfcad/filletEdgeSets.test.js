/**
 * Fillet edge sets. Two things used to go wrong when a script filleted a box
 * rim after the vertical edges: the kernel grouped faces by Manifold faceID
 * alone, so a cutter triangle and a box triangle with the same id fused and
 * two rim segments stopped being feature edges; makeSweepPath then kept the
 * largest piece of the broken loop and dropped the rest without a word. Now
 * faces are grouped per original, and makeSweepPath hands filletAlongPath
 * every chain of an edge set, junctions included.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from './index.js';

const R = 5;
const BOX = 'let part = Manifold.cube([40, 30, 20], true);\n';
const VERT = `const vert = convexEdges(part).filter((e) => Math.abs(e.tangent[2]) > 0.99);
for (const e of vert) part = filletAlongPath(part, makeSweepPath([e]), ${R});\n`;
const rim = (sign) => `convexEdges(part).filter((e) => ${sign} * e.va[2] > 9.9 && ${sign} * e.vb[2] > 9.9)`;

async function run(body) {
  globalThis.__note = null;
  const ran = await runScript(`${BOX}${body}return part;`);
  assert.equal(ran.status, 'NoError', ran.status);
  return { volume: ran.volume, note: globalThis.__note };
}

test('after four vertical sweep fillets both rims are whole loops and fillet alike', { timeout: 120_000 }, async () => {
  const { note } = await run(`${VERT}globalThis.__note = { top: ${rim(1)}.length, bottom: ${rim(-1)}.length };\n`);
  assert.equal(note.top, 100);
  assert.equal(note.bottom, 100, 'the bottom rim keeps every arc segment');
  const top = await run(`${VERT}part = filletAlongPath(part, makeSweepPath(${rim(1)}), ${R});\n`);
  const bottom = await run(`${VERT}part = filletAlongPath(part, makeSweepPath(${rim(-1)}), ${R});\n`);
  assert.ok(Math.abs(top.volume - bottom.volume) < 0.5, `top ${top.volume} bottom ${bottom.volume}`);
  // Planar kernel with spherical corners on the same eight edges is the reference.
  const planar = await run(`part = filletEdges(part, convexEdges(part).filter((e) => Math.abs(e.tangent[2]) > 0.99 || (e.va[2] > 9.9 && e.vb[2] > 9.9)), ${R}, { sphericalCorners: true });\n`);
  assert.ok(Math.abs(top.volume - planar.volume) < 5, `sweep ${top.volume} planar ${planar.volume}`);
});

test('makeSweepPath returns every chain of a set and filletAlongPath fillets them all', { timeout: 120_000 }, async () => {
  const four = await run(`const vert = convexEdges(part).filter((e) => Math.abs(e.tangent[2]) > 0.99);
const path = makeSweepPath(vert);
globalThis.__note = { components: path.components ? path.components.length : 1, edgeCount: path.edgeCount, closed: path.closed };
part = filletAlongPath(part, path, ${R});\n`);
  assert.deepEqual(four.note, { components: 4, edgeCount: 4, closed: false });
  const expectRemoved = 4 * 20 * R * R * (1 - Math.PI / 4);
  // The 24-segment wedge is a polygon inside the arc, so it removes a little more.
  assert.ok(Math.abs((24000 - four.volume) - expectRemoved) < 0.005 * expectRemoved, `removed ${24000 - four.volume} want ${expectRemoved}`);

  // Disjoint edges and a loop in one set: four verticals plus the top rim.
  const mixed = await run(`const es = convexEdges(part).filter((e) => Math.abs(e.tangent[2]) > 0.99 || (e.va[2] > 9.9 && e.vb[2] > 9.9));
const path = makeSweepPath(es);
globalThis.__note = { components: path.components.length, junctions: path.junctions.length };
part = filletAlongPath(part, path, ${R});\n`);
  // Eight edges meet three at a time at the four top corners: eight single-edge chains.
  assert.deepEqual(mixed.note, { components: 8, junctions: 4 });
  // The whole box: twelve chains, eight junctions, every edge rounded and
  // every corner a spherical patch (see filletSweepJunctions.test.js), so the
  // planar kernel with spherical corners is the reference.
  const box = await run(`const path = makeSweepPath(convexEdges(part));
globalThis.__note = { components: path.components.length, junctions: path.junctions.length };
part = filletAlongPath(part, path, ${R});\n`);
  assert.deepEqual(box.note, { components: 12, junctions: 8 });
  const planar = await run(`part = filletEdges(part, convexEdges(part), ${R}, { sphericalCorners: true });\n`);
  assert.ok(Math.abs(box.volume - planar.volume) < 6, `sweep ${box.volume} planar ${planar.volume}`);
});
