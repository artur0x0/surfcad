/**
 * Build missing part thumbnails off the CAD view.
 *
 * A cached part id + script hash is not rebuilt. A visible part that already
 * has a mesh is snapshotted on the preview renderer. A hidden part with no
 * cache is run on its own Manifold worker, never the viewport and never the
 * worker that holds the CAD solid, then snapshotted the same way.
 */
import { ManifoldWorker } from './ManifoldWorker.js';
import { resolvePartMeshes } from './meshAssets.js';
import { planPartThumbnails, partThumbnailKey } from './partThumbnailPlan.js';
import { takePartPreview } from './partPreview.js';
import { getPartThumbnail, putPartThumbnail } from './partThumbnailStore.js';

const inflight = new Set();
const latestScript = new Map();
let workerPromise = null;
let execCount = 0;

export function partThumbnailExecCount() {
  return execCount;
}

function thumbWorker() {
  if (!workerPromise) {
    const worker = new ManifoldWorker();
    workerPromise = worker.init().then(() => worker).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

async function runThumbnailScript(script, importedModels) {
  execCount += 1;
  const worker = await thumbWorker();
  return worker.execute(script, { importedModels, timeoutMs: 30000 });
}

async function meshFromScript(partId, script, execute) {
  let importedModels = {};
  try {
    const prepared = await resolvePartMeshes(partId, script);
    if (prepared.missing?.length) return null;
    importedModels = prepared.importedModels || {};
  } catch (err) {
    console.warn('[partThumb] mesh resolve failed:', err?.message || err);
    return null;
  }
  const run = execute || runThumbnailScript;
  const result = await run(script, importedModels);
  const mesh = result?.mesh;
  return mesh?.vertProperties ? mesh : null;
}

function bitmapUrl(mesh) {
  let shot = null;
  try {
    shot = takePartPreview(mesh);
  } catch (err) {
    console.warn('[partThumb] snapshot failed:', err?.message || err);
    return null;
  }
  if (shot?.kind !== 'manifold' || !shot.canvas) return null;
  try {
    return shot.canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('[partThumb] encode failed:', err?.message || err);
    return null;
  }
}

/**
 * Fill any missing thumbnail for the current scripts.
 * `execute(script, importedModels)` replaces the off-view worker when a
 * caller already has one. Aborted work is the next call's latest script:
 * a bitmap is stored only when that part's script is still the one rendered.
 */
export async function ensurePartThumbnails({ parts, scripts, runs, execute } = {}) {
  for (const part of parts || []) {
    if (!part || part.id == null) continue;
    const script = scripts?.[part.id];
    latestScript.set(String(part.id), typeof script === 'string' ? script : null);
  }
  const cachedKeys = new Set();
  for (const part of parts || []) {
    if (!part || part.id == null) continue;
    const script = scripts?.[part.id];
    if (typeof script !== 'string') continue;
    const url = await getPartThumbnail(part.id, script);
    if (url) cachedKeys.add(partThumbnailKey(part.id, script));
  }
  const jobs = planPartThumbnails({ parts, scripts, cachedKeys, runs });
  const pending = [];
  for (const job of jobs) {
    const key = partThumbnailKey(job.id, job.script);
    if (!key || inflight.has(key)) continue;
    inflight.add(key);
    pending.push({ job, key });
  }
  try {
    for (const { job, key } of pending) {
      try {
        if (latestScript.get(job.id) !== job.script) continue;
        const again = await getPartThumbnail(job.id, job.script);
        if (again) continue;
        const mesh = job.mode === 'snapshot'
          ? job.mesh
          : await meshFromScript(job.id, job.script, execute);
        if (latestScript.get(job.id) !== job.script) continue;
        const url = mesh ? bitmapUrl(mesh) : null;
        if (!url) continue;
        if (latestScript.get(job.id) !== job.script) continue;
        await putPartThumbnail(job.id, job.script, url);
      } catch (err) {
        console.warn('[partThumb]', job.id, err?.message || err);
      } finally {
        inflight.delete(key);
      }
    }
  } finally {
    for (const { key } of pending) inflight.delete(key);
  }
}
