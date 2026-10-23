import assert from 'node:assert/strict';
import test, { before, describe } from 'node:test';
import * as fea from '../../packages/surfcad-fea/pkg/surfcad_fea.js';
import { FEA_SETUP_TIMEOUT_MS, initFeaWasm } from './initFeaWasm.js';
import { chooseEdgeLength, isThinPart, partShape, PHONE_DOF_CAPS, shellDofCap, THIN_ELEMENTS_THROUGH } from './deviceProfile.js';
import { SHEET_FLANGE_PROBE, SHEET_METALLICA_SCRIPT } from './fixtures/sheetMetallica.js';
import { formatDoneText } from './feaProgress.js';
import { countTetsAlong, jacobianAcceptable, meshVolume, tet10MinJacobian } from './meshVolume.js';
import { studyForSolve } from './renderFaceIds.js';
import { readFeaStudy } from './studyScript.js';
import { createMeshCache, solveSolid } from './solveSolid.js';
import {
  buildSheetShell,
  chooseAnalysisModel,
  shellBoundaryConditions,
  shellSheetFromScript,
} from './sheetMidsurface.js';
import { meshArraysFromGeometry } from './studyPanel.js';
import { buildSolidGeometry } from '../utils/partSolidCache.js';
import {
  REFERENCE_METRICS,
  REFERENCE_PATH,
  loadSheetMetallicaReference,
  referenceMetrics,
  relativeError,
} from './fixtures/sheetMetallicaReference.js';
import { SHELL_VS_TET_TOLERANCE } from './sheetShellTolerance.js';

// The Manifold runtime is imported here, not at load. Evaluating it (and
// compiling the FEA wasm) used to be a top-level await, which runs before
// any test is registered. The 180s test timeout never armed, and the file
// held a runner slot until the 30 minute job limit. CI run 38025008657
// attempt 1 stopped after the SendCutSend fixture test with neither
// "Manifold initialized" nor "bracket mesh dofs" printed.
let runScript;
before(async () => {
  console.log('sheet metallica setup: fea wasm');
  await initFeaWasm();
  console.log('sheet metallica setup: manifold runtime');
  ({ runScript } = await import('../lib/surfcad/index.js'));
  console.log('sheet metallica setup: ready');
}, { timeout: FEA_SETUP_TIMEOUT_MS });

const study = readFeaStudy(SHEET_METALLICA_SCRIPT);
const aluminum = { E_MPa: 68900, nu: 0.33, yield_MPa: 276 };

function finiteField(values) {
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) return false;
  }
  return values.length > 0;
}

function forceSum(bcs) {
  const sum = [0, 0, 0];
  for (let i = 0; i < bcs.forceValues.length; i += 3) {
    sum[0] += bcs.forceValues[i];
    sum[1] += bcs.forceValues[i + 1];
    sum[2] += bcs.forceValues[i + 2];
  }
  return sum;
}

function nodeCentroid(mesh, ids) {
  const c = [0, 0, 0];
  const list = [...ids];
  for (const id of list) {
    c[0] += mesh.nodes[id * 3];
    c[1] += mesh.nodes[id * 3 + 1];
    c[2] += mesh.nodes[id * 3 + 2];
  }
  if (list.length) {
    c[0] /= list.length;
    c[1] /= list.length;
    c[2] /= list.length;
  }
  return c;
}

async function surfaceOf() {
  const built = await runScript(SHEET_METALLICA_SCRIPT);
  const positions = Float32Array.from(built.mesh.vertProperties);
  const indices = Uint32Array.from(built.mesh.triVerts);
  const faceIDs = Uint32Array.from(built.mesh.faceID);
  try { built.manifold?.delete?.(); } catch { /* already freed */ }
  return { positions, indices, faceIDs };
}

