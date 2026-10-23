/**
 * The committed TET10 reference for the sheet metallica bracket.
 *
 * `sheetMetallica.test.js` used to mesh the bracket with fTetWild at a 3 mm
 * target (110k to 165k DOF) on every CI run and compare the shell solve to
 * it. fTetWild is single-threaded and pinned, but its output is not
 * deterministic: the same surface meshed on eight CI runs gave 114,714 to
 * 163,716 DOF and 30 s to 246 s of meshing (a ninth run was killed after
 * 690 s still meshing), and a render-surface p95 that moved from 6.9% to
 * 13.2% away from the shell. The unit job timed out or tripped the 12%
 * limit on three unrelated PRs in four days.
 *
 * The reference numbers now live in `sheetMetallicaReference.json`, written
 * by `scripts/golden/fea_shell_vs_tet.mjs --write` from several TET10 runs
 * (the median of each metric, with the spread recorded). The unit test
 * solves the shell, which is deterministic, and compares it to the stored
 * medians in a few seconds. The golden rebuilds the tet mesh and checks that
 * a fresh run still lands inside the recorded spread, so a mesher or solver
 * change is caught there, and the recorded wasm hashes make a stale
 * reference fail loudly in the unit test.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const REFERENCE_URL = new URL('./sheetMetallicaReference.json', import.meta.url);
export const REFERENCE_PATH = 'src/fea/fixtures/sheetMetallicaReference.json';
export const REFERENCE_COMMAND = 'node scripts/golden/fea_shell_vs_tet.mjs --write';

/** The two wasm modules the reference numbers depend on. */
export const REFERENCE_WASM = Object.freeze({
  'surfcad_mesh.wasm': new URL('../../../packages/surfcad-mesh/pkg/surfcad_mesh.wasm', import.meta.url),
  'surfcad_fea_bg.wasm': new URL('../../../packages/surfcad-fea/pkg/surfcad_fea_bg.wasm', import.meta.url),
});

/** The tet study the reference is built from (desktop profile, aluminum). */
export const REFERENCE_MESH = Object.freeze({ target: 3, refine: 'off' });

/** Metrics compared between a shell solve and the tet reference. */
export const REFERENCE_METRICS = Object.freeze(['displacementMax', 'p95', 'surfaceP95']);

export function nearestRankP95(values) {
  const finite = [];
  for (let i = 0; i < values.length; i += 1) {
    if (Number.isFinite(values[i])) finite.push(values[i]);
  }
  finite.sort((a, b) => a - b);
  if (!finite.length) return NaN;
  const rank = Math.min(finite.length - 1, Math.max(0, Math.ceil(0.95 * finite.length) - 1));
  return finite[rank];
}

export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** sha256 of each wasm the reference depends on, keyed like `REFERENCE_WASM`. */
export function wasmFingerprints() {
  const out = {};
  for (const [name, url] of Object.entries(REFERENCE_WASM)) {
    out[name] = createHash('sha256').update(readFileSync(url)).digest('hex');
  }
  return out;
}

/** One solve result reduced to the numbers the reference keeps. */
export function referenceMetrics(result) {
  return {
    dofs: result.stats.dofs,
    meshMs: result.stats.meshMs ?? null,
    solveMs: result.stats.solveMs ?? null,
    displacementMax: result.displacementMax,
    p95: result.p95,
    surfaceP95: nearestRankP95(result.nodal),
  };
}

/**
 * Build the reference document from several tet runs: the median of each
 * metric and the largest relative deviation from it (the spread).
 */
export function buildReference(runs, { command = REFERENCE_COMMAND, generatedAt = new Date().toISOString() } = {}) {
  if (!runs.length) throw new Error('buildReference needs at least one tet run');
  const tet = {};
  const spread = {};
  for (const key of [...REFERENCE_METRICS, 'dofs']) {
    const values = runs.map((run) => run[key]);
    tet[key] = median(values);
    spread[key] = Math.max(...values.map((v) => Math.abs(v - tet[key]) / tet[key]));
  }
  return {
    fixture: 'src/fea/fixtures/sheetMetallica.js SHEET_METALLICA_SCRIPT',
    study: { model: 'solid', mesh: { ...REFERENCE_MESH }, profile: 'desktop', material: 'aluminum 6061-T6' },
    generatedAt,
    command,
    wasm: wasmFingerprints(),
    runs,
    tet,
    spread,
  };
}

/**
 * Read the committed reference. Missing or stale (the wasm it was built
 * with is not the wasm in the tree) throws with the command that fixes it.
 */
export function loadSheetMetallicaReference() {
  let text;
  try {
    text = readFileSync(REFERENCE_URL, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`${REFERENCE_PATH} is missing. Build it with: ${REFERENCE_COMMAND}`);
    }
    throw error;
  }
  const ref = JSON.parse(text);
  const stale = staleReason(ref, wasmFingerprints());
  if (stale) throw new Error(`${REFERENCE_PATH} is stale: ${stale}. Rebuild it with: ${REFERENCE_COMMAND}`);
  return ref;
}

/** Why `ref` no longer matches the tree, or null when it does. */
export function staleReason(ref, fingerprints) {
  if (!ref || typeof ref !== 'object' || !ref.tet || !ref.wasm) return 'unreadable reference document';
  for (const [name, hash] of Object.entries(fingerprints)) {
    if (ref.wasm[name] !== hash) return `${name} changed since the reference was written`;
  }
  for (const key of REFERENCE_METRICS) {
    if (!Number.isFinite(ref.tet[key]) || !(ref.tet[key] > 0)) return `tet.${key} is not a positive number`;
  }
  return null;
}

/** Relative difference of a shell metric from the tet reference. */
export function relativeError(value, reference) {
  return Math.abs(value - reference) / reference;
}
