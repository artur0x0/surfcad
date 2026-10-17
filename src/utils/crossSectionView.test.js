import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, BufferGeometry, BufferAttribute } from 'three';
import {
  collectCrossSectionTargets,
  crossSectionPlaneKey,
  isAssemblyCrossSectionScope,
  worldPlaneToLocalTrim,
} from './crossSectionView.js';
import { buildSolidGeometry, createSolidCache } from './partSolidCache.js';

function boxMeshData() {
  const vertProperties = new Float32Array([
    0, 0, 0,
    10, 0, 0,
    10, 10, 0,
    0, 10, 0,
    0, 0, 10,
    10, 0, 10,
    10, 10, 10,
    0, 10, 10,
  ]);
  const triVerts = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ]);
  return { numProp: 3, vertProperties, triVerts };
}

function makeHost(meshData) {
  const cache = createSolidCache();
  const { geometry } = buildSolidGeometry(meshData);
  const mesh = new Mesh(geometry);
  cache.entries.set(meshData, { geometry, faceIDs: null });
  return { mesh, cache };
}

test('assembly scope follows lock or parked assembly meshes', () => {
  assert.equal(isAssemblyCrossSectionScope({ current: false }, { current: new Map() }), false);
  assert.equal(isAssemblyCrossSectionScope({ current: true }, { current: new Map() }), true);
  assert.equal(isAssemblyCrossSectionScope({ current: false }, { current: new Map([['p2', {}]]) }), true);
});

test('collectCrossSectionTargets: part editor clips only the active mesh', () => {
  const meshData = boxMeshData();
  const { mesh, cache } = makeHost(meshData);
  const extraData = boxMeshData();
  const { mesh: extra, cache: extraCache } = makeHost(extraData);
  for (const [k, v] of extraCache.entries) cache.entries.set(k, v);

  const resultRef = { current: mesh };
  const assemblyExtrasRef = { current: new Map() };
  const targets = collectCrossSectionTargets({
    assemblyRunLockRef: { current: false },
    resultRef,
    assemblyExtrasRef,
    solidCache: cache,
    activePartIdRef: { current: 'p1' },
  });
  assert.equal(targets.length, 1);
  assert.equal(targets[0].mesh, mesh);
});

test('collectCrossSectionTargets: assembly clips active and extras', () => {
  const meshData = boxMeshData();
  const { mesh, cache } = makeHost(meshData);
  const extraData = boxMeshData();
  const { mesh: extra, cache: extraCache } = makeHost(extraData);
  for (const [k, v] of extraCache.entries) cache.entries.set(k, v);

  const targets = collectCrossSectionTargets({
    assemblyRunLockRef: { current: true },
    resultRef: { current: mesh },
    assemblyExtrasRef: { current: new Map([['p2', extra]]) },
    solidCache: cache,
    activePartIdRef: { current: 'p1' },
  });
  assert.equal(targets.length, 2);
  const ids = targets.map((t) => t.partId).sort();
  assert.deepEqual(ids, ['p1', 'p2']);
});

test('worldPlaneToLocalTrim is identity for an unposed mesh', () => {
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  const mesh = new Mesh(geom);
  mesh.updateMatrixWorld(true);
  const out = worldPlaneToLocalTrim(mesh, [0, 0, 1], 5);
  assert.ok(Math.abs(out.normal[2] - 1) < 1e-5);
  assert.ok(Math.abs(out.originOffset - 5) < 1e-4);
});

test('crossSectionPlaneKey normalizes direction', () => {
  const a = crossSectionPlaneKey([0, 0, 2], 1);
  const b = crossSectionPlaneKey([0, 0, 1], 1);
  assert.equal(a, b);
});

test('Manifold trimByPlane seals the cut with cap triangles', async () => {
  const wasmPath = new URL('../../built/manifold.js', import.meta.url);
  const wasm = await (await import(wasmPath.href)).default();
  wasm.setup?.();
  const { Manifold } = wasm;
  const cube = Manifold.cube([20, 20, 20], true);
  const trimmed = cube.trimByPlane([0, 0, 1], 5);
  const mesh = trimmed.getMesh();
  assert.ok(mesh.triVerts.length >= 3);
  let onPlane = 0;
  const verts = mesh.vertProperties;
  const np = mesh.numProp || 3;
  const planeZ = 5;
  for (let i = 0; i < mesh.triVerts.length; i += 3) {
    const a = mesh.triVerts[i] * np;
    const b = mesh.triVerts[i + 1] * np;
    const c = mesh.triVerts[i + 2] * np;
    const za = verts[a + 2];
    const zb = verts[b + 2];
    const zc = verts[c + 2];
    if (Math.abs(za - planeZ) < 0.02 && Math.abs(zb - planeZ) < 0.02 && Math.abs(zc - planeZ) < 0.02) {
      onPlane += 1;
    }
  }
  assert.ok(onPlane >= 1, 'expected at least one cap triangle on the cut plane');
  cube.delete();
  trimmed.delete();
});
