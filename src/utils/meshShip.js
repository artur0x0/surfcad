/**
 * Decide whether a part's mesh has to cross the worker again.
 *
 * Identity is the feature-memo key of the script with trailing whole-body
 * Move / Rotate blocks removed, plus the imported-model salt from the run
 * that produced the mesh. An unchanged script reuses the run. A trailing
 * rigid edit keeps that mesh and replaces the matrix. Anything else rebuilds.
 */
import { memoKey } from '../lib/surfcad/featureMemo.js';
import {
  matrixIsIdentity,
  rigidMatrixForOps,
  splitTrailingRigid,
  transformBBox,
} from './rigidSuffix.js';

function hasMesh(run) {
  return !!(run && run.ok !== false && run.mesh && run.mesh.vertProperties);
}

/** Stable id for a part's mesh-asset map. A different map cannot reuse. */
export function assetKeyFromAssets(assets) {
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) return '';
  return Object.keys(assets).sort().map((name) => `${name}:${String(assets[name])}`).join('\n');
}

/**
 * @param {{ script: string, salt?: string, assetKey?: string, previous?: object }} args
 * `salt` is the previous run's importedModelsKey. `assetKey` is the part's
 * mesh-asset map (names and blob ids). A different map cannot reuse.
 */
export function decideMeshShip({ script, salt = '', assetKey = '', previous = null } = {}) {
  const prev = hasMesh(previous) ? previous : null;
  if (!prev) return { action: 'rebuild', reason: 'no-mesh' };
  if ((assetKey || '') !== (prev.assetKey || '')) return { action: 'rebuild', reason: 'assets' };
  const useSalt = prev.salt != null ? prev.salt : salt;
  const scriptKey = memoKey(String(script ?? ''), useSalt);
  if (prev.scriptKey && prev.scriptKey === scriptKey) {
    return {
      action: 'reuse',
      reason: 'script',
      scriptKey,
      salt: useSalt,
      assetKey: assetKey || '',
      mesh: prev.mesh,
      meshKey: prev.meshKey || null,
      featureRigid: prev.featureRigid || null,
      unmoved: prev.unmoved === true,
      baseCentroid: prev.baseCentroid || null,
      baseBBox: prev.baseBBox || null,
      bbox: prev.bbox || null,
      bodyCentroids: prev.bodyCentroids || null,
      bodyCount: prev.bodyCount,
      volume: prev.volume,
    };
  }
  const split = splitTrailingRigid(String(script ?? ''));
  if (!split) return { action: 'rebuild', reason: 'parse' };
  const meshKey = memoKey(split.prefix, useSalt);
  if (!split.ops.length) {
    if (prev.unmoved === true && prev.meshKey && prev.meshKey === meshKey) {
      return {
        action: 'rigid',
        reason: 'identity',
        scriptKey,
        salt: useSalt,
        assetKey: assetKey || '',
        mesh: prev.mesh,
        meshKey,
        featureRigid: null,
        unmoved: true,
        baseCentroid: prev.baseCentroid || null,
        baseBBox: prev.baseBBox || null,
        bbox: prev.baseBBox || prev.bbox || null,
        bodyCentroids: prev.baseCentroid ? [prev.baseCentroid.slice()] : (prev.bodyCentroids || null),
        bodyCount: prev.bodyCount,
        volume: prev.volume,
      };
    }
    return { action: 'rebuild', reason: 'script' };
  }
  if (prev.unmoved !== true || !prev.meshKey || prev.meshKey !== meshKey) {
    return { action: 'rebuild', reason: 'mesh' };
  }
  if (prev.bodyCount != null && prev.bodyCount !== 1) return { action: 'rebuild', reason: 'bodies' };
  if (!prev.baseCentroid) return { action: 'rebuild', reason: 'centroid' };
  const rigid = rigidMatrixForOps(split.ops, prev.baseCentroid);
  if (!rigid) return { action: 'rebuild', reason: 'at' };
  const featureRigid = matrixIsIdentity(rigid.matrix) ? null : rigid.matrix;
  return {
    action: 'rigid',
    reason: 'transform',
    scriptKey,
    salt: useSalt,
    assetKey: assetKey || '',
    mesh: prev.mesh,
    meshKey,
    featureRigid,
    unmoved: true,
    baseCentroid: prev.baseCentroid,
    baseBBox: prev.baseBBox || null,
    bbox: prev.baseBBox ? transformBBox(rigid.matrix, prev.baseBBox) : (prev.bbox || null),
    bodyCentroids: [rigid.centroid],
    bodyCount: 1,
    volume: prev.volume,
  };
}

/** Fields a worker result contributes to a part run. Absent keys stay absent. */
export function shipFieldsFromResult(result) {
  if (!result || typeof result !== 'object') return {};
  const featureRigid = result.featureRigid || result.mesh?.featureRigid || null;
  const out = {};
  if (result.meshKey) out.meshKey = result.meshKey;
  if (result.scriptKey) out.scriptKey = result.scriptKey;
  if (result.salt != null) out.salt = result.salt;
  if (featureRigid) out.featureRigid = featureRigid;
  if (result.baseCentroid) out.baseCentroid = result.baseCentroid;
  if (result.baseBBox) out.baseBBox = result.baseBBox;
  if (result.unmoved === true) out.unmoved = true;
  if (Array.isArray(result.bodyCentroids)) out.bodyCentroids = result.bodyCentroids;
  return out;
}

/**
 * The run to keep when the mesh is not rebuilt. Stamps `featureRigid` on the
 * mesh object so export and joint catalogs see the same matrix as the pose.
 */
export function runFromShip(previous, decision) {
  if (!decision || (decision.action !== 'reuse' && decision.action !== 'rigid')) return null;
  const mesh = previous?.mesh || decision.mesh;
  if (mesh && decision.action === 'rigid') {
    if (decision.featureRigid) mesh.featureRigid = decision.featureRigid;
    else delete mesh.featureRigid;
  }
  const run = {
    ...(previous || {}),
    ok: true,
    mesh,
    error: null,
    volume: decision.volume != null ? decision.volume : previous?.volume ?? null,
    bbox: decision.bbox || previous?.bbox || null,
    ...(decision.bodyCount != null ? { bodyCount: decision.bodyCount } : {}),
    ...(decision.meshKey ? { meshKey: decision.meshKey } : {}),
    ...(decision.scriptKey ? { scriptKey: decision.scriptKey } : {}),
    ...(decision.salt != null ? { salt: decision.salt } : {}),
    ...(decision.assetKey != null ? { assetKey: decision.assetKey } : {}),
    ...(decision.unmoved ? { unmoved: true } : {}),
    ...(decision.baseCentroid ? { baseCentroid: decision.baseCentroid } : {}),
    ...(decision.baseBBox ? { baseBBox: decision.baseBBox } : {}),
    ...(Array.isArray(decision.bodyCentroids) ? { bodyCentroids: decision.bodyCentroids } : {}),
  };
  if (decision.featureRigid) run.featureRigid = decision.featureRigid;
  else if (decision.action === 'rigid') delete run.featureRigid;
  return run;
}
