/**
 * Built solids and their pick graphs, cached so a part switch is cheap.
 *
 * A part switch used to rebuild everything: the previous part's mesh for the
 * assembly layer, the new part's pick mesh, its face graph, its edge graph
 * and body contours (twice in Fillet), and its contact seam. The geometry
 * depends only on the mesh data a run returned, and the graphs only on that
 * geometry and its faceID array, so they are cached by those objects. A new
 * run returns new mesh data, so a stale entry is never reused.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import { dropPlanarFins } from './planarSeam.js';
import { contactSeamSegments } from './contactSeam.js';
import { buildCoherentEdges, buildFeatureEdges } from './selectEdge.js';
import {
  annotateFeatureEdges,
  indexBoundaryEdgesFromGeometry,
  indexContourBoundaries,
} from './boundaryEdgeIds.js';
import {
  REFERENCE_LENGTH_MM,
  boundsFromGeometry,
  characteristicLengthMm as lengthFromBounds,
} from './characteristicLength.js';
import { stampedPiecesForMesh } from './faceIdentity.js';
import { meshContentHash } from './meshHash.js';

/**
 * Per-triangle feature key from Manifold runs: `runFeature` (fillet / chamfer
 * op brackets from the worker) else `runOriginalID`. Aligned with the kept
 * triangles after fin drop. Null when the mesh has no runs.
 */
export function triangleSources(meshData, keep, nKept) {
  const runIndex = meshData?.runIndex;
  const ids = meshData?.runFeature || meshData?.runOriginalID;
  if (!runIndex || !ids || runIndex.length < 2 || ids.length < runIndex.length - 1) return null;
  const nRaw = Math.floor((meshData.triVerts?.length || 0) / 3);
  const raw = new Int32Array(nRaw);
  for (let r = 0; r + 1 < runIndex.length; r++) {
    const t1 = Math.min(nRaw, Math.floor(runIndex[r + 1] / 3));
    for (let t = Math.floor(runIndex[r] / 3); t < t1; t++) raw[t] = ids[r] | 0;
  }
  if (!keep) return raw.length === nKept ? raw : null;
  const out = new Int32Array(nKept);
  for (let i = 0; i < nKept; i++) out[i] = raw[keep[i]];
  return out;
}

/**
 * One part's solid as a BufferGeometry: the planar needle between two copies
 * of a cap vertex is dropped, faceID is kept, normals are computed. The pick
 * mesh and the other assembly parts use the same build, so a part switch can
 * hand the geometry over instead of rebuilding it.
 * @returns {{ geometry: BufferGeometry, faceIDs: ArrayLike<number>|null }}
 */
function adoptTyped(src, Ctor) {
  // A transferred buffer is already the array the worker posted. Adopt it
  // only when the view owns that buffer outright, the same rule as
  // meshTransferList. A view into a larger buffer is copied so the
  // attribute does not alias the rest of it.
  if (
    src instanceof Ctor
    && src.byteOffset === 0
    && src.byteLength === src.buffer.byteLength
  ) return src;
  return new Ctor(src);
}

