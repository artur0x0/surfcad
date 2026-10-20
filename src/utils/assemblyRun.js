/**
 * Run the parts the viewport is allowed to draw.
 * Each id is executed on its own. A throw or a non-solid becomes a failed
 * run with no mesh, even if an earlier run of that id had one.
 */
import { shouldClearViewportScript } from './helperPaletteSnippets.js';
import {
  composeViewportParts,
  geometryFromExecuteResult,
  recordPartRun,
  resolvePartId,
  sortParts,
} from './assembly.js';
import { missingMeshMessage, resolvePartMeshes } from './meshAssets.js';
import { kernelCrashRecord } from '../workers/kernelCrash.js';

export async function runAssemblyParts({ doc, scripts, execute, ids = null }) {
  const only = ids ? new Set(ids) : null;
  const runs = {};
  const parts = sortParts(doc?.parts);
  const visible = parts.filter((part) => part.visible !== false);
  const activeId = doc?.activeId;
  const ordered = [
    ...visible.filter((part) => part.id !== activeId),
    ...visible.filter((part) => part.id === activeId),
  ];
  for (const part of ordered) {
    if (only && !only.has(part.id)) continue;
    const resolved = resolvePartId(doc?.source, part.id, scripts || {});
    if (!resolved.ok) {
      Object.assign(runs, recordPartRun(runs, part.id, { ok: false, missing: true, error: 'missing' }));
      continue;
    }
    if (shouldClearViewportScript(resolved.script)) {
      Object.assign(runs, recordPartRun(runs, part.id, { ok: false, empty: true }));
      continue;
    }
    let importedModels = null;
    try {
      const prepared = await resolvePartMeshes(part.id, resolved.script);
      if (prepared.missing.length) {
        Object.assign(runs, recordPartRun(runs, part.id, {
          ok: false,
          error: missingMeshMessage(prepared.missing),
        }));
        continue;
      }
      importedModels = prepared.importedModels;
    } catch (err) {
      Object.assign(runs, recordPartRun(runs, part.id, {
        ok: false,
        error: err?.message || String(err),
      }));
      continue;
    }
    let outcome;
    try {
      const result = await execute(resolved.script, { importedModels, partId: part.id });
      if (result?.cleared) {
        Object.assign(runs, recordPartRun(runs, part.id, { ok: false, empty: true }));
        continue;
      }
      const mesh = result?.mesh && result.mesh.vertProperties ? result.mesh : null;
      const geom = geometryFromExecuteResult(result);
      outcome = mesh
        ? { ok: true, mesh, ...geom }
        : { ok: false, error: 'Script must return a Manifold object' };
    } catch (err) {
      const crash = kernelCrashRecord(err);
      outcome = { ok: false, error: err?.message || String(err), ...(crash ? { crash } : {}) };
    }
    Object.assign(runs, recordPartRun(runs, part.id, outcome));
  }
  if (!only) {
    for (const part of parts) {
      if (!runs[part.id]) {
        Object.assign(runs, recordPartRun(runs, part.id, { ok: false, skipped: true }));
      }
    }
  }
  return { runs, solids: composeViewportParts(doc, runs) };
}
