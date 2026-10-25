/**
 * Run the parts the viewport is allowed to draw.
 * Each definition is executed once and recorded on every row that places
 * it. A throw or a non-solid becomes a failed run with no mesh, even if an
 * earlier run of that id had one.
 */
import { shouldClearViewportScript } from './helperPaletteSnippets.js';
import {
  composeViewportParts,
  definitionRows,
  geometryFromExecuteResult,
  partDefinitionId,
  recordPartRun,
  resolvePartId,
  sortParts,
} from './assembly.js';
import { missingMeshMessage, resolvePartMeshes } from './meshAssets.js';
import { kernelCrashRecord } from '../workers/kernelCrash.js';
import { shipFieldsFromResult } from './meshShip.js';

/**
 * Build one part: resolve its script and meshes, run it, and return the
 * outcome `recordPartRun` takes. Never throws.
 */
async function buildPart({ doc, scripts, execute, part }) {
  const resolved = resolvePartId(doc?.source, part.id, scripts || {});
  if (!resolved.ok) return { ok: false, missing: true, error: 'missing' };
  if (shouldClearViewportScript(resolved.script)) return { ok: false, empty: true };
  let importedModels = null;
  try {
    // Mesh assets belong to the definition the row places.
    const prepared = await resolvePartMeshes(partDefinitionId(part), resolved.script);
    if (prepared.missing.length) {
      return { ok: false, error: missingMeshMessage(prepared.missing) };
    }
    importedModels = prepared.importedModels;
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
  try {
    const result = await execute(resolved.script, { importedModels, partId: part.id });
    if (result?.cleared) return { ok: false, empty: true };
    const mesh = result?.mesh && result.mesh.vertProperties ? result.mesh : null;
    const geom = geometryFromExecuteResult(result);
    return mesh
      ? { ok: true, mesh, ...geom, ...shipFieldsFromResult(result) }
      : { ok: false, error: 'Script must return a Manifold object' };
  } catch (err) {
    const crash = kernelCrashRecord(err);
    return { ok: false, error: err?.message || String(err), ...(crash ? { crash } : {}) };
  }
}

/** Run `fn` over `items` with at most `limit` in flight; results keep item order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(Math.floor(Number(limit) || 1), items.length || 1));
  await Promise.all(Array.from({ length: lanes }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

/**
 * `concurrency` is how many parts may build at once (the geometry worker
 * cap); the caller's `execute` decides where each one runs. Outcomes are
 * recorded in part order whatever order they finish in, so `runs` reads
 * the same as a serial build.
 */
export async function runAssemblyParts({ doc, scripts, execute, ids = null, concurrency = 1 }) {
  const only = ids ? new Set(ids) : null;
  const runs = {};
  const parts = sortParts(doc?.parts);
  const visible = parts.filter((part) => part.visible !== false);
  const activeId = doc?.activeId;
  const ordered = [
    ...visible.filter((part) => part.id !== activeId),
    ...visible.filter((part) => part.id === activeId),
  ].filter((part) => !only || only.has(part.id));
  // Part instances: rows that place one definition share one script, so
  // the definition builds once. Its representative is its primary row when
  // that row is in `ordered`, else the first of its rows there; the outcome
  // lands on every row of the definition (hidden ones too, so their
  // thumbnails follow), the active row last so its own run wins later.
  const reps = new Map();
  for (const part of ordered) {
    const def = partDefinitionId(part);
    if (!reps.has(def) || String(part.id) === def) reps.set(def, part);
  }
  const builds = [...reps.values()];
  const outcomes = await mapLimit(builds, concurrency, (part) => buildPart({ doc, scripts, execute, part }));
  builds.forEach((rep, i) => {
    for (const row of definitionRows(parts, partDefinitionId(rep))) {
      Object.assign(runs, recordPartRun(runs, row.id, outcomes[i]));
    }
  });
  if (!only) {
    for (const part of parts) {
      if (!runs[part.id]) {
        Object.assign(runs, recordPartRun(runs, part.id, { ok: false, skipped: true }));
      }
    }
  }
  return { runs, solids: composeViewportParts(doc, runs) };
}