export function buildSolidGeometry(meshData) {
  const geometry = new BufferGeometry();
  const np = meshData.numProp || 3;
  const src = meshData.vertProperties;
  let vertProperties;
  if (np === 3) {
    vertProperties = adoptTyped(src, Float32Array);
  } else {
    const nVert = Math.floor(src.length / np);
    vertProperties = new Float32Array(nVert * 3);
    for (let i = 0; i < nVert; i++) {
      vertProperties[i * 3] = src[i * np];
      vertProperties[i * 3 + 1] = src[i * np + 1];
      vertProperties[i * 3 + 2] = src[i * np + 2];
    }
  }
  const srcIndex = adoptTyped(meshData.triVerts, Uint32Array);
  const srcFaceID = meshData.faceID && meshData.faceID.length > 0 ? meshData.faceID : null;
  const fin = dropPlanarFins(vertProperties, srcIndex, srcFaceID);
  const triVerts = fin.indices;
  applyRunTables(geometry, meshData, fin, triVerts.length / 3);
  geometry.setAttribute('position', new BufferAttribute(vertProperties, 3));
  geometry.setIndex(new BufferAttribute(triVerts, 1));
  const faceIDs = fin.faceIDs && fin.faceIDs.length > 0 ? fin.faceIDs : null;
  if (faceIDs) {
    geometry.setAttribute('faceID', new BufferAttribute(new Float32Array(faceIDs), 1));
  }
  // A dropped needle makes the old run ranges point at removed triangles;
  // matIndex is always 0, so one group covers the kept mesh.
  if (fin.dropped > 0) {
    geometry.addGroup(0, triVerts.length, 0);
  } else if (meshData.runIndex) {
    const runIndex = meshData.runIndex;
    let start = runIndex[0];
    for (let run = 0; run < meshData.numRun; ++run) {
      const end = runIndex[run + 1];
      geometry.addGroup(start, end - start, 0);
      start = end;
    }
  }
  geometry.computeVertexNormals();
  return { geometry, faceIDs, fin: { keep: fin.keep || null, nKept: triVerts.length / 3 } };
}

/**
 * The per-run tables this mesh carries, as geometry.userData: triangle
 * sources (fillet ops / originalIDs), the feature tessellation rows, the
 * face stamps and the identity pieces. They are what differs between two
 * runs of the same triangles (Manifold numbers originalIDs per run), so a
 * geometry kept across such a rerun gets them refreshed from the new mesh.
 * `fin` is the needle drop of the geometry (`keep`, `nKept`), the same for
 * the same triangles.
 */
function applyRunTables(geometry, meshData, fin, nKept) {
  delete geometry.userData.triSource;
  delete geometry.userData.featureTessellation;
  delete geometry.userData.faceStamps;
  delete geometry.userData.faceIdentity;
  // Feature source per kept triangle (fillet op or originalID). The face
  // graph crosses it only between fillet ops whose dihedral clears both gates.
  const triSource = triangleSources(meshData, fin.keep, nKept);
  if (triSource) geometry.userData.triSource = triSource;
  if (meshData?.featureTessellation?.length) {
    geometry.userData.featureTessellation = meshData.featureTessellation;
  }
  // Face identity: the pieces of every stamped label, found on the full
  // mesh before the needles were dropped (so the kernel, which keeps them,
  // and this geometry agree), as a piece id per kept triangle.
  if (Array.isArray(meshData?.faceStamps) && meshData.faceStamps.length) {
    geometry.userData.faceStamps = meshData.faceStamps;
    const stamped = stampedPiecesForMesh(meshData);
    if (stamped) {
      let pieceOfTri = stamped.pieceOfTri;
      if (fin.keep) {
        pieceOfTri = new Int32Array(nKept);
        for (let i = 0; i < nKept; i++) pieceOfTri[i] = stamped.pieceOfTri[fin.keep[i]];
      }
      geometry.userData.faceIdentity = { pieceOfTri, pieces: stamped.pieces };
    }
  }
}

/**
 * Edge graph + body contours for one geometry. Keyed by the geometry object
 * and the faceID array it was built with, so showing a part's solid again
 * (a part switch, Fillet enter) reuses the graph instead of rebuilding it.
 * A new run is a new geometry, so it always misses.
 */
const featureGraphCache = new WeakMap();
const contourBoundaryCache = new WeakMap();

/**
 * Contour reference topology for this geometry.
 * A new run is a new geometry, so a stale catalog is never reused.
 * Fillet keeps `featureGraphFor(...).topo`; this one keeps sheet edges.
 */
export function contourBoundariesFor(geom, faceIDs) {
  if (!geom || !faceIDs?.length) return { faces: [], edges: [], triFace: null };
  const hit = contourBoundaryCache.get(geom);
  if (hit && hit.faceIDs === faceIDs) return hit.topo;
  const topo = indexContourBoundaries(geom, faceIDs);
  contourBoundaryCache.set(geom, { faceIDs, topo });
  return topo;
}

