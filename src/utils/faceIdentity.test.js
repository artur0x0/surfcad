/**
 * Face identity, part 1: helpers stamp one faceID per role, the main
 * thread groups triangles by stamp into named faces, `list_faces` rows
 * carry the names, and names survive an edit and a rebuild.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { buildSolidGeometry } from './partSolidCache.js';
import { describeFaceTable, stampedFaceTable, stampedNameForTriangles } from './faceIdentity.js';
import { agentFaceCatalog } from '../agent/faceCatalog.js';
import { buildFaceList } from '../agent/state/listPickables.js';

async function tableOf(source) {
  const ran = await runScript(source);
  assert.equal(ran.status, 'NoError', ran.status);
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  const table = stampedFaceTable(geometry, faceIDs);
  return { ran, geometry, faceIDs, table, names: table.faces.map((f) => f.name) };
}

const names = (table) => table.faces.map((f) => f.name).sort();

test('a stamped cube keeps the raw mesh and names its six faces', async () => {
  const { ran, table } = await tableOf('let part = Manifold.cube([20, 10, 5], true); return part;');
  // Nothing in the mesh changed: twelve triangles, Manifold's own per-triangle ids.
  assert.equal(ran.tris, 12);
  assert.deepEqual([...new Set(ran.mesh.faceID)].sort((a, b) => a - b), [...Array(12).keys()]);
  assert.deepEqual(names(table), ['cube@1.back', 'cube@1.bottom', 'cube@1.front', 'cube@1.left', 'cube@1.right', 'cube@1.top']);
  const top = table.byName.get('cube@1.top');
  assert.ok(Math.abs(top.normal[2] - 1) < 1e-6 && Math.abs(top.center[2] - 2.5) < 1e-6, JSON.stringify(top.center));
  assert.equal(top.record.kind, 'plane');
  assert.equal(table.edges.length, 12, 'a box has twelve edges between named faces');
  assert.ok(table.byName.has('cube@1.top') && table.edges.some((e) => e.name === 'cube@1.right~cube@1.top'));
});

test('a marked block names the feature; calls outside a block count per helper', async () => {
  const { table } = await tableOf(`// --- cube begin id=seed ---
let part = Manifold.cube([10, 10, 10], true);
// --- cube end id=seed ---
// --- cylinder begin id=cyl1 ---
part = part.add(Manifold.cylinder(20, 3, 3, 16, true));
// --- cylinder end id=cyl1 ---
part = part.subtract(Manifold.cylinder(30, 1, 1, 12, true).rotate([90, 0, 0]));
return part;`);
  const got = names(table);
  // The boss pokes out of both faces of the cube, so its side is two pieces.
  for (const n of ['seed.top', 'seed.bottom', 'seed.left', 'cyl1.side[0]', 'cyl1.side[1]', 'cyl1.top', 'cyl1.bottom']) assert.ok(got.includes(n), `${n} in ${got}`);
  // The freehand cylinder outside every block is cylinder@1 (the marked one is cyl1, not a count).
  assert.ok(got.includes('cylinder@1.side'), got.join(','));
  const side = table.byName.get('cyl1.side[0]');
  assert.equal(side.record.kind, 'cylinder');
  assert.equal(side.record.radius, 3);
});

test('tube, hexPrism, roundedBox, extrude and revolve name their roles with records', async () => {
  let t = (await tableOf('let part = tube(10, 6, 20, 32); return part;')).table;
  assert.deepEqual(names(t), ['tube@1.bottom', 'tube@1.inner', 'tube@1.side', 'tube@1.top']);
  assert.equal(t.byName.get('tube@1.inner').record.radius, 6);

  t = (await tableOf('let part = hexPrism(10, 5); return part;')).table;
  assert.deepEqual(names(t), ['hexPrism@1.bottom', 'hexPrism@1.top', ...[0, 1, 2, 3, 4, 5].map((i) => `hexPrism@1.wall[${i}]`)].sort());

  t = (await tableOf('let part = roundedBox([30, 20, 10], 3, 16); return part;')).table;
  const rb = names(t);
  assert.equal(rb.length, 6 + 12 + 8, rb.join(','));
  const top = t.byName.get('roundedBox@1.top');
  assert.equal(top.record.kind, 'plane', 'the flat top is a plane by name, not a cylinder (bug M5)');
  assert.ok(Math.abs(top.normal[2] - 1) < 1e-9);
  assert.equal(t.byName.get('roundedBox@1.band[0]').record.kind, 'cylinder');
  assert.equal(t.byName.get('roundedBox@1.corner[7]').record.kind, 'sphere');

  const plane = "const pl = { center: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] };";
  t = (await tableOf(`${plane} const c1 = makeCrossSection(pl, profileRectangle(20, 10)); let part = makeExtrude(c1.contours, 8); return part;`)).table;
  assert.deepEqual(names(t), ['extrude@1.cap0', 'extrude@1.cap1', 'extrude@1.wall[0]', 'extrude@1.wall[1]', 'extrude@1.wall[2]', 'extrude@1.wall[3]']);
  assert.ok(Math.abs(t.byName.get('extrude@1.cap1').center[2] - 8) < 1e-6);

  t = (await tableOf(`${plane} const c1 = makeCrossSection(pl, profileCircle(5, 32)); let part = makeExtrude(c1.contours, 8); return part;`)).table;
  assert.deepEqual(names(t), ['extrude@1.cap0', 'extrude@1.cap1', 'extrude@1.wall[0]'], 'a circle profile is one wall, not 32');
  assert.equal(t.byName.get('extrude@1.wall[0]').record.kind, 'cylinder');
  assert.equal(t.byName.get('extrude@1.wall[0]').record.radius, 5);

  t = (await tableOf('let part = makeRevolve([[2, 0], [6, 0], [6, 10], [4, 14], [2, 14]], 48, 360); return part;')).table;
  assert.deepEqual(names(t), [0, 1, 2, 3, 4].map((i) => `revolve@1.seg[${i}]`));
  const kinds = [0, 1, 2, 3, 4].map((i) => t.byName.get(`revolve@1.seg[${i}]`).record.kind);
  assert.deepEqual(kinds, ['plane', 'cylinder', 'cone', 'plane', 'cylinder']);

  t = (await tableOf('let part = makeRevolve([[2, 0], [6, 0], [6, 10], [2, 10]], 48, 180); return part;')).table;
  assert.ok(t.byName.has('revolve@1.end0') && t.byName.has('revolve@1.end1'), names(t).join(','));
});

test('one label in several pieces gets ordinals; a boolean keeps the names of what survives', async () => {
  // Two copies of one stamped cube: the same stamped ids twice.
  let { table } = await tableOf('const c = Manifold.cube([10, 10, 10], true); let part = c.add(c.translate([30, 0, 0])); return part;');
  assert.deepEqual(names(table).filter((n) => n.startsWith('cube@1.top')), ['cube@1.top[0]', 'cube@1.top[1]']);
  assert.ok(table.byName.get('cube@1.top[0]').center[0] < table.byName.get('cube@1.top[1]').center[0]);

  // A slot through the top splits it into two pieces; the sides stay whole.
  ({ table } = await tableOf('let part = Manifold.cube([40, 20, 10], true).subtract(Manifold.cube([4, 30, 30], true)); return part;'));
  assert.deepEqual(names(table).filter((n) => n.startsWith('cube@1.top')), ['cube@1.top[0]', 'cube@1.top[1]']);
  assert.ok(table.byName.has('cube@1.left') && table.byName.has('cube@1.right'));
  // The cutter's faces that remain are the slot walls, named from the cutter.
  assert.ok(table.byName.has('cube@2.left') && table.byName.has('cube@2.right'), names(table).join(','));
});

test('names are stable across an edit and a rebuild', async () => {
  const build = (h) => `// --- cube begin id=base ---
let part = Manifold.cube([30, 20, ${h}], true);
// --- cube end id=base ---
// --- cylinder begin id=boss ---
part = part.add(Manifold.cylinder(${h}, 4, 4, 24, false).translate([5, 0, ${h / 2}]));
// --- cylinder end id=boss ---
// --- hole begin id=pin ---
part = part.subtract(Manifold.cylinder(100, 1.5, 1.5, 16, true).translate([-8, 0, 0]));
// --- hole end id=pin ---
return part;`;
  const a = names((await tableOf(build(10))).table);
  const b = names((await tableOf(build(16))).table);
  assert.deepEqual(a, b);
  assert.ok(a.includes('base.top') && a.includes('boss.side') && a.includes('pin.side'), a.join(','));
});

test('list_faces rows carry name, feature and role next to the unchanged key', async () => {
  const { geometry, faceIDs } = await tableOf(`// --- cube begin id=seed ---
let part = Manifold.cube([20, 10, 5], true);
// --- cube end id=seed ---
return part;`);
  const catalog = agentFaceCatalog(geometry, faceIDs);
  const { faces } = buildFaceList(catalog);
  assert.equal(faces.length, 6);
  for (const row of faces) {
    assert.ok(row.key && Array.isArray(row.key.at) && row.key.area > 0, 'key is still the fingerprint');
    assert.equal(row.feature, 'seed');
    assert.match(row.name, /^seed\.(top|bottom|left|right|front|back)$/);
    assert.equal(row.name, `seed.${row.role}`);
  }
  const top = faces.find((r) => r.name === 'seed.top');
  assert.ok(Math.abs(top.normal[2] - 1) < 1e-6);
});

test('a patch that spans several stamps keeps the dominant name and lists the rest', async () => {
  const { geometry, faceIDs, table } = await tableOf(
    // Two boxes unioned flush on top: one coplanar top from two stamps.
    'let part = Manifold.cube([20, 10, 5], true).add(Manifold.cube([10, 10, 5], true).translate([15, 0, 0])); return part;',
  );
  const catalog = agentFaceCatalog(geometry, faceIDs);
  const topRow = catalog.find((row) => Math.abs(row.n[2] - 1) < 1e-6 && row.at[2] > 2);
  assert.ok(topRow, 'one planar top patch');
  const named = stampedNameForTriangles(table, topRow.tris);
  assert.equal(named.name, 'cube@1.top', 'the larger box owns most of the patch');
  assert.deepEqual(named.names, ['cube@1.top', 'cube@2.top']);
  const plain = describeFaceTable(table);
  assert.ok(plain.faces.every((f) => typeof f.name === 'string' && !('tris' in f)));
});

test('facesNamed resolves in the kernel and places a hole by name; a missing name fails loudly', async () => {
  const ran = await runScript(`// --- cube begin id=plate ---
let part = Manifold.cube([40, 20, 6], true);
// --- cube end id=plate ---
const top = facesNamed(part, 'plate.top');
if (top.length !== 1) throw new Error('top pieces ' + top.length);
if (surfaceOf(top[0]).kind !== 'plane') throw new Error('record ' + surfaceOf(top[0]).kind);
const wp = workplaneFromFace(part, top[0]);
part = hole(part, wp, 10, 0, 4, 6);
if (!faceNames(part).includes('plate.top')) throw new Error('top lost its name');
return part;`);
  assert.equal(ran.status, 'NoError');
  assert.ok(Math.abs(ran.volume - (40 * 20 * 6 - Math.PI * 4 * 6)) < 40 * 20 * 6 * 0.01, `volume ${ran.volume}`);

  await assert.rejects(
    runScript("let part = Manifold.cube([10, 10, 10], true); facesNamed(part, 'plate.top'); return part;"),
    /no face named 'plate.top'.*cube@1\.back/,
  );
  await assert.rejects(
    runScript("let part = Manifold.hull([Manifold.sphere(2, 8), Manifold.sphere(2, 8).translate([10, 0, 0])]); facesNamed(part, 'x.y'); return part;"),
    // A hull has no helper roles; its runs are still named by coplanar group (edge identity).
    /no face named 'x.y'.*script\.f0/,
  );
});
