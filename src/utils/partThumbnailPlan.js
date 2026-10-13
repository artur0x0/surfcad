/**
 * Which part thumbnails to build.
 *
 * The key is the part id plus a hash of its script. A stored bitmap for
 * that key is left alone. A visible part with a current mesh is snapshotted
 * from that mesh. A hidden part with no stored bitmap is executed off the
 * CAD view: its last mesh, if any, belongs to an older run and is not reused.
 */
import { shouldClearViewportScript } from './helperPaletteSnippets.js';
import { scriptHash } from './cart.js';

export function partThumbnailKey(partId, script) {
  const id = partId == null ? '' : String(partId);
  if (!id || typeof script !== 'string') return '';
  return `${id}\0${scriptHash(script)}`;
}

export function partThumbnailHash(script) {
  return typeof script === 'string' ? scriptHash(script) : '';
}

function currentMesh(run) {
  const mesh = run?.ok === true ? run.mesh : null;
  if (!mesh || !mesh.vertProperties) return null;
  return mesh;
}

/**
 * @param {{ parts?: object[], scripts?: object, cachedKeys?: Set<string>, runs?: object }} input
 * @returns {{ id: string, script: string, mode: 'snapshot'|'execute', mesh?: object }[]}
 */
export function planPartThumbnails({ parts, scripts, cachedKeys, runs } = {}) {
  const have = cachedKeys instanceof Set ? cachedKeys : new Set();
  const jobs = [];
  for (const part of parts || []) {
    if (!part || part.id == null) continue;
    const id = String(part.id);
    const script = scripts?.[part.id];
    if (typeof script !== 'string' || shouldClearViewportScript(script)) continue;
    const key = partThumbnailKey(id, script);
    if (!key || have.has(key)) continue;
    const mesh = currentMesh(runs?.[part.id]);
    if (part.visible !== false && mesh) {
      jobs.push({ id, script, mode: 'snapshot', mesh });
    } else if (part.visible === false) {
      jobs.push({ id, script, mode: 'execute' });
    }
  }
  return jobs;
}
