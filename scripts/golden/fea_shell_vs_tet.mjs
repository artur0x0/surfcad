#!/usr/bin/env node
/**
 * Sheet metallica bracket: shell solve vs a fine TET10 solve, and the
 * committed reference the unit test compares against.
 *
 *   node scripts/golden/fea_shell_vs_tet.mjs            check: fresh tet runs
 *                                                        against the committed
 *                                                        reference and the shell
 *   node scripts/golden/fea_shell_vs_tet.mjs --write    rebuild the reference
 *   --runs N                                            tet runs (default 3)
 *
 * fTetWild's output is not deterministic (see
 * src/fea/fixtures/sheetMetallicaReference.js), so the reference is the
 * median of `--runs` TET10 solves, with the spread recorded. Check mode
 * fails when a fresh tet run lands outside that spread (times 2.5, floor
 * 5%), when the shell is further from the fresh tet than the unit test
 * allows, or when the committed reference is missing or stale. Headless
 * node, no Chrome; each tet run takes one to several minutes.
 */
import { writeFileSync } from 'node:fs';
import * as fea from '../../packages/surfcad-fea/pkg/surfcad_fea.js';
import { initFeaWasm } from '../../src/fea/initFeaWasm.js';
import { SHEET_METALLICA_SCRIPT } from '../../src/fea/fixtures/sheetMetallica.js';
import {
  REFERENCE_MESH,
  REFERENCE_METRICS,
  REFERENCE_PATH,
  REFERENCE_URL,
  buildReference,
  loadSheetMetallicaReference,
  referenceMetrics,
  relativeError,
} from '../../src/fea/fixtures/sheetMetallicaReference.js';
import { meshVolume } from '../../src/fea/meshVolume.js';
import { studyForSolve } from '../../src/fea/renderFaceIds.js';
import { readFeaStudy } from '../../src/fea/studyScript.js';
import { solveSolid } from '../../src/fea/solveSolid.js';
import { shellSheetFromScript } from '../../src/fea/sheetMidsurface.js';
import { meshArraysFromGeometry } from '../../src/fea/studyPanel.js';
import { buildSolidGeometry } from '../../src/utils/partSolidCache.js';
import { SHELL_VS_TET_TOLERANCE } from '../../src/fea/sheetShellTolerance.js';

const args = process.argv.slice(2);
const write = args.includes('--write');
const runsAt = args.indexOf('--runs');
const runCount = runsAt >= 0 ? Math.max(1, Number(args[runsAt + 1]) || 3) : 3;
const aluminum = { E_MPa: 68900, nu: 0.33, yield_MPa: 276 };

let failed = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
}
const pct = (x) => `${(100 * x).toFixed(2)}%`;

async function surfaceAndStudy(runScript) {
  const study = readFeaStudy(SHEET_METALLICA_SCRIPT);
  const built = await runScript(SHEET_METALLICA_SCRIPT);
  const solid = buildSolidGeometry(built.mesh);
  const surface = meshArraysFromGeometry(solid.geometry, solid.faceIDs);
  const expanded = studyForSolve(study, solid.geometry, solid.faceIDs);
  try { built.manifold?.delete?.(); } catch { /* already freed */ }
  return { surface, expanded };
}

async function main() {
  console.log(`fea shell vs tet golden (${write ? 'write' : 'check'}, ${runCount} tet run${runCount === 1 ? '' : 's'})`);
  await initFeaWasm();
  const { runScript } = await import('../../src/lib/surfcad/index.js');
  const { surface, expanded } = await surfaceAndStudy(runScript);
  const spec = shellSheetFromScript(SHEET_METALLICA_SCRIPT);
  const common = {
    positions: surface.positions,
    indices: surface.indices,
    faceIDs: surface.faceIDs,
    material: aluminum,
    profile: 'desktop',
    solveTet10: fea.solve_tet10,
    solveStub: fea.solve,
  };

  const shellResult = await solveSolid({ ...common, study: expanded, sheetSpec: spec, solveShell: fea.solve_shell });
  const shell = referenceMetrics(shellResult);
  console.log(`  shell ${shell.dofs} dof u ${shell.displacementMax.toFixed(3)} p95 ${shell.p95.toFixed(2)} surface p95 ${shell.surfaceP95.toFixed(2)} solve ${shell.solveMs} ms`);

  const runs = [];
  for (let i = 0; i < runCount; i += 1) {
    const started = Date.now();
    const tet = await solveSolid({ ...common, study: { ...expanded, model: 'solid', mesh: { ...REFERENCE_MESH } }, meshVolume });
    const row = referenceMetrics(tet);
    runs.push(row);
    console.log(`  tet run ${i + 1}: ${row.dofs} dof mesh ${row.meshMs} ms solve ${row.solveMs} ms u ${row.displacementMax.toFixed(3)} p95 ${row.p95.toFixed(2)} surface p95 ${row.surfaceP95.toFixed(2)} (${Date.now() - started} ms)`);
  }

  const fresh = buildReference(runs);
  for (const key of REFERENCE_METRICS) {
    const err = relativeError(shell[key], fresh.tet[key]);
    check(
      `shell ${key} within ${pct(SHELL_VS_TET_TOLERANCE[key])} of the fresh tet median`,
      err <= SHELL_VS_TET_TOLERANCE[key],
      `${pct(err)} (shell ${shell[key].toFixed(3)} vs tet ${fresh.tet[key].toFixed(3)})`,
    );
  }

  if (write) {
    writeFileSync(REFERENCE_URL, `${JSON.stringify(fresh, null, 2)}\n`);
    console.log(`  wrote ${REFERENCE_PATH} (${runs.length} runs; spread ${REFERENCE_METRICS.map((k) => `${k} ${pct(fresh.spread[k])}`).join(', ')})`);
  } else {
    let ref = null;
    try {
      ref = loadSheetMetallicaReference();
    } catch (error) {
      check('committed reference is present and matches the wasm in the tree', false, error.message);
    }
    if (ref) {
      for (const key of REFERENCE_METRICS) {
        const allowed = Math.max(2.5 * (ref.spread[key] || 0), 0.05);
        const err = relativeError(fresh.tet[key], ref.tet[key]);
        check(
          `fresh tet ${key} within ${pct(allowed)} of the committed reference`,
          err <= allowed,
          `${pct(err)} (fresh ${fresh.tet[key].toFixed(3)} vs committed ${ref.tet[key].toFixed(3)}, recorded spread ${pct(ref.spread[key] || 0)})`,
        );
      }
    }
  }

  if (failed) {
    console.log(`fea shell vs tet golden: ${failed} failed`);
    process.exit(1);
  }
  console.log('fea shell vs tet golden: ok');
}

main().catch((error) => {
  console.error(error);
  console.log('fea shell vs tet golden: crashed');
  process.exit(1);
});