describe('sheet metallica bracket', { concurrency: 1 }, () => {
  test('the auto mesh stays right-handed through the bends', { timeout: 180_000 }, async () => {
    const surface = await surfaceOf();
    const shape = partShape(surface.positions, surface.indices);
    assert.equal(isThinPart(shape), true);
    const shapeEdge = chooseEdgeLength(shape, 'auto', PHONE_DOF_CAPS.tet10Thin);
    const mesh = await meshVolume(surface, { edgeLength: shapeEdge.edgeLength, epsilon: 1e-3 });
    let worst = Infinity;
    let worstAt = -1;
    const n = mesh.elements.length / 10;
    for (let t = 0; t < n; t += 1) {
      const det = tet10MinJacobian(mesh.nodes, mesh.elements.subarray(t * 10, t * 10 + 10));
      if (det < worst) {
        worst = det;
        worstAt = t;
      }
      assert.equal(jacobianAcceptable(det), true, `element ${t} min Jacobian ${det}`);
    }
    const through = countTetsAlong(
      mesh.nodes,
      mesh.elements,
      SHEET_FLANGE_PROBE.at,
      SHEET_FLANGE_PROBE.inward,
      SHEET_FLANGE_PROBE.gaugeMm,
    );
    // Two isotropic elements through 3.175 mm want an edge near 1.5 mm, about
    // 960 000 degrees of freedom on this bracket. That is past the phone cap
    // and the thin-wall budget, and the cap's own edge (near the gauge) slivers.
    // The bbox edge stays. fTetWild still stacks several tets through the flange.
    console.log(`bracket mesh dofs ${mesh.stats.dofs} elements ${mesh.stats.elements} edge ${shapeEdge.edgeLength.toFixed(2)} mm through ${through} worstJ ${worst} at ${worstAt} straightened ${mesh.stats.straightenedMids} oriented ${mesh.stats.oriented} ms ${mesh.stats.ms}`);
    assert.equal(mesh.stats.positive, true);
    // Measured on the fixed flange: the ray through 3.175 mm crosses more
    // than one tet even at the bbox edge, because fTetWild refines to the
    // wall. Two isotropic elements (edge near 1.5 mm) would be about 960k
    // DOF and is not requested once the budget refuses it.
    assert.ok(through >= THIN_ELEMENTS_THROUGH, `flange ray crossed ${through} elements through ${SHEET_FLANGE_PROBE.gaugeMm} mm`);
    assert.equal(shapeEdge.coarsened, false);
  });

  test('the mid-surface is a welded T6 mesh and the picked faces land on the flanges', async () => {
    const spec = shellSheetFromScript(SHEET_METALLICA_SCRIPT);
    assert.ok(spec);
    assert.deepEqual(chooseAnalysisModel(study, spec), { kind: 'shell', warning: null });
    assert.equal(chooseAnalysisModel({ ...study, model: 'solid' }, spec).kind, 'solid');
    assert.equal(chooseAnalysisModel({ model: 'shell' }, null).kind, 'solid');
    assert.equal(shellSheetFromScript(`${SHEET_METALLICA_SCRIPT}\npart = part.add(sheetMetalSolid(sheetSpec));`), null);
    const mesh = buildSheetShell(spec, { target: 'auto', cap: shellDofCap('phone') });
    assert.equal(mesh.stats.coarsened, false);
    assert.ok(mesh.stats.dofs <= PHONE_DOF_CAPS.shell, `dofs ${mesh.stats.dofs}`);
    assert.ok(mesh.stats.edgeLength > 0);
    const across = mesh.stats.feature / mesh.stats.edgeLength;
    assert.ok(across >= 2 && across <= 3, `elements across the bend ${across}`);
    for (const region of mesh.regions) {
      if (region.kind !== 'bend') continue;
      for (const element of region.elements) {
        for (const slot of [3, 4, 5]) {
          const node = mesh.elements[element * 6 + slot];
          const point = [mesh.nodes[node * 3], mesh.nodes[node * 3 + 1], mesh.nodes[node * 3 + 2]];
          const rel = [
            point[0] - region.axis[0],
            point[1] - region.axis[1],
            point[2] - region.axis[2],
          ];
          const q = rel[0] * region.e[0] + rel[1] * region.e[1] + rel[2] * region.e[2];
          const radial = Math.hypot(
            rel[0] - q * region.e[0],
            rel[1] - q * region.e[1],
            rel[2] - q * region.e[2],
          );
          assert.ok(Math.abs(radial - region.rMid) < 1e-6, `${region.id} mid radius ${radial} vs ${region.rMid}`);
        }
      }
    }
    const base = mesh.regions.find((region) => region.id === 'panel:base');
    const bend = mesh.regions.find((region) => region.id === 'bend:b1');
    const baseNodes = new Set();
    for (const element of base.elements) {
      for (let k = 0; k < 6; k += 1) baseNodes.add(mesh.elements[element * 6 + k]);
    }
    let shared = 0;
    for (const element of bend.elements) {
      for (let k = 0; k < 6; k += 1) {
        if (baseNodes.has(mesh.elements[element * 6 + k])) shared += 1;
      }
    }
    assert.ok(shared > 0, 'the bend is welded to the base');

    const built = await runScript(SHEET_METALLICA_SCRIPT);
    const solid = buildSolidGeometry(built.mesh);
    const surface = meshArraysFromGeometry(solid.geometry, solid.faceIDs);
    const expanded = studyForSolve(study, solid.geometry, solid.faceIDs);
    try { built.manifold?.delete?.(); } catch { /* already freed */ }
    const bcs = shellBoundaryConditions(mesh, surface.positions, surface.indices, surface.faceIDs, expanded, { diagonal: 200 });
    assert.ok(bcs.clampedNodes.length > 0 && bcs.clampedNodes.length < mesh.stats.nodes / 2);
    const fixedAt = nodeCentroid(mesh, bcs.clampedNodes);
    const loadedAt = nodeCentroid(mesh, bcs.forceNodes);
    assert.ok(fixedAt[0] > 40, `fixed flange centroid ${fixedAt}`);
    assert.ok(loadedAt[0] < -40, `loaded flange centroid ${loadedAt}`);
    const sum = forceSum(bcs);
    assert.ok(Math.abs(sum[0]) < 1e-6 && Math.abs(sum[1] - 200) < 1e-6 && Math.abs(sum[2]) < 1e-6, `force ${sum}`);
    console.log(`shell mesh dofs ${mesh.stats.dofs} edge ${mesh.stats.edgeLength.toFixed(2)} mm across ${across.toFixed(2)} clamped ${bcs.clampedNodes.length}`);
  });

  test('phone and desktop shell solves finish with a finite stress field', { timeout: 120_000 }, async () => {
    const spec = shellSheetFromScript(SHEET_METALLICA_SCRIPT);
    const built = await runScript(SHEET_METALLICA_SCRIPT);
    const solid = buildSolidGeometry(built.mesh);
    const surface = meshArraysFromGeometry(solid.geometry, solid.faceIDs);
    const expanded = studyForSolve(study, solid.geometry, solid.faceIDs);
    try { built.manifold?.delete?.(); } catch { /* already freed */ }
    const cache = createMeshCache();
    let desktop = null;
    for (const profile of ['phone', 'desktop']) {
      const result = await solveSolid({
        study: expanded,
        positions: surface.positions,
        indices: surface.indices,
        faceIDs: surface.faceIDs,
        material: aluminum,
        profile,
        sheetSpec: spec,
        solveShell: fea.solve_shell,
        solveTet10: fea.solve_tet10,
        solveStub: fea.solve,
        cache,
      });
      assert.equal(result.source, 'shell');
      assert.equal(result.solver, 'cholesky');
      assert.equal(result.shells, true);
      assert.equal(finiteField(result.nodal), true);
      assert.equal(finiteField(result.displacement), true);
      assert.equal(result.nodal.length, surface.positions.length / 3);
      assert.ok(result.max > 0.05 && result.max < 5000, `max ${result.max} MPa`);
      assert.ok(result.p95 > 0 && result.p95 <= result.max);
      assert.ok(Math.abs(result.safetyFactor - (aluminum.yield_MPa / result.p95)) < 1e-6);
      assert.ok(result.displacementMax > 0.1, `displacement ${result.displacementMax}`);
      assert.ok(result.stats.dofs <= PHONE_DOF_CAPS.shell);
      const timing = formatDoneText({
        timings: result.stageTimings,
        dofs: result.stats.dofs,
        source: result.source,
        meshReused: result.meshReused,
        startedAt: 0,
        now: result.stats.ms,
      });
      assert.match(timing, result.meshReused ? /Shell mesh reused/ : /Shell mesh in .+ solved in .+ DOF.+total/);
      assert.equal(result.warnings.some((warning) => warning.code === 'mesh-coarse'), false);
      if (profile === 'desktop') desktop = result;
      console.log(`${profile} shell dofs ${result.stats.dofs} mesh ${result.stats.meshMs} ms solve ${result.stageTimings.solving} ms max ${result.max.toFixed(2)} MPa p95 ${result.p95.toFixed(2)} u ${result.displacementMax.toFixed(3)} mm ${timing}`);
    }
    const modal = await solveSolid({
      study: { ...expanded, type: 'modal' },
      positions: surface.positions,
      indices: surface.indices,
      faceIDs: surface.faceIDs,
      material: { ...aluminum, density_kg_m3: 2700 },
      profile: 'desktop',
      sheetSpec: spec,
      solveShell: fea.solve_shell,
      modalShell: fea.modal_shell,
      solveTet10: fea.solve_tet10,
      solveStub: fea.solve,
      cache,
    });
    assert.equal(modal.source, 'modal');
    assert.equal(modal.field, 'mode');
    assert.equal(modal.solver, 'lobpcg');
    assert.equal(modal.rescaled, false);
    assert.ok(modal.frequenciesHz[0] > 1, `sheet frequency ${modal.frequenciesHz[0]}`);
    assert.equal(modal.displacement.length, surface.positions.length / 3);
    assert.equal(modal.modeMagnitudes.length, modal.frequenciesHz.length * modal.displacement.length);
    assert.ok(modal.warnings.some((warning) => warning.code === 'modal-loads'));
    assert.equal(modal.meshReused, true);
    console.log(`sheet modal f1 ${modal.frequenciesHz[0].toFixed(2)} Hz dofs ${modal.stats.dofs} solve ${modal.stats.solveMs} ms`);

    const softer = await solveSolid({
      study: expanded,
      positions: surface.positions,
      indices: surface.indices,
      faceIDs: surface.faceIDs,
      material: { E_MPa: aluminum.E_MPa / 2, nu: aluminum.nu, yield_MPa: aluminum.yield_MPa },
      profile: 'desktop',
      sheetSpec: spec,
      solveShell: fea.solve_shell,
      solveTet10: fea.solve_tet10,
      solveStub: fea.solve,
      cache,
    });
    assert.equal(softer.rescaled, true);
    assert.equal(softer.meshReused, true);
    assert.ok(Math.abs(softer.p95 - desktop.p95) / desktop.p95 < 1e-6, 'stress is unchanged when only E changes');
    assert.ok(Math.abs(softer.displacementMax / desktop.displacementMax - 2) < 0.02, `displacement ${softer.displacementMax} vs ${desktop.displacementMax}`);
  });

  test('shell displacement and p95 stay near the committed fine TET10 reference', { timeout: 60_000 }, async () => {
    // The TET10 side is `src/fea/fixtures/sheetMetallicaReference.json`,
    // the median of several 3 mm fTetWild meshes solved with the committed
    // wasm (see fixtures/sheetMetallicaReference.js for why it is not meshed
    // here). `npm run golden:fea-shell-vs-tet` rebuilds that mesh and checks
    // a fresh run against the stored spread; `--write` refreshes the file.
    let ref;
    try {
      ref = loadSheetMetallicaReference();
    } catch (error) {
      assert.fail(error.message);
    }
    const spec = shellSheetFromScript(SHEET_METALLICA_SCRIPT);
    const built = await runScript(SHEET_METALLICA_SCRIPT);
    const solid = buildSolidGeometry(built.mesh);
    const surface = meshArraysFromGeometry(solid.geometry, solid.faceIDs);
    const expanded = studyForSolve(study, solid.geometry, solid.faceIDs);
    try { built.manifold?.delete?.(); } catch { /* already freed */ }
    const shell = referenceMetrics(await solveSolid({
      study: expanded,
      positions: surface.positions,
      indices: surface.indices,
      faceIDs: surface.faceIDs,
      material: aluminum,
      profile: 'desktop',
      sheetSpec: spec,
      solveShell: fea.solve_shell,
      solveTet10: fea.solve_tet10,
      solveStub: fea.solve,
    }));
    const errors = {};
    for (const key of REFERENCE_METRICS) errors[key] = relativeError(shell[key], ref.tet[key]);
    console.log(`compare shell u ${shell.displacementMax.toFixed(3)} ref tet u ${ref.tet.displacementMax.toFixed(3)} (${(100 * errors.displacementMax).toFixed(2)}%) shell p95 ${shell.p95.toFixed(2)} ref tet p95 ${ref.tet.p95.toFixed(2)} (${(100 * errors.p95).toFixed(2)}%) surface p95 ${(100 * errors.surfaceP95).toFixed(2)}% shell ${shell.dofs} dof ${shell.solveMs} ms reference ${ref.runs.length} tet runs median ${ref.tet.dofs} dof from ${ref.generatedAt}`);
    // Limits and the measured spread behind them: src/fea/sheetShellTolerance.js.
    for (const key of REFERENCE_METRICS) {
      assert.ok(
        errors[key] <= SHELL_VS_TET_TOLERANCE[key],
        `${key} ${(100 * errors[key]).toFixed(2)}% from the ${REFERENCE_PATH} median (limit ${(100 * SHELL_VS_TET_TOLERANCE[key]).toFixed(0)}%)`,
      );
    }
  });

  test('auto refine reports a convergence history', { timeout: 420_000 }, async () => {
    const built = await runScript(SHEET_METALLICA_SCRIPT);
    const solid = buildSolidGeometry(built.mesh);
    const surface = meshArraysFromGeometry(solid.geometry, solid.faceIDs);
    const expanded = studyForSolve(study, solid.geometry, solid.faceIDs);
    try { built.manifold?.delete?.(); } catch { /* already freed */ }
    expanded.model = 'solid';
    expanded.mesh = { ...expanded.mesh, refine: 'auto' };
    const result = await solveSolid({
      study: expanded,
      positions: surface.positions,
      indices: surface.indices,
      faceIDs: surface.faceIDs,
      material: aluminum,
      profile: 'phone',
      solveTet10: fea.solve_tet10,
      solveStub: fea.solve,
      meshVolume,
    });
    assert.ok(Array.isArray(result.convergence) && result.convergence.length >= 1);
    for (let i = 0; i < result.convergence.length; i += 1) {
      const row = result.convergence[i];
      const change = i === 0 || !(result.convergence[i - 1].p95 > 0)
        ? null
        : Math.abs(row.p95 - result.convergence[i - 1].p95) / result.convergence[i - 1].p95;
      console.log(
        `bracket pass ${row.pass} dof ${row.dof} p95 ${Number(row.p95).toFixed(3)} max ${Number(row.max).toFixed(3)} umax ${row.umax == null ? 'n/a' : Number(row.umax).toFixed(4)} err ${Number(row.errEst).toFixed(4)}`
        + (change == null ? '' : ` dp95 ${(change * 100).toFixed(2)}%`),
      );
      assert.equal(typeof row.pass, 'number');
      assert.ok(row.dof > 0);
      assert.ok(Number.isFinite(row.p95) && Number.isFinite(row.max) && Number.isFinite(row.errEst));
      assert.ok(row.umax == null || Number.isFinite(row.umax));
    }
    assert.equal(typeof result.converged, 'boolean');
    assert.equal(typeof result.errEst, 'number');
    console.log(`bracket converged ${result.converged} refined ${result.refineCount}x err ${Number(result.errEst).toFixed(4)} ms ${result.stats.ms}`);
  });
});
