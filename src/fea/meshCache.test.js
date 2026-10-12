import assert from 'node:assert/strict';
import test, { before, describe } from 'node:test';
import * as fea from '../../packages/surfcad-fea/pkg/surfcad_fea.js';
import { FEA_SETUP_TIMEOUT_MS, initFeaWasm } from './initFeaWasm.js';
import { box } from './meshShapes.js';
import { meshCacheKey, meshCacheLimit, meshVolume, releaseMesh } from './meshVolume.js';
import { createMeshCache, dropCachedSolutions, releaseMeshCache, solveSolid } from './solveSolid.js';

before(() => initFeaWasm(), { timeout: FEA_SETUP_TIMEOUT_MS });

const NODES = [
  0, 0, 0, 0, 10, 0, 0, 0, 10, 0, 5, 5, 0, 5, 0, 0, 0, 5,
  40, 0, 0, 40, 10, 0, 40, 0, 10, 40, 5, 5, 40, 5, 0, 40, 0, 5,
];
const FACES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function beamStudy(force = 200, target = 4) {
  return {
    model: 'solid',
    mesh: { target, refine: 'off' },
    fixtures: [{
      kind: 'fixed',
      faces: [{ faceID: 1, at: [0, 5, 5], n: [-1, 0, 0], area: 100 }],
    }],
    loads: [{
      kind: 'force',
      vector: [0, 0, -force],
      faces: [{ faceID: 2, at: [40, 5, 5], n: [1, 0, 0], area: 100 }],
    }],
  };
}

function material(E, yieldMPa = 52.5, nu = 0.36) {
  return { E_MPa: E, nu, yield_MPa: yieldMPa };
}

function fakeMesh() {
  return {
    nodes: Float64Array.from(NODES),
    elements: new Uint32Array(10),
    faces: Uint32Array.from(FACES),
    faceIds: Uint32Array.from([1, 2]),
    stats: { dofs: 36, elements: 1, ms: 12, wasmBytes: 64 },
  };
}

function linearSolve(mesh, mat) {
  const n = mesh.nodes.length / 3;
  const nodal = new Float64Array(n);
  const displacement = new Float64Array(n * 3);
  const scale = 4096 / mat.E_MPa;
  for (let i = 0; i < n; i += 1) {
    nodal[i] = 10 + (i % 5);
    const amp = (i + 1) * scale;
    displacement[i * 3] = amp;
    displacement[i * 3 + 1] = amp * 2;
    displacement[i * 3 + 2] = -amp;
  }
  const p95 = 14;
  const yieldMPa = mat.yield_MPa;
  const safety = yieldMPa == null || !(Number(yieldMPa) > 0) ? null : Number(yieldMPa) / p95;
  return {
    nodal,
    displacement,
    min: 10,
    max: 14,
    p95,
    safetyFactor: safety,
    solver: 'cholesky',
    warnings: [],
    stats: { dofs: n * 3, freeDofs: n, iterations: 0, residual: 0, solveMs: 5 },
  };
}

function tipDisplacement(result) {
  const probe = result && result.probe;
  const nodes = probe && probe.nodes;
  const disp = probe && probe.displacement;
  assert.ok(nodes && disp && nodes.length >= 3 && disp.length === nodes.length, 'probe displacement');
  let maxX = -Infinity;
  for (let i = 0; i < nodes.length; i += 3) maxX = Math.max(maxX, nodes[i]);
  const acc = [0, 0, 0];
  let count = 0;
  const cutoff = maxX - 0.5;
  for (let i = 0; i < nodes.length / 3; i += 1) {
    if (nodes[i * 3] < cutoff) continue;
    acc[0] += disp[i * 3];
    acc[1] += disp[i * 3 + 1];
    acc[2] += disp[i * 3 + 2];
    count += 1;
  }
  assert.ok(count > 0, `tip nodes near x=${maxX}`);
  return acc.map((value) => value / count);
}

function relError(actual, expected) {
  if (!Number.isFinite(actual) && !Number.isFinite(expected)) return 0;
  const denom = Math.max(Math.abs(actual), Math.abs(expected), 1e-30);
  return Math.abs(actual - expected) / denom;
}

function maxFieldError(actual, expected) {
  assert.equal(actual.length, expected.length);
  let worst = 0;
  for (let i = 0; i < actual.length; i += 1) {
    const err = relError(actual[i], expected[i]);
    if (err > worst) worst = err;
  }
  return worst;
}