export function featureGraphFor(geom, faceIDs) {
  if (!geom) {
    return {
      featureEdges: [],
      topo: null,
      timing: null,
      cached: false,
      characteristicLengthMm: REFERENCE_LENGTH_MM,
    };
  }
  const hit = featureGraphCache.get(geom);
  if (hit && hit.faceIDs === faceIDs) return { ...hit, cached: true };
  const tFeat = performance.now();
  const raw = buildFeatureEdges(geom);
  const featureMs = performance.now() - tFeat;
  let topoMs = 0;
  let annotateMs = 0;
  let coherentMs = 0;
  let topo = null;
  let featureEdges;
  if (faceIDs && faceIDs.length) {
    const tTopo = performance.now();
    topo = indexBoundaryEdgesFromGeometry(geom, faceIDs);
    topoMs = performance.now() - tTopo;
    const tAnn = performance.now();
    const annotated = annotateFeatureEdges(raw, topo);
    annotateMs = performance.now() - tAnn;
    const tCoh = performance.now();
    featureEdges = buildCoherentEdges(annotated);
    coherentMs = performance.now() - tCoh;
  } else {
    const tCoh = performance.now();
    featureEdges = buildCoherentEdges(raw);
    coherentMs = performance.now() - tCoh;
  }
  const entry = {
    faceIDs,
    featureEdges,
    topo,
    timing: { featureMs, topoMs, annotateMs, coherentMs },
    characteristicLengthMm: lengthFromBounds({ bounds: boundsFromGeometry(geom) }),
  };
  featureGraphCache.set(geom, entry);
  return { ...entry, cached: false };
}

/**
 * Feature edges already cached for this geometry.
 * A miss builds them without face ids. Calling `featureGraphFor(geom, null)`
 * while a face-id entry is cached would miss and overwrite that entry.
 */
export function featureEdgesOf(geom) {
  if (!geom) return [];
  const hit = featureGraphCache.get(geom);
  if (hit?.featureEdges) return hit.featureEdges;
  return featureGraphFor(geom, null).featureEdges;
}

/**
 * Built solids by mesh data object, and by content. `cache.entries` maps
 * meshData → entry; `cache.geoms` is every cached geometry, so a swap does
 * not dispose one that another part (or the pick mesh, after a switch back)
 * still shows. `cache.byKey` maps `<partId>|<content hash>` → entry: a run
 * of the same part that returns the same mesh (a comment edit, a no-op
 * block, a memoised replay) takes the geometry it already shows, so no new
 * GPU buffers are built. `cache.stats` counts builds (each one is a GPU
 * upload on its first frame) and reuses; `solidCacheStats()` sums them for
 * the `geometry_workers` debug read and the gpu-upload-cache golden.
 */
const liveCaches = new Set();

export function createSolidCache() {
  const cache = {
    entries: new Map(),
    geoms: new WeakSet(),
    byKey: new Map(),
    stats: { builds: 0, reuses: 0, disposed: 0 },
  };
  liveCaches.add(typeof WeakRef === 'function' ? new WeakRef(cache) : { deref: () => cache });
  return cache;
}

function solidKey(partId, meshData) {
  const hash = meshContentHash(meshData);
  if (!hash) return null;
  return `${partId != null && partId !== '' ? String(partId) : '*'}|${hash}`;
}

/**
 * The built solid for this mesh data. `partId` scopes content reuse to one
 * part: the same mesh under another part id is built again, so a part never
 * shows a geometry whose per-part state (skins, outlines) belongs elsewhere.
 * @param {ReturnType<typeof createSolidCache>} cache
 * @param {object} meshData worker mesh data
 * @param {string|number|null} [partId]
 * @returns {{ geometry: BufferGeometry, faceIDs: ArrayLike<number>|null, meshData: object, key: string|null }}
 */
