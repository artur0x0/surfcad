/**
 * Manifold surface to a TET10 von Mises field.
 *
 * meshVolume turns the render triangles into a quadratic tet mesh and copies
 * face ids onto the boundary. Fixtures and loads on those face ids become
 * nodal constraints and consistent tractions. solve_tet10 returns nodal von
 * Mises and nodal displacement. Both are sampled onto the render vertices,
 * keyed by faceID and position. Displacement is the magnitude in millimetres.
 * The render mesh is not deformed.
 *
 * The worker passes a mesh cache. The mesh key is the surface hash, the
 * mesh target, and the device profile. A material change, a fixture edit,
 * and a load magnitude or direction change all reuse that TET10 mesh,
 * including an adaptive mesh. When only E and/or yield change, with the
 * same ν and the same force and pressure loads, the cached solution is
 * rescaled and solve_tet10 is not called: stress stays put, displacement
 * is multiplied by E_old / E_new, and the safety factor is yield / p95.
 * The stored convergence rows scale the same way. A different fixture,
 * load vector, or direction misses that solution key and re-solves once
 * on the cached mesh. The phone cache holds one mesh; desktop holds two.
 * Evicting an entry releases its arrays.
 *
 * A pure sheet-metal part (`sheetMetalSolid`, study model "auto" or "shell")
 * is meshed on its mid-surface and solved with solve_shell. study model
 * "solid" keeps TET10. A non-sheet part stays on TET10; the general
 * thin-solid midsurface heuristic is not implemented.
 */

import { boundaryConditions } from './boundaryConditions.js';
import { solveModal, solveSheetModal } from './solveModal.js';
import {
  chooseEdgeLength,
  chooseSolver,
  dofCap,
  isThinPart,
  partShape,
  phoneRefineStopNote,
  refineDofCap,
  refineMode,
  refinePassLimit,
  refineStepAllowed,
  SHELLS_AVAILABLE,
  shellDofCap,
  THIN_ELEMENTS_THROUGH,
} from './deviceProfile.js';
import {
  convergedOn,
  ERROR_TARGET,
  recoveryEstimate,
  scaleConvergence,
  sizingFromError,
} from './errorEstimate.js';
import {
  buildSheetShell,
  chooseAnalysisModel,
  sampleShellSurface,
  shellBoundaryConditions,
} from './sheetMidsurface.js';
import { packProbeSurface, packShellProbe } from './probeSample.js';
import {
  fieldRange,
  safetyFactor,
  sampleSurfaceDisplacement,
  sampleSurfaceStress,
} from './stressSample.js';
import { PHONE_WASM_BYTES, workerMemorySample } from './wasmMemory.js';

function abortError() {
  const error = new Error('FEA solve cancelled');
  error.name = 'AbortError';
  return error;
}

