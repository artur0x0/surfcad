/**
 * Edge identity (MVP 3 edge slice, kernel half): `edgesNamed` resolves an
 * edge by the two stamped faces it lies between, fillet and chamfer
 * surfaces carry `round` / `bevel` names, uploads and freehand runs get
 * synthetic names, and a stale literal wire fails loud in filletAlongPath.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { buildSolidGeometry } from './partSolidCache.js';
import { stampedFaceTable } from './faceIdentity.js';

async function run(source, opts = {}) {
  const ran = await runScript(source, opts);
  assert.equal(ran.status, 'NoError', ran.status);
  return ran;
}

async function failing(source) {
  try {
    await runScript(source);
  } catch (err) {
    return err;
  }
  throw new Error('expected the script to throw');
}

const faceNamesOf = (ran) => {
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  return stampedFaceTable(geometry, faceIDs).faces.map((f) => f.name).sort();
};

const CUBE = `// --- cube begin id=cube1 ---
let part = Manifold.cube([20, 10, 5], true);
// --- cube end id=cube1 ---
`;

test('edgesNamed returns the segments between two named faces, in either order, with a glob', async () => {
  const ran = await run(`${CUBE}
const e = edgesNamed(part, 'cube1.top~cube1.front');
if (e.length !== 1) throw new Error('one segment, got ' + e.length);
if (Math.abs(e[0].length - 20) > 1e-6) throw new Error('length ' + e[0].length);
if (!e[0].n0 || !e[0].n1 || e[0].name !== 'cube1.front~cube1.top') throw new Error('row ' + JSON.stringify(e[0]));
const flipped = edgesNamed(part, 'cube1.front~cube1.top');
if (flipped[0].key !== e[0].key) throw new Error('order matters');
const rim = edgesNamed(part, 'cube1.top~*');
if (rim.length !== 4 || rim.names.length !== 4) throw new Error('rim ' + rim.length + ' ' + rim.names);
const two = edgesNamed(part, ['cube1.top~cube1.front', 'cube1.top~cube1.back']);
if (two.length !== 2) throw new Error('two ' + two.length);
return part;
`);
  assert.equal(ran.tris, 12);
});

test('a bare pair is every chain, [k] one chain, and an ordinal the pair no longer has throws', async () => {
  // A notch out of the middle of the top-front edge: top and front stay one
  // piece each, but they meet in two chains.
  const NOTCHED = `// --- cube begin id=plate ---
let part = Manifold.cube([40, 20, 10], true);
// --- cube end id=plate ---
// --- cube begin id=notch ---
part = part.subtract(Manifold.cube([10, 6, 4], true).translate([0, -10, 5]));
// --- cube end id=notch ---
`;
  await run(`${NOTCHED}
const all = edgesNamed(part, 'plate.top~plate.front');
if (all.names.length !== 2) throw new Error('chains ' + all.names.join(','));
if (all.names[0] !== 'plate.front~plate.top[0]' || all.names[1] !== 'plate.front~plate.top[1]') throw new Error(all.names.join(','));
const one = edgesNamed(part, 'plate.top~plate.front[1]');
if (one.names.length !== 1 || one.names[0] !== 'plate.front~plate.top[1]') throw new Error(one.names.join(','));
if (Math.abs(all.reduce((s, e) => s + e.length, 0) - 30) > 1e-6) throw new Error('40 mm edge minus a 10 mm notch');
return part;
`);
  const bad = await failing(`${NOTCHED}
edgesNamed(part, 'plate.top~plate.front[2]');
return part;
`);
  assert.match(bad.message, /has 2 chains/);
  assert.match(bad.message, /re-pick/);
  const unknown = await failing(`${CUBE}
edgesNamed(part, 'cube1.top~cube1.lid');
return part;
`);
  assert.match(unknown.message, /no edge named/);
  assert.match(unknown.message, /edges on this solid: cube1\.back~cube1\.bottom/);
});

test('a fillet names its surface <block>.round and a chamfer on it resolves by name', async () => {
  const ran = await run(`${CUBE}
// --- fillet-mode begin id=fil ---
const p1 = makeSweepPath(edgesNamed(part, 'cube1.top~cube1.front'));
part = filletAlongPath(part, p1, 1.5);
// --- fillet-mode end ---
// --- chamfer-mode begin id=cham ---
const p2 = makeSweepPath(edgesNamed(part, 'cube1.top~fil.round'));
part = filletAlongPath(part, p2, 0.4, { profile: 'chamfer' });
// --- chamfer-mode end ---
return part;
`);
  const names = faceNamesOf(ran);
  assert.ok(names.includes('fil.round'), names.join(','));
  assert.ok(names.includes('cham.bevel'), names.join(','));
  // The script-side table and the viewport table agree on the blend names.
  const fromKernel = await run(`${CUBE}
// --- fillet-mode begin id=fil ---
part = filletAlongPath(part, makeSweepPath(edgesNamed(part, 'cube1.top~cube1.front')), 1.5);
// --- fillet-mode end ---
const got = faceNames(part);
if (!got.includes('fil.round')) throw new Error(got.join(','));
if (edgesNamed(part, 'fil.round~cube1.top').length < 1) throw new Error('no round~top edge');
return part;
`);
  assert.ok(fromKernel.volume < 20 * 10 * 5);
});

test('freehand runs are named after their block, or script, by coplanar group', async () => {
  const ran = await run(`// --- code begin id=blob ---
let part = Manifold.extrude(CrossSection.square([12, 8], true), 6);
// --- code end id=blob ---
part = part.add(Manifold.extrude(CrossSection.square([4, 4], true), 10).translate([0, 0, 2]));
const got = faceNames(part);
if (!got.some((n) => n.startsWith('blob.f'))) throw new Error(got.join(','));
if (!got.some((n) => n.startsWith('script.f'))) throw new Error(got.join(','));
if (edgesNamed(part, 'blob.f*~script.f*').length < 1) throw new Error('no edge between the block and the freehand run');
return part;
`);
  const names = faceNamesOf(ran);
  assert.equal(names.filter((n) => n.startsWith('blob.f')).length, 6, names.join(','));
  assert.ok(names.some((n) => n.startsWith('script.f')), names.join(','));
});

test('an upload is named import@1.f<k> by coplanar group', async () => {
  const cube = await run('return Manifold.cube([10, 10, 10], true);');
  const ran = await run('let part = importMesh("blob.mesh"); return part;', {
    importedModels: { 'blob.mesh': { numProp: cube.mesh.numProp, vertProperties: cube.mesh.vertProperties, triVerts: cube.mesh.triVerts } },
  });
  const names = faceNamesOf(ran);
  assert.deepEqual(names, [0, 1, 2, 3, 4, 5].map((k) => `import@1.f${k}`));
});

test('a literal wire off the solid fails loud instead of sweeping air', async () => {
  const err = await failing(`${CUBE}
const stale = [{ a: 0, b: 1, va: [-10, -5, 4], vb: [10, -5, 4], length: 20 }];
part = filletAlongPath(part, makeSweepPath(stale), 1);
return part;
`);
  assert.match(err.message, /off every edge of this solid/);
  assert.match(err.message, /re-pick edges/);
  // The same wire on the edge still works.
  await run(`${CUBE}
const live = [{ a: 0, b: 1, va: [-10, -5, 2.5], vb: [10, -5, 2.5], length: 20 }];
part = filletAlongPath(part, makeSweepPath(live), 1);
return part;
`);
});