export function cachedSolidGeometry(cache, meshData, partId = null) {
  let entry = cache.entries.get(meshData);
  if (entry) return entry;
  const key = solidKey(partId, meshData);
  const shared = key && cache.byKey ? cache.byKey.get(key) : null;
  if (shared && !shared.disposed) {
    // Same part, same triangles: the geometry (and its GPU buffers) moves to
    // the new mesh data object and the old one is let go, so a rerun does
    // not pile up entries. The run tables are this run's, so the face graph
    // and the identity pieces name what the kernel now holds.
    if (shared.meshData !== meshData) {
      cache.entries.delete(shared.meshData);
      shared.meshData = meshData;
      cache.entries.set(meshData, shared);
      applyRunTables(shared.geometry, meshData, shared.fin, shared.fin.nKept);
    }
    cache.stats.reuses += 1;
    return shared;
  }
  entry = buildSolidGeometry(meshData);
  entry.meshData = meshData;
  entry.key = key;
  entry.disposed = false;
  cache.entries.set(meshData, entry);
  cache.geoms.add(entry.geometry);
  if (key && cache.byKey) cache.byKey.set(key, entry);
  cache.stats.builds += 1;
  return entry;
}

function disposeEntry(cache, entry) {
  cache.geoms.delete(entry.geometry);
  if (entry.key && cache.byKey?.get(entry.key) === entry) cache.byKey.delete(entry.key);
  entry.disposed = true;
  entry.geometry.dispose?.();
  cache.stats.disposed += 1;
}

/** Dispose a geometry unless the solid cache owns it (pruned later). */
export function releaseGeometryIn(cache, geom) {
  if (!geom || cache.geoms.has(geom)) return;
  geom.dispose?.();
}

/**
 * Drop cached solids that nothing shows any more: not the pick mesh, not
 * another assembly part. A new run is new mesh data, so the old entry goes
 * here instead of piling up. A deleted part's geometry is disposed here on
 * the next prune, which frees its GPU buffers.
 */
export function pruneSolidCacheIn(cache, pickMesh, extras) {
  const shown = new Set();
  if (pickMesh?.geometry) shown.add(pickMesh.geometry);
  for (const mesh of extras?.values?.() || []) {
    if (mesh?.geometry) shown.add(mesh.geometry);
  }
  for (const [meshData, entry] of cache.entries) {
    if (shown.has(entry.geometry)) continue;
    cache.entries.delete(meshData);
    disposeEntry(cache, entry);
  }
}

/**
 * Totals over every live solid cache: `builds` (geometries built, each a
 * GPU upload on its first frame), `reuses` (runs that kept the geometry they
 * already showed), `disposed`, and `live` (geometries held right now).
 */
export function solidCacheStats() {
  const out = { builds: 0, reuses: 0, disposed: 0, live: 0 };
  for (const ref of liveCaches) {
    const cache = ref.deref();
    if (!cache) {
      liveCaches.delete(ref);
      continue;
    }
    out.builds += cache.stats.builds;
    out.reuses += cache.stats.reuses;
    out.disposed += cache.stats.disposed;
    out.live += cache.entries.size;
  }
  return out;
}

/** Parts above this many triangles are not pre-built in idle time. */
export const PREWARM_MAX_TRIS = 40000;

/** The live cache entry that owns this geometry, or null. */
export function liveSolidEntryForGeometry(cache, geom) {
  if (!geom || !cache?.entries) return null;
  for (const entry of cache.entries.values()) {
    if (entry.geometry === geom) return entry;
  }
  return null;
}

/** The cache entry (and its mesh data) that owns this geometry, or null. */
export function solidEntryForGeometry(cache, geom) {
  if (!geom) return null;
  for (const [meshData, entry] of cache.entries) {
    if (entry.geometry === geom) return { meshData, ...entry };
  }
  return null;
}

const contactSeamCache = new WeakMap();

/** contactSeamSegments for this mesh data, scanned once. */
export function contactSeamFor(meshData) {
  if (!meshData?.vertProperties || !meshData?.triVerts) return [];
  let segs = contactSeamCache.get(meshData);
  if (!segs) {
    segs = contactSeamSegments(meshData.vertProperties, meshData.triVerts, meshData.numProp || 3);
    contactSeamCache.set(meshData, segs);
  }
  return segs;
}