function yieldTurn() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function plainWarnings(list) {
  if (!Array.isArray(list)) return [];
  return list.map((warning) => ({
    code: warning && warning.code ? String(warning.code) : 'warning',
    msg: warning && warning.msg ? String(warning.msg) : '',
  })).filter((warning) => warning.msg);
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * `solveTet10`, `solveShell`, and `solveStub` are the wasm exports.
 * `meshVolume` is injected in tests; the app loads it on the first call so
 * the mesher stays out of the initial bundle. `fallback: "stub"` is the
 * dev-only placeholder. `sheetSpec` is the pure sheet-metal spec, or null.
 * `cache` is the worker's mesh cache (`createMeshCache`). Without it, every
 * call meshes.
 */
export function createMeshCache() {
  return { entries: [] };
}

/** Drop every cached mesh and its saved solution. */
export function releaseMeshCache(cache) {
  if (!cache?.entries) return;
  while (cache.entries.length) freeCacheEntry(cache.entries.pop());
}

/** Keep the meshes and forget the saved solutions, so the next run re-solves. */
export function dropCachedSolutions(cache) {
  if (!cache?.entries) return;
  for (const entry of cache.entries) clearSolution(entry);
}

/** Drop one cache entry, including a bonded entry that holds several meshes. */
export function releaseCachedMesh(entry, releaseMesh) {
  freeCacheEntry(entry, releaseMesh);
}

function multiPartStudy(study) {
  const kind = study && study.scope ? study.scope.kind : null;
  return kind === 'assembly' || kind === 'parts';
}

export async function solveSolid({
  study,
  positions,
  indices,
  faceIDs,
  material,
  profile,
  fallback,
  solveTet10,
  solveShell,
  modalTet10,
  modalShell,
  solveStub,
  sheetSpec,
  solveBonded,
  solveContact,
  meshVolume,
  cache,
  parts,
  isCancelled,
  onProgress,
  memory,
  noteMemory,
  peakMemory,
}) {
  const cancelled = () => (typeof isCancelled === 'function' ? isCancelled() : false);
  const progress = (update) => {
    if (typeof onProgress === 'function') onProgress(update);
  };
  const timings = {};
  if (cancelled()) throw abortError();

  if (multiPartStudy(study) && Array.isArray(parts) && parts.length > 0) {
    const { solveAssembly } = await import('./solveAssembly.js');
    return solveAssembly({
      study,
      parts,
      profile,
      solveBonded,
      solveContact,
      meshVolume,
      cache,
      isCancelled,
      onProgress,
      memory,
      noteMemory,
      peakMemory,
    });
  }

  if (fallback === 'stub') {
    const stubStarted = Date.now();
    progress({ stage: 'meshing', fraction: 0 });
    const result = solveStub(study, positions, indices, faceIDs, material, profile || 'desktop');
    timings.meshing = Date.now() - stubStarted;
    timings.solving = 0;
    timings['post-processing'] = 0;
    progress({ stage: 'post-processing', fraction: 1, dofs: result && result.stats ? result.stats.dofs : null });
    if (typeof noteMemory === 'function') noteMemory();
    if (result && typeof result === 'object') result.stageTimings = timings;
    return result;
  }

  const shape = partShape(positions, indices);
  if (!(shape.volume > 0) || !(indices && indices.length)) {
    throw new Error('The part has no solid volume to mesh.');
  }
  const modelChoice = chooseAnalysisModel(study, sheetSpec);
  if (modelChoice.kind === 'shell') {
    const modalStudy = study && study.type === 'modal';
    if (modalStudy && typeof modalShell !== 'function') {
      throw new Error('Modal analysis is not in this FEA build.');
    }
    if (!modalStudy && typeof solveShell !== 'function') {
      throw new Error('The shell solver is not loaded.');
    }
    const tools = await import('./meshVolume.js');
    return solveSheetMetal({
      study,
      positions,
      indices,
      faceIDs,
      material,
      profile,
      sheetSpec,
      solveShell,
      modalShell,
      cache,
      tools,
      isCancelled,
      onProgress,
      memory,
      noteMemory,
      peakMemory,
      shape,
    });
  }
  const thin = isThinPart(shape);
  const solver = chooseSolver(shape);
  const cap = dofCap(profile, thin, solver);
  const target = study && study.mesh ? study.mesh.target : undefined;
  const edge = chooseEdgeLength(shape, target, cap);
  const warnings = [];
  if (modelChoice.warning) warnings.push(modelChoice.warning);
  if (edge.coarsened) {
    const short = edge.elementsThrough != null && edge.elementsThrough < THIN_ELEMENTS_THROUGH;
    const throughText = short
      ? ` That is coarser than ${THIN_ELEMENTS_THROUGH} elements through the ${edge.wallMm.toFixed(2)} mm wall.`
      : '';
    const why = Number.isFinite(cap)
      ? `The phone DOF cap (${cap}) coarsened the mesh from ${edge.requested.toFixed(2)} mm to ${edge.edgeLength.toFixed(2)} mm edges.`
      : `A ${edge.requested.toFixed(2)} mm edge (2 through the ${edge.wallMm.toFixed(2)} mm wall) does not fit in memory, so the mesh keeps ${edge.edgeLength.toFixed(2)} mm edges.`;
    warnings.push({
      code: 'mesh-coarse',
      msg: `${why}${throughText}`,
    });
  }

  progress({ stage: 'loading-mesher' });
  await yieldTurn();
  if (cancelled()) throw abortError();
  const loadStarted = Date.now();
  const tools = (cache || !meshVolume) ? await import('./meshVolume.js') : null;
  const loadMesh = meshVolume || tools.meshVolume;
  timings['loading-mesher'] = Date.now() - loadStarted;

  const device = profile === 'phone' ? 'phone' : 'desktop';
  const mode = refineMode(study, device);
  const passLimit = mode === 'auto' ? refinePassLimit(device) : 1;
  const refineCap = refineDofCap(device, thin, solver);
  const signature = bcSignature(study);
  // The mesh key ignores fixtures and loads. The solution key (`signature`)
  // does not, so a load edit re-solves on the mesh already in the cache.
  const cacheKey = cache
    ? tools.meshCacheKey({ positions, indices, faceIDs }, target, device)
    : '';
  let entry = cache ? takeCacheEntry(cache, cacheKey) : null;
  let volume = entry?.mesh?.nodes ? entry.mesh : null;
  let meshReused = false;
  let started = Date.now();
  let meshMs = 0;
  let assembleMs = 0;
  let solveMs = 0;
  const tagging = mode === 'auto';
  const progressPass = (update, pass) => {
    progress({
      ...update,
      ...(tagging && !meshReused ? { refinePass: pass, refinePasses: passLimit } : {}),
    });
  };
  const meshOnce = async (edgeLength, sizing, pass) => {
    progressPass({ stage: 'meshing' }, pass);
    await yieldTurn();
    if (cancelled()) throw abortError();
    const ceiling = profile === 'phone' ? PHONE_WASM_BYTES : 0;
    const meshStarted = Date.now();
    const mesh = await loadMesh(
      { positions, indices, faceIds: faceIDs },
      {
        edgeLength,
        epsilon: 1e-3,
        maxTets: 0,
        memoryCeilingBytes: ceiling,
        sizing: sizing ? {
          positions: sizing.positions,
          tets: sizing.tets,
          values: sizing.values,
        } : undefined,
        onProgress: (update) => progressPass({ stage: 'meshing', ...(update || {}) }, pass),
      },
    );
    meshMs += Date.now() - meshStarted;
    return mesh;
  };

  if (volume) {
    meshReused = true;
    timings['loading-mesher'] = 0;
    timings.meshing = 0;
    started = Date.now();
    progressPass({ stage: 'meshing', fraction: 1 }, 1);
  } else {
    entry = null;
    if (cache) evictCache(cache, tools.meshCacheLimit(device), tools.releaseMesh);
    started = Date.now();
    volume = await meshOnce(edge.edgeLength, null, 1);
    if (cancelled()) {
      tools?.releaseMesh?.(volume);
      throw abortError();
    }
  }

  if (study && study.type === 'modal') {
    progress({ stage: 'assembling' });
    await yieldTurn();
    if (cancelled()) throw abortError();
    const assembleStarted = Date.now();
    const bcs = boundaryConditions(volume, study || {}, { diagonal: shape.diagonal });
    timings.meshing = meshMs;
    timings.assembling = Date.now() - assembleStarted;
    warnings.push(...bcs.warnings);
    if (cache && volume && !entry) entry = pushCacheEntry(cache, cacheKey, volume);
    return solveModal({
      study,
      positions,
      indices,
      faceIDs,
      material,
      profile,
      volume,
      edge,
      bcs,
      warnings,
      timings,
      started,
      meshReused,
      thin,
      modalTet10,
      progress,
      noteMemory,
      memory,
      peakMemory,
      cancelled,
    });
  }

  const yieldMPa = material && material.yield_MPa != null && Number.isFinite(Number(material.yield_MPa))
    ? Number(material.yield_MPa)
    : null;
  let bcWarnings = [];
  const solveOnce = async (mesh, pass) => {
    progressPass({ stage: 'assembling' }, pass);
    await yieldTurn();
    if (cancelled()) throw abortError();
    const assembleStarted = Date.now();
    const bcs = boundaryConditions(mesh, study || {}, { diagonal: shape.diagonal });
    assembleMs += Date.now() - assembleStarted;
    bcWarnings = bcs.warnings;
    if (!bcs.fixedNodes.length) {
      if (!meshReused) tools?.releaseMesh?.(mesh);
      throw new Error('Fix a face before running the study.');
    }
    const bcPayload = { fixedNodes: bcs.fixedNodes };
    if (bcs.forceNodes.length) {
      bcPayload.forceNodes = bcs.forceNodes;
      bcPayload.forceValues = bcs.forceValues;
    }
    if (bcs.pressureFaces.length) {
      bcPayload.pressureFaces = bcs.pressureFaces;
      bcPayload.pressures = bcs.pressures;
    }
    progressPass({
      stage: 'solving',
      solver,
      blocking: true,
      choleskyStep: solver === 'cholesky' ? 'factor' : undefined,
      fraction: solver === 'cholesky' ? 0.5 : undefined,
    }, pass);
    await yieldTurn();
    if (cancelled()) throw abortError();
    const solveStarted = Date.now();
    let solvedPass;
    try {
      solvedPass = solveTet10(
        { nodes: mesh.nodes, elements: mesh.elements },
        { E_MPa: material.E_MPa, nu: material.nu, yield_MPa: yieldMPa },
        bcPayload,
        { solver },
      );
    } finally {
      if (!solvedPass) progressPass({ stage: 'solving', solver, blocking: false }, pass);
    }
    solveMs += Date.now() - solveStarted;
    const solvedStats = solvedPass && solvedPass.stats ? solvedPass.stats : {};
    const solvedDofs = solvedStats.dofs != null ? solvedStats.dofs : mesh.stats.dofs;
    if (solver === 'cholesky') {
      progressPass({
        stage: 'solving',
        solver,
        blocking: false,
        choleskyStep: 'solve',
        fraction: 1,
        dofs: solvedDofs,
      }, pass);
    } else {
      progressPass({
        stage: 'solving',
        solver,
        blocking: false,
        iteration: solvedStats.iterations,
        residual: solvedStats.residual,
        residual0: Number.isFinite(solvedStats.residual) ? 1 : undefined,
        tol: 1e-8,
        dofs: solvedDofs,
      }, pass);
    }
    return solvedPass;
  };

  let solved = null;
  let rescaled = false;
  let rows = [];
  let refineCount = 0;
  let refineNote = '';
  let usedEdge = edge.edgeLength;

  if (meshReused) {
    if (entry.report && entry.report.refineNote) refineNote = entry.report.refineNote;
    progressPass({ stage: 'assembling' }, 1);
    await yieldTurn();
    if (cancelled()) throw abortError();
    const assembleStarted = Date.now();
    const reusedBcs = boundaryConditions(volume, study || {}, { diagonal: shape.diagonal });
    assembleMs += Date.now() - assembleStarted;
    bcWarnings = reusedBcs.warnings;
    if (!reusedBcs.fixedNodes.length) throw new Error('Fix a face before running the study.');
    solved = rescaleSolution(entry, material, yieldMPa, signature);
    if (solved) {
      rescaled = true;
      solveMs = 0;
      const ratio = entry.solution.E / Number(material.E_MPa);
      rows = entry.report && entry.report.convergence && entry.report.convergence.length
        ? scaleConvergence(entry.report.convergence, ratio)
        : [convergenceRow(1, solved, volume, maxMagnitude(solved.displacement), entry.report ? entry.report.errEst : 0)];
      refineCount = entry.report && entry.report.refineCount ? entry.report.refineCount : 0;
      if (entry.report && entry.report.edgeLength > 0) usedEdge = entry.report.edgeLength;
      progressPass({
        stage: 'solving',
        solver: solved.solver || solver,
        blocking: false,
        fraction: 1,
        dofs: solved.stats ? solved.stats.dofs : volume.stats.dofs,
      }, 1);
    } else {
      solved = await solveOnce(volume, 1);
      const estimate = safeEstimate(volume, solved, material);
      const row = convergenceRow(
        ((entry.report && entry.report.convergence && entry.report.convergence.length) || 0) + 1,
        solved,
        volume,
        maxMagnitude(solved.displacement),
        estimate.errEst,
      );
      rows = [...((entry.report && entry.report.convergence) || []), row];
      refineCount = entry.report && entry.report.refineCount ? entry.report.refineCount : 0;
      if (entry.report && entry.report.edgeLength > 0) usedEdge = entry.report.edgeLength;
    }
  } else {
    let sizing = null;
    for (let pass = 1; pass <= passLimit; pass += 1) {
      if (pass > 1) {
        if (device === 'phone') {
          const previousVolume = volume;
          const previousSolved = solved;
          const previousEdge = usedEdge;
          let nextVolume;
          try {
            nextVolume = await meshOnce(sizing.edgeLength, sizing, pass);
          } catch (error) {
            tools?.releaseMesh?.(previousVolume);
            throw error;
          }
          const meshedDofs = nextVolume && nextVolume.stats ? nextVolume.stats.dofs : 0;
          if (!refineStepAllowed('phone', meshedDofs, refineCap)) {
            tools?.releaseMesh?.(nextVolume);
            volume = previousVolume;
            solved = previousSolved;
            usedEdge = previousEdge;
            refineNote = phoneRefineStopNote(refineCap);
            if (cancelled()) {
              tools?.releaseMesh?.(volume);
              throw abortError();
            }
            break;
          }
          tools?.releaseMesh?.(previousVolume);
          volume = nextVolume;
        } else {
          tools?.releaseMesh?.(volume);
          volume = await meshOnce(sizing.edgeLength, sizing, pass);
        }
        usedEdge = sizing.edgeLength;
        if (cancelled()) {
          tools?.releaseMesh?.(volume);
          throw abortError();
        }
      }
      solved = await solveOnce(volume, pass);
      if (typeof noteMemory === 'function') noteMemory(volume);
      if (cancelled()) throw abortError();
      const estimate = safeEstimate(volume, solved, material);
      rows.push(convergenceRow(
        pass,
        solved,
        volume,
        maxMagnitude(solved.displacement),
        estimate.errEst,
      ));
      if (mode !== 'auto' || pass === passLimit) break;
      // The first pass can still be locally coarse when the energy norm is
      // already under the target, so allow one remesh. After that, a global
      // error under the target stops the loop before a corner singularity
      // is chased. A settled p95 stops at any pass.
      if (convergedOn(rows)) break;
      if (pass > 1 && estimate.errEst <= ERROR_TARGET) break;
      sizing = sizingFromError({
        nodes: volume.nodes,
        elements: volume.elements,
        elementError: estimate.elementError,
        baseEdge: usedEdge,
        cap: refineCap,
      });
      const forecast = Number.isFinite(sizing.uncappedDofs) ? sizing.uncappedDofs : sizing.estimatedDofs;
      if (device === 'phone' && !refineStepAllowed('phone', forecast, refineCap)) {
        refineNote = phoneRefineStopNote(refineCap);
        break;
      }
      if (!sizing.canRefine) break;
    }
    refineCount = Math.max(0, rows.length - 1);
  }

  if (Number.isFinite(cap) && volume.stats.dofs > cap * 1.25) {
    warnings.push({
      code: 'dof-cap',
      msg: `The mesh has ${volume.stats.dofs} degrees of freedom, above the phone cap of ${cap}.`,
    });
  }
  warnings.push(...bcWarnings);

  const converged = convergedOn(rows);
  const errEst = rows.length ? rows[rows.length - 1].errEst : 0;
  if (cache && volume) {
    if (!entry) entry = pushCacheEntry(cache, cacheKey, volume);
    if (!rescaled) {
      rememberSolution(entry, material, signature, solved, linearLoads(study));
      entry.report = {
        convergence: rows.map((row) => ({ ...row })),
        converged,
        refineCount,
        refineNote,
        errEst,
        edgeLength: usedEdge,
      };
    }
  }

  const solvedStats = solved && solved.stats ? solved.stats : {};
  const solvedDofs = solvedStats.dofs != null ? solvedStats.dofs : volume.stats.dofs;
  if (typeof noteMemory === 'function') noteMemory(volume);
  progressPass({ stage: 'post-processing', fraction: 0.9, dofs: solvedDofs }, rows.length || 1);
  const postStarted = Date.now();
  const tetField = Float64Array.from(solved.nodal);
  const nodal = sampleSurfaceStress(positions, indices, faceIDs, volume, tetField);
  let displacement = null;
  let displacementMin = null;
  let displacementMax = null;
  const nodeCount = volume.nodes.length / 3;
  const nodalDisp = solved.displacement;
  if (nodalDisp && nodalDisp.length >= nodeCount * 3) {
    displacement = sampleSurfaceDisplacement(positions, indices, faceIDs, volume, nodalDisp);
    const dispRange = fieldRange(displacement);
    displacementMin = dispRange.min;
    displacementMax = dispRange.max;
  }
  const tetRange = fieldRange(tetField);
  const min = asNumber(solved.min) ?? tetRange.min;
  const max = asNumber(solved.max) ?? tetRange.max;
  const p95 = asNumber(solved.p95) ?? tetRange.p95;
  const factor = solved.safetyFactor != null ? solved.safetyFactor : safetyFactor(yieldMPa, p95);
  const solverWarnings = plainWarnings(solved.warnings);
  for (const warning of solverWarnings) {
    if (warning.code === 'missing-yield' || warning.code === 'zero-stress' || warning.code === 'cholesky-index') {
      warnings.push(warning);
    }
  }
  timings['post-processing'] = Date.now() - postStarted;
  progressPass({ stage: 'post-processing', fraction: 1, dofs: solvedDofs }, rows.length || 1);

  const elapsed = Date.now() - started;
  return {
    source: 'tet10',
    field: 'von_mises',
    units: 'MPa',
    nodal,
    displacement,
    displacementMin,
    displacementMax,
    min,
    max,
    p95,
    safetyFactor: factor == null ? null : factor,
    fos: factor == null ? null : factor,
    warnings,
    solver: solved.solver || solver,
    meshReused,
    rescaled,
    errEst,
    convergence: rows,
    converged,
    refineCount,
    refineNote,
    // Loading the worker is timed on the main thread. These four are the
    // worker's own clocks. A reused mesh reports meshing as zero; the
    // timing line says "Mesh reused" from meshReused. Refine passes add
    // into meshing, assembling, and solving.
    stageTimings: {
      ...(meshReused ? { 'loading-mesher': 0 } : {}),
      meshing: meshReused ? 0 : meshMs,
      assembling: assembleMs,
      solving: solveMs,
      'post-processing': timings['post-processing'],
    },
    thin,
    shells: SHELLS_AVAILABLE,
    probe: packProbeSurface(volume, {
      stress: tetField,
      displacement: nodalDisp,
    }, 'local'),
    stats: {
      dofs: solved.stats ? solved.stats.dofs : volume.stats.dofs,
      freeDofs: solved.stats ? solved.stats.freeDofs : 0,
      ms: elapsed,
      meshMs: meshReused ? 0 : meshMs,
      solveMs: rescaled ? 0 : solveMs,
      vertices: positions.length / 3,
      triangles: indices.length / 3,
      elements: volume.stats.elements,
      edgeLength: usedEdge,
      peakMemoryBytes: typeof peakMemory === 'function'
        ? peakMemory()
        : peakBytes(memory, volume),
      wasmMemoryMaxBytes: profile === 'phone' ? PHONE_WASM_BYTES : null,
    },
  };
}

function maxMagnitude(displacement) {
  if (!displacement || displacement.length < 3) return null;
  let max = 0;
  for (let i = 0; i < displacement.length; i += 3) {
    const value = Math.hypot(displacement[i] || 0, displacement[i + 1] || 0, displacement[i + 2] || 0);
    if (value > max) max = value;
  }
  return max;
}

function safeEstimate(volume, solved, material) {
  try {
    if (!volume || !solved || !solved.displacement) {
      return { errEst: 0, elementError: new Float64Array(0), elementVolume: new Float64Array(0) };
    }
    return recoveryEstimate({
      nodes: volume.nodes,
      elements: volume.elements,
      displacement: solved.displacement,
      material,
    });
  } catch {
    return { errEst: 0, elementError: new Float64Array(0), elementVolume: new Float64Array(0) };
  }
}

function convergenceRow(pass, solved, volume, umax, errEst) {
  const stats = solved && solved.stats ? solved.stats : {};
  const dof = stats.dofs != null ? stats.dofs : (volume && volume.stats ? volume.stats.dofs : 0);
  return {
    pass,
    dof,
    p95: asNumber(solved && solved.p95) ?? 0,
    max: asNumber(solved && solved.max) ?? 0,
    umax,
    errEst: Number.isFinite(errEst) ? errEst : 0,
  };
}

function peakBytes(memory, volume) {
  const meshBytes = (volume && volume.stats && volume.stats.wasmBytes) || 0;
  let perf = null;
  try {
    perf = typeof performance !== 'undefined' ? performance.memory : null;
  } catch {
    perf = null;
  }
  return workerMemorySample([memory, meshBytes], perf);
}

function takeCacheEntry(cache, key) {
  if (!cache?.entries || !key) return null;
  const index = cache.entries.findIndex((item) => item && item.key === key);
  if (index < 0) return null;
  const [entry] = cache.entries.splice(index, 1);
  if (!entry?.mesh?.nodes) {
    freeCacheEntry(entry);
    return null;
  }
  cache.entries.push(entry);
  return entry;
}

function evictCache(cache, limit, releaseMesh) {
  const cap = limit > 0 ? limit : 1;
  while (cache.entries.length >= cap) freeCacheEntry(cache.entries.shift(), releaseMesh);
}

function pushCacheEntry(cache, key, mesh) {
  const entry = { key, mesh, solution: null };
  cache.entries.push(entry);
  return entry;
}

function freeCacheEntry(entry, releaseMesh) {
  if (!entry) return;
  const meshes = [];
  if (entry.mesh) meshes.push(entry.mesh);
  if (Array.isArray(entry.meshes)) {
    for (const mesh of entry.meshes) if (mesh) meshes.push(mesh);
  }
  entry.mesh = null;
  entry.meshes = null;
  entry.key = '';
  clearSolution(entry);
  for (const mesh of meshes) {
    if (typeof releaseMesh === 'function') releaseMesh(mesh);
    else blankMesh(mesh);
  }
}

function clearSolution(entry) {
  if (!entry) return;
  const solution = entry.solution;
  entry.solution = null;
  if (!solution) return;
  solution.nodal = null;
  solution.displacement = null;
  solution.vonMisesTop = null;
  solution.vonMisesMid = null;
  solution.vonMisesBottom = null;
}

function blankMesh(mesh) {
  if (!mesh || typeof mesh !== 'object') return;
  mesh.nodes = null;
  mesh.elements = null;
  mesh.faces = null;
  mesh.faceIds = null;
  mesh.regions = null;
  mesh.directors = null;
  mesh.elementRegion = null;
  if (mesh.stats && typeof mesh.stats === 'object') mesh.stats.wasmBytes = 0;
}

function bcSignature(study) {
  return JSON.stringify({
    fixtures: (study && study.fixtures) || [],
    loads: (study && study.loads) || [],
  });
}

function linearLoads(study) {
  const loads = (study && study.loads) || [];
  for (const load of loads) {
    if (!load || (load.kind !== 'force' && load.kind !== 'pressure')) return false;
  }
  const fixtures = (study && study.fixtures) || [];
  for (const fixture of fixtures) {
    if (!fixture || fixture.kind !== 'fixed') return false;
  }
  return true;
}

function rememberSolution(entry, material, signature, solved, linear) {
  clearSolution(entry);
  const E = Number(material && material.E_MPa);
  const nu = Number(material && material.nu);
  if (!(E > 0) || !Number.isFinite(nu) || !solved || !solved.nodal || !solved.displacement) return;
  const solution = {
    E,
    nu,
    linear: linear === true,
    bcKey: signature,
    nodal: Float64Array.from(solved.nodal),
    displacement: Float64Array.from(solved.displacement),
    min: asNumber(solved.min),
    max: asNumber(solved.max),
    p95: asNumber(solved.p95),
    solver: solved.solver || null,
    dofs: solved.stats && solved.stats.dofs != null ? solved.stats.dofs : null,
    freeDofs: solved.stats && solved.stats.freeDofs != null ? solved.stats.freeDofs : 0,
  };
  if (solved.vonMisesTop && solved.vonMisesMid && solved.vonMisesBottom) {
    solution.vonMisesTop = Float64Array.from(solved.vonMisesTop);
    solution.vonMisesMid = Float64Array.from(solved.vonMisesMid);
    solution.vonMisesBottom = Float64Array.from(solved.vonMisesBottom);
  }
  entry.solution = solution;
}

function rescaleSolution(entry, material, yieldMPa, signature) {
  const saved = entry && entry.solution;
  if (!saved || saved.linear !== true || !saved.nodal || !saved.displacement || !(saved.E > 0)) return null;
  const E = Number(material && material.E_MPa);
  const nu = Number(material && material.nu);
  if (!(E > 0) || !Number.isFinite(nu) || nu !== saved.nu) return null;
  if (saved.bcKey !== signature) return null;
  const ratio = saved.E / E;
  if (!Number.isFinite(ratio) || !(ratio > 0)) return null;
  const displacement = new Float64Array(saved.displacement.length);
  for (let i = 0; i < displacement.length; i += 1) displacement[i] = saved.displacement[i] * ratio;
  const p95 = saved.p95;
  const factor = safetyFactor(yieldMPa, p95);
  const warnings = [];
  if (yieldMPa == null) {
    warnings.push({
      code: 'missing-yield',
      msg: 'material.yield_MPa is null, so safetyFactor is null',
    });
  } else if (!(p95 > 0)) {
    warnings.push({
      code: 'zero-stress',
      msg: 'p95 is 0, so safetyFactor is null (yield / p95 is undefined)',
    });
  }
  const scaled = {
    nodal: saved.nodal,
    displacement,
    min: saved.min,
    max: saved.max,
    p95,
    safetyFactor: factor,
    solver: saved.solver,
    warnings,
    stats: {
      dofs: saved.dofs,
      freeDofs: saved.freeDofs,
      iterations: 0,
      residual: 0,
      solveMs: 0,
    },
  };
  if (saved.vonMisesTop) {
    scaled.vonMisesTop = saved.vonMisesTop;
    scaled.vonMisesMid = saved.vonMisesMid;
    scaled.vonMisesBottom = saved.vonMisesBottom;
  }
  return scaled;
}

async function solveSheetMetal({
  study,
  positions,
  indices,
  faceIDs,
  material,
  profile,
  sheetSpec,
  solveShell,
  modalShell,
  cache,
  tools,
  isCancelled,
  onProgress,
  memory,
  noteMemory,
  peakMemory,
  shape,
}) {
  const cancelled = () => (typeof isCancelled === 'function' ? isCancelled() : false);
  const progress = (update) => {
    if (typeof onProgress === 'function') onProgress(update);
  };
  const warnings = [];
  const cap = shellDofCap(profile);
  const target = study && study.mesh ? study.mesh.target : 'auto';
  const device = profile === 'phone' ? 'phone' : 'desktop';
  const cacheKey = cache
    ? `shell|${tools.meshCacheKey({ positions, indices, faceIDs }, target, device)}|${JSON.stringify(sheetSpec)}`
    : '';
  let entry = cache ? takeCacheEntry(cache, cacheKey) : null;
  let shellMesh = entry?.mesh?.nodes ? entry.mesh : null;
  let meshReused = false;
  progress({ stage: 'loading-mesher', fraction: 1 });
  await yieldTurn();
  if (cancelled()) throw abortError();
  const started = Date.now();
  if (shellMesh) {
    meshReused = true;
    progress({ stage: 'meshing', fraction: 1 });
  } else {
    entry = null;
    if (cache) evictCache(cache, tools.meshCacheLimit(device), tools.releaseMesh);
    progress({ stage: 'meshing', fraction: 0 });
    await yieldTurn();
    if (cancelled()) throw abortError();
    shellMesh = buildSheetShell(sheetSpec, { target, cap });
    progress({ stage: 'meshing', fraction: 1 });
    if (cancelled()) throw abortError();
    if (cache) entry = pushCacheEntry(cache, cacheKey, shellMesh);
  }
  const meshMs = meshReused ? 0 : (shellMesh.stats.ms || (Date.now() - started));
  if (typeof noteMemory === 'function') noteMemory({ stats: { wasmBytes: shellMesh.stats.wasmBytes || 0 } });
  if (shellMesh.stats.coarsened) {
    warnings.push({
      code: 'mesh-coarse',
      msg: `The phone shell DOF cap (${cap}) coarsened the mid-surface mesh from ${shellMesh.stats.requested.toFixed(2)} mm to ${shellMesh.stats.edgeLength.toFixed(2)} mm edges.`,
    });
  }
  if (Number.isFinite(cap) && shellMesh.stats.dofs > cap * 1.25) {
    warnings.push({
      code: 'dof-cap',
      msg: `The shell mesh has ${shellMesh.stats.dofs} degrees of freedom, above the phone cap of ${cap}.`,
    });
  }

  progress({ stage: 'assembling' });
  await yieldTurn();
  if (cancelled()) throw abortError();
  const assembleStarted = Date.now();
  const bcs = shellBoundaryConditions(shellMesh, positions, indices, faceIDs, study || {}, { diagonal: shape.diagonal });
  const assembling = Date.now() - assembleStarted;
  warnings.push(...bcs.warnings);
  if (study && study.type === 'modal') {
    return solveSheetModal({
      study,
      positions,
      indices,
      faceIDs,
      material,
      profile,
      shellMesh,
      bcs,
      warnings,
      assembling,
      meshMs,
      meshReused,
      started,
      modalShell,
      progress,
      noteMemory,
      memory,
      peakMemory,
      cancelled,
    });
  }
  if (!bcs.clampedNodes.length) throw new Error('Fix a face before running the study.');
  const bcPayload = { clampedNodes: bcs.clampedNodes };
  if (bcs.forceNodes.length) {
    bcPayload.forceNodes = bcs.forceNodes;
    bcPayload.forceValues = bcs.forceValues;
  }
  if (bcs.pressureElements.length) {
    bcPayload.pressureElements = bcs.pressureElements;
    bcPayload.pressures = bcs.pressures;
  }
  const yieldMPa = material && material.yield_MPa != null && Number.isFinite(Number(material.yield_MPa))
    ? Number(material.yield_MPa)
    : null;
  const signature = bcSignature(study);
  let solved = rescaleSolution(entry, material, yieldMPa, signature);
  let rescaled = !!solved;
  if (!solved) {
    progress({
      stage: 'solving',
      solver: 'cholesky',
      blocking: true,
      choleskyStep: 'factor',
      fraction: 0.5,
    });
    await yieldTurn();
    if (cancelled()) throw abortError();
    const solveStarted = Date.now();
    try {
      solved = solveShell(
        {
          nodes: shellMesh.nodes,
          elements: shellMesh.elements,
          thickness: new Float64Array([shellMesh.thickness]),
        },
        { E_MPa: material.E_MPa, nu: material.nu, yield_MPa: yieldMPa },
        bcPayload,
        { solver: 'cholesky' },
      );
    } finally {
      if (!solved) progress({ stage: 'solving', solver: 'cholesky', blocking: false });
    }
    solved.stageSolveMs = Date.now() - solveStarted;
  } else {
    solved.stageSolveMs = 0;
  }
  const solvedStats = solved && solved.stats ? solved.stats : {};
  const solvedDofs = solvedStats.dofs != null ? solvedStats.dofs : shellMesh.stats.dofs;
  progress({
    stage: 'solving',
    solver: 'cholesky',
    blocking: false,
    choleskyStep: 'solve',
    fraction: 1,
    dofs: solvedDofs,
  });
  if (typeof noteMemory === 'function') noteMemory({ stats: { wasmBytes: shellMesh.stats.wasmBytes || 0 } });
  if (cancelled()) throw abortError();
  if (entry && !rescaled) rememberSolution(entry, material, signature, solved, linearLoads(study));

  progress({ stage: 'post-processing', fraction: 0.9, dofs: solvedDofs });
  const postStarted = Date.now();
  const sampled = sampleShellSurface(positions, indices, faceIDs, shellMesh, {
    top: Float64Array.from(solved.vonMisesTop),
    mid: Float64Array.from(solved.vonMisesMid),
    bottom: Float64Array.from(solved.vonMisesBottom),
    displacement: Float64Array.from(solved.displacement),
  });
  const dispRange = fieldRange(sampled.displacement);
  const solverWarnings = plainWarnings(solved.warnings);
  for (const warning of solverWarnings) {
    if (warning.code === 'missing-yield' || warning.code === 'zero-stress' || warning.code === 'cholesky-index') {
      warnings.push(warning);
    }
  }
  const postMs = Date.now() - postStarted;
  progress({ stage: 'post-processing', fraction: 1, dofs: solvedDofs });
  const elapsed = Date.now() - started;
  return {
    source: 'shell',
    field: 'von_mises',
    units: 'MPa',
    nodal: sampled.stress,
    displacement: sampled.displacement,
    displacementMin: dispRange.min,
    displacementMax: dispRange.max,
    min: asNumber(solved.min),
    max: asNumber(solved.max),
    p95: asNumber(solved.p95),
    safetyFactor: solved.safetyFactor == null ? null : solved.safetyFactor,
    fos: solved.fos == null ? (solved.safetyFactor == null ? null : solved.safetyFactor) : solved.fos,
    warnings,
    solver: solved.solver || 'cholesky',
    meshReused,
    rescaled,
    stageTimings: {
      'loading-mesher': 0,
      meshing: meshMs,
      assembling,
      solving: rescaled ? 0 : (solved.stageSolveMs || (solvedStats.solveMs || 0)),
      'post-processing': postMs,
    },
    thin: true,
    shells: SHELLS_AVAILABLE,
    probe: packShellProbe(shellMesh, {
      top: solved.vonMisesTop,
      mid: solved.vonMisesMid,
      bottom: solved.vonMisesBottom,
      displacement: solved.displacement,
    }, 'local'),
    stats: {
      dofs: solvedDofs,
      freeDofs: solvedStats.freeDofs || 0,
      ms: elapsed,
      meshMs,
      solveMs: rescaled ? 0 : (solvedStats.solveMs || solved.stageSolveMs || 0),
      vertices: positions.length / 3,
      triangles: indices.length / 3,
      elements: shellMesh.stats.elements,
      edgeLength: shellMesh.stats.edgeLength,
      peakMemoryBytes: typeof peakMemory === 'function'
        ? peakMemory()
        : peakBytes(memory, { stats: { wasmBytes: shellMesh.stats.wasmBytes || 0 } }),
      wasmMemoryMaxBytes: profile === 'phone' ? PHONE_WASM_BYTES : null,
    },
  };
}