function assertResultClose(actual, expected, tol, label) {
  const fields = ['min', 'max', 'p95', 'safetyFactor', 'displacementMin', 'displacementMax'];
  let worst = 0;
  for (const field of fields) {
    const err = relError(actual[field], expected[field]);
    if (err > worst) worst = err;
    assert.ok(err <= tol, `${label} ${field} ${actual[field]} vs ${expected[field]} rel ${err}`);
  }
  const stress = maxFieldError(actual.nodal, expected.nodal);
  const disp = maxFieldError(actual.displacement, expected.displacement);
  assert.ok(stress <= tol, `${label} stress rel ${stress}`);
  assert.ok(disp <= tol, `${label} displacement rel ${disp}`);
  return Math.max(worst, stress, disp);
}

describe('mesh cache', { concurrency: 1 }, () => {
  test('the key tracks the surface, the target, and the profile', () => {
    const surface = box([40, 10, 10]);
    const copy = {
      positions: Float64Array.from(surface.positions),
      indices: Uint32Array.from(surface.indices),
      faceIDs: Uint32Array.from(surface.faceIds),
    };
    const key = meshCacheKey(surface, 4, 'desktop');
    assert.equal(meshCacheKey(copy, 4, 'desktop'), key);
    assert.equal(meshCacheLimit('phone'), 1);
    assert.equal(meshCacheLimit('desktop'), 2);

    const moved = Float64Array.from(surface.positions);
    moved[0] += 1;
    assert.notEqual(meshCacheKey({ ...surface, positions: moved }, 4, 'desktop'), key);
    const faces = Uint32Array.from(surface.faceIds);
    faces[0] += 1;
    assert.notEqual(meshCacheKey({ ...surface, faceIds: faces }, 4, 'desktop'), key);
    const indices = Uint32Array.from(surface.indices);
    const swap = indices[0];
    indices[0] = indices[1];
    indices[1] = swap;
    assert.notEqual(meshCacheKey({ ...surface, indices }, 4, 'desktop'), key);
    assert.notEqual(meshCacheKey(surface, 5, 'desktop'), key);
    assert.notEqual(meshCacheKey(surface, 4, 'phone'), key);
    assert.equal(meshCacheKey(surface, 'auto', 'desktop') !== key, true);
    assert.equal(meshCacheKey(surface, 4, 'desktop', ''), key);
    const loaded = meshCacheKey(surface, 4, 'desktop', '{"loads":1}');
    assert.notEqual(loaded, key);
    assert.notEqual(meshCacheKey(surface, 4, 'desktop', '{"loads":2}'), loaded);
  });

  test('releaseMesh drops the typed arrays', () => {
    const mesh = fakeMesh();
    releaseMesh(mesh);
    assert.equal(mesh.nodes, null);
    assert.equal(mesh.elements, null);
    assert.equal(mesh.faces, null);
    assert.equal(mesh.faceIds, null);
    assert.equal(mesh.stats.wasmBytes, 0);
  });

  test('material, yield, and load changes reuse one mesh', async () => {
    const cache = createMeshCache();
    const surface = box([40, 10, 10]);
    const made = [];
    let solves = 0;
    const meshVolumeFn = async () => {
      const mesh = fakeMesh();
      made.push(mesh);
      return mesh;
    };
    const solveTet10 = (mesh, mat, bcs) => {
      solves += 1;
      return linearSolve(mesh, mat, bcs);
    };
    const common = {
      positions: surface.positions,
      indices: surface.indices,
      faceIDs: surface.faceIds,
      profile: 'desktop',
      cache,
      meshVolume: meshVolumeFn,
      solveTet10,
      solveStub: () => { throw new Error('stub'); },
    };
    const first = await solveSolid({ ...common, study: beamStudy(200), material: material(4096, 52.5) });
    const yieldOnly = await solveSolid({ ...common, study: beamStudy(200), material: material(4096, 100) });
    const modulus = await solveSolid({ ...common, study: beamStudy(200), material: material(8192, 100) });
    const loaded = await solveSolid({ ...common, study: beamStudy(400), material: material(8192, 100) });
    const nu = await solveSolid({ ...common, study: beamStudy(400), material: material(8192, 100, 0.3) });

    assert.equal(made.length, 1);
    assert.equal(solves, 3);
    assert.equal(first.meshReused, false);
    assert.equal(first.rescaled, false);
    assert.equal(yieldOnly.meshReused, true);
    assert.equal(yieldOnly.rescaled, true);
    assert.equal(yieldOnly.stats.meshMs, 0);
    assert.equal(yieldOnly.stats.solveMs, 0);
    assert.equal(yieldOnly.min, first.min);
    assert.equal(yieldOnly.max, first.max);
    assert.equal(yieldOnly.p95, first.p95);
    assert.equal(yieldOnly.safetyFactor, 100 / first.p95);
    assert.equal(yieldOnly.displacementMax, first.displacementMax);
    assert.equal(modulus.meshReused, true);
    assert.equal(modulus.rescaled, true);
    assert.equal(modulus.p95, first.p95);
    assert.ok(Math.abs(modulus.safetyFactor - (100 / first.p95)) <= 1e-12);
    assert.equal(loaded.meshReused, true);
    assert.equal(loaded.rescaled, false);
    assert.equal(nu.meshReused, true);
    assert.equal(nu.rescaled, false);
    assert.equal(made[0].nodes instanceof Float64Array, true);
  });

  test('a new fixture face re-solves on the cached mesh', async () => {
    const cache = createMeshCache();
    const surface = box([40, 10, 10]);
    let meshes = 0;
    const fixed = [];
    await solveSolid({
      study: beamStudy(200),
      positions: surface.positions,
      indices: surface.indices,
      faceIDs: surface.faceIds,
      material: material(4096),
      profile: 'desktop',
      cache,
      meshVolume: async () => {
        meshes += 1;
        return fakeMesh();
      },
      solveTet10: (mesh, mat, bcs) => {
        fixed.push(Array.from(bcs.fixedNodes).sort((a, b) => a - b).join(','));
        return linearSolve(mesh, mat);
      },
      solveStub: () => { throw new Error('stub'); },
    });
    const swapped = beamStudy(200);
    swapped.fixtures[0].faces[0].faceID = 2;
    swapped.loads[0].faces[0].faceID = 1;
    const again = await solveSolid({
      study: swapped,
      positions: surface.positions,
      indices: surface.indices,
      faceIDs: surface.faceIds,
      material: material(4096),
      profile: 'desktop',
      cache,
      meshVolume: async () => {
        meshes += 1;
        return fakeMesh();
      },
      solveTet10: (mesh, mat, bcs) => {
        fixed.push(Array.from(bcs.fixedNodes).sort((a, b) => a - b).join(','));
        return linearSolve(mesh, mat);
      },
      solveStub: () => { throw new Error('stub'); },
    });
    assert.equal(meshes, 1);
    assert.equal(again.meshReused, true);
    assert.equal(again.rescaled, false);
    assert.equal(fixed.length, 2);
    assert.notEqual(fixed[0], fixed[1]);
  });

  test('geometry, target, and profile miss, and the phone keeps one mesh', async () => {
    const cache = createMeshCache();
    const a = box([40, 10, 10]);
    const b = box([30, 10, 10]);
    const made = [];
    const meshVolumeFn = async () => {
      const mesh = fakeMesh();
      made.push(mesh);
      return mesh;
    };
    const common = {
      study: beamStudy(200),
      material: material(4096),
      profile: 'phone',
      cache,
      meshVolume: meshVolumeFn,
      solveTet10: linearSolve,
      solveStub: () => { throw new Error('stub'); },
    };
    await solveSolid({
      ...common,
      positions: a.positions,
      indices: a.indices,
      faceIDs: a.faceIds,
    });
    await solveSolid({
      ...common,
      positions: b.positions,
      indices: b.indices,
      faceIDs: b.faceIds,
    });
    assert.equal(made.length, 2);
    assert.equal(made[0].nodes, null);
    assert.ok(made[1].nodes);

    const desktop = createMeshCache();
    const kept = [];
    let meshes = 0;
    const deskMesh = async () => {
      meshes += 1;
      const mesh = fakeMesh();
      kept.push(mesh);
      return mesh;
    };
    const desk = {
      study: beamStudy(200, 4),
      material: material(4096),
      profile: 'desktop',
      cache: desktop,
      meshVolume: deskMesh,
      solveTet10: linearSolve,
      solveStub: () => { throw new Error('stub'); },
    };
    const run = (surface, target, profile) => solveSolid({
      ...desk,
      study: beamStudy(200, target),
      profile,
      positions: surface.positions,
      indices: surface.indices,
      faceIDs: surface.faceIds,
    });
    await run(a, 4, 'desktop');
    await run(b, 4, 'desktop');
    await run(a, 4, 'desktop');
    assert.equal(meshes, 2);
    await run(a, 8, 'desktop');
    assert.equal(meshes, 3);
    assert.equal(kept[1].nodes, null);
    assert.ok(kept[0].nodes);
    await run(a, 4, 'phone');
    assert.equal(meshes, 4);
  });

  test('desktop drops the least recently used mesh', async () => {
    const cache = createMeshCache();
    const surfaces = [box([40, 10, 10]), box([30, 10, 10]), box([20, 10, 10])];
    const made = [];
    const meshVolumeFn = async () => {
      const mesh = fakeMesh();
      made.push(mesh);
      return mesh;
    };
    const run = (surface) => solveSolid({
      study: beamStudy(200),
      positions: surface.positions,
      indices: surface.indices,
      faceIDs: surface.faceIds,
      material: material(4096),
      profile: 'desktop',
      cache,
      meshVolume: meshVolumeFn,
      solveTet10: linearSolve,
      solveStub: () => { throw new Error('stub'); },
    });
    await run(surfaces[0]);
    await run(surfaces[1]);
    await run(surfaces[0]);
    await run(surfaces[2]);
    assert.equal(made.length, 3);
    assert.equal(made[1].nodes, null);
    assert.ok(made[0].nodes);
    releaseMeshCache(cache);
    assert.equal(cache.entries.length, 0);
    assert.equal(made[0].nodes, null);
    assert.equal(made[2].nodes, null);
  });

  test('an E and yield change matches a full solve to 1e-9 relative', { timeout: 180_000 }, async () => {
    const surface = box([40, 10, 10]);
    const cache = createMeshCache();
    let meshes = 0;
    let solves = 0;
    const meshVolumeFn = async (part, options) => {
      meshes += 1;
      return meshVolume(part, options);
    };
    const solveTet10 = (mesh, mat) => {
      solves += 1;
      return linearSolve(mesh, mat);
    };
    const common = {
      study: beamStudy(200, 8),
      positions: surface.positions,
      indices: surface.indices,
      faceIDs: surface.faceIds,
      profile: 'desktop',
      cache,
      meshVolume: meshVolumeFn,
      solveTet10,
      solveStub: () => { throw new Error('stub'); },
    };
    const full = await solveSolid({ ...common, material: material(8192, 100) });
    dropCachedSolutions(cache);
    const base = await solveSolid({ ...common, material: material(4096, 50) });
    const scaled = await solveSolid({ ...common, material: material(8192, 100) });
    assert.equal(meshes, 1);
    assert.equal(solves, 2);
    assert.equal(base.meshReused, true);
    assert.equal(base.rescaled, false);
    assert.equal(scaled.meshReused, true);
    assert.equal(scaled.rescaled, true);
    assert.equal(scaled.stageTimings.meshing, 0);
    assert.equal(scaled.stageTimings.solving, 0);
    const worst = assertResultClose(scaled, full, 1e-9, 'rescale');
    assert.ok(worst <= 1e-9);
    assert.ok(scaled.stats.ms >= 0);
    assert.ok(full.stats.ms > scaled.stats.ms);
  });

  test('rescaling the real solver matches a full solve to 1e-9 relative', { timeout: 180_000 }, async () => {
    const surface = box([40, 10, 10]);
    const cache = createMeshCache();
    let solves = 0;
    const solveTet10 = (...args) => {
      solves += 1;
      return fea.solve_tet10(...args);
    };
    const common = {
      study: beamStudy(200, 8),
      positions: surface.positions,
      indices: surface.indices,
      faceIDs: surface.faceIds,
      profile: 'desktop',
      cache,
      meshVolume,
      solveTet10,
      solveStub: fea.solve,
    };
    const stiff = material(6500, 52.5);
    const soft = material(3250, 52.5);
    const full = await solveSolid({ ...common, material: stiff });
    dropCachedSolutions(cache);
    await solveSolid({ ...common, material: soft });
    const scaled = await solveSolid({ ...common, material: stiff });
    assert.equal(solves, 2);
    assert.equal(scaled.meshReused, true);
    assert.equal(scaled.rescaled, true);
    const worst = assertResultClose(scaled, full, 1e-9, 'wasm rescale');
    console.log(`wasm rescale worst relative error ${worst}`);
  });

  test('auto refine reuses the mesh for a material change and for a load change', async () => {
    const cache = createMeshCache();
    const surface = box([40, 10, 10]);
    let made = 0;
    let solves = 0;
    const meshVolumeFn = async (part, options) => {
      made += 1;
      assert.equal(options.sizing, undefined);
      return fakeMesh();
    };
    const common = {
      positions: surface.positions,
      indices: surface.indices,
      faceIDs: surface.faceIds,
      profile: 'desktop',
      cache,
      meshVolume: meshVolumeFn,
      solveTet10: (mesh, mat) => {
        solves += 1;
        return linearSolve(mesh, mat);
      },
      solveStub: () => { throw new Error('stub'); },
    };
    const study = { ...beamStudy(200), mesh: { target: 4, refine: 'auto' } };
    const first = await solveSolid({ ...common, study, material: material(4096) });
    const stiffer = await solveSolid({ ...common, study, material: material(8192) });
    assert.equal(made, 1);
    assert.equal(solves, 1);
    assert.equal(first.meshReused, false);
    assert.equal(stiffer.meshReused, true);
    assert.equal(stiffer.rescaled, true);
    assert.equal(stiffer.refineCount, first.refineCount);
    assert.ok(Array.isArray(stiffer.convergence) && stiffer.convergence.length === first.convergence.length);
    const loaded = {
      ...study,
      loads: [{ ...study.loads[0], vector: [0, 0, -400] }],
    };
    const again = await solveSolid({ ...common, study: loaded, material: material(8192) });
    assert.equal(made, 1);
    assert.equal(solves, 2);
    assert.equal(again.meshReused, true);
    assert.equal(again.rescaled, false);
  });

  test('doubling the force doubles displacement and a new direction rotates it', { timeout: 180_000 }, async () => {
    const surface = box([40, 10, 10]);
    const cache = createMeshCache();
    let meshes = 0;
    let solves = 0;
    const common = {
      positions: surface.positions,
      indices: surface.indices,
      faceIDs: surface.faceIds,
      profile: 'desktop',
      cache,
      material: material(4096, 52.5),
      meshVolume: async (part, options) => {
        meshes += 1;
        return meshVolume(part, options);
      },
      solveTet10: (...args) => {
        solves += 1;
        return fea.solve_tet10(...args);
      },
      solveStub: fea.solve,
    };
    const bend = beamStudy(200, 8);
    const doubled = beamStudy(400, 8);
    const sideways = beamStudy(400, 8);
    sideways.loads[0].vector = [0, -400, 0];
    sideways.loads[0].direction = '-y';
    const down = await solveSolid({ ...common, study: bend });
    const again = await solveSolid({ ...common, study: doubled });
    const turned = await solveSolid({ ...common, study: sideways });
    assert.equal(meshes, 1);
    assert.equal(solves, 3);
    assert.equal(down.meshReused, false);
    assert.equal(down.rescaled, false);
    assert.equal(again.meshReused, true);
    assert.equal(again.rescaled, false);
    assert.equal(turned.meshReused, true);
    assert.equal(turned.rescaled, false);
    const a = tipDisplacement(down);
    const b = tipDisplacement(again);
    const c = tipDisplacement(turned);
    const az = Math.abs(a[2]);
    const bz = Math.abs(b[2]);
    assert.ok(az > Math.abs(a[1]) * 2 && az > Math.abs(a[0]) * 2, `−Z tip ${a}`);
    assert.ok(relError(bz, az * 2) < 1e-4, `doubled Z ${b[2]} vs ${a[2]}`);
    assert.ok(relError(Math.hypot(b[0], b[1], b[2]), Math.hypot(a[0], a[1], a[2]) * 2) < 1e-4);
    const cy = Math.abs(c[1]);
    assert.ok(cy > Math.abs(c[2]) * 2 && cy > Math.abs(c[0]) * 2, `−Y tip ${c}`);
    assert.ok(cy > az * 1.5, `rotated |uy| ${cy} vs |uz| ${az}`);
    assert.ok(Math.abs(c[2]) < az * 0.5, `rotated uz ${c[2]} vs bend ${a[2]}`);
    const bendDir = b.map((value) => value / Math.hypot(b[0], b[1], b[2]));
    const turnDir = c.map((value) => value / Math.hypot(c[0], c[1], c[2]));
    const dot = bendDir[0] * turnDir[0] + bendDir[1] * turnDir[1] + bendDir[2] * turnDir[2];
    assert.ok(Math.abs(dot) < 0.5, `direction dot ${dot}`);
  });
});
