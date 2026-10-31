// src/lib/surfcad/runtime.js
// Script helpers + the sandbox message protocol. The worker entry binds this module.
import Module from '../../../built/manifold.js';
import {
  fastenerClearanceDia,
  fastenerTapDrillDia,
  fastenerMajorDia,
  listFastenerSizes,
  resolveFastenerSize,
} from '../../workers/fastenerSizes.js';
import { isFilletSliverDirty } from '../../utils/filletSliverGuard.js';
import {
  expandFilletCutterContour,
  expandDihedralCutterContour,
  filletSweepCutterExpand,
  planFilletSweepPath,
  densifySweepArcTurns,
  dihedralFilletContour,
  dihedralChamferContour,
  filletRemovedArea,
  chamferRemovedArea,
  orientFilletFrame,
  varyingProfileTubeMesh,
  FILLET_ARC_SEGMENTS,
} from '../../utils/filletAlongPath.js';
import { densifyPathPoints, buildVariableProfileFrames, maxConsecutiveFrameAngleDeg, countThetaRuns, variableProfileDensifyStep, pathPolylineLength, FRAME_DENSIFY_MAX_TURN_DEG } from '../../utils/edgeTangencyField.js';
import { indexBoundaryEdges } from '../../utils/boundaryEdgeIds.js';
import { chainNamedEdges, describeEdgeNames, matchEdgeName } from './namedEdges.js';
import {
  assembleSweepPathSet,
} from '../../utils/edgeSweepPath.js';
import {
  calibrateScriptLineOffset,
  createFeatureTracker,
  FEATURE_TRACE_ENTER,
  FEATURE_TRACE_LEAVE,
  featureSkipFailure,
  instrumentFeatureBlocks,
  scriptLineFromStack,
  unionSkipIds,
} from '../../utils/featureFailure.js';
import { evaluationScript, resolveRollback } from '../../utils/featureSkip.js';
import { parseFeatureMarkers } from '../../utils/featureMarkers.js';
import { decomposedBodyIndexForTri } from '../../utils/meshBodyComponents.js';
import { buildMakeLoftSolid, offsetPlaneFrame } from '../../utils/makeLoft.js';
import { blockSpec, buildBlockManifold } from '../../utils/blockSolid.js';
import { buildSheetMetalSolid } from '../../utils/sheetMetal/sheetSolid.js';
import { markSheetMesh } from '../../utils/sheetMetal/sheetMeshFlag.js';
import { installSeparateBodies, overlappingBodies, runEstimateOf, noteRunEstimate } from '../../workers/separateBodies.js';
import { installKernelArena, beginKernelArena, endKernelArena, retainFromKernelArena, wasmHeapMB } from '../../workers/kernelArena.js';
import { planMemo, FeatureMemo, MEMO_CAPTURE, MEMO_RESTORE, featureMemoBudgetBytes, importedModelsKey, memoKey } from './featureMemo.js';
import { collectTransferBuffers } from '../../utils/meshTransfer.js';
import {
  bakeRigidMesh,
  matrixIsIdentity,
  rigidMatrixForOps,
  splitTrailingRigid,
  transformBBox,
  transformPoint,
} from '../../utils/rigidSuffix.js';
import { solveContour as solveContourModel } from '../../utils/contourSolve.js';
import { classifyKernelFailure, FEATURE_TIMEOUT_CODE, FEATURE_TIMEOUT_HINT, featureTimeoutMessage } from '../../workers/kernelCrash.js';

/**
 * List of globals to block/remove in the worker context
 */
const BLOCKED_GLOBALS = [
  // Network
  'fetch',
  'XMLHttpRequest', 
  'WebSocket',
  'EventSource',
  
  // Storage
  'indexedDB',
  'caches',
  
  // Workers (prevent spawning nested workers)
  'Worker',
  'SharedWorker',
  
  // Messaging that could leak data
  'BroadcastChannel',
  
  // Import (dynamic) - We load Manifold before blocking
  'importScripts',
];

/**
 * Globals to make read-only proxies (allow reading but not as escape vectors)
 */
const READONLY_GLOBALS = [
  'navigator',
  'location',
  'performance',
];

let manifoldModule = null;
let isInitialized = false;
let cachedManifold = null;
// Nonce of the execute that last wrote cachedManifold (game compare staleness).
let cachedExecuteNonce = null;
// Live ghost target for game-mode match (independent cloned handle retained
// across attempt executes — not an alias of cachedManifold).
let gameTargetManifold = null;
// Snapshot of the attempt solid at the execute that ran while a ghost was set.
// compareGameMatch grades this — never ambient cachedManifold.
let gameAttemptManifold = null;
/**
 * Trailing Move / Rotate kept off the mesh. `cachedManifold` is the unmoved
 * solid; `cachedBaked` is a lazy clone().transform() for cross-section,
 * export and game compare. Both stay out of the arena sweep.
 */
let cachedFeatureRigid = null;
let cachedMeshKey = null;
let cachedBaseCentroid = null;
let cachedBaseBBox = null;
let cachedVolume = null;
let cachedTriCount = null;
let cachedBaked = null;

function _dropBaked() {
  _safeDeleteManifold(cachedBaked);
  cachedBaked = null;
}

function _clearFeatureRigid() {
  cachedFeatureRigid = null;
  cachedMeshKey = null;
  cachedBaseCentroid = null;
  cachedBaseBBox = null;
  cachedVolume = null;
  cachedTriCount = null;
  _dropBaked();
}

/** The solid consumers see: the base, or the base moved by the feature rigid. */
function liveManifold() {
  if (!cachedManifold) return null;
  if (!cachedFeatureRigid || matrixIsIdentity(cachedFeatureRigid)) return cachedManifold;
  if (cachedBaked) return cachedBaked;
  try {
    cachedBaked = cachedManifold.clone().transform(cachedFeatureRigid);
  } catch (_) {
    return cachedManifold;
  }
  return cachedBaked || cachedManifold;
}

/** Best-effort Manifold.dispose (embind .delete); ignore missing/throws. */
function _safeDeleteManifold(m) {
  if (!m) return;
  try {
    if (typeof m.delete === 'function') m.delete();
  } catch (_) { /* already freed or non-embind */ }
}

/**
 * Make `next` the cached solid and free the one it replaces. The game
 * ghost and attempt are their own clones, so they are never the same
 * handle; the guard is for a caller that cached one of them anyway.
 */
function _replaceCachedManifold(next) {
  const prev = cachedManifold;
  if (prev && prev !== next && prev !== gameTargetManifold && prev !== gameAttemptManifold) {
    _safeDeleteManifold(prev);
  }
  cachedManifold = next;
}

/**
 * Run `fn` inside a kernel arena: every handle the script (and the helpers
 * it calls) creates is freed on the way out, except the solid `fn` returns
 * in `.result` and the handles the runtime retains between runs. Returns
 * `{ ran, kernelFreed }`. A throw frees everything and rethrows.
 */
function _runInKernelArena(fn) {
  const arena = beginKernelArena();
  let ran;
  try {
    ran = fn();
    // Evaluate the lazy result while every intermediate handle is still
    // alive. The kernel flattens a union chain only through nodes nobody
    // else holds, so freeing the handles first would change the batching
    // and with it the triangulation (same volume, different triangles, and
    // not the same from one run to the next). Evaluated here, the mesh is
    // the one the script always produced.
    if (ran && ran.result && typeof ran.result.numTri === 'function') ran.result.numTri();
    // Blocks captured by this run are sized and stored now, after the
    // result's evaluation, so sizing never evaluates a node ahead of it.
    _memoCommitPending();
  } catch (error) {
    _memoCommitPending();
    endKernelArena(arena, { keep: [cachedManifold, cachedBaked, gameTargetManifold, gameAttemptManifold] });
    throw error;
  }
  const kernelFreed = endKernelArena(arena, {
    keep: [ran && ran.result, cachedManifold, cachedBaked, gameTargetManifold, gameAttemptManifold],
  });
  return { ran, kernelFreed };
}

// ============================================================================
// FEATURE-LEVEL MEMOISATION (src/lib/surfcad/featureMemo.js)
// The worker keeps, per marked block, the bindings a script holds when the
// block closes (kernel handles as clones, plain data as structured clones)
// plus the per-run side tables below. A rerun restores the longest prefix of
// blocks whose keys still match and executes from the first change on.
// ============================================================================
/** The cache, created on first use with a budget from the device's memory. */
let _featureMemo = null;
/** `{ partId }` while an execute / runPreparedScript runs; null elsewhere (other callers of executeScript are not memoised). */
let _memoContext = null;
/** Per executeScript: `{ plan, pending, stopped }`; committed in _runInKernelArena. */
let _memoRun = null;
/** `featureCache` of the last execute (what the result payload carries). */
let _lastMemoReport = null;

function _memo() {
  if (!_featureMemo) {
    const deviceMemory = typeof navigator !== 'undefined' && navigator ? navigator.deviceMemory : undefined;
    _featureMemo = new FeatureMemo({
      budgetBytes: featureMemoBudgetBytes({ deviceMemory }),
      cloneHandle: _memoStoreClone,
      handOut: _memoHandOut,
      freeHandle: _safeDeleteManifold,
    });
  }
  return _featureMemo;
}

/** A stored clone: out of the arena sweep, with the run-table estimate of the original. */
function _memoStoreClone(h) {
  const c = h.clone();
  retainFromKernelArena(c);
  const est = runEstimateOf(h);
  if (est > 0) noteRunEstimate(c, est);
  return c;
}

/** A handed-out clone: the run's own handle, freed by its arena like any other. */
function _memoHandOut(h) {
  const c = h.clone();
  const est = runEstimateOf(h);
  if (est > 0) noteRunEstimate(c, est);
  return c;
}

/** The side tables a block's result depends on, copied. */
function _memoStateSnapshot() {
  return globalThis.structuredClone({
    faceStamps: [..._faceStamps],
    stampCounters: [..._stampCounters],
    featureOps: _featureOps,
    sourceTess: _sourceTess,
    blockRanges: _blockRanges,
    sheetFilletSpan: _sheetFilletSpan,
  });
}

function _memoStateRestore(state) {
  const s = globalThis.structuredClone(state);
  _faceStamps = new Map(s.faceStamps);
  _stampCounters = new Map(s.stampCounters);
  _featureOps = s.featureOps;
  _sourceTess = s.sourceTess;
  _blockRanges = Array.isArray(s.blockRanges) ? s.blockRanges : [];
  _sheetFilletSpan = s.sheetFilletSpan;
}

/** Plan this script against the cache, or null when memoisation does not apply. */
function _memoPlan(script, importedModels) {
  if (!_memoContext) return null;
  const memo = _memo();
  if (!memo.enabled) return null;
  try {
    return planMemo(script, { lookup: (key) => memo.lookup(key), salt: importedModelsKey(importedModels) });
  } catch (err) {
    console.warn(`[memo] plan failed, running cold (${err?.message || err})`);
    return null;
  }
}

/** `__memoCapture(i, thunk)`: the script's bindings when block i closed. */
function _memoCapture(index, thunk) {
  const run = _memoRun;
  if (!run || run.stopped) return;
  const block = run.plan.blocks[index];
  if (!block || !block.cacheable) return;
  // Captures must be the prefix after the restored blocks; a block that
  // returned early or was skipped leaves a gap nothing after it can fill.
  if (index !== run.plan.hits + run.pending.length) { run.stopped = `gap at block ${index}`; return; }
  let values;
  try { values = thunk(); } catch (err) { run.stopped = `capture ${block.id}: ${err?.message || err}`; return; }
  try {
    run.pending.push(_memo().capture({
      key: block.key,
      blockIndex: index,
      partId: _memoContext?.partId || null,
      names: block.names,
      values,
      state: _memoStateSnapshot(),
    }));
  } catch (err) {
    run.stopped = `capture ${block.id}: ${err?.message || err}`;
  }
}

/** `__memoRestore(i)`: the bindings of restored block i, as fresh values. */
function _memoRestore(index) {
  const run = _memoRun;
  const entry = run?.plan?.entries?.[index];
  if (!entry) throw new Error(`memo: no entry for block ${index}`);
  _memoStateRestore(entry.state);
  return _memo().restore(entry);
}

/** Store what the run captured and write the run's cache report. */
function _memoCommitPending() {
  const run = _memoRun;
  if (!run) return;
  _memoRun = null;
  const memo = _memo();
  const pending = run.pending;
  run.pending = [];
  let stored = { stored: 0, dropped: 0, reason: null };
  if (pending.length) {
    try { stored = memo.commit(pending); } catch (err) {
      for (const e of pending) memo.free(e);
      stored = { stored: 0, dropped: pending.length, reason: `commit: ${err?.message || err}` };
    }
  }
  const blocks = run.plan.blocks.length;
  const hits = run.plan.hits;
  memo.hits += hits;
  memo.misses += Math.max(0, blocks - hits);
  const first = run.plan.blocks.find((b) => !b.cacheable);
  _lastMemoReport = {
    enabled: true,
    blocks,
    hits,
    misses: Math.max(0, blocks - hits),
    stored: stored.stored,
    entries: memo.entries.size,
    bytes: memo.bytes,
    budgetBytes: memo.budgetBytes,
    ...(run.stopped ? { stopped: run.stopped } : {}),
    ...(stored.reason ? { dropped: stored.reason } : {}),
    ...(first ? { uncacheable: { index: first.index, id: first.id, reason: first.reason } } : {}),
  };
}

/** Empty the cache (tests, the dev hook, the `featureMemo` message). */
export function clearFeatureMemo() {
  _memo().clear();
}

/** `{ enabled, entries, bytes, budgetBytes, hits, misses }`. */
export function featureMemoStats() {
  return _memo().stats();
}

/** Turn the cache off or on, or change its byte budget. */
export function configureFeatureMemo({ enabled, budgetBytes, clear } = {}) {
  const memo = _memo();
  if (enabled === false) { memo.enabled = false; memo.clear(); }
  if (enabled === true) memo.enabled = true;
  if (Number.isFinite(Number(budgetBytes)) && Number(budgetBytes) > 0) memo.budgetBytes = Number(budgetBytes);
  if (clear === true) memo.clear();
  return memo.stats();
}

/** Finite and > 0, else fallback (for relEps / volFloor). */
function _positiveFinite(v, fallback) {
  return (Number.isFinite(v) && v > 0) ? v : fallback;
}

// ============================================================================
// EXTENDED MANIFOLD HELPERS
// These functions are injected into the script execution scope
// ============================================================================

// ---------------------------------------------------------------- status
// Build-tolerant Manifold status probe -- the single source of truth for
// "is this manifold valid". The two builds in use report status() in
// DIFFERENT shapes, and both must work:
//   * npm `manifold-3d` (harness/CI)  -> the string 'NoError'
//   * bundled `built/manifold.js` (the browser worker) -> an enum object
//     whose .value is 0 for valid and nonzero for an error (11 = degenerate)
// So comparing status() against the string 'NoError' inline throws on EVERY
// valid manifold in the browser while passing in the harness -- the exact C8
// bug class. Never inline a status comparison again; call this.
// Returns null when valid (or when the status shape is unknown to this
// build -- callers keep their volume() floor checks), else a printable label.
function _c4StatusError(m) {
  if (!m || typeof m.status !== 'function') return 'not a manifold';
  const s = m.status();
  if (typeof s === 'string') return s === 'NoError' ? null : s;
  if (s && typeof s.value === 'number') return s.value === 0 ? null : `code ${s.value}`;
  return null;
}

/** Slice-01: fail loudly on bad numeric args (never silently produce empty/non-manifold). */
function _c4RequirePositive(fn, label, val) {
  if (typeof val !== 'number' || !Number.isFinite(val) || !(val > 0)) {
    throw new Error(`${fn}: ${label} must be a finite number > 0 (got ${val})`);
  }
}

/** Status + empty-volume guard shared by feature cutters. */
function _c4RequireValidSolid(out, fn) {
  const se = _c4StatusError(out);
  if (se) throw new Error(`${fn}: bad result (${se})`);
  if (typeof out.volume === 'function' && out.volume() <= 1e-9) {
    throw new Error(`${fn}: result is EMPTY (volume 0) — cutter consumed the solid or inputs were degenerate`);
  }
  return out;
}

/**
 * Helper to compute uniform scale ratio based on min perpendicular dimension
 *
 * LEGACY: this is the math the pre-uniform-wall `shell()` used. Kept because it
 * is part of HELPER_FUNCTIONS (user scripts may call it), but nothing in this
 * module uses it any more — a uniform SCALE cannot produce a uniform WALL:
 * scaling a 60x20 box by one ratio leaves a 3x thicker wall on the long axis
 * than on the short one. See `shell()` for the offset-based replacement.
 */
function getScaleRatio(manifold, axis, thickness) {
  const bbox = manifold.boundingBox();
  const minPt = bbox.min;
  const maxPt = bbox.max;
  const sizes = [
    maxPt[0] - minPt[0],
    maxPt[1] - minPt[1],
    maxPt[2] - minPt[2]
  ];
  const perpAxes = [0, 1, 2].filter(i => i !== axis);
  const minPerpSize = Math.min(sizes[perpAxes[0]], sizes[perpAxes[1]]);
  if (minPerpSize <= 2 * thickness) {
    throw new Error('Shell thickness too large for object dimensions');
  }
  return (minPerpSize - 2 * thickness) / minPerpSize;
}

// ============================================================================
// SHELL / DRAFT — face-driven, uniform wall
// ----------------------------------------------------------------------------
// Both features used to be bounding-box tricks:
//   shell    = scale the solid down by ONE ratio and subtract -> wall thickness
//              differed per axis (a 60x20x20 box got a 2.5mm wall on Y and a
//              7.5mm wall on X), and the "axis" argument was the only way to
//              say where the opening goes.
//   addDraft = taper by scaling every perpendicular coordinate -> the requested
//              angle was only achieved on the SMALLEST perpendicular dimension;
//              every wider wall came out shallower.
// Both are now built from the real face set (c4MeshData) so thickness and angle
// are honoured per face, and both accept a face SELECTION (what the Viewport
// face pick hands over) instead of only an axis letter.
// ============================================================================

const _C4_SIDE_FACE_COS = Math.cos((25 * Math.PI) / 180); // |n·pull| above this = cap, not side

/** 'z' | '+z' | '-y' | [x,y,z] | {normal} -> unit vector. */
function _c4DirVec(spec, label = 'direction') {
  if (Array.isArray(spec) && spec.length === 3 && spec.every((n) => typeof n === 'number')) {
    if (_c4Len(spec) < 1e-12) throw new Error(`${label}: zero-length vector`);
    return _c4Norm(spec);
  }
  if (spec && typeof spec === 'object' && Array.isArray(spec.normal)) return _c4Norm(spec.normal);
  if (typeof spec === 'string') {
    const s = spec.trim().toLowerCase();
    const sign = s.startsWith('-') ? -1 : 1;
    const ax = { x: 0, y: 1, z: 2 }[s.replace(/^[+-]/, '')];
    if (ax === undefined) {
      throw new Error(`${label}: expected 'x'|'y'|'z' (optionally signed) or [x,y,z], got '${spec}'`);
    }
    const v = [0, 0, 0];
    v[ax] = sign;
    return v;
  }
  throw new Error(`${label}: expected 'x'|'y'|'z', a signed axis like '-z', or [x,y,z]`);
}

/** Unique vertex indices of a face, in first-seen order. */
function _c4FaceVertIndices(md, face) {
  const seen = new Set();
  const out = [];
  for (const t of face.tris) {
    for (let k = 0; k < 3; k++) {
      const vi = md.T[t * 3 + k];
      if (!seen.has(vi)) { seen.add(vi); out.push(vi); }
    }
  }
  return out;
}

/**
 * Resolve a face SELECTION to a Set of face indices into md.faces.
 *
 * Accepted specs (arrays mix freely):
 *   null | false | 'none' | []      -> {} (nothing)
 *   'all'                           -> every face
 *   'sides'                         -> faces more than 25° off ±opts.pull
 *   'z' | '-z' | [0,0,1]            -> every face whose normal is within tolDeg
 *   a face from facesByNormal()     -> that one face
 *   a Viewport face pick {center, normal} / a PlaneFrame -> the face it names
 *
 * Fails loudly when a named face is not on this body: a silently-empty
 * selection would make shell()/draftFaces() a no-op that looks like a kernel bug.
 */
function _c4ResolveFaceSelection(md, spec, opts = {}) {
  const { tolDeg = 8, label = 'faces', pull = null } = opts;
  const out = new Set();
  const add = (s) => {
    if (s === null || s === undefined || s === false || s === 'none') return;
    if (s === 'all') { md.faces.forEach((_, i) => out.add(i)); return; }
    if (s === 'sides') {
      if (!pull) throw new Error(`${label}: 'sides' needs a pull direction`);
      md.faces.forEach((f, i) => {
        if (Math.abs(_c4Dot(f.normal, pull)) < _C4_SIDE_FACE_COS) out.add(i);
      });
      return;
    }
    if (Array.isArray(s) && !(s.length === 3 && s.every((n) => typeof n === 'number'))) {
      s.forEach(add);
      return;
    }
    // A face object (it carries a center) names ONE face; a bare direction
    // names every face pointing that way.
    const named = s && typeof s === 'object' && Array.isArray(s.center);
    const dir = _c4DirVec(s, label);
    const cosT = Math.cos((tolDeg * Math.PI) / 180);
    const cands = [];
    md.faces.forEach((f, i) => { if (_c4Dot(f.normal, dir) >= cosT) cands.push(i); });
    if (!cands.length) {
      throw new Error(
        `${label}: no face on this body points along [${dir.map((n) => n.toFixed(3))}] `
        + `(within ${tolDeg}°) — re-pick the face after the edit that changed it`,
      );
    }
    if (!named) { cands.forEach((i) => out.add(i)); return; }
    const c = s.center;
    // Distance to the face center crosses bodies: a small face on another
    // body can sit closer to the pick than the center of the face that was
    // actually hit. The pick stays on the body whose surface contains it.
    let best = null;
    for (const i of cands) {
      const f = md.faces[i];
      let dist = Infinity;
      const tris = f.tris;
      for (let ti = 0; ti < tris.length; ti++) {
        const t = tris[ti];
        const d = _c4DistPointTri(
          c,
          md.V[md.T[t * 3]],
          md.V[md.T[t * 3 + 1]],
          md.V[md.T[t * 3 + 2]],
        );
        if (d < dist) dist = d;
      }
      const off = Math.abs(_c4Dot(_c4Sub(c, f.center), f.normal));
      if (!best || dist < best.dist - 1e-4
        || (Math.abs(dist - best.dist) <= 1e-4 && off < best.off - 1e-6)) {
        best = { i, dist, off };
      }
    }
    if (!best) return;
    if (best.dist > 1 && best.off > 1) {
      throw new Error(
        `${label}: the picked face is ${best.off.toFixed(3)}mm off every matching `
        + 'plane on this body — it belongs to an earlier version of the part; re-pick it',
      );
    }
    out.add(best.i);
  };
  add(spec);
  return out;
}

/**
 * Rebuild a Manifold from md's triangles with new vertex positions.
 *
 * NOT `warp()`: getMesh() reports float32 vertices while warp() hands the
 * callback Manifold's own double-precision positions, so keying displacements
 * by coordinate silently missed every vertex whose value is not exact in
 * float32 — a shelled cube came out right and a shelled cylinder came out 0.1mm
 * thick. Going through the mesh keeps positions and indices in lockstep.
 */
function _c4RebuildWithVerts(md, verts, label, triVerts = null) {
  const { Manifold, Mesh } = manifoldModule;
  const vp = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    vp[i * 3] = verts[i][0];
    vp[i * 3 + 1] = verts[i][1];
    vp[i * 3 + 2] = verts[i][2];
  }
  const out = new Manifold(new Mesh({
    numProp: 3,
    vertProperties: vp,
    triVerts: new Uint32Array(triVerts || md.T),
  }));
  const se = _c4StatusError(out);
  if (se) {
    throw new Error(
      `${label}: the offset surface folds in on itself (${se}) — use a smaller value`,
    );
  }
  return out;
}

/**
 * Re-triangulate the slivers a vertex warp turned inside out.
 *
 * Manifold triangulates a planar face bounded by a dense arc (a fillet at 96
 * steps per quarter) with long thin triangles from a far corner to adjacent
 * arc vertices, a fraction of a micron high. A uniform offset moves those two
 * vertices by amounts that differ by about as much, and the sliver flips: the
 * cavity then carries fold pairs (a ~1 mm² sliver wound against the face it
 * lies in) that flip crease signs and break moveFace downstream. The surface
 * is still a plane; only the diagonal is wrong. For every triangle whose
 * normal reversed under the move, flip the edge it shares with a neighbour
 * when both resulting triangles come out the right way round. Topology and
 * vertex positions are unchanged; a few passes settle chains of slivers.
 *
 * @returns {Uint32Array} the triangle list to rebuild with (md.T when nothing flipped)
 */
function _c4RepairFlippedTriangles(md, out) {
  const T = new Uint32Array(md.T);
  const nTri = md.numTri;
  const before = new Array(nTri);
  const normalAfter = (t) => {
    const i0 = T[t * 3], i1 = T[t * 3 + 1], i2 = T[t * 3 + 2];
    return _c4Cross(_c4Sub(out[i1], out[i0]), _c4Sub(out[i2], out[i0]));
  };
  for (let t = 0; t < nTri; t++) {
    const i0 = md.T[t * 3], i1 = md.T[t * 3 + 1], i2 = md.T[t * 3 + 2];
    before[t] = _c4Cross(_c4Sub(md.V[i1], md.V[i0]), _c4Sub(md.V[i2], md.V[i0]));
  }
  const flippedNow = (t) => _c4Len(before[t]) > 1e-9 && _c4Dot(before[t], normalAfter(t)) < 0;
  let any = false;
  for (let t = 0; t < nTri && !any; t++) if (flippedNow(t)) any = true;
  if (!any) return md.T;
  const key = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  const edgeTris = new Map();
  const addEdges = (t) => {
    for (let k = 0; k < 3; k++) {
      const kk = key(T[t * 3 + k], T[t * 3 + ((k + 1) % 3)]);
      let list = edgeTris.get(kk);
      if (!list) { list = []; edgeTris.set(kk, list); }
      if (!list.includes(t)) list.push(t);
    }
  };
  const dropEdges = (t) => {
    for (let k = 0; k < 3; k++) {
      const kk = key(T[t * 3 + k], T[t * 3 + ((k + 1) % 3)]);
      const list = edgeTris.get(kk);
      if (list) { const i = list.indexOf(t); if (i >= 0) list.splice(i, 1); }
    }
  };
  for (let t = 0; t < nTri; t++) addEdges(t);
  const third = (t, u, w) => {
    for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; if (v !== u && v !== w) return v; }
    return -1;
  };
  const ok = (a, b, c, ref) => {
    const n = _c4Cross(_c4Sub(out[b], out[a]), _c4Sub(out[c], out[a]));
    return _c4Len(n) > 1e-12 && _c4Dot(n, ref) > 0;
  };
  let changed = true;
  for (let pass = 0; pass < 6 && changed; pass++) {
    changed = false;
    for (let t = 0; t < nTri; t++) {
      if (!flippedNow(t)) continue;
      for (let k = 0; k < 3 && flippedNow(t); k++) {
        const u = T[t * 3 + k];
        const w = T[t * 3 + ((k + 1) % 3)];
        const list = edgeTris.get(key(u, w));
        if (!list || list.length !== 2) continue;
        const sIdx = list[0] === t ? list[1] : list[0];
        const c = third(t, u, w);
        const d = third(sIdx, u, w);
        if (c < 0 || d < 0 || c === d) continue;
        // t = (u, w, c), s = (w, u, d) → t' = (u, d, c), s' = (w, c, d).
        if (!ok(u, d, c, before[t]) || !ok(w, c, d, before[sIdx])) {
          continue;
        }
        dropEdges(t); dropEdges(sIdx);
        T[t * 3] = u; T[t * 3 + 1] = d; T[t * 3 + 2] = c;
        T[sIdx * 3] = w; T[sIdx * 3 + 1] = c; T[sIdx * 3 + 2] = d;
        addEdges(t); addEdges(sIdx);
        changed = true;
      }
    }
  }
  return T;
}

/** 3x3 solve (Cramer). Returns null when the matrix is effectively singular. */
function _c4Solve3(A, b) {
  const [a0, a1, a2] = A;
  const det = a0[0] * (a1[1] * a2[2] - a1[2] * a2[1])
    - a0[1] * (a1[0] * a2[2] - a1[2] * a2[0])
    + a0[2] * (a1[0] * a2[1] - a1[1] * a2[0]);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null;
  const d = (m) => (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
  const sub = (k) => A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)));
  return [d(sub(0)) / det, d(sub(1)) / det, d(sub(2)) / det];
}

/**
 * The one displacement that satisfies `d·nᵢ = rᵢ` for every plane meeting a
 * vertex, in the least-squares sense. This single solve is what makes both
 * shell walls and draft angles come out right, because it distinguishes
 * "several facets of ONE curved surface" from "several DISTINCT planes":
 *   one plane        -> d = r·n                    (flat wall)
 *   two              -> the intersection of the two moved planes (a box edge
 *                       gives d = -t(n₁+n₂), so the corner is not pinched)
 *   three            -> the corner of three moved planes
 *   many, near-parallel -> their common value, i.e. the smooth-surface answer
 *                       for a sphere, a tessellated cylinder or a lofted wall
 * SUMMING per-face displacements instead would be right for the box corner and
 * badly wrong for the loft — it multiplied a lofted cup's draft by its facet
 * count and collapsed the solid. A small Tikhonov term keeps the 3x3 well
 * conditioned at every rank so one code path covers all of the above.
 *
 * @param {number[][]} normals distinct unit plane normals
 * @param {number[]} rhs signed distance to move each plane along its normal
 * @returns {number[]}
 */
function _c4SolvePlaneMoves(normals, rhs) {
  if (!normals.length) return [0, 0, 0];
  if (normals.length === 1) return _c4Mul(rhs[0], normals[0]);
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const b = [0, 0, 0];
  for (let k = 0; k < normals.length; k++) {
    const n = normals[k];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) A[i][j] += n[i] * n[j];
      b[i] += rhs[k] * n[i];
    }
  }
  const lam = 1e-6 * normals.length;
  for (let i = 0; i < 3; i++) A[i][i] += lam;
  const sol = _c4Solve3(A, b);
  if (sol) return sol;
  // Singular even with the regulariser: every normal points the same way, so
  // the average direction and the mean distance are the answer.
  const avg = _c4Norm(normals.reduce(_c4Add, [0, 0, 0]));
  return _c4Mul(rhs.reduce((x, y) => x + y, 0) / rhs.length, avg);
}

/**
 * Append unit direction `n` to `list` unless one within angular tolerance is
 * already there. Default cosTol≈1 (1e-6 component match) keeps draftFaces'
 * sharp-corner behaviour; shell offset passes a looser cosTol so tessellated
 * fillet/cylinder facets collapse to one plane per vertex.
 */
function _c4PushDistinct(list, n, cosTol = null) {
  if (cosTol == null) {
    for (const m of list) {
      if (Math.abs(m[0] - n[0]) < 1e-6 && Math.abs(m[1] - n[1]) < 1e-6 && Math.abs(m[2] - n[2]) < 1e-6) return;
    }
  } else {
    for (const m of list) {
      if (_c4Dot(m, n) >= cosTol) return;
    }
  }
  list.push(n);
}

/**
 * Area-weighted normal clustering for shell offset. Unlike `_c4PushDistinct`
 * (first-wins), a later larger facet in the same ~cosTol cone pulls the
 * representative toward its normal — fillet boolean scraps no longer steal the
 * cluster from the real wall/fillet plane.
 * `list` entries are `{ n:[x,y,z], w:number }`; call `_c4FinalizeClusters`
 * before using them as unit normals.
 */
function _c4PushCluster(list, n, area, cosTol) {
  const w = Math.max(area, 1e-18);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (_c4Dot(c.n, n) >= cosTol) {
      const nw = c.w + w;
      c.n = _c4Norm(_c4Add(_c4Mul(c.w, c.n), _c4Mul(w, n)));
      c.w = nw;
      return;
    }
  }
  list.push({ n: n.slice(), w });
}

function _c4FinalizeClusters(list) {
  return list.map((c) => _c4Norm(c.n));
}

/**
 * Reject an offset/draft that turns the surface inside out.
 *
 * A fold is still a closed mesh, so volume alone does not catch it — but a
 * folded facet has its normal REVERSED. Weigh flips BY AREA and judge the
 * surface as a whole: a dense loft or sweep always has a few slivers that
 * invert under any offset (the boolean absorbs them), while a genuinely
 * over-thick wall or over-steep draft turns the whole surface inside out.
 */
function _c4RequireNoFold(md, out, label, amount, maxFrac = 0.25) {
  let flipped = 0;
  let total = 0;
  for (let t = 0; t < md.numTri; t++) {
    const i0 = md.T[t * 3], i1 = md.T[t * 3 + 1], i2 = md.T[t * 3 + 2];
    const before = _c4Cross(_c4Sub(md.V[i1], md.V[i0]), _c4Sub(md.V[i2], md.V[i0]));
    const a = _c4Len(before);
    if (a < 1e-9) continue; // already degenerate: carries no normal
    total += a;
    const after = _c4Cross(_c4Sub(out[i1], out[i0]), _c4Sub(out[i2], out[i0]));
    if (_c4Dot(before, after) < 0) flipped += a;
  }
  if (total > 0 && flipped / total > maxFrac) {
    throw new Error(
      `${label}: ${amount} is too large for this body — ${Math.round((flipped / total) * 100)}% `
      + 'of the surface folds through itself; use a smaller value',
    );
  }
}

/**
 * Displacement that puts a vertex on the inward offset of every face meeting it.
 * `openNormals` are faces the cavity must break THROUGH: the vertex is pushed
 * out along them by t instead of in, so the cavity pokes past the outer surface
 * and the subtraction opens the face. Several removed faces are solved together
 * (each at +t), not averaged into one push — an averaged push leaves a rib on
 * the edge those faces share.
 *
 * Ill-conditioned multi-plane solves at fillet×planar junctions blow |d| past
 * the orthogonal bound t√N. When residual is high, fall back to a single inward
 * step along the mean of the (hemisphere-filtered) normals — they cannot cancel,
 * so this insets instead of tearing the cavity.
 */
function _c4VertexOffset(closedNormals, openNormals, t) {
  let d = _c4SolvePlaneMoves(closedNormals, closedNormals.map(() => -t));
  if (closedNormals.length) {
    let resid2 = 0;
    for (const n of closedNormals) {
      const e = _c4Dot(d, n) + t;
      resid2 += e * e;
    }
    const resid = Math.sqrt(resid2 / closedNormals.length);
    const dLen = _c4Len(d);
    const softCap = t * Math.sqrt(closedNormals.length) * 1.6;
    if (resid > t * 0.3 || dLen > softCap) {
      const avg = _c4Norm(closedNormals.reduce(_c4Add, [0, 0, 0]));
      d = _c4Mul(-t, avg);
    }
  }
  if (openNormals.length === 1) {
    // One removed face: push out along its normal by t so the cavity
    // overshoots that face and the subtraction opens it.
    d = _c4Add(d, _c4Mul(t, openNormals[0]));
  } else if (openNormals.length > 1) {
    // Two or more removed faces meet here. Averaging their normals into ONE
    // push of length t leaves the shared edge short of both planes (a rib).
    // Solve every removed plane at +t together with the kept-face offsets at
    // -t, so that edge is consumed in one bite.
    const normals = closedNormals.concat(openNormals);
    const rhs = closedNormals.map(() => -t).concat(openNormals.map(() => t));
    const dj = _c4SolvePlaneMoves(normals, rhs);
    let resid2 = 0;
    for (let k = 0; k < normals.length; k++) {
      const e = _c4Dot(dj, normals[k]) - rhs[k];
      resid2 += e * e;
    }
    const resid = Math.sqrt(resid2 / normals.length);
    const dLen = _c4Len(dj);
    const softCap = t * Math.sqrt(normals.length) * 1.6;
    if (!Number.isFinite(dLen) || resid > t * 0.3 || dLen > softCap) {
      // Ill-conditioned (opposite openings, scrap normals). Still clear each
      // removed plane by a full t — do not fall back to the short bisector.
      for (const n of openNormals) d = _c4Add(d, _c4Mul(t, n));
    } else {
      d = dj;
    }
  }
  return d;
}

/** A face is an exact plane when every facet normal is within this of the face normal. */
const _C4_EXACT_PLANE_DEG = 0.5;
/** Smaller planar faces (fold slivers, boolean chips) do not define a plane. */
const _C4_EXACT_PLANE_MIN_AREA = 0.5;
/**
 * Narrower planar faces are facets of a smooth surface (a 96-step sail
 * facet on r=4 is 0.07 mm wide), not flats: a vertex on two of them must
 * take the clustered smooth-surface move, never their exact intersection,
 * which for near-parallel planes runs off along the surface.
 */
const _C4_EXACT_PLANE_MIN_WIDTH = 1.0;

/**
 * Offset planes of the large planar closed faces, and which vertices sit on
 * them: `{ planes: [{ n, c }], ofVertex: Array<number[]|null> }` with the
 * plane `n·x = c` already moved inward by `t`.
 */
function _c4ExactOffsetPlanes(md, t, openSet) {
  const cosExact = Math.cos((_C4_EXACT_PLANE_DEG * Math.PI) / 180);
  const planes = [];
  const ofVertex = new Array(md.V.length).fill(null);
  for (let fi = 0; fi < md.faces.length; fi++) {
    if (openSet && openSet.has && openSet.has(fi)) continue;
    const f = md.faces[fi];
    if (!f || !Array.isArray(f.tris) || !f.normal) continue;
    const n = _c4Norm(f.normal);
    if (!(_c4Len(n) > 0.5)) continue;
    let area = 0;
    let planar = true;
    let sumC = 0;
    let maxEdge = 0;
    for (const ti of f.tris) {
      const a = md.V[md.T[ti * 3]], b = md.V[md.T[ti * 3 + 1]], c = md.V[md.T[ti * 3 + 2]];
      const cx = _c4Cross(_c4Sub(b, a), _c4Sub(c, a));
      const a2 = _c4Len(cx);
      if (a2 < 1e-12) continue;
      if (_c4Dot(_c4Mul(1 / a2, cx), n) < cosExact) { planar = false; break; }
      area += 0.5 * a2;
      sumC += 0.5 * a2 * _c4Dot(n, a);
      maxEdge = Math.max(maxEdge, _c4Len(_c4Sub(b, a)), _c4Len(_c4Sub(c, b)), _c4Len(_c4Sub(a, c)));
    }
    if (!planar || !(area >= _C4_EXACT_PLANE_MIN_AREA)) continue;
    // Width of the face across its longest edge: a strip facet fails this.
    if (!(maxEdge > 0) || (2 * area) / maxEdge < _C4_EXACT_PLANE_MIN_WIDTH) continue;
    const pi = planes.length;
    planes.push({ n, c: sumC / area - t });
    for (const ti of f.tris) {
      for (let k = 0; k < 3; k++) {
        const vi = md.T[ti * 3 + k];
        let list = ofVertex[vi];
        if (!list) { list = []; ofVertex[vi] = list; }
        if (!list.includes(pi)) list.push(pi);
      }
    }
  }
  return { planes, ofVertex };
}

/**
 * Closest point to `p` on the intersection of up to three independent
 * planes `n·x = c` (minimum-norm correction). Parallel duplicates are
 * dropped; a fourth plane is ignored (a vertex on four large flats is a
 * degenerate corner the LS move already handled).
 */
function _c4ProjectOntoPlanes(p, ids, planes) {
  const use = [];
  for (const id of ids) {
    const pl = planes[id];
    if (!use.some((q) => Math.abs(_c4Dot(q.n, pl.n)) > 0.999999)) use.push(pl);
    if (use.length === 3) break;
  }
  if (!use.length) return p;
  // x = p + Nᵀ λ, with (N Nᵀ) λ = c − N p.
  const k = use.length;
  const r = use.map((pl) => pl.c - _c4Dot(pl.n, p));
  if (k === 1) return _c4Add(p, _c4Mul(r[0], use[0].n));
  const G = Array.from({ length: 3 }, () => [0, 0, 0]);
  const rhs = [0, 0, 0];
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) G[i][j] = _c4Dot(use[i].n, use[j].n);
    rhs[i] = r[i];
  }
  for (let i = k; i < 3; i++) G[i][i] = 1;
  const lam = _c4Solve3(G, rhs);
  if (!lam) return _c4Add(p, _c4Mul(r[0], use[0].n));
  let x = p;
  for (let i = 0; i < k; i++) x = _c4Add(x, _c4Mul(lam[i], use[i].n));
  return x;
}

/**
 * The CAVITY of a uniform-thickness shell: the whole boundary offset inward by
 * `thickness`, as one warp of the solid (O(vertices), no per-facet booleans).
 *
 * Faces in `openSet` are pushed OUT instead of in, so the cavity overshoots the
 * outer surface there and subtracting it opens that face.
 *
 * Why not prisms: sweeping each facet inward and unioning is exact, but a
 * lofted wall is tens of thousands of facets — the default Solo Cup script took
 * 83s and produced a 968k-triangle skin. This keeps the original topology.
 */
function _c4OffsetCavity(md, thickness, openSet, label) {
  const nV = md.V.length;
  // Cluster facet normals within ~10°, AREA-WEIGHTED. Tessellated fillets /
  // cylinders put many near-parallel planes on one vertex; treating each as
  // distinct makes `_c4SolvePlaneMoves` shoot vertices hundreds of mm.
  // First-wins clustering let tiny boolean scraps own the cone; area-weighted
  // merge keeps the representative honest. 10° still keeps real sharp edges.
  const COS_CLUSTER = Math.cos((10 * Math.PI) / 180);
  // Per-vertex area-weighted clusters (open / closed), finalised below.
  const closedC = Array.from({ length: nV }, () => []);
  const openC = Array.from({ length: nV }, () => []);
  const isOpenTri = new Uint8Array(md.numTri);
  for (const fi of openSet) {
    for (const t of md.faces[fi].tris) isOpenTri[t] = 1;
  }
  for (let t = 0; t < md.numTri; t++) {
    const i0 = md.T[t * 3], i1 = md.T[t * 3 + 1], i2 = md.T[t * 3 + 2];
    const cx = _c4Cross(_c4Sub(md.V[i1], md.V[i0]), _c4Sub(md.V[i2], md.V[i0]));
    const area2 = _c4Len(cx);
    if (area2 < 1e-12) continue; // zero-area facet carries no plane
    const n = _c4Norm(cx);
    const bucket = isOpenTri[t] ? openC : closedC;
    _c4PushCluster(bucket[i0], n, area2, COS_CLUSTER);
    _c4PushCluster(bucket[i1], n, area2, COS_CLUSTER);
    _c4PushCluster(bucket[i2], n, area2, COS_CLUSTER);
  }
  const closed = closedC.map(_c4FinalizeClusters);
  const open = openC.map(_c4FinalizeClusters);
  // Bbox centre = outward reference for hemisphere filtering. Fillet boolean
  // scraps / opposite-sheet facets park nearly-antiparallel normals on one
  // vertex; averaging them cancels and the old fallback then shoved the vert
  // OUT through the wall (visible punch-through at vertical×rim junctions).
  let bbMin = [Infinity, Infinity, Infinity];
  let bbMax = [-Infinity, -Infinity, -Infinity];
  for (let vi = 0; vi < nV; vi++) {
    const v = md.V[vi];
    for (let k = 0; k < 3; k++) {
      if (v[k] < bbMin[k]) bbMin[k] = v[k];
      if (v[k] > bbMax[k]) bbMax[k] = v[k];
    }
  }
  const center = [
    0.5 * (bbMin[0] + bbMax[0]),
    0.5 * (bbMin[1] + bbMax[1]),
    0.5 * (bbMin[2] + bbMax[2]),
  ];
  // Verts that sit on a solid AABB face must keep that face's plane in their
  // normal set. Fillet scraps sometimes leave only a sideways normal on a
  // flat-face vert; LS then insets the wrong way and the AABB clamp freezes
  // or tears the inner wall at flat↔fillet transitions.
  const AABB_FACE_EPS = 1e-3;
  const ensureAabbFaceNormals = (normals, vert) => {
    const add = [];
    if (Math.abs(vert[0] - bbMax[0]) <= AABB_FACE_EPS) add.push([1, 0, 0]);
    if (Math.abs(vert[0] - bbMin[0]) <= AABB_FACE_EPS) add.push([-1, 0, 0]);
    if (Math.abs(vert[1] - bbMax[1]) <= AABB_FACE_EPS) add.push([0, 1, 0]);
    if (Math.abs(vert[1] - bbMin[1]) <= AABB_FACE_EPS) add.push([0, -1, 0]);
    if (Math.abs(vert[2] - bbMax[2]) <= AABB_FACE_EPS) add.push([0, 0, 1]);
    if (Math.abs(vert[2] - bbMin[2]) <= AABB_FACE_EPS) add.push([0, 0, -1]);
    if (!add.length) return normals;
    const out = normals.slice();
    for (const n of add) {
      if (!out.some((m) => _c4Dot(m, n) >= 0.985)) out.push(n);
    }
    return out;
  };
  const COS_HEMI = Math.cos((85 * Math.PI) / 180); // keep ~outward vs centre
  const filterHemi = (normals, vert) => {
    if (!normals.length) return normals;
    const ref = _c4Sub(vert, center);
    const rLen = _c4Len(ref);
    if (rLen < 1e-12) return normals;
    const r = _c4Mul(1 / rLen, ref);
    const kept = normals.filter((n) => _c4Dot(n, r) >= COS_HEMI);
    // Spurious-only set (e.g. a lone inward normal on the opposite side):
    // replace with geometric outward so we still inset instead of punching out.
    return kept.length ? kept : [r];
  };
  // A vertex on N unit planes offset by t moves at most t*sqrt(N) in the
  // orthogonal case (box corner: t√3). Anything far beyond that is a blown
  // solve — clamp magnitude along the LS direction (do NOT avg-cancel).
  const dCap = thickness * 4;
  // Exact planes. The LS move above treats a planar face and the first facet
  // of a fillet it is tangent to as one cluster (they are within 10°), so a
  // vertex on the tangency lands about half a micron off the plane. The
  // cavity's walls were then not quite planar, and once a fillet's chords
  // dropped under ~0.05 mm Manifold's triangulation of those walls folded:
  // pairs of ~1 mm² slivers wound against each other, which flipped crease
  // signs, broke moveFace and showed as inverted facets. After the solve,
  // every closed vertex is projected onto the offset planes of the large
  // planar faces it lies on; the arc keeps its LS position (accurate to
  // 1e-4 mm at any density).
  const exactPlanes = _c4ExactOffsetPlanes(md, thickness, openSet);
  let moved = 0;
  const out = md.V.map((v) => v.slice());
  for (let vi = 0; vi < nV; vi++) {
    if (!closed[vi].length && !open[vi].length) continue;
    // Skip AABB-face injection on open-rim verts — injecting the open face's
    // normal as closed would cancel the intentional outward overshoot.
    const closedF = filterHemi(
      open[vi].length ? closed[vi] : ensureAabbFaceNormals(closed[vi], md.V[vi]),
      md.V[vi],
    );
    // Open faces intentionally overshoot outward; do not hemisphere-filter them
    // against centre (the open rim would lose its -Y push).
    let d = _c4VertexOffset(closedF, open[vi], thickness);
    if (!Number.isFinite(d[0] + d[1] + d[2])) {
      throw new Error(`${label}: offset blew up at a degenerate vertex — check the mesh for slivers`);
    }
    const dLen = _c4Len(d);
    if (dLen > dCap) {
      d = _c4Mul(dCap / dLen, d);
    }
    if (_c4Len(d) < 1e-12) continue;
    moved++;
    const v0 = md.V[vi];
    let nv = _c4Add(v0, d);
    // Closed-only verts: (1) strip leftover OUTWARD motion along (v−centre) so
    // a residual/LS miss cannot push the cavity through the outer wall;
    // (2) per-axis AABB clamp ONLY axes that exited — full segment pullback
    // froze verts that start on an AABB face whenever any component nudged
    // outward through that face (inner-wall holes at flat↔fillet junctions).
    if (!open[vi].length) {
      const ref = _c4Sub(v0, center);
      const rLen = _c4Len(ref);
      if (rLen > 1e-12) {
        const r = _c4Mul(1 / rLen, ref);
        const outExtra = _c4Dot(_c4Sub(nv, v0), r);
        if (outExtra > 0) nv = _c4Sub(nv, _c4Mul(outExtra, r));
      }
      nv = [
        Math.min(bbMax[0], Math.max(bbMin[0], nv[0])),
        Math.min(bbMax[1], Math.max(bbMin[1], nv[1])),
        Math.min(bbMax[2], Math.max(bbMin[2], nv[2])),
      ];
    }
    const planes = exactPlanes.ofVertex[vi];
    if (planes && planes.length === 1 && closedF.every((n) => _c4Dot(n, exactPlanes.planes[planes[0]].n) >= COS_CLUSTER)) {
      // On one flat, every other closed facet near-tangent to it (a fillet's
      // tangency line): the exact answer is a pure move along the plane
      // normal, the same for every vertex on that line, plus the outward push
      // of any open face the vertex sits on. The LS move drifts in-plane by
      // t·tan(δ/2), δ the first facet's angle, which reorders the
      // near-collinear vertices of the flat's long slivers and flips them.
      // The arc's own vertices move along their facet normals and land where
      // the offset cylinder puts them.
      let d = _c4Mul(-thickness, exactPlanes.planes[planes[0]].n);
      for (const n of open[vi]) d = _c4Add(d, _c4Mul(thickness, n));
      nv = _c4Add(v0, d);
    } else if (planes && planes.length) {
      // Every other vertex on a flat, open rim included: snap the LS result
      // onto the flat's exact offset plane(s). The open faces are not in the
      // list (they offset outward and the LS move already carries that
      // push), so an open-rim corner keeps its push and lands exactly in
      // the walls it belongs to. Left at its LS position it sat 5 µm off
      // the wall every other vertex was projected onto, the wall's fan from
      // that corner was no longer one plane to Manifold, and the hollow
      // kept two dozen collinear vertices along the open rim.
      nv = _c4ProjectOntoPlanes(nv, planes, exactPlanes.planes);
    }
    out[vi] = nv;
  }
  if (!moved) throw new Error(`${label}: nothing to offset — the body has no faces`);
  _c4RequireNoFold(md, out, label, thickness);
  return _c4RebuildWithVerts(md, out, label, _c4RepairFlippedTriangles(md, out));
}


/**
 * Face features on a part whose bodies overlap (Merge bodies off).
 *
 * hollow / draftFaces / moveFace / deleteFace read the whole mesh. With two
 * overlapping bodies that is wrong: a hollow's cavity of one body cuts the
 * other's walls, a coplanar seam expansion can reach the other body, and a
 * draft's neutral plane comes from the whole part's box. So each named face
 * ({ center }) goes to the body whose surface is closest to it, and the
 * feature runs on that body alone. Unnamed selectors ('z', 'all', 'sides',
 * a bare normal, or none) run on every body. Bodies that get no face are
 * kept as they are, and the results are composed again.
 *
 * A part that is one body, or whose bodies do not overlap, takes the
 * feature exactly as before.
 */
function _perBodyFaceOp(manifold, faces, run) {
  const split = manifold && typeof manifold.decompose === 'function'
    ? overlappingBodies(manifold, manifoldModule)
    : null;
  if (!split) return run(manifold, faces);
  const { Manifold } = manifoldModule;
  const bodies = split.bodies;
  const named = bodies.map(() => []);
  const shared = [];
  const flat = [];
  const walk = (s) => {
    if (Array.isArray(s) && !(s.length === 3 && s.every((n) => typeof n === 'number'))) {
      s.forEach(walk);
      return;
    }
    flat.push(s);
  };
  walk(faces);
  let meshes = null;
  for (const entry of flat) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && Array.isArray(entry.center)) {
      if (!meshes) meshes = bodies.map((b) => b.getMesh());
      let best = 0;
      let bestD = Infinity;
      const want = Array.isArray(entry.normal) && entry.normal.length >= 3 ? _c4Norm(entry.normal.map(Number)) : null;
      for (let bi = 0; bi < bodies.length; bi++) {
        const mesh = meshes[bi];
        const np = mesh.numProp;
        const vp = mesh.vertProperties;
        const tv = mesh.triVerts;
        const at = (k) => [vp[k * np], vp[k * np + 1], vp[k * np + 2]];
        for (let t = 0; t < mesh.numTri; t++) {
          const a = at(tv[t * 3]);
          const b = at(tv[t * 3 + 1]);
          const c = at(tv[t * 3 + 2]);
          // A pick on the seam where two bodies cross is 0 from both; the
          // facing triangle (same normal as the pick) decides.
          if (want) {
            const tn = _c4Norm(_c4Cross(_c4Sub(b, a), _c4Sub(c, a)));
            if (_c4Dot(tn, want) < 0.99) continue;
          }
          const d = _c4DistPointTri(entry.center, a, b, c);
          if (d < bestD) { bestD = d; best = bi; }
        }
      }
      named[best].push(entry);
    } else {
      shared.push(entry);
    }
  }
  const out = [];
  const temps = [];
  for (let bi = 0; bi < bodies.length; bi++) {
    const mine = named[bi];
    const anyNamed = flat.some((e) => e && typeof e === 'object' && Array.isArray(e.center));
    // Only named picks, none on this body → leave it alone.
    if (!mine.length && anyNamed && !shared.length) {
      out.push(bodies[bi]);
      continue;
    }
    const spec = [...mine, ...shared];
    const arg = Array.isArray(faces) || spec.length !== 1 ? spec : spec[0];
    const res = run(bodies[bi], flat.length ? arg : faces);
    out.push(res);
    if (res !== bodies[bi]) temps.push(bodies[bi]);
  }
  const result = Manifold.compose(out);
  for (const m of out) _safeDeleteManifold(m);
  for (const m of temps) _safeDeleteManifold(m);
  return result;
}

/**
 * shell(manifold, thickness, opening) — the CAVITY tool.
 *
 * Returns the material to remove, so the historical call site still reads
 *   part = part.subtract(shell(part, 2.5, 'z'));
 * `hollow(part, 2.5, 'z')` is the same thing with the subtraction done for you.
 *
 * Wall thickness is uniform on every face: each boundary vertex lands on the
 * inward offset of every face meeting it, instead of the old single-ratio scale
 * that gave a 60x20 box a 2.5mm wall on Y and 7.5mm on X.
 *
 * @param {Manifold} manifold
 * @param {number} thickness wall thickness, mm
 * @param {*} [opening='z'] which face(s) open into the cavity: 'z' (default,
 *        the +Z face — what the old axis argument meant), '-z', 'x'…; 'none'
 *        for a closed hollow; a face from facesByNormal()/planarFaceAt(); a
 *        Viewport face pick {center, normal}; or an array of those.
 * @returns {Manifold} the cavity — subtract it from `manifold`
 */
function shell(manifold, thickness, opening = 'z') {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  _c4RequirePositive('shell', 'thickness', thickness);
  const md = c4MeshData(manifold);
  const openSet = _c4ResolveFaceSelection(md, opening, { label: 'shell: opening' });
  const cavity = _c4OffsetCavity(md, thickness, openSet, 'shell');
  const cv = cavity.volume();
  if (cv <= 1e-9) {
    throw new Error(
      cv < -1e-9
        ? `shell: wall thickness ${thickness} folded the offset surface (cavity volume ${cv.toFixed(3)}) — try a smaller wall or simplify the body`
        : `shell: wall thickness ${thickness} leaves no cavity — the part is thinner than 2x the wall`,
    );
  }
  return cavity;
}

/**
 * hollow(manifold, thickness, opening) — the shelled SOLID (walls only).
 * @see shell for the `opening` forms.
 */
function hollow(manifold, thickness, opening = 'z') {
  return _perBodyFaceOp(manifold, opening, (body, sel) => _hollowOne(body, thickness, sel));
}

function _hollowOne(manifold, thickness, opening) {
  const out = _c4RequireValidSolid(manifold.subtract(shell(manifold, thickness, opening)), 'hollow');
  // A wall thicker than half the part can leave the solid untouched — a silent
  // no-op that reads as a kernel bug. Say it instead.
  if (out.volume() >= manifold.volume() - 1e-9) {
    throw new Error(
      `hollow: wall thickness ${thickness} leaves no cavity — the part is thinner than 2x the wall`,
    );
  }
  return out;
}

/** Face → neighbor face indices, from the welded edge table. */
function _c4FaceAdj(md) {
  const adj = new Map();
  for (const e of md.edges) {
    const a = e.faces[0], b = e.faces[1];
    if (a < 0 || b < 0 || a === b) continue;
    let sa = adj.get(a);
    if (!sa) { sa = []; adj.set(a, sa); }
    let sb = adj.get(b);
    if (!sb) { sb = []; adj.set(b, sb); }
    sa.push(b);
    sb.push(a);
  }
  return adj;
}

/**
 * Pull-coordinate of the fillet/chamfer tangency to hinge `fi` on, or null
 * to keep the neutral plane.
 *
 * A blend between the neutral plane and the wall stops the wall short of the
 * plane. Shearing that wall about the plane slides the shared tangency edge
 * (tan(angle) × the gap) and leaves a ledge; the blend itself must stay.
 * Hinge on the tangency instead: vertices on that line do not move, and the
 * wall tilts from there. The blend is not added to the draft selection.
 *
 * Returns null — caller keeps the neutral plane — when the wall already
 * meets that plane, when the blend is on the far side of the wall, or when
 * the near outline is not one tangency line (reference:'mid' on a cube).
 */
function _c4BlendHingePull(md, fi, pull, t0, sel, getAdj) {
  const f = md.faces[fi];
  const sAbs = (vi) => Math.abs(_c4Dot(md.V[vi], pull) - t0);
  const vis = _c4FaceVertIndices(md, f);
  let minAbs = Infinity;
  for (const vi of vis) minAbs = Math.min(minAbs, sAbs(vi));
  // Already meets the neutral plane — nothing sits between them.
  if (!(minAbs > 1e-3)) return null;

  // Vertices on the near side of this face. 0.05 mm covers tessellation
  // noise on the tangency without swallowing the rest of a real wall.
  const near = new Set();
  for (const vi of vis) {
    if (Math.abs(sAbs(vi) - minAbs) <= 0.05) near.add(vi);
  }
  const pulls = [];
  const start = [];
  for (const e of md.edges) {
    let ni = -1;
    if (e.faces[0] === fi) ni = e.faces[1];
    else if (e.faces[1] === fi) ni = e.faces[0];
    else continue;
    if (ni < 0 || ni === fi || !near.has(e.a) || !near.has(e.b)) continue;
    if (sel.has(ni)) continue;
    pulls.push(_c4Dot(md.V[e.a], pull), _c4Dot(md.V[e.b], pull));
    start.push(ni);
  }
  if (!pulls.length) return null;
  let pLo = Infinity, pHi = -Infinity;
  for (const p of pulls) {
    if (p < pLo) pLo = p;
    if (p > pHi) pHi = p;
  }
  // The tangency has to be one line parallel to the neutral plane. A face
  // whose whole outline is equally near (reference:'mid' on a cube) spans
  // the height and keeps the neutral-plane hinge.
  if (pHi - pLo > 0.5) return null;

  const adj = getAdj();
  const CAP = Math.cos((20 * Math.PI) / 180);
  const PARALLEL = Math.cos((5 * Math.PI) / 180);
  const fn = f.normal;
  const seen = new Set([fi]);
  const q = start.slice();
  let closer = false;
  let blend = false;
  let guard = 0;
  while (q.length && guard < 4000) {
    const ni = q.pop();
    guard++;
    if (seen.has(ni)) continue;
    seen.add(ni);
    if (sel.has(ni)) continue;
    const n = md.faces[ni];
    if (!n || _c4Len(n.normal) < 1e-8) continue;
    const align = Math.abs(_c4Dot(n.normal, fn));
    const pullAlign = Math.abs(_c4Dot(n.normal, pull));
    const isCap = pullAlign > CAP;
    // Neighboring wall: perpendicular to the drafted face and to the pull.
    const isSide = pullAlign < 0.34 && align < 0.25;
    let headsToward = false;
    for (const vi of _c4FaceVertIndices(md, n)) {
      const a = sAbs(vi);
      if (a < minAbs - 0.005) {
        closer = true;
        headsToward = true;
      } else if (a <= minAbs + 0.2) headsToward = true;
    }
    // A blend normal sits between the wall and the cap (fillet facets, or
    // one chamfer plane). A parallel step and the floor do not count.
    if (!isCap && !isSide && align < PARALLEL && align > 0.25) blend = true;
    if (closer && blend) break;
    if (isCap || isSide || !headsToward) continue;
    const nbrs = adj.get(ni);
    if (!nbrs) continue;
    for (const k of nbrs) if (!seen.has(k)) q.push(k);
  }
  if (!closer || !blend) return null;
  return pulls.reduce((a, b) => a + b, 0) / pulls.length;
}

/** One slide direction per vertex. Same normal keeps the first hinge. */
function _c4PushDraftDir(list, n, tRef) {
  for (const m of list) {
    if (Math.abs(m.n[0] - n[0]) < 1e-6 && Math.abs(m.n[1] - n[1]) < 1e-6 && Math.abs(m.n[2] - n[2]) < 1e-6) return;
  }
  list.push({ n, tRef });
}

/**
 * draftFaces(manifold, faces, angleDeg, opts) — tilt the selected faces by a
 * true constant angle about their intersection with a reference plane.
 *
 * Each selected face tilts about the line where it meets the reference plane,
 * so the achieved angle is `angleDeg` on EVERY selected wall regardless of its
 * width (the old scale-based taper only hit the angle on the narrowest one).
 * When a fillet or chamfer sits between that plane and the face, the hinge
 * moves to the blend–wall tangency; the blend face is not drafted.
 * Vertices shared by two selected faces get both displacements solved together,
 * which is what keeps a drafted corner sharp.
 *
 * Sign: positive tapers the face INWARD going along the pull direction (the
 * usual mould-release sense — the section shrinks toward the pull); negative
 * flares it outward. Inner (cavity) faces read their own outward normal, so a
 * negative angle on them widens the cavity toward the pull, which is what a
 * core needs.
 *
 * @param {Manifold} manifold
 * @param {*} faces face selection: a Viewport face pick, a face from
 *        facesByNormal(), an axis like '-x', 'sides' for every side wall, or an
 *        array mixing those.
 * @param {number} angleDeg signed draft angle in degrees
 * @param {object} [opts]
 * @param {*} [opts.pull='z'] pull/draw direction ('z', '-z', [x,y,z]…)
 * @param {*} [opts.reference='min'] the neutral plane that does not move:
 *        'min' | 'max' | 'mid' along the pull axis, a number (coordinate along
 *        pull), or a face / PlaneFrame / face pick whose center defines it.
 * @returns {Manifold}
 */
function draftFaces(manifold, faces, angleDeg, opts = {}) {
  return _perBodyFaceOp(manifold, faces, (body, sel) => _draftFacesOne(body, sel, angleDeg, opts));
}

function _draftFacesOne(manifold, faces, angleDeg, opts = {}) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  if (typeof angleDeg !== 'number' || !Number.isFinite(angleDeg)) {
    throw new Error(`draftFaces: angleDeg must be a finite number (got ${angleDeg})`);
  }
  if (Math.abs(angleDeg) >= 89) throw new Error(`draftFaces: angleDeg ${angleDeg} is past vertical`);
  const pull = _c4DirVec(opts.pull ?? 'z', 'draftFaces: pull');
  const md = c4MeshData(manifold);
  const sel = _c4ResolveFaceSelection(md, faces, { label: 'draftFaces: faces', pull });
  if (!sel.size) throw new Error('draftFaces: face selection is empty — nothing to draft');

  // Reference ("neutral") plane level, measured along pull.
  const bb = manifold.boundingBox();
  const proj = [];
  for (const x of [bb.min[0], bb.max[0]]) {
    for (const y of [bb.min[1], bb.max[1]]) {
      for (const z of [bb.min[2], bb.max[2]]) proj.push(_c4Dot([x, y, z], pull));
    }
  }
  const lo = Math.min(...proj), hi = Math.max(...proj);
  const refSpec = opts.reference ?? 'min';
  let t0;
  if (typeof refSpec === 'number') t0 = refSpec;
  else if (refSpec === 'min') t0 = lo;
  else if (refSpec === 'max') t0 = hi;
  else if (refSpec === 'mid') t0 = (lo + hi) / 2;
  else if (refSpec && typeof refSpec === 'object' && Array.isArray(refSpec.center)) {
    t0 = _c4Dot(refSpec.center, pull);
  } else {
    throw new Error(
      `draftFaces: reference must be 'min'|'max'|'mid', a number, or a face/plane (got ${refSpec})`,
    );
  }

  const tan = Math.tan((angleDeg * Math.PI) / 180);
  // Per vertex, the DISTINCT slide directions of the selected faces meeting it.
  // Distinct is the operative word: a tessellated wall contributes one direction
  // many times over (solve once), while two walls of a box corner contribute two
  // (solve together, so the corner stays sharp). Each direction carries the
  // pull coordinate it hinges on: the neutral plane, or the blend tangency
  // when a fillet/chamfer sits between that plane and the face.
  const dirs = new Map(); // vertex index -> { n, tRef }[]
  let faceAdj = null;
  // 'taper' makes every selected wall lean the same way round the pull axis, so
  // a HOLLOW part keeps its wall: the cavity wall's own normal points at the
  // axis, and honouring it would drive the inner and outer walls INTO each other
  // (a 1° draft closed the 2mm wall of the 125mm Solo Cup and left 11% of it).
  // 'face' honours each face's own normal — right for a picked face, and the
  // mould-core sense on a cavity wall.
  const sense = opts.sense ?? (faces === 'sides' ? 'taper' : 'face');
  if (sense !== 'taper' && sense !== 'face') {
    throw new Error(`draftFaces: sense must be 'taper' or 'face' (got ${sense})`);
  }
  // Pull axis for 'taper': the body's centre line along the pull direction.
  const axisPt = [
    (bb.min[0] + bb.max[0]) / 2,
    (bb.min[1] + bb.max[1]) / 2,
    (bb.min[2] + bb.max[2]) / 2,
  ];
  let drafted = 0;
  for (const fi of sel) {
    const f = md.faces[fi];
    // In-plane part of the face normal: the direction the face slides. A face
    // perpendicular to pull (a cap) has none — it cannot be drafted.
    const nIn = _c4Sub(f.normal, _c4Mul(_c4Dot(f.normal, pull), pull));
    // A face parallel to the pull is a cap. Do not skip it — one cap in the
    // list (including the neutral face) must fail, not silently drop.
    if (_c4Len(nIn) < 1e-6) {
      // A zero normal is a degenerate triangle cluster, not a cap. 'sides'
      // can pick one up after a hollow; skipping it is not dropping a wall.
      // A real face whose plane is perpendicular to the pull (normal parallel
      // to the pull) must throw, even when other faces in the list are walls.
      if (_c4Len(f.normal) < 1e-6) continue;
      throw new Error(
        'draftFaces: a selected face is parallel to the pull (its plane is perpendicular '
        + 'to the pull direction) — a cap cannot be drafted, including the neutral face; '
        + 'remove it from the list',
      );
    }
    let u = _c4Norm(nIn);
    if (sense === 'taper') {
      const r = _c4Sub(f.center, axisPt);
      const rIn = _c4Sub(r, _c4Mul(_c4Dot(r, pull), pull));
      // Point the slide direction away from the axis, whichever side of the
      // wall this face is. (A face centred on the axis keeps its own normal.)
      if (_c4Len(rIn) > 1e-9 && _c4Dot(u, rIn) < 0) u = _c4Mul(-1, u);
    }
    drafted++;
    const tRef = _c4BlendHingePull(md, fi, pull, t0, sel, () => {
      if (!faceAdj) faceAdj = _c4FaceAdj(md);
      return faceAdj;
    }) ?? t0;
    for (const vi of _c4FaceVertIndices(md, f)) {
      let list = dirs.get(vi);
      if (!list) { list = []; dirs.set(vi, list); }
      _c4PushDraftDir(list, u, tRef);
    }
  }
  if (!drafted) {
    throw new Error(
      'draftFaces: every selected face is perpendicular to the pull direction — '
      + 'a cap cannot be drafted; pick the side walls or change opts.pull',
    );
  }
  if (!dirs.size) return manifold;

  // Rebuild rather than warp(): warp() is fed Manifold's double-precision
  // positions while our vertex indices came from the float32 getMesh(), so a
  // coordinate-keyed lookup misses every non-exact vertex (see
  // _c4RebuildWithVerts).
  const moved = md.V.map((v) => v.slice());
  for (const [vi, us] of dirs) {
    // Each selected plane slides by tan(angle) × the vertex's distance along
    // pull from THAT face's hinge (neutral plane, or the blend tangency).
    const s = _c4Dot(md.V[vi], pull);
    const rhs = us.map((u) => -tan * (s - u.tRef));
    moved[vi] = _c4Add(md.V[vi], _c4SolvePlaneMoves(us.map((u) => u.n), rhs));
  }
  _c4RequireNoFold(md, moved, 'draftFaces', `${angleDeg}°`);
  return _c4RequireValidSolid(_c4RebuildWithVerts(md, moved, 'draftFaces'), 'draftFaces');
}

/**
 * Add draft angle to a manifold — every side wall, true constant angle.
 *
 * Back-compatible wrapper over `draftFaces`: the bottom (min along `axis`) stays
 * put and every wall tilts in by `draftDeg`. Unlike the old scale-based taper, a
 * 60x20 box now gets the SAME angle on its long and short walls.
 *
 * @param {Manifold} manifold
 * @param {number} draftDeg draft angle in degrees (positive tapers toward +axis)
 * @param {string} [axis='z'] pull direction: 'x', 'y', 'z' (or signed, '-z')
 * @returns {Manifold}
 *
 * @example
 * const box = Manifold.cube([50, 50, 30], true);
 * return addDraft(hollow(box, 2, 'z'), 2, 'z');
 */
function addDraft(manifold, draftDeg, axis = "z") {
  return draftFaces(manifold, 'sides', draftDeg, { pull: axis, reference: 'min' });
}

/**
 * Rigid offset of a tangent blend that shares an edge with the selection.
 *
 * An internal fillet is one body with the wall, but its facets are their own
 * faces. Leaving them stationary pins the shared vertices (the facet is
 * almost the wall's plane, with a zero offset) and the wall cannot move, so
 * the fillet stays where it was. A circular blend between planar faces
 * translates with the moved plane and stays tangent to the planes that do
 * not move. Facets much smaller than the picked face, starting within 18°
 * of it and continuing within 28°, are that blend. The next wall is not.
 *
 * @returns {Map<number, number[]>|null} vertex index → displacement
 */
function _c4BlendCarryDelta(md, sel, signed) {
  const adj = _c4FaceAdj(md);
  const area = md.faces.map((face) => {
    let a = 0;
    for (const t of face.tris) {
      const i0 = md.T[t * 3];
      const i1 = md.T[t * 3 + 1];
      const i2 = md.T[t * 3 + 2];
      a += 0.5 * _c4Len(_c4Cross(_c4Sub(md.V[i1], md.V[i0]), _c4Sub(md.V[i2], md.V[i0])));
    }
    return a;
  });
  const tangent = Math.cos((18 * Math.PI) / 180);
  const smooth = Math.cos((28 * Math.PI) / 180);
  const carry = new Set();
  const seedOf = new Map();
  const stack = [];
  for (const fi of sel) {
    const limit = Math.max(area[fi] * 0.5, 12);
    for (const nb of adj.get(fi) || []) {
      if (sel.has(nb) || carry.has(nb)) continue;
      if (!(area[nb] < limit)) continue;
      if (_c4Dot(md.faces[fi].normal, md.faces[nb].normal) < tangent) continue;
      carry.add(nb);
      seedOf.set(nb, fi);
      stack.push(nb);
    }
  }
  while (stack.length) {
    const fi = stack.pop();
    const seed = seedOf.get(fi);
    const limit = Math.max(area[seed] * 0.5, 12);
    for (const nb of adj.get(fi) || []) {
      if (sel.has(nb) || carry.has(nb)) continue;
      if (!(area[nb] < limit)) continue;
      if (_c4Dot(md.faces[fi].normal, md.faces[nb].normal) < smooth) continue;
      carry.add(nb);
      seedOf.set(nb, seed);
      stack.push(nb);
    }
  }
  if (!carry.size) return null;

  const seen = new Set();
  const vertDelta = new Map();
  for (const start of carry) {
    if (seen.has(start)) continue;
    const comp = [];
    const seeds = new Set();
    const st = [start];
    seen.add(start);
    while (st.length) {
      const fi = st.pop();
      comp.push(fi);
      seeds.add(seedOf.get(fi));
      for (const nb of adj.get(fi) || []) {
        if (!carry.has(nb) || seen.has(nb)) continue;
        seen.add(nb);
        st.push(nb);
      }
    }
    const faceSet = new Set(comp);
    const stationary = [];
    const statSeen = new Set();
    for (const e of md.edges) {
      const a = e.faces[0];
      const b = e.faces[1];
      let other = -1;
      if (faceSet.has(a) && !faceSet.has(b)) other = b;
      else if (faceSet.has(b) && !faceSet.has(a)) other = a;
      else continue;
      if (other < 0 || sel.has(other) || statSeen.has(other)) continue;
      if (area[other] < Math.max(area[seeds.values().next().value] * 0.5, 12)) continue;
      statSeen.add(other);
      stationary.push(other);
    }
    const normals = [];
    const rhs = [];
    const pushPlane = (n, r) => {
      for (let k = 0; k < normals.length; k++) {
        const d = _c4Dot(normals[k], n);
        if (d > 0.999) return;
        if (d < -0.999) return;
      }
      normals.push(n);
      rhs.push(r);
    };
    for (const fi of seeds) pushPlane(md.faces[fi].normal, signed);
    for (const fi of stationary) pushPlane(md.faces[fi].normal, 0);
    let delta = _c4SolvePlaneMoves(normals, rhs);
    let worst = 0;
    for (let k = 0; k < normals.length; k++) {
      worst = Math.max(worst, Math.abs(_c4Dot(delta, normals[k]) - rhs[k]));
    }
    if (worst > Math.max(1e-3, Math.abs(signed) * 0.02)) {
      delta = _c4Mul(signed, md.faces[seeds.values().next().value].normal);
    }
    for (const fi of comp) {
      for (const vi of _c4FaceVertIndices(md, md.faces[fi])) vertDelta.set(vi, delta);
    }
  }
  return vertDelta.size ? vertDelta : null;
}

/**
 * moveFace(manifold, faces, distance, opts) — offset the selected faces along
 * their own normals. Adjacent planar faces stay on their planes, so they
 * extend or trim and the result is still one closed solid. A tangent blend
 * on the picked face (an internal fillet) translates with that face instead
 * of staying behind.
 *
 * This is not move(). move() translates a whole body. A vertex on a selected
 * face is solved against every plane that meets it: selected planes move by
 * the signed distance, the others stay. Facets within 10° on the same side
 * of that offset are one plane. A thin facet a few degrees off that plane,
 * sharing its vertices, is the same face: the pick includes the larger plane
 * it was cut from. A distance the walls cannot absorb throws.
 * It does not return a folded mesh.
 *
 * @param {Manifold} manifold
 * @param {*} faces face selection: a viewport pick `{ center, normal }`, a
 *        face from facesByNormal(), or an array of those
 * @param {number} distance millimetres along each selected face normal
 * @param {object} [opts]
 * @param {boolean} [opts.flip=false] reverse each face normal
 * @returns {Manifold}
 */
/**
 * A fillet boolean can leave two copies of a cap vertex about 0.001mm apart,
 * so c4MeshData keeps two faces and the needle between them draws a seam.
 * They are one plane on one body. A named pick of either face includes the
 * other. The curved blend is several degrees off that plane and stays out.
 */
function _c4ExpandCoplanarSeam(md, sel) {
  const STITCH = 0.02;
  const STITCH2 = STITCH * STITCH;
  const cosP = Math.cos((0.5 * Math.PI) / 180);
  const inv = 1 / STITCH;
  const faceVerts = md.faces.map((face) => _c4FaceVertIndices(md, face));
  const buckets = new Map();
  for (let fi = 0; fi < md.faces.length; fi++) {
    for (let k = 0; k < faceVerts[fi].length; k++) {
      const p = md.V[faceVerts[fi][k]];
      const key = `${Math.floor(p[0] * inv)}|${Math.floor(p[1] * inv)}|${Math.floor(p[2] * inv)}`;
      let list = buckets.get(key);
      if (!list) { list = []; buckets.set(key, list); }
      list.push(fi);
    }
  }
  const out = new Set(sel);
  const stack = [...sel];
  while (stack.length) {
    const fi = stack.pop();
    const face = md.faces[fi];
    const n = face.normal;
    const off = n[0] * face.center[0] + n[1] * face.center[1] + n[2] * face.center[2];
    const seen = new Set();
    for (let k = 0; k < faceVerts[fi].length; k++) {
      const p = md.V[faceVerts[fi][k]];
      const cx = Math.floor(p[0] * inv);
      const cy = Math.floor(p[1] * inv);
      const cz = Math.floor(p[2] * inv);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const list = buckets.get(`${cx + dx}|${cy + dy}|${cz + dz}`);
            if (!list) continue;
            for (let li = 0; li < list.length; li++) {
              const fj = list[li];
              if (out.has(fj) || seen.has(fj)) continue;
              seen.add(fj);
              const other = md.faces[fj];
              if (other.body !== face.body) continue;
              const nd = n[0] * other.normal[0] + n[1] * other.normal[1] + n[2] * other.normal[2];
              if (nd < cosP) continue;
              const offO = n[0] * other.center[0] + n[1] * other.center[1] + n[2] * other.center[2];
              if (Math.abs(offO - off) > 0.05) continue;
              let close = false;
              for (let a = 0; a < faceVerts[fj].length && !close; a++) {
                const q = md.V[faceVerts[fj][a]];
                for (let b = 0; b < faceVerts[fi].length; b++) {
                  const r = md.V[faceVerts[fi][b]];
                  const ex = q[0] - r[0];
                  const ey = q[1] - r[1];
                  const ez = q[2] - r[2];
                  if (ex * ex + ey * ey + ez * ez <= STITCH2) { close = true; break; }
                }
              }
              if (!close) continue;
              out.add(fj);
              stack.push(fj);
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * A fillet boolean can leave a thin facet a few degrees off a planar face,
 * sharing that face's vertices. The click treats them as one plane. Pairwise
 * 0.5° seam expansion does not: the worker faces are the merged ends of that
 * chain, and the leftover step is wider than 0.5°. Moving only the scrap
 * pins the real plane (offset 0 against offset d) and every distance throws.
 * The larger face on the same body, within 10°, that shares a vertex and
 * still contains the scrap (the scrap lies within 0.012mm of its plane) is
 * that plane. A similar-sized neighbor is the next fillet step and stays out.
 */
function _c4FaceArea(md, face) {
  let a = 0;
  for (const t of face.tris) {
    const i0 = md.T[t * 3];
    const i1 = md.T[t * 3 + 1];
    const i2 = md.T[t * 3 + 2];
    a += 0.5 * _c4Len(_c4Cross(_c4Sub(md.V[i1], md.V[i0]), _c4Sub(md.V[i2], md.V[i0])));
  }
  return a;
}

function _c4MaxPlaneOff(md, face, normal, off) {
  let far = 0;
  for (const vi of _c4FaceVertIndices(md, face)) {
    const p = md.V[vi];
    const d = Math.abs(normal[0] * p[0] + normal[1] * p[1] + normal[2] * p[2] - off);
    if (d > far) far = d;
  }
  return far;
}

function _c4ExpandSamePlane(md, sel) {
  const COS = Math.cos((10 * Math.PI) / 180);
  const COS_STRIP = Math.cos((0.1 * Math.PI) / 180);
  const ON_PLANE = 0.012;
  const seeds = [...sel];
  const out = new Set(sel);
  // Every vertex of a member face maps back to the ORIGINAL seed it grew
  // from, so the area and plane tests below are always against the scrap
  // the user picked. The walk is transitive: a scrap at a fillet's tangency
  // can touch a medium strip that touches the main flat, and all three are
  // one plane the user meant.
  const vertToSeed = new Map();
  for (const fi of seeds) {
    for (const vi of _c4FaceVertIndices(md, md.faces[fi])) vertToSeed.set(vi, fi);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (let fj = 0; fj < md.faces.length; fj++) {
      if (out.has(fj)) continue;
      const other = md.faces[fj];
      let seedFi = -1;
      const otherVerts = _c4FaceVertIndices(md, other);
      for (const vi of otherVerts) {
        if (vertToSeed.has(vi)) { seedFi = vertToSeed.get(vi); break; }
      }
      if (seedFi < 0) continue;
      const face = md.faces[seedFi];
      if (other.body !== face.body) continue;
      const nd = face.normal[0] * other.normal[0]
        + face.normal[1] * other.normal[1]
        + face.normal[2] * other.normal[2];
      if (nd < COS) continue;
      // Only the plane this scrap was cut from. A similar-sized neighbor is the
      // next fillet step; pulling it in leaves a new edge the walls cannot meet.
      // A similar-sized neighbour that is exactly coplanar (normals within
      // 0.1°, where a fillet step is at least 0.9°) is a strip of the same
      // flat, as a sweep fillet's tangency leaves beside a flat: it joins.
      const aSeed = _c4FaceArea(md, face);
      const aOther = _c4FaceArea(md, other);
      const exactlyCoplanar = nd >= COS_STRIP;
      if (!(aOther > aSeed * 4) && !exactlyCoplanar) continue;
      const n = other.normal;
      const p0 = md.V[otherVerts[0]];
      const off = n[0] * p0[0] + n[1] * p0[1] + n[2] * p0[2];
      if (_c4MaxPlaneOff(md, face, n, off) > ON_PLANE) continue;
      out.add(fj);
      for (const vi of otherVerts) if (!vertToSeed.has(vi)) vertToSeed.set(vi, seedFi);
      grew = true;
    }
  }
  // A small scrap that shares no vertex with its plane: a boolean seam can
  // leave a strip of a flat whose vertices are copies of the flat's own,
  // a few microns apart, so the walk above never reaches it. It is still a
  // piece of that flat when a much larger face lies in its plane (within
  // ON_PLANE, under the same 10° normal slack: a strip a quarter millimetre
  // wide reads a degree off) with a vertex within NEAR of one of its own.
  const NEAR = 0.05;
  for (const fi of seeds) {
    const face = md.faces[fi];
    const aSeed = _c4FaceArea(md, face);
    if (!(aSeed < 4)) continue;
    const seedVerts = _c4FaceVertIndices(md, face).map((vi) => md.V[vi]);
    for (let fj = 0; fj < md.faces.length; fj++) {
      if (out.has(fj)) continue;
      const other = md.faces[fj];
      if (other.body !== face.body) continue;
      const nd = face.normal[0] * other.normal[0] + face.normal[1] * other.normal[1] + face.normal[2] * other.normal[2];
      if (nd < COS) continue;
      if (!(_c4FaceArea(md, other) > aSeed * 4)) continue;
      const otherVerts = _c4FaceVertIndices(md, other);
      const n = other.normal;
      const p0 = md.V[otherVerts[0]];
      const off = n[0] * p0[0] + n[1] * p0[1] + n[2] * p0[2];
      if (_c4MaxPlaneOff(md, face, n, off) > ON_PLANE) continue;
      let near = false;
      for (const vi of otherVerts) {
        const q = md.V[vi];
        for (const sv of seedVerts) {
          if (_c4Len(_c4Sub(q, sv)) <= NEAR) { near = true; break; }
        }
        if (near) break;
      }
      if (near) out.add(fj);
    }
  }
  return out;
}

function moveFace(manifold, faces, distance, opts = {}) {
  return _perBodyFaceOp(manifold, faces, (body, sel) => _moveFaceOne(body, sel, distance, opts));
}

function _moveFaceOne(manifold, faces, distance, opts = {}) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  if (typeof distance !== 'number' || !Number.isFinite(distance)) {
    throw new Error(`moveFace: distance must be a finite number (got ${distance})`);
  }
  const flip = !!(opts && opts.flip);
  const signed = flip ? -distance : distance;
  const md = c4MeshData(manifold);
  const sel = _c4ExpandSamePlane(md, _c4ExpandCoplanarSeam(md, _c4ResolveFaceSelection(md, faces, { label: 'moveFace: faces' })));
  if (!sel.size) throw new Error('moveFace: face selection is empty — nothing to move');
  for (const fi of sel) {
    if (_c4Len(md.faces[fi].normal) < 1e-8) {
      throw new Error('moveFace: a selected face has no normal — re-pick it');
    }
  }
  if (signed === 0) return manifold;

  const carried = _c4BlendCarryDelta(md, sel, signed);

  const vertFaces = new Map();
  for (let fi = 0; fi < md.faces.length; fi++) {
    for (const vi of _c4FaceVertIndices(md, md.faces[fi])) {
      let list = vertFaces.get(vi);
      if (!list) { list = []; vertFaces.set(vi, list); }
      list.push(fi);
    }
  }
  const touched = new Set();
  for (const fi of sel) {
    for (const vi of _c4FaceVertIndices(md, md.faces[fi])) touched.add(vi);
  }

  const moved = md.V.map((v) => v.slice());
  const tol = Math.max(1e-3, Math.abs(signed) * 1e-3);
  // Same 10° cone as the shell offset. A fillet leaves several facets of one
  // wall on a corner; they are one plane. A real corner is wider and stays.
  const COS_CLUSTER = Math.cos((10 * Math.PI) / 180);
  const faceArea = md.faces.map((face) => {
    let a = 0;
    for (const t of face.tris) {
      const i0 = md.T[t * 3];
      const i1 = md.T[t * 3 + 1];
      const i2 = md.T[t * 3 + 2];
      a += 0.5 * _c4Len(_c4Cross(_c4Sub(md.V[i1], md.V[i0]), _c4Sub(md.V[i2], md.V[i0])));
    }
    return a;
  });
  for (const vi of touched) {
    if (carried && carried.has(vi)) continue;
    const held = [];
    const moving = [];
    for (const fi of vertFaces.get(vi) || []) {
      const n = md.faces[fi].normal;
      if (_c4Len(n) < 1e-8) continue;
      _c4PushCluster(sel.has(fi) ? moving : held, n, faceArea[fi], COS_CLUSTER);
    }
    const heldN = _c4FinalizeClusters(held);
    const movingN = _c4FinalizeClusters(moving);
    const normals = heldN.concat(movingN);
    const rhs = heldN.map(() => 0).concat(movingN.map(() => signed));
    if (!normals.length) continue;
    const d = _c4SolvePlaneMoves(normals, rhs);
    let worst = 0;
    for (let k = 0; k < normals.length; k++) {
      worst = Math.max(worst, Math.abs(_c4Dot(d, normals[k]) - rhs[k]));
    }
    if (worst > tol) {
      throw new Error(
        `moveFace: offset ${distance} cannot keep a closed solid — adjacent faces `
        + 'would not meet the moved face; use a smaller distance',
      );
    }
    moved[vi] = _c4Add(md.V[vi], d);
  }
  if (carried) {
    for (const [vi, delta] of carried) moved[vi] = _c4Add(md.V[vi], delta);
  }

  let acc = 0;
  let nAcc = 0;
  for (const fi of sel) {
    const n = md.faces[fi].normal;
    for (const vi of _c4FaceVertIndices(md, md.faces[fi])) {
      acc += _c4Dot(_c4Sub(moved[vi], md.V[vi]), n);
      nAcc++;
    }
  }
  const achieved = nAcc ? acc / nAcc : 0;
  if (Math.abs(achieved - signed) > Math.max(1e-2, Math.abs(signed) * 0.02)) {
    throw new Error(
      `moveFace: offset ${distance} did not land on the moved face `
      + `(achieved ${achieved.toFixed(3)}) — refusing a solid that is not that offset`,
    );
  }
  _c4RequireNoFold(md, moved, 'moveFace', `${distance}`, 0.02);
  let out;
  try {
    out = _c4RebuildWithVerts(md, moved, 'moveFace');
    return _c4RequireValidSolid(out, 'moveFace');
  } catch (err) {
    if (out) _safeDeleteManifold(out);
    throw err;
  }
}

/**
 * deleteFace(manifold, faces) — remove the selected faces and heal by
 * extending or trimming the neighboring faces.
 *
 * A boundary vertex of a deleted face slides onto the intersection of the
 * kept planes that meet it and the neighbor across the gap. The deleted
 * triangles are dropped. The result is returned only when every edge is
 * shared by two triangles and Manifold accepts a closed solid. An open gap,
 * a non-manifold edge, or a folded heal throws. Nothing dirty is returned.
 *
 * Faces are the same `{ center, normal }` picks moveFace uses.
 *
 * @param {Manifold} manifold
 * @param {*} faces face selection: a viewport pick `{ center, normal }`, a
 *        face from facesByNormal(), or an array of those
 * @returns {Manifold}
 */
function deleteFace(manifold, faces) {
  return _perBodyFaceOp(manifold, faces, (body, sel) => _deleteFaceOne(body, sel));
}

function _deleteFaceOne(manifold, faces) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  const md = c4MeshData(manifold);
  const sel = _c4ResolveFaceSelection(md, faces, { label: 'deleteFace: faces' });
  if (!sel.size) throw new Error('deleteFace: face selection is empty — nothing to delete');
  for (const fi of sel) {
    if (_c4Len(md.faces[fi].normal) < 1e-8) {
      throw new Error('deleteFace: a selected face has no normal — re-pick it');
    }
  }

  const nTri = md.numTri;
  const nV = md.V.length;
  const triFace = new Int32Array(nTri).fill(-1);
  for (let fi = 0; fi < md.faces.length; fi++) {
    for (const t of md.faces[fi].tris) triFace[t] = fi;
  }
  const dropTri = new Uint8Array(nTri);
  for (const fi of sel) {
    for (const t of md.faces[fi].tris) dropTri[t] = 1;
  }
  let keptTris = 0;
  for (let t = 0; t < nTri; t++) if (!dropTri[t]) keptTris++;
  if (!keptTris) {
    throw new Error(
      'deleteFace: removing these faces cannot keep a closed solid — every face was selected',
    );
  }

  const planeOf = (face) => {
    if (!face || _c4Len(face.normal) < 1e-8) return null;
    return { n: face.normal, o: _c4Dot(face.normal, face.center) };
  };
  const planesParallel = (a, b) => Math.abs(_c4Dot(a.n, b.n)) >= 0.999;
  const samePlane = (a, b) => {
    const d = _c4Dot(a.n, b.n);
    if (Math.abs(d) < 0.999) return false;
    const oB = d >= 0 ? b.o : -b.o;
    return Math.abs(a.o - oB) <= 0.05;
  };
  const pushPlane = (list, plane) => {
    if (!plane) return;
    for (const have of list) {
      if (samePlane(have, plane)) return;
    }
    list.push(plane);
  };
  const planeLine = (p, q) => {
    const dir = _c4Cross(p.n, q.n);
    const len = _c4Len(dir);
    if (len < 1e-8) return null;
    const n3 = [dir[0] / len, dir[1] / len, dir[2] / len];
    const point = _c4Solve3([p.n, q.n, n3], [p.o, q.o, 0]);
    if (!point) return null;
    return { point, dir: n3 };
  };
  const lineHit = (line, plane) => {
    const denom = _c4Dot(line.dir, plane.n);
    if (Math.abs(denom) < 1e-8) return null;
    const t = (plane.o - _c4Dot(line.point, plane.n)) / denom;
    if (!Number.isFinite(t)) return null;
    return _c4Add(line.point, _c4Mul(t, line.dir));
  };
  const projectLine = (v, line) => {
    const t = _c4Dot(_c4Sub(v, line.point), line.dir);
    return _c4Add(line.point, _c4Mul(t, line.dir));
  };
  const onPlanes = (point, planes) => {
    for (const p of planes) {
      if (Math.abs(_c4Dot(p.n, point) - p.o) > 0.05) return false;
    }
    return true;
  };

  const vertFaces = Array.from({ length: nV }, () => []);
  const touchesDrop = new Uint8Array(nV);
  const touchesKeep = new Uint8Array(nV);
  for (let t = 0; t < nTri; t++) {
    const fi = triFace[t];
    const drop = dropTri[t];
    for (let k = 0; k < 3; k++) {
      const vi = md.T[t * 3 + k];
      if (drop) touchesDrop[vi] = 1;
      else touchesKeep[vi] = 1;
      if (fi >= 0 && vertFaces[vi].indexOf(fi) < 0) vertFaces[vi].push(fi);
    }
  }

  const delNeighbors = new Map();
  for (const e of md.edges) {
    const a = e.faces[0];
    const b = e.faces[1];
    if (a < 0 || b < 0 || a === b) continue;
    const link = (del, kept) => {
      let set = delNeighbors.get(del);
      if (!set) { set = new Set(); delNeighbors.set(del, set); }
      set.add(kept);
    };
    if (sel.has(a) && !sel.has(b)) link(a, b);
    else if (sel.has(b) && !sel.has(a)) link(b, a);
  }

  const bb = manifold.boundingBox();
  const diag = Math.hypot(
    bb.max[0] - bb.min[0],
    bb.max[1] - bb.min[1],
    bb.max[2] - bb.min[2],
  );
  const cap = Math.max(diag, 1);

  const moved = md.V.map((v) => v.slice());
  for (let vi = 0; vi < nV; vi++) {
    if (!touchesDrop[vi] || !touchesKeep[vi]) continue;
    const constraints = [];
    const deleted = [];
    for (const fi of vertFaces[vi]) {
      if (sel.has(fi)) deleted.push(fi);
      else pushPlane(constraints, planeOf(md.faces[fi]));
    }
    const partners = [];
    for (const dfi of deleted) {
      const neigh = delNeighbors.get(dfi);
      if (!neigh) continue;
      for (const kfi of neigh) {
        const plane = planeOf(md.faces[kfi]);
        if (!plane) continue;
        let blocked = false;
        for (const c of constraints) {
          if (planesParallel(c, plane)) { blocked = true; break; }
        }
        if (blocked) continue;
        pushPlane(partners, plane);
      }
    }

    let point = null;
    let bestD = Infinity;
    const consider = (hit) => {
      if (!hit || !onPlanes(hit, constraints)) return;
      const d = _c4Len(_c4Sub(hit, md.V[vi]));
      if (d < bestD) { bestD = d; point = hit; }
    };
    if (constraints.length === 2) {
      const line = planeLine(constraints[0], constraints[1]);
      if (line) {
        for (const p of partners) consider(lineHit(line, p));
      }
    } else if (constraints.length === 1) {
      for (const p of partners) {
        const line = planeLine(constraints[0], p);
        if (line) consider(projectLine(md.V[vi], line));
      }
    }
    if (!point || !(bestD > 1e-4) || bestD > cap) continue;
    moved[vi] = point;
  }

  let flipped = 0;
  let total = 0;
  for (let t = 0; t < nTri; t++) {
    if (dropTri[t]) continue;
    const i0 = md.T[t * 3];
    const i1 = md.T[t * 3 + 1];
    const i2 = md.T[t * 3 + 2];
    const before = _c4Cross(_c4Sub(md.V[i1], md.V[i0]), _c4Sub(md.V[i2], md.V[i0]));
    const a = _c4Len(before);
    if (a < 1e-9) continue;
    total += a;
    const after = _c4Cross(_c4Sub(moved[i1], moved[i0]), _c4Sub(moved[i2], moved[i0]));
    if (_c4Len(after) < 1e-9) continue;
    if (_c4Dot(before, after) < 0) flipped += a;
  }
  if (total > 0 && flipped / total > 0.02) {
    throw new Error(
      `deleteFace: removing these faces cannot keep a closed solid — `
      + `${Math.round((flipped / total) * 100)}% of the surface folds`,
    );
  }

  const weld = new Map();
  const newV = [];
  const mapV = (old) => {
    const v = moved[old];
    const key = `${Math.round(v[0] * 1e4)},${Math.round(v[1] * 1e4)},${Math.round(v[2] * 1e4)}`;
    if (weld.has(key)) return weld.get(key);
    const id = newV.length;
    weld.set(key, id);
    newV.push(v.slice());
    return id;
  };
  const newTris = [];
  const seenTri = new Set();
  for (let t = 0; t < nTri; t++) {
    if (dropTri[t]) continue;
    const i0 = mapV(md.T[t * 3]);
    const i1 = mapV(md.T[t * 3 + 1]);
    const i2 = mapV(md.T[t * 3 + 2]);
    if (i0 === i1 || i1 === i2 || i2 === i0) continue;
    const area = _c4Len(_c4Cross(
      _c4Sub(newV[i1], newV[i0]),
      _c4Sub(newV[i2], newV[i0]),
    ));
    if (area < 1e-8) continue;
    const key = [i0, i1, i2].sort((a, b) => a - b).join(',');
    if (seenTri.has(key)) continue;
    seenTri.add(key);
    newTris.push(i0, i1, i2);
  }
  if (newTris.length < 12) {
    throw new Error(
      'deleteFace: removing these faces cannot keep a closed solid — neighboring faces do not meet',
    );
  }

  const edgeUse = new Map();
  for (let i = 0; i < newTris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const u = newTris[i + k];
      const w = newTris[i + ((k + 1) % 3)];
      const key = u < w ? `${u},${w}` : `${w},${u}`;
      edgeUse.set(key, (edgeUse.get(key) || 0) + 1);
    }
  }
  let open = 0;
  let nonManifold = 0;
  for (const count of edgeUse.values()) {
    if (count === 1) open++;
    else if (count !== 2) nonManifold++;
  }
  if (open || nonManifold) {
    throw new Error(
      'deleteFace: removing these faces cannot keep a closed solid — neighboring faces do not meet'
      + ` (${open} open, ${nonManifold} non-manifold)`,
    );
  }

  const { Manifold, Mesh } = manifoldModule;
  const vp = new Float32Array(newV.length * 3);
  for (let i = 0; i < newV.length; i++) {
    vp[i * 3] = newV[i][0];
    vp[i * 3 + 1] = newV[i][1];
    vp[i * 3 + 2] = newV[i][2];
  }
  let out;
  try {
    out = new Manifold(new Mesh({
      numProp: 3,
      vertProperties: vp,
      triVerts: new Uint32Array(newTris),
    }));
    const se = _c4StatusError(out);
    if (se) {
      throw new Error(
        `deleteFace: removing these faces cannot keep a closed solid (${se})`,
      );
    }
    const outBb = out.boundingBox();
    const outDiag = Math.hypot(
      outBb.max[0] - outBb.min[0],
      outBb.max[1] - outBb.min[1],
      outBb.max[2] - outBb.min[2],
    );
    if (outDiag > diag * 2 + 1) {
      throw new Error(
        'deleteFace: removing these faces cannot keep a closed solid — the heal runs away',
      );
    }
    return _c4RequireValidSolid(out, 'deleteFace');
  } catch (err) {
    if (out) _safeDeleteManifold(out);
    throw err;
  }
}

// Helpers for a loft function

// Compute centroid of a contour (array of [x, y] points)
function computeCentroid(contour) {
  let cx = 0;
  let cy = 0;
  const n = contour.length;
  if (n === 0) return [0, 0];

  for (const p of contour) {
    cx += p[0];
    cy += p[1];
  }
  return [cx / n, cy / n];
}

// Center a contour by subtracting its centroid
function centerContour(contour) {
  const [cx, cy] = computeCentroid(contour);
  return contour.map(p => [p[0] - cx, p[1] - cy]);
}

// Resample a closed contour to n evenly spaced points using arc-length parameterization
function resampleContour(contour, n) {
  if (contour.length < 2) return contour;
  if (n < 2) n = 2;

  // Compute cumulative arc lengths
  const lengths = [0];
  for (let i = 1; i < contour.length; i++) {
    const dx = contour[i][0] - contour[i - 1][0];
    const dy = contour[i][1] - contour[i - 1][1];
    lengths.push(lengths[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  // Close the loop
  const dxClose = contour[0][0] - contour[contour.length - 1][0];
  const dyClose = contour[0][1] - contour[contour.length - 1][1];
  lengths.push(lengths[lengths.length - 1] + Math.sqrt(dxClose * dxClose + dyClose * dyClose));

  const totalLength = lengths[lengths.length - 1];

  const resampled = [];
  for (let i = 0; i < n; i++) {
    const target = (i / n) * totalLength;

    // Find segment
    let seg = 0;
    while (seg < lengths.length - 1 && target > lengths[seg + 1]) seg++;

    const s0 = lengths[seg];
    const s1 = lengths[seg + 1];
    const frac = (target - s0) / (s1 - s0);

    const idx0 = seg % contour.length;
    const idx1 = (seg + 1) % contour.length;

    const x = contour[idx0][0] + frac * (contour[idx1][0] - contour[idx0][0]);
    const y = contour[idx0][1] + frac * (contour[idx1][1] - contour[idx0][1]);

    resampled.push([x, y]);
  }

  return resampled;
}

// Rotate a contour (array of [x, y] points) by a given angle in degrees
function rotateContour(contour, deg) {
  if (contour.length === 0) return contour;
  const rad = deg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return contour.map(p => [
    p[0] * cos - p[1] * sin,
    p[0] * sin + p[1] * cos
  ]);
}

// Compute sum of squared distances between two contours of equal length
function sumSqDist(cont1, cont2) {
  if (cont1.length !== cont2.length) {
    throw new Error('Contours must have the same number of points for sumSqDist');
  }
  let dist = 0;
  for (let i = 0; i < cont1.length; i++) {
    const dx = cont1[i][0] - cont2[i][0];
    const dy = cont1[i][1] - cont2[i][1];
    dist += dx * dx + dy * dy;
  }
  return dist;
}

function loft({
  topCS,
  bottomCS,
  height = 30,
  twistDeg = 0,
  topScale = 1.0,
  align = true,
  resolution = 1024  // Higher for better corner preservation
} = {}) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  const { Manifold } = manifoldModule;

  // Extract and center contours
  let bottomContour = centerContour(bottomCS.toPolygons()[0]);
  let topContour = centerContour(topCS.toPolygons()[0]);

  // Scale top
  topContour = topContour.map(p => [p[0] * topScale, p[1] * topScale]);

  // Resample using arc length
  const bottomTable = resampleContour(bottomContour, resolution);
  let topTable = resampleContour(topContour, resolution);

  // Optional alignment
  if (align) {
    let bestRot = 0;
    let minDist = Infinity;
    const steps = 72;
    for (let k = 0; k < steps; k++) {
      const rot = k * (360 / steps);
      const rotated = rotateContour(topTable, rot);
      const d = sumSqDist(bottomTable, rotated);
      if (d < minDist) {
        minDist = d;
        bestRot = rot;
      }
    }
    topTable = rotateContour(topTable, bestRot);
  }

  // Precompute radial distance table for bottom (normalized radius at each angle)
  const radialTable = [];
  for (let i = 0; i < resolution; i++) {
    const x = bottomTable[i][0];
    const y = bottomTable[i][1];
    radialTable[i] = Math.sqrt(x * x + y * y);
  }

  // Extrude bottom to full height
  const straight = Manifold.extrude(bottomCS, height, 128);

  // Warp using polar coordinates for proper corner blending
  const warp = (v) => {
    let [x, y, z] = v;

    const t = z / height;

    // Handle center separately
    const r_orig = Math.sqrt(x * x + y * y);
    if (r_orig < 1e-8) {
      v[0] = 0;
      v[1] = 0;
      return;
    }

    // Normalized radius on bottom at this angle
    let angle = Math.atan2(y, x);
    if (angle < 0) angle += 2 * Math.PI;
    const s = angle / (2 * Math.PI);

    const i = Math.floor(s * resolution);
    const frac = (s * resolution) - i;

    // Interpolate normalized radius from bottom table
    let r_bottom = radialTable[i];
    r_bottom += frac * (radialTable[(i + 1) % resolution] - radialTable[i]);

    // Scale factor for this ray
    const scale = r_orig / r_bottom;

    // Interpolate target point from top table at same angle
    let tx = topTable[i][0];
    let ty = topTable[i][1];
    tx += frac * (topTable[(i + 1) % resolution][0] - tx);
    ty += frac * (topTable[(i + 1) % resolution][1] - ty);

    // Linear blend in shape space
    let targetX = x + t * (tx * scale - x);
    let targetY = y + t * (ty * scale - y);

    // Apply twist
    if (twistDeg !== 0) {
      const twistAngle = t * twistDeg * Math.PI / 180;
      const cosT = Math.cos(twistAngle);
      const sinT = Math.sin(twistAngle);
      const tempX = targetX * cosT - targetY * sinT;
      targetY = targetX * sinT + targetY * cosT;
      targetX = tempX;
    }

    v[0] = targetX;
    v[1] = targetY;
  };

  return straight.warp(warp);
}

/**
 * Sweep a 2D profile along a 3D path
 * 
 * Creates a 3D manifold by extruding a cross-section profile along a parametric
 * path curve. Uses Rotation Minimizing Frames (RMF) for smooth orientation
 * without twist artifacts, and arc-length parameterization for uniform distribution.
 * 
 * @param {CrossSection} profile - The 2D cross-section to sweep (centered at origin)
 * @param {Object} path - Parametric path definition
 * @param {Function} path.position - Function(t) returning [x,y,z] position on curve
 * @param {Function} [path.derivative] - Function(t) returning first derivative [dx,dy,dz].
 *                                       If omitted, computed numerically.
 * @param {number} [path.tMin=0] - Start parameter value
 * @param {number} [path.tMax=1] - End parameter value
 * @param {Object} [options] - Sweep options
 * @param {number} [options.arcSamples=1000] - Samples for arc-length table (higher = more accurate)
 * @param {number} [options.extrudeSegments=64] - Segments along the extrusion
 * @param {number} [options.epsilon=1e-5] - Delta for numerical derivatives
 * @param {number[]} [options.initialNormal] - Initial normal direction hint [x,y,z]
 * @returns {Manifold} The swept 3D manifold
 * 
 * @example
 * // Sweep a circle along a helix
 * const profile = CrossSection.circle(2, 32);
 * const helixPath = {
 *   position: (t) => [10 * Math.cos(t), 10 * Math.sin(t), 3 * t],
 *   tMin: 0,
 *   tMax: 4 * Math.PI
 * };
 * return sweep(profile, helixPath);
 */
function sweep(profile, path, options = {}) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  const { Manifold } = manifoldModule;
  
  const {
    position,
    derivative: explicitDerivative,
    tMin = 0,
    tMax = 1
  } = path;
  
  const {
    arcSamples = 1000,
    extrudeSegments = 64,
    epsilon = 1e-5,
    initialNormal = null
  } = options;
  
  if (typeof position !== 'function') {
    throw new Error('path.position must be a function');
  }
  
  // Numerical derivative fallback
  const derivative = explicitDerivative || ((t) => {
    const p0 = position(t - epsilon);
    const p1 = position(t + epsilon);
    return vecMul(1 / (2 * epsilon), vecSub(p1, p0));
  });
  
  // Precompute arc length table
  const tValues = [];
  const sValues = [0];
  const deltaT = (tMax - tMin) / arcSamples;
  
  for (let i = 0; i <= arcSamples; i++) {
    tValues.push(tMin + i * deltaT);
  }
  
  for (let i = 1; i <= arcSamples; i++) {
    const speedPrev = vecNorm(derivative(tValues[i - 1]));
    const speedCurr = vecNorm(derivative(tValues[i]));
    const deltaS = (speedPrev + speedCurr) / 2 * deltaT;
    sValues.push(sValues[i - 1] + deltaS);
  }
  
  const totalLength = sValues[sValues.length - 1];
  
  if (totalLength < epsilon) {
    throw new Error('Path has zero or near-zero length');
  }
  
  // =========================================================================
  // Precompute Rotation Minimizing Frames (RMF) at sample points
  // This prevents twist discontinuities that occur with Frenet frames
  // =========================================================================
  
  const frames = []; // Array of { T, N, B } at each tValue
  
  // Compute initial frame
  const T0 = vecNormalize(derivative(tValues[0]));
  let N0;
  
  if (initialNormal) {
    // Use provided initial normal, orthogonalize to tangent
    const proj = vecMul(vecDot(initialNormal, T0), T0);
    N0 = vecNormalize(vecSub(initialNormal, proj));
  } else {
    // Find a vector not parallel to T0 for initial normal
    const absT = [Math.abs(T0[0]), Math.abs(T0[1]), Math.abs(T0[2])];
    let minAxis;
    if (absT[0] <= absT[1] && absT[0] <= absT[2]) {
      minAxis = [1, 0, 0];
    } else if (absT[1] <= absT[0] && absT[1] <= absT[2]) {
      minAxis = [0, 1, 0];
    } else {
      minAxis = [0, 0, 1];
    }
    N0 = vecNormalize(vecCross(T0, minAxis));
  }
  
  const B0 = vecCross(T0, N0);
  frames.push({ T: T0, N: N0, B: B0 });
  
  // Propagate frame using double reflection method (rotation minimizing)
  for (let i = 1; i <= arcSamples; i++) {
    const prevFrame = frames[i - 1];
    const Ti = vecNormalize(derivative(tValues[i]));
    
    // Double reflection method for RMF
    // Reflect previous frame to midpoint, then to current point
    const v1 = vecSub(position(tValues[i]), position(tValues[i - 1]));
    const c1 = vecDot(v1, v1);
    
    if (c1 < epsilon * epsilon) {
      // Points too close, copy previous frame with new tangent
      const proj = vecMul(vecDot(prevFrame.N, Ti), Ti);
      const Ni = vecNormalize(vecSub(prevFrame.N, proj));
      const Bi = vecCross(Ti, Ni);
      frames.push({ T: Ti, N: Ni, B: Bi });
      continue;
    }
    
    // First reflection: reflect N and T across v1
    const NL = vecSub(prevFrame.N, vecMul((2 / c1) * vecDot(v1, prevFrame.N), v1));
    const TL = vecSub(prevFrame.T, vecMul((2 / c1) * vecDot(v1, prevFrame.T), v1));
    
    // Second reflection: reflect across v2 = Ti - TL
    const v2 = vecSub(Ti, TL);
    const c2 = vecDot(v2, v2);
    
    let Ni;
    if (c2 < epsilon * epsilon) {
      Ni = NL;
    } else {
      Ni = vecSub(NL, vecMul((2 / c2) * vecDot(v2, NL), v2));
    }
    
    // Ensure orthonormality
    Ni = vecNormalize(vecSub(Ni, vecMul(vecDot(Ni, Ti), Ti)));
    const Bi = vecCross(Ti, Ni);
    
    frames.push({ T: Ti, N: Ni, B: Bi });
  }
  
  // Create straight extrusion to warp
  const straight = Manifold.extrude(profile, totalLength, extrudeSegments);
  
  // Warp function using precomputed RMF frames
  const warp = (v) => {
    let [x, y, s] = v;
    s = Math.max(0, Math.min(totalLength, s));
    
    // Binary search for arc length to parameter mapping
    let low = 0;
    let high = sValues.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (sValues[mid] <= s) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    
    let i = low;
    if (i === sValues.length - 1) i--;
    
    // Interpolate between frames
    const frac = (s - sValues[i]) / (sValues[i + 1] - sValues[i]);
    const t = tValues[i] + frac * (tValues[i + 1] - tValues[i]);
    
    // Get position on curve
    const P = position(t);
    
    // Interpolate frame (simple linear interp, could use slerp for better results)
    const frame0 = frames[i];
    const frame1 = frames[i + 1];
    
    const N = vecNormalize([
      frame0.N[0] + frac * (frame1.N[0] - frame0.N[0]),
      frame0.N[1] + frac * (frame1.N[1] - frame0.N[1]),
      frame0.N[2] + frac * (frame1.N[2] - frame0.N[2])
    ]);
    const B = vecNormalize([
      frame0.B[0] + frac * (frame1.B[0] - frame0.B[0]),
      frame0.B[1] + frac * (frame1.B[1] - frame0.B[1]),
      frame0.B[2] + frac * (frame1.B[2] - frame0.B[2])
    ]);
    
    // Map local (x, y) to N-B plane
    v[0] = P[0] + x * N[0] + y * B[0];
    v[1] = P[1] + x * N[1] + y * B[1];
    v[2] = P[2] + x * N[2] + y * B[2];
  };

  const swept = straight.warp(warp);
  // Face identity: caps on the path's end planes, one wall per logical
  // profile edge, read off the swept mesh through the frame nearest each
  // triangle (the warp re-sorts triangles, so nothing is read by index).
  return _stampSweep(swept, {
    profile,
    frames,
    samples: tValues.map((tv) => position(tv)),
    pathPoints: options.identityPath || null,
  });
}

// ============================================================================
// VECTOR HELPERS (for sweep and other operations)
// ============================================================================

function vecAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vecSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vecMul(s, v) { return [s * v[0], s * v[1], s * v[2]]; }
function vecDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vecCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}
function vecNorm(v) { return Math.sqrt(vecDot(v, v)); }
function vecNormalize(v) {
  const len = vecNorm(v);
  return len > 1e-8 ? vecMul(1 / len, v) : [0, 0, 1];
}

/**
 * Sweep a profile along a path defined by an array of points
 * 
 * Convenience wrapper for sweep() that accepts a polyline path.
 * Internally creates a Catmull-Rom spline through the points.
 * 
 * @param {CrossSection} profile - The 2D cross-section to sweep
 * @param {number[][]} points - Array of [x,y,z] points defining the path (minimum 2 points)
 * @param {Object} [options] - Sweep options (see sweep())
 * @param {boolean} [options.closed=false] - Whether the path forms a closed loop
 * @returns {Manifold} The swept 3D manifold
 * 
 * @example
 * // Sweep along a series of points
 * const profile = CrossSection.circle(1, 16);
 * const points = [
 *   [0, 0, 0],
 *   [10, 5, 0],
 *   [20, 0, 10],
 *   [30, -5, 10]
 * ];
 * return sweepPoints(profile, points);
 */
function sweepPoints(profile, points, options = {}) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('points must be an array of at least 2 [x,y,z] coordinates');
  }
  
  const { closed = false, ...sweepOptions } = options;
  const n = points.length;
  
  // Catmull-Rom spline interpolation
  const catmullRom = (p0, p1, p2, p3, t) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return [
      0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
      0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      0.5 * ((2 * p1[2]) + (-p0[2] + p2[2]) * t + (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 + (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3)
    ];
  };
  
  const catmullRomDeriv = (p0, p1, p2, p3, t) => {
    const t2 = t * t;
    return [
      0.5 * ((-p0[0] + p2[0]) + 2 * (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t + 3 * (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t2),
      0.5 * ((-p0[1] + p2[1]) + 2 * (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t + 3 * (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t2),
      0.5 * ((-p0[2] + p2[2]) + 2 * (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t + 3 * (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t2)
    ];
  };
  
  // Get control points with proper boundary handling
  // For open curves, extrapolate phantom points to maintain tangent direction
  const getPoint = (i) => {
    if (closed) {
      return points[((i % n) + n) % n];
    } else {
      if (i < 0) {
        // Extrapolate before start: reflect point[1] across point[0]
        const idx = -i;
        if (idx <= n - 1) {
          return vecSub(vecMul(2, points[0]), points[idx]);
        }
        return points[0];
      } else if (i >= n) {
        // Extrapolate after end: reflect point[n-2] across point[n-1]
        const idx = 2 * (n - 1) - i;
        if (idx >= 0) {
          return vecSub(vecMul(2, points[n - 1]), points[idx]);
        }
        return points[n - 1];
      }
      return points[i];
    }
  };
  
  const numSegments = closed ? n : n - 1;
  
  const path = {
    position: (t) => {
      // Clamp t to valid range to avoid issues at boundaries
      t = Math.max(0, Math.min(1, t));
      const scaledT = t * numSegments;
      let segment = Math.floor(scaledT);
      let localT = scaledT - segment;
      
      // Handle exact endpoint
      if (segment >= numSegments) {
        segment = numSegments - 1;
        localT = 1;
      }
      
      const p0 = getPoint(segment - 1);
      const p1 = getPoint(segment);
      const p2 = getPoint(segment + 1);
      const p3 = getPoint(segment + 2);
      
      return catmullRom(p0, p1, p2, p3, localT);
    },
    derivative: (t) => {
      t = Math.max(0, Math.min(1, t));
      const scaledT = t * numSegments;
      let segment = Math.floor(scaledT);
      let localT = scaledT - segment;
      
      if (segment >= numSegments) {
        segment = numSegments - 1;
        localT = 1;
      }
      
      const p0 = getPoint(segment - 1);
      const p1 = getPoint(segment);
      const p2 = getPoint(segment + 1);
      const p3 = getPoint(segment + 2);
      
      // Scale derivative by numSegments due to chain rule
      const d = catmullRomDeriv(p0, p1, p2, p3, localT);
      return vecMul(numSegments, d);
    },
    tMin: 0,
    tMax: 1
  };
  
  return sweep(profile, path, { ...sweepOptions, identityPath: points.map((pt) => [pt[0], pt[1], pt[2]]) });
}

/**
 * Create a rounded box (box with filleted edges)
 * @param {number[]} size - [x, y, z] dimensions
 * @param {number} radius - Corner/edge radius
 * @param {number} segments - Number of segments for rounding (default 16)
 */
function roundedBox(size, radius, segments = 16) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  const { Manifold } = manifoldModule;
  const minDim = Math.min(...size);
  const r = Math.min(radius, minDim / 2 - 0.001);
  if (!(r > 0)) return _stampCube(Manifold.cube(size, true), 'roundedBox');
  // Bundled Manifold has no offset()/minkowski — hull of 8 corner spheres
  // equals cube ⊕ sphere (rounded box).
  const half = size.map((s) => s / 2 - r);
  const spheres = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        spheres.push(
          Manifold.sphere(r, segments).translate([
            sx * half[0], sy * half[1], sz * half[2],
          ]),
        );
      }
    }
  }
  return _stampRoundedBox(Manifold.hull(spheres), size, r);
}

/**
 * Rounded-rectangle 2D profile as a CrossSection, centered on the origin.
 * r = 0 gives a plain rectangle. r is clamped to half the shorter side.
 */
function _c4RectProfile(w, d, r, segments) {
  const { CrossSection } = manifoldModule;
  const rr = Math.min(Math.max(r || 0, 0), Math.min(w, d) / 2 - 1e-9);
  if (!(rr > 1e-9)) return CrossSection.square([w, d], true);
  // Offset an inset rectangle outward: exact rounded corners, no hand-rolled arcs.
  return CrossSection.square([w - 2 * rr, d - 2 * rr], true)
    .offset(rr, 'Round', 2, Math.max(8, segments || 32));
}

/**
 * rectTube(outer, inner, height, opts) — rectangular (square) tube.
 *
 * @param {number|number[]} outer outer size: [w, d], or a number for a square
 * @param {number|number[]} inner inner size [w, d]; a NUMBER is read as a
 *        uniform wall thickness (inner = outer - 2*wall), which is how you
 *        usually want to specify a rectangular tube
 * @param {number} height extruded height (z = 0 .. height, like Manifold.cylinder)
 * @param {object} [opts]
 * @param {number} [opts.cornerRadius=0] outer corner radius
 * @param {number} [opts.innerCornerRadius] inner corner radius; defaults to
 *        cornerRadius - wall (>= 0), which keeps the wall uniform round the corner
 * @param {number} [opts.segments=32] segments per full circle for the corner arcs
 * @param {boolean} [opts.center=false] center the extrusion on z instead of z=0..h
 * @returns {Manifold}
 *
 * @example
 * rectTube([40, 20], 2.5, 60);                        // 2.5mm wall, sharp corners
 * rectTube([40, 20], [30, 10], 60, { cornerRadius: 4 });
 */
function rectTube(outer, inner, height, opts = {}) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  const size = (v, label) => {
    if (Array.isArray(v)) {
      if (v.length !== 2) throw new Error(`rectTube: ${label} must be [w, d] or a number`);
      return [v[0], v[1]];
    }
    return [v, v];
  };
  const [ow, od] = size(outer, 'outer');
  _c4RequirePositive('rectTube', 'outer width', ow);
  _c4RequirePositive('rectTube', 'outer depth', od);
  _c4RequirePositive('rectTube', 'height', height);
  let iw, id, wall;
  if (typeof inner === 'number') {
    wall = inner;
    _c4RequirePositive('rectTube', 'wall', wall);
    iw = ow - 2 * wall;
    id = od - 2 * wall;
    if (!(iw > 0) || !(id > 0)) {
      throw new Error(
        `rectTube: wall ${wall} is too thick for a ${ow}x${od} tube (needs < ${(Math.min(ow, od) / 2).toFixed(3)})`,
      );
    }
  } else {
    [iw, id] = size(inner, 'inner');
    _c4RequirePositive('rectTube', 'inner width', iw);
    _c4RequirePositive('rectTube', 'inner depth', id);
    if (iw >= ow || id >= od) {
      throw new Error(`rectTube: inner ${iw}x${id} must be smaller than outer ${ow}x${od}`);
    }
    wall = Math.min(ow - iw, od - id) / 2;
  }
  const segments = opts.segments ?? 32;
  const rOut = opts.cornerRadius ?? 0;
  const rIn = opts.innerCornerRadius ?? Math.max(0, rOut - wall);
  const profile = _c4RectProfile(ow, od, rOut, segments)
    .subtract(_c4RectProfile(iw, id, rIn, segments));
  const out = profile.extrude(height, 0, 0, [1, 1], !!opts.center);
  return _c4RequireValidSolid(out, 'rectTube');
}

/**
 * Create a tube/pipe shape — round or rectangular.
 *
 * Round:       tube(outerRadius, innerRadius, height, segments?)
 * Rectangular: tube([w, d], wall, height, opts?)  /  tube([w, d], [iw, id], height, opts?)
 *
 * Passing an array as the first argument hands off to `rectTube`, so the 4th
 * argument is then its options object ({ cornerRadius, segments, center }) and
 * not a segment count.
 *
 * @param {number|number[]} outerRadius outer radius, or [w, d] for a rectangle
 * @param {number|number[]} innerRadius inner radius; for a rectangle, a wall
 *        thickness or [iw, id]
 * @param {number} height Height of the tube
 * @param {number|object} [segments=32] segments (round) or opts (rectangular)
 */
function tube(outerRadius, innerRadius, height, segments = 32) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  const { Manifold } = manifoldModule;

  if (Array.isArray(outerRadius)) {
    return rectTube(outerRadius, innerRadius, height, typeof segments === 'object' ? segments : {});
  }

  if (innerRadius >= outerRadius) {
    throw new Error('Inner radius must be smaller than outer radius');
  }

  const outer = Manifold.cylinder(height, outerRadius, outerRadius, segments);
  const inner = Manifold.cylinder(height, innerRadius, innerRadius, segments);

  return _stampTube(outer.subtract(inner), outerRadius, innerRadius);
}

/**
 * Create a hexagonal prism
 * @param {number} radius - Radius (circumradius)
 * @param {number} height - Height
 */
function hexPrism(radius, height) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  const { Manifold } = manifoldModule;
  
  return _stampHexPrism(Manifold.cylinder(height, radius, radius, 6));
}

/** 'xy' | 'xz' | 'yz' through the origin, or { center, normal } / { normal, originOffset }. */
function _mirrorFrameOf(plane) {
  if (typeof plane === 'string') {
    const key = plane.trim().toLowerCase();
    const named = { xy: [0, 0, 1], xz: [0, 1, 0], yz: [1, 0, 0] }[key];
    if (!named) throw new Error('mirror: plane must be "xy", "xz", "yz", or { center, normal }');
    return { center: [0, 0, 0], normal: named };
  }
  if (!plane || typeof plane !== 'object' || Array.isArray(plane)) {
    throw new Error('mirror: plane must be "xy", "xz", "yz", or { center, normal }');
  }
  const nRaw = plane.normal;
  if (!Array.isArray(nRaw) || nRaw.length < 3) {
    throw new Error('mirror: plane must be "xy", "xz", "yz", or { center, normal }');
  }
  const n = [Number(nRaw[0]), Number(nRaw[1]), Number(nRaw[2])];
  if (n.some((v) => !Number.isFinite(v))) throw new Error('mirror: normal must be finite [x, y, z]');
  const len = Math.hypot(n[0], n[1], n[2]);
  if (!(len > 1e-12)) throw new Error('mirror: normal has zero length');
  const normal = [n[0] / len, n[1] / len, n[2] / len];
  let center;
  if (Array.isArray(plane.center)) {
    center = [Number(plane.center[0]), Number(plane.center[1]), Number(plane.center[2])];
    if (center.some((v) => !Number.isFinite(v))) throw new Error('mirror: center must be finite [x, y, z]');
  } else if (plane.originOffset != null || plane.offset != null) {
    const off = Number(plane.originOffset != null ? plane.originOffset : plane.offset);
    if (!Number.isFinite(off)) throw new Error('mirror: originOffset must be a finite number');
    center = [normal[0] * off, normal[1] * off, normal[2] * off];
  } else {
    center = [0, 0, 0];
  }
  return { center, normal };
}

/** Unit quaternion [x, y, z, w] rotating unit vector u onto unit vector v. */
function _mirrorQuatFromTo(u, v) {
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  if (dot > 1 - 1e-10) return [0, 0, 0, 1];
  let x;
  let y;
  let z;
  let w;
  if (dot < -1 + 1e-10) {
    const ax = Math.abs(u[0]) < 0.9 ? 1 : 0;
    const ay = ax === 1 ? 0 : 1;
    x = u[1] * 0 - u[2] * ay;
    y = u[2] * ax - u[0] * 0;
    z = u[0] * ay - u[1] * ax;
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len, 0];
  }
  x = u[1] * v[2] - u[2] * v[1];
  y = u[2] * v[0] - u[0] * v[2];
  z = u[0] * v[1] - u[1] * v[0];
  w = 1 + dot;
  const len = Math.hypot(x, y, z, w);
  return [x / len, y / len, z / len, w / len];
}

/** Column-major rotation (Manifold.transform) for quaternion [x, y, z, w]. */
function _mirrorQuatMatrix(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
}

/**
 * Reflect body across the plane. Rotation plus a Z scale, the same two
 * operations rotateAbout and the old origin mirror already use. The input
 * handle is left alone.
 */
function _reflectManifold(body, frame) {
  const origin = frame.center;
  const shifted = body.translate([-origin[0], -origin[1], -origin[2]]);
  const q = _mirrorQuatFromTo(frame.normal, [0, 0, 1]);
  const spun = shifted.transform(_mirrorQuatMatrix(q));
  if (shifted !== body && shifted !== spun) _safeDeleteManifold(shifted);
  const flipped = spun.scale([1, 1, -1]);
  if (spun !== body && spun !== flipped) _safeDeleteManifold(spun);
  const qi = [-q[0], -q[1], -q[2], q[3]];
  const unspun = flipped.transform(_mirrorQuatMatrix(qi));
  if (flipped !== body && flipped !== unspun) _safeDeleteManifold(flipped);
  const back = unspun.translate(origin);
  if (unspun !== body && unspun !== back) _safeDeleteManifold(unspun);
  const status = _c4StatusError(back);
  if (status) {
    _safeDeleteManifold(back);
    throw new Error(`mirror: result is not a valid solid (${status})`);
  }
  return back;
}

/** Union the copy with the original. Overlap is an error, not a silent drop of the original. */
function _mirrorJoin(original, reflected) {
  let joined;
  try {
    joined = original.add(reflected);
  } catch (err) {
    _safeDeleteManifold(reflected);
    const msg = err && err.message ? String(err.message) : String(err);
    throw new Error(`mirror: the mirrored copy overlaps the original and could not be joined (${msg}). Pick a plane that does not cut through the body.`);
  }
  const status = _c4StatusError(joined);
  if (status) {
    if (joined !== original && joined !== reflected) _safeDeleteManifold(joined);
    if (reflected !== original) _safeDeleteManifold(reflected);
    throw new Error(`mirror: the mirrored copy overlaps the original and could not be joined (${status}). Pick a plane that does not cut through the body.`);
  }
  if (reflected !== joined && reflected !== original) _safeDeleteManifold(reflected);
  return joined;
}

/**
 * mirror(manifold, plane, keepOriginal, { bodies }) — reflect one body, or the whole solid.
 * plane is 'xy', 'xz', or 'yz' (through the origin) or { center, normal }
 * (a workplane or a planar face). { normal, originOffset } is the same plane.
 * keepOriginal unions the copy with that body (default true). A third
 * argument that is an object is the options, and the copy is kept.
 * { bodies: [{ at }] } names one body the way move() does: that body is
 * mirrored, every other body stays. With no bodies, the whole solid is
 * mirrored, which is what older scripts do. The input handle is not deleted.
 * Overlap throws; the original is not replaced by the copy alone.
 * @param {Manifold} manifold - The solid
 * @param {string|{center:number[],normal:number[]}} plane - 'xy', 'xz', 'yz', or { center, normal }
 * @param {boolean|{bodies?:object[]}} [keepOriginal=true] - Keep the original, or an options object
 * @param {{bodies?:{at:number[]}[],keepOriginal?:boolean}} [opts] - Name one body with { bodies: [{ at }] }
 */
function mirror(manifold, plane = 'xy', keepOriginal = true, opts = {}) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  if (!manifold || typeof manifold.translate !== 'function' || typeof manifold.scale !== 'function') {
    throw new Error('mirror: expected a Manifold');
  }
  let options = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  let keep = keepOriginal;
  if (keepOriginal && typeof keepOriginal === 'object' && !Array.isArray(keepOriginal)) {
    options = keepOriginal;
    keep = options.keepOriginal !== false;
  }
  keep = keep !== false;
  const frame = _mirrorFrameOf(plane);
  const named = Array.isArray(options.bodies);
  if (!named) {
    const reflected = _reflectManifold(manifold, frame);
    if (!keep) return reflected;
    return _mirrorJoin(manifold, reflected);
  }
  let bodies;
  let selected;
  try {
    bodies = _cutBodiesOf(manifold);
    selected = _moveSelected(manifold, bodies, options.bodies);
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    throw new Error(msg.replace(/^(?:cut|move|rotateAbout):/, 'mirror:'));
  }
  if (selected.size !== 1) {
    throw new Error('mirror: name one body with { bodies: [{ at }] }');
  }
  const idx = selected.values().next().value;
  if (bodies.length === 1 && bodies[0] === manifold) {
    const reflected = _reflectManifold(manifold, frame);
    if (!keep) return reflected;
    return _mirrorJoin(manifold, reflected);
  }
  const { Manifold } = manifoldModule;
  const kept = [];
  const discard = [];
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (i !== idx) {
      kept.push(body);
      continue;
    }
    const reflected = _reflectManifold(body, frame);
    const piece = keep ? _mirrorJoin(body, reflected) : reflected;
    kept.push(piece);
    if (body !== manifold && body !== piece) discard.push(body);
  }
  for (const m of discard) _safeDeleteManifold(m);
  const result = kept.length === 1 ? kept[0] : Manifold.compose(kept);
  const status = _c4StatusError(result);
  if (status) throw new Error(`mirror: result is not a valid solid (${status})`);
  return result;
}

/**
 * Create an array/grid of manifolds
 * @param {Manifold} manifold - The manifold to array
 * @param {number[]} counts - [nx, ny, nz] number of copies in each direction
 * @param {number[]} spacing - [dx, dy, dz] spacing between copies
 */
function array3D(manifold, counts, spacing) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  const { Manifold } = manifoldModule;
  
  const [nx, ny, nz] = counts;
  const [dx, dy, dz] = spacing;
  
  const copies = [];
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        if (ix === 0 && iy === 0 && iz === 0) {
          copies.push(manifold);
        } else {
          copies.push(manifold.translate([ix * dx, iy * dy, iz * dz]));
        }
      }
    }
  }
  
  return Manifold.union(copies);
}

/**
 * Pattern on points: one copy of `manifold` at every point, turned so its
 * `up` axis follows the point's `axis` when the point has one. This is how
 * a bolt part lands in every hole of the part it fastens: the points are
 * the hole centers and axes (`list_faces` gives them for cylindrical faces).
 *
 * @param {Manifold} manifold - The body to copy (one instance)
 * @param {Array<number[] | { at: number[], axis?: number[] }>} points - [x, y, z] mm, or { at, axis }
 * @param {{ up?: number[], keepOriginal?: boolean, merge?: boolean }} [opts]
 *   up: the body axis that follows each point's axis (default [0, 0, 1]);
 *   keepOriginal: also keep the source where it is (default false);
 *   merge: union the copies (default true); false composes them as separate bodies.
 */
function patternOnPoints(manifold, points, opts = {}) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  const { Manifold } = manifoldModule;
  if (!manifold || typeof manifold.translate !== 'function') {
    throw new Error('patternOnPoints: the first argument must be a Manifold');
  }
  const list = _patternPointsList(points);
  const up = _unitVector(opts && opts.up != null ? opts.up : [0, 0, 1], 'patternOnPoints: up');
  const copies = [];
  if (opts && opts.keepOriginal === true) copies.push(manifold);
  for (const { at, axis } of list) {
    if (!axis) {
      copies.push(manifold.translate(at));
      continue;
    }
    copies.push(manifold.transform(_rotationToMatrix(up, axis, at)));
  }
  if (copies.length === 1) return copies[0];
  return opts && opts.merge === false ? Manifold.compose(copies) : Manifold.union(copies);
}

/** Normalise the points argument; throws a plain Error on anything unusable. */
function _patternPointsList(points) {
  const bad = (why) => new Error(`patternOnPoints: points must be a non-empty array of [x, y, z] or { at: [x, y, z], axis?: [nx, ny, nz] } (${why})`);
  if (!Array.isArray(points) || points.length === 0) throw bad('got ' + (Array.isArray(points) ? 'an empty array' : typeof points));
  if (points.length > 10000) throw bad('more than 10000 points');
  const vec3 = (v, what) => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => Number.isFinite(Number(n)))) throw bad(`${what} is not [x, y, z]`);
    return v.map(Number);
  };
  return points.map((p, i) => {
    if (Array.isArray(p)) return { at: vec3(p, `point ${i}`), axis: null };
    if (p && typeof p === 'object') {
      const at = vec3(p.at, `point ${i} at`);
      let axis = null;
      if (p.axis != null) {
        axis = _unitVector(p.axis, `patternOnPoints: point ${i} axis`);
      }
      return { at, axis };
    }
    throw bad(`point ${i} is ${typeof p}`);
  });
}

function _unitVector(v, what) {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => Number.isFinite(Number(n)))) {
    throw new Error(`${what} must be [nx, ny, nz]`);
  }
  const [x, y, z] = v.map(Number);
  const len = Math.hypot(x, y, z);
  if (!(len > 1e-9)) throw new Error(`${what} must not be a zero vector`);
  return [x / len, y / len, z / len];
}

/**
 * The 4x4 column-major matrix that turns unit vector `from` onto unit vector
 * `to` (Rodrigues) and then moves to `at`. Antiparallel vectors rotate 180°
 * about any axis perpendicular to `from`.
 */
function _rotationToMatrix(from, to, at) {
  const [ax, ay, az] = from;
  const [bx, by, bz] = to;
  let vx = ay * bz - az * by;
  let vy = az * bx - ax * bz;
  let vz = ax * by - ay * bx;
  const c = ax * bx + ay * by + az * bz;
  const s = Math.hypot(vx, vy, vz);
  let R;
  if (s < 1e-9) {
    if (c > 0) {
      R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    } else {
      // 180° about an axis perpendicular to `from`.
      let px = -ay;
      let py = ax;
      let pz = 0;
      if (Math.hypot(px, py, pz) < 1e-9) { px = 0; py = -az; pz = ay; }
      const pl = Math.hypot(px, py, pz);
      px /= pl; py /= pl; pz /= pl;
      R = [
        2 * px * px - 1, 2 * px * py, 2 * px * pz,
        2 * py * px, 2 * py * py - 1, 2 * py * pz,
        2 * pz * px, 2 * pz * py, 2 * pz * pz - 1,
      ];
    }
  } else {
    const k = (1 - c) / (s * s);
    // R = I + [v]x + [v]x^2 * k, row-major here.
    R = [
      1 + k * (-vz * vz - vy * vy), -vz + k * (vx * vy), vy + k * (vx * vz),
      vz + k * (vx * vy), 1 + k * (-vz * vz - vx * vx), -vx + k * (vy * vz),
      -vy + k * (vx * vz), vx + k * (vy * vz), 1 + k * (-vy * vy - vx * vx),
    ];
  }
  // Column-major 4x4: columns are R's columns, then the translation.
  return [
    R[0], R[3], R[6], 0,
    R[1], R[4], R[7], 0,
    R[2], R[5], R[8], 0,
    at[0], at[1], at[2], 1,
  ];
}

/**
 * Copies of a solid equally spaced around an axis, offset perpendicular to that axis (+Y for x, +X for y and z), without keeping the input as an extra body.
 * @param {Manifold} manifold - The manifold to array
 * @param {number} count - Number of copies
 * @param {number} radius - Radius of the orbit. 0 leaves every copy on the axis
 * @param {string} axis - Rotation axis ('x', 'y', or 'z')
 */
function polarArray(manifold, count, radius = 0, axis = 'z') {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  const { Manifold } = manifoldModule;

  const copies = [];
  const angleStep = 360 / count;
  const ax = String(axis || 'z').toLowerCase();
  // +X is parallel to axis x, so that orbit steps out along +Y. y and z
  // step out along +X, which is perpendicular to both.
  const offset = !(radius > 0) ? null
    : ax === 'x' ? [0, radius, 0]
    : [radius, 0, 0];

  for (let i = 0; i < count; i++) {
    const angle = i * angleStep;
    const positioned = offset ? manifold.translate(offset) : manifold;
    let rotated;

    switch (ax) {
      case 'x':
        rotated = positioned.rotate([angle, 0, 0]);
        break;
      case 'y':
        rotated = positioned.rotate([0, angle, 0]);
        break;
      case 'z':
      default:
        rotated = positioned.rotate([0, 0, angle]);
        break;
    }

    copies.push(rotated);
  }

  return Manifold.union(copies);
}

/**
 * Center a manifold at origin
 * @param {Manifold} manifold - The manifold to center
 * @param {boolean[]} axes - [centerX, centerY, centerZ] which axes to center
 */
function center(manifold, axes = [true, true, true]) {
  const bbox = manifold.boundingBox();
  const offset = [0, 0, 0];
  
  for (let i = 0; i < 3; i++) {
    if (axes[i]) {
      offset[i] = -(bbox.min[i] + bbox.max[i]) / 2;
    }
  }
  
  return manifold.translate(offset);
}

/**
 * Align a manifold to a specific position
 * @param {Manifold} manifold - The manifold to align
 * @param {object} options - { min: [x,y,z], max: [x,y,z], center: [x,y,z] }
 */
function align(manifold, options = {}) {
  const bbox = manifold.boundingBox();
  const offset = [0, 0, 0];
  
  if (options.min) {
    for (let i = 0; i < 3; i++) {
      if (options.min[i] !== undefined) {
        offset[i] = options.min[i] - bbox.min[i];
      }
    }
  }
  
  if (options.max) {
    for (let i = 0; i < 3; i++) {
      if (options.max[i] !== undefined) {
        offset[i] = options.max[i] - bbox.max[i];
      }
    }
  }
  
  if (options.center) {
    for (let i = 0; i < 3; i++) {
      if (options.center[i] !== undefined) {
        const currentCenter = (bbox.min[i] + bbox.max[i]) / 2;
        offset[i] = options.center[i] - currentCenter;
      }
    }
  }
  
  return manifold.translate(offset);
}

/**
 * Get the dimensions of a manifold
 * @param {Manifold} manifold - The manifold to measure
 * @returns {object} { size: [x,y,z], min: [x,y,z], max: [x,y,z], center: [x,y,z] }
 */
function getDimensions(manifold) {
  const bbox = manifold.boundingBox();
  return {
    size: [
      bbox.max[0] - bbox.min[0],
      bbox.max[1] - bbox.min[1],
      bbox.max[2] - bbox.min[2]
    ],
    min: [...bbox.min],
    max: [...bbox.max],
    center: [
      (bbox.min[0] + bbox.max[0]) / 2,
      (bbox.min[1] + bbox.max[1]) / 2,
      (bbox.min[2] + bbox.max[2]) / 2
    ]
  };
}

// ============================================================================
// C4 — Selection + Feature helpers for Manifold JS (SurfCAD sandbox)
// Ported from cadgen-workspace/harness/c4_helpers.mjs (all 21 harness tests
// green; verified against real dataset STEP ground truth).
//
// Mesh facts (verified against manifold-3d):
//   getMesh() -> { numProp, vertProperties(Float32), triVerts(Uint32, 3/tri),
//                  faceID(Uint32, per-tri), ... }
//   faceID = true BRep face grouping (stable across booleans; 6 on a box,
//   14 on a 12-seg cylinder, 36 on a holed box). Triangle winding is outward.
//   runIndex = per-component (NOT per edge) — edges are derived from the
//   welded triangle map instead.
//   .transform(m) = flat-16 matrix, axes packed as ROWS (row-vector
//   convention, empirically verified; see frameToMatrix). Last row = translation.
//   No face/edge API exists — this module IS the selector layer.
// ============================================================================

// ---------------------------------------------------------------- local math
function _c4Cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function _c4Dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function _c4Len(v) { return Math.hypot(v[0], v[1], v[2]); }
function _c4Norm(v) { const l = _c4Len(v) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }
function _c4Sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function _c4Add(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function _c4Mul(s, v) { return [s*v[0], s*v[1], s*v[2]]; }

/** Distance from point p to triangle abc. Used so a face pick stays on the body under the point. */
function _c4DistPointTri(p, a, b, c) {
  const ab = _c4Sub(b, a);
  const ac = _c4Sub(c, a);
  const ap = _c4Sub(p, a);
  const d1 = _c4Dot(ab, ap);
  const d2 = _c4Dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return _c4Len(ap);
  const bp = _c4Sub(p, b);
  const d3 = _c4Dot(ab, bp);
  const d4 = _c4Dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return _c4Len(bp);
  const cp = _c4Sub(p, c);
  const d5 = _c4Dot(ab, cp);
  const d6 = _c4Dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return _c4Len(cp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return _c4Len(_c4Sub(p, _c4Add(a, _c4Mul(v, ab))));
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return _c4Len(_c4Sub(p, _c4Add(a, _c4Mul(w, ac))));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return _c4Len(_c4Sub(p, _c4Add(b, _c4Mul(w, _c4Sub(c, b)))));
  }
  const n = _c4Cross(ab, ac);
  const nn = _c4Len(n);
  if (!(nn > 1e-18)) return _c4Len(ap);
  return Math.abs(_c4Dot(ap, n)) / nn;
}

/**
 * Vertex-connected component of each triangle. A cut that keeps both pieces
 * does not share vertices, so each piece is its own body even when Manifold
 * reuses the original faceID across the cut.
 */
function _triComponentIds(triVerts, numTri) {
  const parent = new Uint32Array(numTri);
  for (let i = 0; i < numTri; i++) parent[i] = i;
  const find = (a) => {
    let r = a;
    while (parent[r] !== r) r = parent[r];
    let x = a;
    while (parent[x] !== r) {
      const n = parent[x];
      parent[x] = r;
      x = n;
    }
    return r;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const vertToTri = new Map();
  for (let t = 0; t < numTri; t++) {
    for (let k = 0; k < 3; k++) {
      const v = triVerts[t * 3 + k];
      const prev = vertToTri.get(v);
      if (prev === undefined) vertToTri.set(v, t);
      else unite(prev, t);
    }
  }
  const rootToId = new Map();
  const ids = new Int32Array(numTri);
  let next = 0;
  for (let t = 0; t < numTri; t++) {
    const r = find(t);
    let id = rootToId.get(r);
    if (id == null) {
      id = next++;
      rootToId.set(r, id);
    }
    ids[t] = id;
  }
  return ids;
}

// ---------------------------------------------------------------- mesh data
// c4MeshData(m) -> { V:[[x,y,z]...], faces:[{id, tris, normal, center, verts}],
//                    edges:[{a, b, va, vb, tris, tangent, faces:[faceIdx,faceIdx]}] }
/** In-plane share of a face group's area for its normal to drop foreign facets. */
const _C4_PLANAR_INLIER_FRAC = 0.9;
/** A triangle within this of the area-weighted normal is in the group's plane. */
const _C4_PLANAR_INLIER_DEG = 2;

/**
 * Face-group normal that ignores foreign facets on a planar face.
 *
 * faceID is only unique within one source mesh, and every swept fillet cutter
 * is built with the same triangle numbering, so a cutter facet can carry the
 * same faceID as the flat face it touches. When it shares an edge with that
 * face it lands in the same connected component, and the old unweighted sum
 * of unit normals counted a 1.3 mm² fillet facet (normal 80° off) as much as
 * each big face triangle: on the three-fillet cube the +y wall read
 * (0.070, 0.997, 0.012), 4° off, and the next variable-profile fillet cut a
 * 94° section along it. When ≥ 90% of the group's area lies within 2° of its
 * area-weighted normal, the group is a plane: average only those triangles.
 * Curved groups (and clean planes, where every triangle is an inlier) keep
 * the plain sum `cn` exactly as before.
 */
function _c4PlanarGroupNormal(trisSub, mesh, V, cn, areaSum) {
  if (!(areaSum > 1e-18) || trisSub.length < 2) return _c4Norm(cn);
  const tns = [];
  const aw = [0, 0, 0];
  for (const t of trisSub) {
    const v0 = V[mesh.triVerts[t*3]], v1 = V[mesh.triVerts[t*3+1]], v2 = V[mesh.triVerts[t*3+2]];
    const cxv = _c4Cross(_c4Sub(v1, v0), _c4Sub(v2, v0));
    const area = 0.5 * _c4Len(cxv);
    aw[0] += cxv[0]; aw[1] += cxv[1]; aw[2] += cxv[2];
    tns.push({ n: _c4Norm(cxv), area });
  }
  if (_c4Len(aw) < 1e-18) return _c4Norm(cn);
  const awn = _c4Norm(aw);
  const cosIn = Math.cos((_C4_PLANAR_INLIER_DEG * Math.PI) / 180);
  const sum = [0, 0, 0];
  let inArea = 0;
  let outliers = 0;
  for (const { n, area } of tns) {
    if (_c4Dot(n, awn) > cosIn) {
      sum[0] += n[0]; sum[1] += n[1]; sum[2] += n[2];
      inArea += area;
    } else {
      outliers++;
    }
  }
  if (!outliers || inArea < _C4_PLANAR_INLIER_FRAC * areaSum || _c4Len(sum) < 0.5) return _c4Norm(cn);
  return _c4Norm(sum);
}

function c4MeshData(m) {
  const mesh = m.getMesh();
  const triBody = _triComponentIds(mesh.triVerts, mesh.numTri);
  const np = mesh.numProp;
  const V = [];
  // Vertex count = vertProperties length / numProp (NOT tri count — that silently
  // truncated V on welded meshes and read past the buffer on sparse ones).
  const nVerts = mesh.vertProperties.length / np;
  for (let i = 0; i < nVerts; i++)
    V.push([mesh.vertProperties[i*np], mesh.vertProperties[i*np+1], mesh.vertProperties[i*np+2]]);

  // A face group is one Manifold faceID WITHIN ONE ORIGINAL. faceID restarts
  // at 0 for every input mesh of a boolean (the part, each cutter), so after a
  // fillet the box's bottom triangle and the sail triangle next to it can both
  // carry id 8. Grouped by id alone they fused across their shared edge and
  // that 90° edge was never a feature edge: the bottom rim of a box lost two
  // arc segments after the vertical fillets, makeSweepPath saw a broken loop,
  // and the next fillet missed a corner. The run tables say which original
  // each triangle came from; the key carries both.
  const runIndex = mesh.runIndex;
  const runOriginalID = mesh.runOriginalID;
  const triRun = new Int32Array(mesh.numTri);
  if (runIndex && runOriginalID && runIndex.length > 1) {
    for (let r = 0; r + 1 < runIndex.length; r++) {
      const t0 = runIndex[r] / 3;
      const t1 = Math.min(mesh.numTri, runIndex[r + 1] / 3);
      for (let t = t0; t < t1; t++) triRun[t] = runOriginalID[r];
    }
  }
  const faceMap = new Map();
  const faceMapFid = new Map();
  const triFace = [];
  for (let i = 0; i < mesh.numTri; i++) {
    const fid = mesh.faceID[i];
    triFace.push(fid);
    const key = `${triRun[i]}:${fid}`;
    if (!faceMap.has(key)) { faceMap.set(key, []); faceMapFid.set(key, fid); }
    faceMap.get(key).push(i);
  }
  const faces = [];
  const triToFace = new Int32Array(mesh.numTri).fill(-1);
  for (const [groupKey, tris] of faceMap) {
    const fid = faceMapFid.get(groupKey);
    const n = [0, 0, 0];
    for (const t of tris) {
      const v0 = V[mesh.triVerts[t*3]], v1 = V[mesh.triVerts[t*3+1]], v2 = V[mesh.triVerts[t*3+2]];
      const tn = _c4Norm(_c4Cross(_c4Sub(v1, v0), _c4Sub(v2, v0))); // outward (winding)
      n[0] += tn[0]; n[1] += tn[1]; n[2] += tn[2];
    }
    const nrm = _c4Norm(n);
    // Manifold may merge coplanar-but-DISCONNECTED regions into one faceID
    // (e.g. a base top ring at z=5 and a raised step top at z=15 both have
    // normal +Z), which breaks face `center` (mean of both planes) and
    // misplaces any feature cut from it. Split the group into CONNECTED
    // components (triangles sharing an edge). NOTE: must NOT use a
    // coplanarity condition — tessellated curved faces (fillets) have
    // non-coplanar adjacent facets, and shredding them re-creates the
    // per-seam face pairings that force expensive convexEdges ball probes
    // and break chamfer/fillet edge data.
    const parent = tris.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    const edgeTris = new Map();
    tris.forEach((t, gi) => {
      const vs = [mesh.triVerts[t*3], mesh.triVerts[t*3+1], mesh.triVerts[t*3+2]];
      for (let k = 0; k < 3; k++) {
        const u = vs[k], w = vs[(k+1) % 3];
        const key = u < w ? u * 1e9 + w : w * 1e9 + u;
        if (!edgeTris.has(key)) edgeTris.set(key, []);
        edgeTris.get(key).push(gi);
      }
    });
    for (const list of edgeTris.values())
      for (let i = 1; i < list.length; i++) union(list[0], list[i]);
    const byRoot = new Map();
    tris.forEach((t, gi) => {
      const r = find(gi);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push(gi);
    });
    // Components that lie in the SAME plane AND the same body (e.g. an annulus
    // split into two regions by a groove, both at z=10) are re-merged into one
    // face so that queries see the original Manifold face. A cut that keeps
    // both pieces reuses that faceID across two bodies; those stay separate
    // so each body keeps its own contour. Curved faces never re-merge: their
    // connected components each span one plane offset, and a curved group is
    // a single connected component anyway.
    const offs = tris.map((t) => {
      const v0 = V[mesh.triVerts[t*3]];
      return nrm[0]*v0[0] + nrm[1]*v0[1] + nrm[2]*v0[2];
    });
    // The offset alone is not a plane test. faceID is only unique within one
    // source mesh, and every swept fillet cutter is built with the same
    // triangle numbering, so faceID k is a facet of EACH earlier fillet. On a
    // symmetric part two such facets on different fillets can sit at the same
    // offset along their averaged normal (measured: a +x top fillet facet and
    // a −x vertical fillet facet, normals 90° apart). Merged, the group normal
    // was 45° off both, signedFeatureEdges handed that to the next fillet as
    // the edge dihedral, and the variable-profile cutter cut a wrong section
    // there (the three-fillet corner blob). Re-merge only components whose
    // own normals agree.
    const compNormal = (gis) => {
      const n = [0, 0, 0];
      for (const gi of gis) {
        const t = tris[gi];
        const v0 = V[mesh.triVerts[t*3]], v1 = V[mesh.triVerts[t*3+1]], v2 = V[mesh.triVerts[t*3+2]];
        const tn = _c4Norm(_c4Cross(_c4Sub(v1, v0), _c4Sub(v2, v0)));
        n[0] += tn[0]; n[1] += tn[1]; n[2] += tn[2];
      }
      return _c4Norm(n);
    };
    const cosSamePlane = Math.cos((COPLANAR_PAIR_MIN_DEG * Math.PI) / 180);
    const planeGroups = new Map(); // offsetKey -> [{ n, gis }]
    for (const gis of byRoot.values()) {
      const key = `${triBody[tris[gis[0]]]}:${Math.round(offs[gis[0]] * 1e3)}`;
      if (!planeGroups.has(key)) planeGroups.set(key, []);
      const bucket = planeGroups.get(key);
      const cn = compNormal(gis);
      const hit = bucket.find((g) => _c4Dot(g.n, cn) > cosSamePlane);
      if (hit) hit.gis.push(...gis);
      else bucket.push({ n: cn, gis: gis.slice() });
    }
    const planeGroupList = [];
    for (const bucket of planeGroups.values()) for (const g of bucket) planeGroupList.push(g.gis);
    for (const gis of planeGroupList) {
      const cn = [0, 0, 0];
      const c = [0, 0, 0];
      let areaSum = 0;
      const all = [];
      const seenVert = new Set();
      const trisSub = gis.map(gi => tris[gi]);
      for (const t of trisSub) {
        const i0 = mesh.triVerts[t*3], i1 = mesh.triVerts[t*3+1], i2 = mesh.triVerts[t*3+2];
        const v0 = V[i0], v1 = V[i1], v2 = V[i2];
        const cxv = _c4Cross(_c4Sub(v1, v0), _c4Sub(v2, v0));
        const area = 0.5 * _c4Len(cxv);
        const tn = _c4Norm(cxv);
        cn[0] += tn[0]; cn[1] += tn[1]; cn[2] += tn[2];
        // Area-weighted triangle centroid (matches Viewport face pick center).
        const tc = [(v0[0]+v1[0]+v2[0])/3, (v0[1]+v1[1]+v2[1])/3, (v0[2]+v1[2]+v2[2])/3];
        c[0] += tc[0]*area; c[1] += tc[1]*area; c[2] += tc[2]*area;
        areaSum += area;
        for (const id of [i0, i1, i2]) {
          if (!seenVert.has(id)) { seenVert.add(id); all.push(V[id]); }
        }
      }
      const center = areaSum > 1e-18 ? _c4Mul(1/areaSum, c) : [0, 0, 0];
      faces.push({
        id: fid,
        tris: trisSub,
        normal: _c4PlanarGroupNormal(trisSub, mesh, V, cn, areaSum),
        center,
        verts: all,
        body: triBody[trisSub[0]],
      });
    }
  }
  faces.sort((a, b) => a.id - b.id);

  // ── Slice 12: merge coplanar connected faces ─────────────────────────
  // built/manifold.wasm (and some Manifold builds) assign a *unique faceID
  // per triangle*. Without this pass, a rectangular face is two one-tri
  // "faces" whose centers are triangle centroids — so workplaneFromFace +
  // hole(u=0,v=0) misses the true face center (playtest Center miss).
  // Merge only when adjacent faces share an edge, normals align, and plane
  // offsets match.
  //
  // Hotfix (occlusion/tangent/hole slice): use a tight 0.1° pairwise gate.
  // A 1° gate + union-find was transitive through fillet chord facets
  // (~0.23° steps on a 384-seg arc), absorbing the true planar top into a
  // frankenstein face whose averaged normal drifted >5° from +Z — then
  // facesByNormal(selNormal, 5) missed the face the Viewport chip showed.
  // Curved walls (normals diverge >0.1°) stay one-tri each so convexEdges
  // dihedral filtering still sees tessellation seams.
  {
    const nF = faces.length;
    if (nF > 1) {
      const parent = Array.from({ length: nF }, (_, i) => i);
      const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
      const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
      const t2f = new Int32Array(mesh.numTri).fill(-1);
      for (let fi = 0; fi < nF; fi++)
        for (const t of faces[fi].tris) t2f[t] = fi;
      const cosPlanar = Math.cos((0.1 * Math.PI) / 180);
      const edgeMapM = new Map();
      for (let t = 0; t < mesh.numTri; t++) {
        const vs = [mesh.triVerts[t*3], mesh.triVerts[t*3+1], mesh.triVerts[t*3+2]];
        for (let k = 0; k < 3; k++) {
          const u = vs[k], w = vs[(k+1)%3];
          const key = u < w ? u * 1e9 + w : w * 1e9 + u;
          if (!edgeMapM.has(key)) edgeMapM.set(key, []);
          edgeMapM.get(key).push(t);
        }
      }
      for (const trisE of edgeMapM.values()) {
        if (trisE.length !== 2) continue;
        const f0 = t2f[trisE[0]], f1 = t2f[trisE[1]];
        if (f0 < 0 || f1 < 0 || f0 === f1) continue;
        if (triBody[trisE[0]] !== triBody[trisE[1]]) continue;
        const A = faces[f0], B = faces[f1];
        if (_c4Dot(A.normal, B.normal) < cosPlanar) continue;
        const offA = A.center[0]*A.normal[0] + A.center[1]*A.normal[1] + A.center[2]*A.normal[2];
        const offB = B.center[0]*A.normal[0] + B.center[1]*A.normal[1] + B.center[2]*A.normal[2];
        if (Math.abs(offA - offB) > 1e-3) continue;
        union(f0, f1);
      }
      const groups = new Map();
      for (let fi = 0; fi < nF; fi++) {
        const r = find(fi);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(fi);
      }
      if (groups.size < nF) {
        const merged = [];
        for (const members of groups.values()) {
          if (members.length === 1) {
            merged.push(faces[members[0]]);
            continue;
          }
          const cn = [0, 0, 0];
          const c = [0, 0, 0];
          let areaSum = 0;
          const all = [];
          const seenVert = new Set();
          const trisSub = [];
          let id = faces[members[0]].id;
          for (const fi of members) {
            id = Math.min(id, faces[fi].id);
            for (const t of faces[fi].tris) {
              trisSub.push(t);
              const i0 = mesh.triVerts[t*3], i1 = mesh.triVerts[t*3+1], i2 = mesh.triVerts[t*3+2];
              const v0 = V[i0], v1 = V[i1], v2 = V[i2];
              const cxv = _c4Cross(_c4Sub(v1, v0), _c4Sub(v2, v0));
              const area = 0.5 * _c4Len(cxv);
              const tn = _c4Norm(cxv);
              cn[0] += tn[0]; cn[1] += tn[1]; cn[2] += tn[2];
              const tc = [(v0[0]+v1[0]+v2[0])/3, (v0[1]+v1[1]+v2[1])/3, (v0[2]+v1[2]+v2[2])/3];
              c[0] += tc[0]*area; c[1] += tc[1]*area; c[2] += tc[2]*area;
              areaSum += area;
              for (const vi of [i0, i1, i2]) {
                if (!seenVert.has(vi)) { seenVert.add(vi); all.push(V[vi]); }
              }
            }
          }
          const center = areaSum > 1e-18 ? _c4Mul(1/areaSum, c) : faces[members[0]].center;
          merged.push({
            id,
            tris: trisSub,
            normal: _c4Norm(cn),
            center,
            verts: all,
            body: faces[members[0]].body,
          });
        }
        faces.length = 0;
        faces.push(...merged);
        faces.sort((a, b) => a.id - b.id);
      }
    }
  }

  // Within each faceID group, order sub-faces OUTERMOST-FIRST in the face's
  // normal direction (desc by n·center): for a merged group of parallel
  // planes (e.g. two +Z planes at z=5 and z=15), facesByNormal(+Z)[0] is the
  // topmost plane — what a "top face" query almost always means.
  {
    const byId = new Map();
    for (const f of faces) { if (!byId.has(f.id)) byId.set(f.id, []); byId.get(f.id).push(f); }
    for (const list of byId.values())
      list.sort((a, b) => {
        const oa = a.center[0]*a.normal[0] + a.center[1]*a.normal[1] + a.center[2]*a.normal[2];
        const ob = b.center[0]*b.normal[0] + b.center[1]*b.normal[1] + b.center[2]*b.normal[2];
        return ob - oa;
      });
  }
  // Build triToFace AFTER all sorts — indices assigned at push-time would be
  // stale once faces is re-ordered. This map is what edges/convexEdges use to
  // reach each triangle's true (sub-)face.
  triToFace.fill(-1);
  for (let fi = 0; fi < faces.length; fi++)
    for (const t of faces[fi].tris) triToFace[t] = fi;
  const faceIdxById = new Map(faces.map((f, i) => [f.id, i]));

  // edges: weld key = sorted vertex pair
  const edgeMap = new Map();
  for (let t = 0; t < mesh.numTri; t++) {
    const vs = [mesh.triVerts[t*3], mesh.triVerts[t*3+1], mesh.triVerts[t*3+2]];
    for (let k = 0; k < 3; k++) {
      const u = vs[k], w = vs[(k+1) % 3];
      const key = u < w ? u * 1e9 + w : w * 1e9 + u;
      if (!edgeMap.has(key)) edgeMap.set(key, { a: u, b: w, tris: [] });
      edgeMap.get(key).tris.push(t);
    }
  }
  const edges = [];
  for (const e of edgeMap.values()) {
    if (e.tris.length !== 2) continue; // interior/defect: not a real boundary edge
    // triToFace: each triangle -> its (sub-)face index. After the coplanar
    // connected-component split, a faceID may own several faces, so the
    // triangle's face MUST come from triToFace, not faceIdxById.
    const f0 = triToFace[e.tris[0]];
    const f1 = triToFace[e.tris[1]];
    // canonical direction: lower-ordered vertex first (stable, undirected)
    const [a, b] = e.a < e.b ? [e.a, e.b] : [e.b, e.a];
    let tangent = _c4Sub(V[b], V[a]);
    if (_c4Len(tangent) < 1e-9) {
      tangent = _c4Norm(_c4Cross(faces[f0].normal, faces[f1].normal));
    }
    tangent = _c4Norm(tangent);
    edges.push({ a, b, va: V[a], vb: V[b], tris: e.tris, tangent, faces: [f0, f1] });
  }
  // T/numTri expose the welded triangle table so callers that need per-triangle
  // vertices (shell skin prisms, draftFaces vertex sets) do not have to call
  // getMesh() again and risk a DIFFERENT welding than the faces above.
  if (_s23CaptureFaceSoupOn) _s23RememberFaceSoup(m, faces, V, mesh.triVerts);
  return { V, faces, edges, faceIdxById, T: mesh.triVerts, numTri: mesh.numTri };
}

// ---------------------------------------------------------------- selectors
/**
 * facesByNormal(m, dir, tolDeg=1) — faces whose normal is within tolDeg of dir.
 * dir e.g. [0,0,1] (>Z) or [0,0,-1] (<Z).
 */
function facesByNormal(m, dir, tolDeg = 1) {
  const d = _c4Norm(dir);
  const cosT = Math.cos((tolDeg * Math.PI) / 180);
  // Outermost-first along dir so facesByNormal(+Z)[0] is the topmost plane
  // (byId re-sort below does not rewrite the faces array order).
  return c4MeshData(m).faces
    .filter(f => _c4Dot(f.normal, d) >= cosT)
    .sort((a, b) => _c4Dot(b.center, d) - _c4Dot(a.center, d));
}

/**
 * planarFaceAt(m, axis, value, tol=1e-3) — the face lying in plane axis==value
 * (axis 'x'|'y'|'z'). Returns null if absent, throws if ambiguous.
 */
function planarFaceAt(m, axis, value, tol = 1e-3) {
  const i = { x: 0, y: 1, z: 2 }[axis.toLowerCase()];
  if (i === undefined) throw new Error(`planarFaceAt: bad axis '${axis}'`);
  const n = [0, 0, 0]; n[i] = 1;
  const cands = c4MeshData(m).faces.filter(f =>
    Math.abs(Math.abs(_c4Dot(f.normal, n)) - 1) < 0.01 &&
    f.verts.every(v => Math.abs(v[i] - value) < tol));
  if (cands.length === 0) return null;
  if (cands.length > 1) throw new Error(`planarFaceAt: ${cands.length} faces at ${axis}=${value}`);
  return cands[0];
}

/**
 * edgesByOrientation(m, axis, dir, tolDeg=5)
 *  axis 'x'|'y'|'z'  -> edges parallel to that axis
 *  dir 1 | -1 | null -> one-sided / both
 */
function edgesByOrientation(m, axis, dir = null, tolDeg = 5) {
  const i = { x: 0, y: 1, z: 2 }[axis.toLowerCase()];
  if (i === undefined) throw new Error(`edgesByOrientation: bad axis '${axis}'`);
  const ax = [0, 0, 0]; ax[i] = 1;
  const cosT = Math.cos((tolDeg * Math.PI) / 180);
  return c4MeshData(m).edges.filter(e => {
    const s = _c4Dot(e.tangent, ax); // in [-1, 1]
    if (dir === 1 && s < cosT) return false;
    if (dir === -1 && s > -cosT) return false;
    return Math.abs(s) >= cosT;
  });
}

/**
 * workplaneFromFace(m, face) -> { center, normal, x, y }
 * Local 2D frame on the face. center = face centroid, normal = outward face
 * normal, and the in-plane axes x,y are DETERMINISTIC + AXIS-ALIGNED so
 * (u,v) map to predictable world directions (a transpiler/LLM can reason
 * about them):
 *   x = the world axis most in-plane with the face (smallest |n·axis|),
 *       ties broken by axis index (X > Y > Z); y = normal × x.
 * So: +Z face -> u→+X, v→+Y ; -Z -> u→+X, v→-Y ; +X -> u→+Y, v→+Z ;
 *     -X -> u→+Y, v→-Z ; +Y -> u→+X, v→-Z ; -Y -> u→+X, v→+Z.
 * (Non-axis-aligned faces, e.g. a 45° chamfer, fall back to the
 * first-vertex direction.)
 * (pass a face object from facesByNormal/planarFaceAt, or a face index into m)
 */
function workplaneFromFace(m, face) {
  if (typeof face === 'number') face = c4MeshData(m).faces[face];
  const normal = _c4Norm(face.normal);
  const worldAxes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let x = null, best = Infinity;
  for (const a of worldAxes) {
    const s = Math.abs(_c4Dot(normal, a));
    if (s < best - 1e-9) { best = s; x = a; }
  }
  if (best > 0.9) { // face normal is diagonal — no world axis is in-plane
    const w = face.verts.find(v => _c4Len(_c4Sub(v, face.center)) > 1e-9) || face.verts[0];
    x = _c4Sub(w, face.center);
    x = _c4Sub(x, _c4Mul(_c4Dot(x, normal), normal)); // project onto plane
    if (_c4Len(x) < 1e-9) x = Math.abs(normal[2]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  }
  x = _c4Norm(x);
  const y = _c4Norm(_c4Cross(normal, x));
  return { center: face.center, normal, x, y };
}

// ---------------------------------------------------------------- frames
// frameToMatrix(frame) -> flat 16 for Manifold .transform(m).
// CONVENTION (empirically verified): Manifold applies world = localRow · M
// (row-vector), so the frame axes must be packed as ROWS:
//   row0 = frame.x, row1 = frame.y, row2 = frame.normal, row3 = center.
// (Packing them as columns silently transposes the rotation — invisible
// for axis-aligned faces, wrong for arbitrary face normals.)
function frameToMatrix(frame) {
  const z = frame.normal, x = frame.x, y = frame.y, c = frame.center;
  return [
    x[0], x[1], x[2], 0,
    y[0], y[1], y[2], 0,
    z[0], z[1], z[2], 0,
    c[0], c[1], c[2], 1,
  ];
}

/**
 * placeInFrame(frame, solid, uvw = [0, 0, 0])
 * Transform `solid` so its local origin lands at
 * center + u·x + v·y + w·normal, axes aligned to (x, y, normal).
 * `frame` is a PlaneFrame { center, normal, x, y } — never a Manifold.
 * Does not take a host part; caller assigns the result (replace, not add).
 */
function placeInFrame(frame, solid, uvw = [0, 0, 0]) {
  if (frame && typeof frame.status === 'function') {
    throw new Error('placeInFrame: frame must be a PlaneFrame { center, normal, x, y }, not a Manifold solid');
  }
  if (!frame || !frame.center || !frame.normal || !frame.x || !frame.y) {
    throw new Error('placeInFrame: frame must be a PlaneFrame { center, normal, x, y }');
  }
  if (!solid || typeof solid.status !== 'function') {
    throw new Error('placeInFrame: solid must be a Manifold');
  }
  const u = Number(uvw?.[0]) || 0;
  const v = Number(uvw?.[1]) || 0;
  const w = Number(uvw?.[2]) || 0;
  const x = frame.x, y = frame.y, n = frame.normal, c = frame.center;
  const t = frameToMatrix({
    center: [
      c[0] + u * x[0] + v * y[0] + w * n[0],
      c[1] + u * x[1] + v * y[1] + w * n[1],
      c[2] + u * x[2] + v * y[2] + w * n[2],
    ],
    x,
    y,
    normal: n,
  });
  return solid.transform(t);
}

/** Alias — same frame-only replace transform as placeInFrame. */
function transformByFrame(frame, solid, uvw = [0, 0, 0]) {
  return placeInFrame(frame, solid, uvw);
}

/**
 * placeOnFace(part, frame, builder) — run builder in the face's local frame.
 * builder receives { Manifold: statics, frame, put } where put(m, [u,v,w])
 * returns m transformed so its local origin lands at
 * center + u·x + v·y + w·normal (w is along the outward normal), with its
 * local axes aligned to (x, y, normal). Lets scripts write axis-aligned
 * geometry for arbitrary face normals.
 *
 * `part` is unused (legacy host arg). New-body Confirm should assign
 * placeInFrame/transformByFrame instead of placeOnFace + part.add.
 */
function placeOnFace(part, frame, builder) {
  void part;
  const M = manifoldModule.Manifold;
  const built = builder({
    Manifold: M,
    frame,
    put: (mm, offset) => placeInFrame(frame, mm, offset),
  });
  if (!built || typeof built.status !== 'function')
    throw new Error('placeOnFace: builder must return a Manifold');
  return built;
}

// ---------------------------------------------------------------- features
/**
 * hole(part, frame, u, v, dia, span) — cut a round hole through `part`.
 * frame from workplaneFromFace; (u,v) local coords (mm), span = cut length
 * along the outward normal from the face (use holeSpan() for full thickness).
 * Returns the cut part.
 */
function hole(part, frame, u, v, dia, span) {
  _c4RequirePositive('hole', 'dia', dia);
  _c4RequirePositive('hole', 'span', span);
  if (!frame || !frame.normal || !frame.center || !frame.x || !frame.y) {
    throw new Error('hole: frame must come from workplaneFromFace (needs center/normal/x/y)');
  }
  const M = manifoldModule.Manifold;
  const cut = _c4PutCyl(M, frame, u, v, dia, span);
  return _c4RequireValidSolid(M.difference(part, cut), 'hole');
}
// _c4PutCyl: centered cylinder anchored so it spans w ∈ [1, 1-len] in frame
// space (1mm outside the face, len-1mm INTO the solid).
function _c4PutCyl(M, frame, u, v, dia, len) {
  const n = frame.normal;
  const c = _c4Add(_c4Add(frame.center, _c4Mul(u, frame.x)), _c4Mul(v, frame.y));
  const w0 = 1 - len / 2; // centered body covers w0 ± len/2 = [1-len, 1]
  const t = frameToMatrix({ center: [
    c[0] + n[0] * w0, c[1] + n[1] * w0, c[2] + n[2] * w0,
  ], x: frame.x, y: frame.y, normal: n });
  return M.cylinder(len, dia/2, dia/2, 48, true).transform(t);
}

/**
 * holeSpan(part, frame) — full extent of the part measured along the frame
 * normal (both directions from the face plane) + 2mm overshoot. A safe
 * full-through cut length from that face.
 */
function holeSpan(part, frame) {
  const bb = part.boundingBox();
  const corners = [
    [bb.min[0], bb.min[1], bb.min[2]], [bb.max[0], bb.min[1], bb.min[2]],
    [bb.min[0], bb.max[1], bb.min[2]], [bb.max[0], bb.max[1], bb.min[2]],
    [bb.min[0], bb.min[1], bb.max[2]], [bb.max[0], bb.min[1], bb.max[2]],
    [bb.min[0], bb.max[1], bb.max[2]], [bb.max[0], bb.max[1], bb.max[2]],
  ];
  let minW = Infinity, maxW = -Infinity;
  for (const p of corners) {
    const w = _c4Dot(_c4Sub(p, frame.center), frame.normal);
    minW = Math.min(minW, w);
    maxW = Math.max(maxW, w);
  }
  return (maxW - minW) + 2; // +2mm overshoot
}

/**
 * cboreHole(part, frame, u, v, diaThru, diaCbore, cboreDepth, span)
 * — through hole + larger counterbore from the face. (CadQuery cboreHole)
 */
function cboreHole(part, frame, u, v, diaThru, diaCbore, cboreDepth, span) {
  _c4RequirePositive('cboreHole', 'diaThru', diaThru);
  _c4RequirePositive('cboreHole', 'diaCbore', diaCbore);
  _c4RequirePositive('cboreHole', 'cboreDepth', cboreDepth);
  _c4RequirePositive('cboreHole', 'span', span);
  if (!(diaCbore > diaThru)) {
    throw new Error(`cboreHole: diaCbore (${diaCbore}) must be > diaThru (${diaThru})`);
  }
  if (!frame || !frame.normal || !frame.center || !frame.x || !frame.y) {
    throw new Error('cboreHole: frame must come from workplaneFromFace (needs center/normal/x/y)');
  }
  const M = manifoldModule.Manifold;
  const thru = _c4PutCyl(M, frame, u, v, diaThru, span);
  const cbore = _c4PutCyl(M, frame, u, v, diaCbore, cboreDepth + 1); // [−depth, +1]
  return _c4RequireValidSolid(M.difference(M.difference(part, thru), cbore), 'cboreHole');
}

/**
 * cskHole(part, frame, u, v, diaThru, diaCsk, cskDepth, span)
 * — through hole + cone countersink: the cone spans diaThru→diaCsk over
 * cskDepth (118° style for cskDepth ≈ 1.17·(diaCsk−diaThru)/2).
 * (CadQuery cskHole)
 */
function cskHole(part, frame, u, v, diaThru, diaCsk, cskDepth, span) {
  _c4RequirePositive('cskHole', 'diaThru', diaThru);
  _c4RequirePositive('cskHole', 'diaCsk', diaCsk);
  _c4RequirePositive('cskHole', 'cskDepth', cskDepth);
  _c4RequirePositive('cskHole', 'span', span);
  if (!(diaCsk > diaThru)) {
    throw new Error(`cskHole: diaCsk (${diaCsk}) must be > diaThru (${diaThru})`);
  }
  if (!frame || !frame.normal || !frame.center || !frame.x || !frame.y) {
    throw new Error('cskHole: frame must come from workplaneFromFace (needs center/normal/x/y)');
  }
  const M = manifoldModule.Manifold;
  const thru = _c4PutCyl(M, frame, u, v, diaThru, span);
  // Exact csk frustum: small end (diaThru) at depth cskDepth below the face,
  // big end (diaCsk) flush at the face. Cylinder rLow sits at local z0
  // (bottom), rHigh at the top; frame row-packing maps local +z to the
  // OUTWARD normal. Length = cskDepth, centered at w0 = -cskDepth/2 so the
  // body spans w ∈ [-cskDepth, 0] (0 = face plane, - = into the solid).
  const n = frame.normal;
  const c = _c4Add(_c4Add(frame.center, _c4Mul(u, frame.x)), _c4Mul(v, frame.y));
  const cone = M.cylinder(cskDepth, diaThru/2, diaCsk/2, 48, true); // rLow small
  const w0 = -cskDepth / 2;
  const t = frameToMatrix({ center: [
    c[0] + n[0] * w0, c[1] + n[1] * w0, c[2] + n[2] * w0,
  ], x: frame.x, y: frame.y, normal: n });
  return _c4RequireValidSolid(
    M.difference(M.difference(part, thru), cone.transform(t)),
    'cskHole',
  );
}

function _chamferComponents(solid) {
  if (!solid || typeof solid.decompose !== 'function') return 1;
  let parts = null;
  try { parts = solid.decompose(); } catch { return 1; }
  if (!Array.isArray(parts) || parts.length === 0) return 1;
  const n = parts.length;
  for (const piece of parts) {
    if (piece && piece !== solid) _safeDeleteManifold(piece);
  }
  return n;
}

/**
 * chamferEdges(part, edges, c) — equal-leg 45° chamfer c on a SET of straight
 * convex edges. Edges = objects from c4MeshData/convexEdges, or a plain
 * [{va, vb, n0, n1}] array. n0/n1 (outward normals of the two adjacent faces
 * at that edge) are REQUIRED for hand-built edges, but are AUTO-DERIVED from
 * the current mesh when the edge object carries {faces: [i0, i1]} (as all
 * c4MeshData-based selectors do: convexEdges, edgesByOrientation,
 * edgesByNormal, planarFaceAt-derived selections) — no more
 * "Cannot read properties of undefined (reading '0')" when mixing selectors
 * with chamferEdges.
 *
 * Construction (verified, C2 pilot + C4): per edge, cutter = hull of the two
 * edge endpoints plus four corner points pulled c into each adjacent face
 * interior. c IS THE LEG LENGTH along each adjacent face (CAD "C2" = 2 mm
 * on both legs), NOT the perpendicular face offset — the perpendicular
 * offset is derived from the face-to-face angle (offset = c·tan(θ/2), θ =
 * angle between n0/n1; at a 90° corner they coincide, at a 120° hex-nut
 * corner C2 → 1.155 mm offset / 2 mm legs). CUTTERS ARE APPLIED SEQUENTIALLY (one difference per edge) and
 * each intermediate result is checked: a single degenerate cutter (e.g. at
 * a triple-junction rib-base edge where the two "adjacent faces" are coplanar
 * or the cutter self-intersects) must not be allowed to wedge the batch
 * union into a wasm out-of-bounds trap (observed: chamfering ALL convex
 * edges of a ribbed plate — one subset crashes the kernel while the rest
 * build fine). The first bad edge throws a named, actionable error instead.
 * Cost: n differences instead of 1 — fine for the edge counts these parts
 * actually use (≤ ~30); the C8 timeout guard catches anything pathological.
 * A chamfer that splits the solid into more bodies than it started with
 * throws. The pieces are not returned.
 */
function chamferEdges(part, edges, c) {
  _c4RequirePositive('chamferEdges', 'c (leg length)', c);
  const M = manifoldModule.Manifold;
  if (!edges || !edges.length) return part;
  const started = _chamferComponents(part);
  let data = null;
  const laz = () => (data ||= c4MeshData(part));
  let out = part;
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    const p0 = e.va, p1 = e.vb;
    if (!p0 || !p1) throw new Error(`chamferEdges: edge ${ei} has no va/vb coordinates`);
    const len = _c4Len(_c4Sub(p1, p0));
    if (len < 1e-9) continue;
    const d = _c4Mul(1/len, _c4Sub(p1, p0));
    // adjacent face normals: use provided n0/n1, else derive from the mesh
    // via e.faces (present on all c4MeshData-derived edge objects).
    let n0 = e.n0, n1 = e.n1;
    if ((!n0 || !n1) && Array.isArray(e.faces) && e.faces.length === 2) {
      const ds = laz();
      n0 = ds.faces[e.faces[0]].normal;
      n1 = ds.faces[e.faces[1]].normal;
    }
    if (!n0 || !n1)
      throw new Error(`chamferEdges: edge ${ei} has no adjacent face normals (n0/n1) — get the edge from convexEdges()/edgesByOrientation() on THIS part, or pass explicit n0/n1`);
    if (_c4Dot(n0, n1) > 0.9999)
      throw new Error(`chamferEdges: edge ${ei} — adjacent faces are coplanar (tessellation seam or wrong face pair); not a chamferable edge`);
    // offset c INTO each adjacent face: (-n) projected perpendicular to the
    // edge direction. This is a unit direction lying IN the face plane,
    // pointing toward the face interior (negated normal = into the solid).
    const off = (n) => {
      const t = _c4Dot(_c4Mul(-1, n), d);
      return _c4Mul(c, _c4Norm(_c4Sub(_c4Mul(-1, n), _c4Mul(t, d))));
    };
    const a0 = off(n0), a1 = off(n1);
    const cutter = M.hull([
      p0, p1,
      _c4Add(p0, a0), _c4Add(p0, a1),
      _c4Add(p1, a0), _c4Add(p1, a1),
    ]);
    const seCutter = _c4StatusError(cutter);
    if (seCutter)
      throw new Error(`chamferEdges: edge ${ei} — degenerate cutter (hull status ${seCutter}); check the two adjacent faces at this edge`);
    const next = M.difference(out, cutter);
    const seNext = _c4StatusError(next);
    if (seNext)
      throw new Error(`chamferEdges: edge ${ei} — boolean failed (${seNext}); the cutter geometry is degenerate at this edge (common at triple-junction rib-base edges)`);
    const pieces = _chamferComponents(next);
    if (pieces > started) {
      _safeDeleteManifold(next);
      throw new Error(
        `chamferEdges: edge ${ei} split the solid into ${pieces} bodies (was ${started}). `
        + 'The chamfer cut through the part. Use the boundary edges of one face, or a smaller leg length.',
      );
    }
    out = next;
  }
  return out;
}

/**
 * Ball-probe-equivalent feature threshold (degrees).
 *
 * The old convexity test intersected a small sphere at each edge midpoint with
 * the whole solid and kept `f < 0.45`. Measured across box / cylinder / sphere /
 * L-shape / loft, that fraction is exactly `(180 - dihedralDeg) / 360` — the
 * probe was a dihedral threshold wearing a CSG costume, at ~4.5 ms per edge
 * (5.5 s of a 5.6 s loft fillet). `f < 0.45` ⇔ dihedral > 18°.
 *
 * It was also WRONG on fine meshes: on a 384-segment filleted box the probe
 * sphere shrinks to ~0.012 mm, where Manifold's boolean returns f = 0.5 for
 * plainly 90° edges and even negative volumes. The local test below has no
 * such scale dependence.
 */
const FEATURE_EDGE_MIN_DEG = 18;

/**
 * Coplanarity gate on the FACE-GROUP normal pair that these helpers return.
 * Downstream (chamferEdges, the fillet framing) consumes n0/n1 and loud-fails
 * on a coplanar pair, so the returned pair must clear this independently of
 * the per-triangle dihedral used for the sign.
 */
const COPLANAR_PAIR_MIN_DEG = 2;

/** Area of triangle `ti`, for spotting degenerate slivers. */
function _c4TriArea(tri) {
  return 0.5 * _c4Len(_c4Cross(_c4Sub(tri.v[1], tri.v[0]), _c4Sub(tri.v[2], tri.v[0])));
}

/**
 * Signed feature edges — convex AND concave, by a local winding test.
 *
 * Sign: `dot(cross(n0, n1), dir) > 0` is convex, `< 0` is concave, where `dir`
 * is the edge as wound in the triangle whose normal is n0. Winding is what
 * carries the inside/outside information; a dot product alone cannot tell a 90°
 * convex edge from a 270° concave one (they share the same normal angle).
 *
 * Normals come from the adjacent TRIANGLES, not the face groups: a face group's
 * normal is an area-weighted average, and on a curved group (a fillet sail) it
 * points nowhere near the local surface, which flips the cross product. Where a
 * triangle is a degenerate sliver — tessellated lofts carry hundreds — its
 * normal is meaningless, so the face-group normal stands in for it instead.
 *
 * `e.tris[i]` is the triangle belonging to face group `e.faces[i]`, so the
 * substitution always pairs a triangle with its own group.
 *
 * @param {Manifold} m
 * @param {number} [minAngleDeg] dihedral gate; raised to FEATURE_EDGE_MIN_DEG
 * @returns {object[]} edges with { n0, n1, convex, dihedralDeg }
 */
/**
 * The surface normal at a triangle, for signing an edge. A planar face
 * bounded by a dense arc (96 steps per quarter) can carry long slivers that
 * Manifold wound the wrong way: about 1 mm² each, normal opposite to the face
 * around them, each with its own faceID, so the group normal is the sliver's
 * own. Signing a concave crease from one called it convex and the next
 * fillet cut instead of filled (concave playtest after hollow). Among the
 * triangle and its neighbours that lie in its plane, folded or not, the
 * largest one is the surface; a sliver borrows that normal, a real face
 * keeps its own.
 */
function _c6UnfoldedNormal(info, ti, tri, g, gOK) {
  // Only a FOLDED neighbour (wound against this triangle) that is larger
  // overrides; a coplanar neighbour never does, so the dense facets of a
  // loft keep their own normals and their per-knot dihedrals.
  let bestN = tri.n;
  let bestA = _c4TriArea(tri);
  for (let k = 0; k < 3; k++) {
    const a = tri.vs[k];
    const b = tri.vs[(k + 1) % 3];
    const key = a < b ? a * 1e9 + b : b * 1e9 + a;
    const pair = info.pairMap.get(key);
    if (!pair || pair.length !== 2) continue;
    const other = info.tris[pair[0] === ti ? pair[1] : pair[0]];
    if (!other || _c4Dot(tri.n, other.n) > -0.9) continue;
    const area = _c4TriArea(other);
    if (area > bestA) { bestA = area; bestN = other.n; }
  }
  if (bestN === tri.n && gOK && _c4Dot(tri.n, g) < 0) return g;
  return bestN;
}

/** Face groups whose every facet normal lies within 0.5° of the group normal. */
function _c6PlanarFaceFlags(data, info) {
  const cosExact = Math.cos((0.5 * Math.PI) / 180);
  return data.faces.map((f) => {
    if (!f || !Array.isArray(f.tris) || !f.normal) return false;
    const n = _c4Norm(f.normal);
    if (!(_c4Len(n) > 0.5)) return false;
    for (const ti of f.tris) {
      const t = info.tris[ti];
      if (!t) continue;
      if (_c4TriArea(t) < 1e-9) continue;
      if (_c4Dot(t.n, n) < cosExact) return false;
    }
    return true;
  });
}

function signedFeatureEdges(m, minAngleDeg = FEATURE_EDGE_MIN_DEG) {
  const data = c4MeshData(m);
  const info = _c6BuildMeshInfo(m);
  const planarFace = _c6PlanarFaceFlags(data, info);
  const gate = Math.max(Number(minAngleDeg) || 0, FEATURE_EDGE_MIN_DEG);
  const cosGate = Math.cos((gate * Math.PI) / 180);
  // The old helper's coplanarity pre-gate, kept verbatim at its 2° default.
  const cosContract = Math.cos((COPLANAR_PAIR_MIN_DEG * Math.PI) / 180);
  const out = [];
  for (const e of data.edges) {
    const g0 = data.faces[e.faces[0]].normal;
    const g1 = data.faces[e.faces[1]].normal;
    const i0 = e.tris[0];
    const i1 = e.tris[1];
    const t0 = info.tris[i0];
    const t1 = info.tris[i1];
    if (!t0 || !t1) continue;
    const eLen = _c4Len(_c4Sub(e.vb, e.va));
    if (!(eLen > 0)) continue;
    // Relative sliver test: a 384-segment fillet's triangles are tiny but valid,
    // so an absolute area floor would reject the whole blend surface.
    const slivEps = 1e-6 * eLen * eLen;
    const tOK0 = _c4TriArea(t0) > slivEps;
    const tOK1 = _c4TriArea(t1) > slivEps;
    // c4MeshData sums a face group's triangle normals; on difference-derived
    // solids a group can span opposing patches and cancel to the zero vector
    // (measured: 13 of 17 convex edges on an L-shape). Those zeros used to
    // flow straight into the fillet framing as n0/n1. Prefer the group normal,
    // but fall back to the triangle when the group degenerates.
    const gOK0 = _c4Len(g0) > 0.5;
    const gOK1 = _c4Len(g1) > 0.5;
    if ((!tOK0 && !gOK0) || (!tOK1 && !gOK1)) continue;
    // Two triangles folded flat against each other share a fin, not a crease
    // (a knife edge does not exist on a solid). Those fins come from the
    // triangulation of a planar face bounded by a dense arc and are what
    // dropPlanarFins removes before drawing; here they are no edge at all.
    if (tOK0 && tOK1 && _c4Dot(t0.n, t1.n) < -0.9) continue;
    const n0 = tOK0 ? _c6UnfoldedNormal(info, i0, t0, g0, gOK0) : g0;
    const n1 = tOK1 ? _c6UnfoldedNormal(info, i1, t1, g1, gOK1) : g1;
    const outN0 = gOK0 ? g0 : t0.n;
    const outN1 = gOK1 ? g1 : t1.n;
    // Gate 1 (consumer contract): the normals this helper RETURNS are the
    // face-group pair, and chamferEdges / the fillet framing reject a coplanar
    // pair. Gating on the triangle normals alone would hand them edges whose
    // group normals are coplanar — a real regression the pilot caught.
    if (_c4Dot(outN0, outN1) > cosContract) continue;
    // Gate 2 (feature): dihedral must clear the ball-probe-equivalent threshold.
    const dot = _c4Dot(n0, n1);
    if (dot > cosGate) continue; // coplanar / tessellation seam / below gate
    // Edge as wound in t0. Vertex ORDER survives degeneracy even when the
    // normal does not, so this stays valid for sliver triangles.
    let dir = null;
    for (let k = 0; k < 3; k++) {
      const u = t0.vs[k];
      const w = t0.vs[(k + 1) % 3];
      if ((u === e.a && w === e.b) || (u === e.b && w === e.a)) {
        dir = _c4Sub(t0.v[(k + 1) % 3], t0.v[k]);
        break;
      }
    }
    if (!dir) continue;
    const convex = _c4Dot(_c4Cross(n0, n1), dir) > 0;
    const dihedralDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
    // planar0/planar1: both faces are true planes. The sweep ends its legs
    // exactly on such faces; a curved neighbour keeps the nudge.
    out.push({ ...e, n0: outN0, n1: outN1, convex, dihedralDeg, planar0: !!planarFace[e.faces[0]], planar1: !!planarFace[e.faces[1]] });
  }
  return out;
}

/**
 * convexEdges(m, minAngleDeg) — genuine convex feature edges.
 * Thin filter over signedFeatureEdges; see FEATURE_EDGE_MIN_DEG for why the
 * ball probe it replaced was both slow and scale-dependent.
 * n0/n1 stay the FACE-GROUP normals, which is what the fillet framing consumes.
 */
function convexEdges(m, minAngleDeg = FEATURE_EDGE_MIN_DEG) {
  return signedFeatureEdges(m, minAngleDeg).filter((e) => e.convex);
}

/**
 * concaveEdges(m, minAngleDeg) — genuine concave (interior) feature edges.
 * Rounding these is material ADD, not remove; see filletAlongPath.
 */
function concaveEdges(m, minAngleDeg = FEATURE_EDGE_MIN_DEG) {
  return signedFeatureEdges(m, minAngleDeg).filter((e) => !e.convex);
}

// ---------------------------------------------------------------- hole patterns
/**
 * holePattern(part, frame, { n, m, spacingU, spacingV, dia, span, u0=0, v0=0 })
 * — linear grid of through holes (CadQuery rarray idiom).
 * Grid centered on the face center + (u0, v0) offset.
 */
function holePattern(part, frame, opts) {
  const { n = 1, m = 1, spacingU = 10, spacingV = 10, dia = 2, span, u0 = 0, v0 = 0 } = opts;
  _c4RequirePositive('holePattern', 'dia', dia);
  if (!frame || !frame.normal || !frame.center || !frame.x || !frame.y) {
    throw new Error('holePattern: frame must come from workplaneFromFace (needs center/normal/x/y)');
  }
  const sp = span ?? holeSpan(part, frame);
  let out = part;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const u = u0 + (i - (n-1)/2) * spacingU;
      const v = v0 + (j - (m-1)/2) * spacingV;
      out = hole(out, frame, u, v, dia, sp);
    }
  }
  return out;
}

// ---------------------------------------------------------------- fastener holes (slice 01 puzzle vocabulary)
/**
 * clearanceHole(part, frame, u, v, size, spanOrOpts?, fit?)
 * Cut a clearance hole for fastener `size` ('M3', 3, '#8-32', …).
 * fit: 'close'|'normal'|'loose' (default 'normal'). span defaults to holeSpan().
 * Also accepts opts object: { fit, span }.
 */
function clearanceHole(part, frame, u, v, size, spanOrOpts, fitArg) {
  let fit = 'normal';
  let span;
  if (spanOrOpts && typeof spanOrOpts === 'object' && !Array.isArray(spanOrOpts)) {
    fit = spanOrOpts.fit ?? 'normal';
    span = spanOrOpts.span;
  } else {
    span = spanOrOpts;
    if (fitArg != null) fit = fitArg;
  }
  const dia = fastenerClearanceDia(size, fit);
  const sp = span ?? holeSpan(part, frame);
  return hole(part, frame, u, v, dia, sp);
}

/**
 * tapDrillHole(part, frame, u, v, size, span?)
 * Cut a tap-drill hole for fastener `size` (for subsequent tapping).
 * span defaults to holeSpan().
 */
function tapDrillHole(part, frame, u, v, size, span) {
  const dia = fastenerTapDrillDia(size);
  const sp = span ?? holeSpan(part, frame);
  return hole(part, frame, u, v, dia, sp);
}

function _holeOpt(spec) {
  if (spec == null) return {};
  if (typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('holesOnContour: spec must be an object');
  }
  return spec;
}

function _holeSide(spec) {
  const flip = spec.flip === true;
  let side = 1;
  if (spec.side != null && spec.side !== '') {
    side = Number(spec.side);
    if (side !== 1 && side !== -1) throw new Error('holesOnContour: side must be 1 or -1');
  }
  if (flip && spec.side != null && spec.side !== '' && side !== -1) {
    throw new Error('holesOnContour: flip and side disagree');
  }
  return flip ? -1 : side;
}

function _holeDia(spec) {
  if (spec.dia != null && spec.dia !== '') {
    const dia = Number(spec.dia);
    if (!(dia > 0)) throw new Error('holesOnContour: dia must be > 0');
    return dia;
  }
  const type = spec.type == null || spec.type === 'clearance'
    ? 'clearance'
    : (spec.type === 'tap' || spec.type === 'tapDrill' ? 'tapDrill' : null);
  if (!type) throw new Error('holesOnContour: type must be clearance or tapDrill');
  if (spec.size == null || spec.size === '') throw new Error('holesOnContour: set dia or a fastener size');
  return type === 'tapDrill'
    ? fastenerTapDrillDia(spec.size)
    : fastenerClearanceDia(spec.size, spec.fit || 'normal');
}

function _holeReach(part, frame, spec) {
  const hasDepth = spec.depth != null && spec.depth !== '';
  if (spec.through === true && hasDepth) {
    throw new Error('holesOnContour: set through or depth, not both');
  }
  const blind = spec.through === false || (hasDepth && spec.through !== true);
  if (!blind) return { through: true, span: holeSpan(part, frame) };
  const depth = Number(spec.depth);
  if (!(depth > 0)) throw new Error('holesOnContour: depth must be > 0');
  // hole() keeps 1mm on the start side of the plane. depth is how far the
  // cutter enters the chosen side, so the span is one millimetre longer.
  return { through: false, span: depth + 1 };
}

function _holeEnd(raw, label) {
  if (raw == null || raw === 'none') return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`holesOnContour: ${label} must be none or { kind, dia, depth }`);
  }
  const kind = raw.kind == null ? 'none' : String(raw.kind);
  if (kind === 'none') return null;
  if (kind !== 'cbore' && kind !== 'csk') {
    throw new Error(`holesOnContour: ${label} kind must be none, cbore, or csk`);
  }
  const dia = Number(raw.dia);
  const depth = Number(raw.depth);
  if (!(dia > 0) || !(depth > 0)) {
    throw new Error(`holesOnContour: ${label} needs a dia and a depth`);
  }
  return { kind, dia, depth };
}

function _holeProfile(section) {
  if (section && section.profile && typeof section.profile === 'object') return section.profile;
  if (section && (Array.isArray(section.points) || Array.isArray(section.arcs))) return section;
  return { points: [], arcs: [] };
}

function _holeCentres(profile) {
  const points = Array.isArray(profile.points) ? profile.points : [];
  const seen = new Set();
  const out = [];
  for (const p of points) {
    if (!p || p.id == null || !Array.isArray(p.at)) {
      throw new Error('holesOnContour: a centre needs an id and at');
    }
    const id = String(p.id);
    const u = Number(p.at[0]);
    const v = Number(p.at[1]);
    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      throw new Error(`holesOnContour: centre ${id} must be a finite [u, v]`);
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, u, v });
  }
  for (const arc of profile.arcs || []) {
    if (!arc || arc.center == null) continue;
    const id = String(arc.center);
    if (!seen.has(id)) {
      throw new Error(`holesOnContour: arc ${arc.id || ''} center ${id} is not a sketch point`);
    }
  }
  return out;
}

function _holeFrameForSide(frame, side) {
  if (side === 1) return frame;
  return {
    center: frame.center.slice(),
    normal: [-frame.normal[0], -frame.normal[1], -frame.normal[2]],
    x: frame.x.slice(),
    y: [-frame.y[0], -frame.y[1], -frame.y[2]],
  };
}

function _holeFarFrame(part, frame) {
  const bb = part.boundingBox();
  const fn = frame.normal;
  const fc = frame.center;
  let minW = Infinity;
  const xs = [bb.min[0], bb.max[0]];
  const ys = [bb.min[1], bb.max[1]];
  const zs = [bb.min[2], bb.max[2]];
  for (const x of xs) for (const y of ys) for (const z of zs) {
    const w = (x - fc[0]) * fn[0] + (y - fc[1]) * fn[1] + (z - fc[2]) * fn[2];
    if (w < minW) minW = w;
  }
  return {
    center: [fc[0] + fn[0] * minW, fc[1] + fn[1] * minW, fc[2] + fn[2] * minW],
    normal: [-fn[0], -fn[1], -fn[2]],
    x: frame.x.slice(),
    y: [-frame.y[0], -frame.y[1], -frame.y[2]],
  };
}

function _holeEndCutter(M, frame, u, v, end, diaThru) {
  if (!(end.dia > diaThru)) {
    const name = end.kind === 'cbore' ? 'c-bore' : 'c-sink';
    throw new Error(`holesOnContour: ${name} dia (${end.dia}) must be > hole dia (${diaThru})`);
  }
  if (end.kind === 'cbore') return _c4PutCyl(M, frame, u, v, end.dia, end.depth + 1);
  const n = frame.normal;
  const c = _c4Add(_c4Add(frame.center, _c4Mul(u, frame.x)), _c4Mul(v, frame.y));
  const cone = M.cylinder(end.depth, diaThru / 2, end.dia / 2, 48, true);
  const w0 = -end.depth / 2;
  const t = frameToMatrix({
    center: [c[0] + n[0] * w0, c[1] + n[1] * w0, c[2] + n[2] * w0],
    x: frame.x,
    y: frame.y,
    normal: n,
  });
  return cone.transform(t);
}

/**
 * holesOnContour(part, section, spec) — one hole at every sketch point of a
 * centres contour, including arc centres. `section` is a makeCrossSection
 * (plane + profile). Construction lines are not centres. No centres returns
 * `part`. `dia` is a raw millimetre diameter and wins over `size` + `fit`.
 * Without `dia`, `type: 'tapDrill'` uses the tap drill and anything else uses
 * the clearance diameter. `side: 1` cuts toward −normal (the same way as
 * hole()); `side: -1` or `flip: true` cuts the other way. `depth` is how far
 * the hole enters that side; `through: true` uses holeSpan. A far c-bore or
 * c-sink needs a through hole. Two calls may share one section.
 */
function holesOnContour(part, section, spec) {
  if (!part || typeof part.boundingBox !== 'function') {
    throw new Error('holesOnContour: part must be a solid');
  }
  const opts = _holeOpt(spec);
  const plane = section && section.plane;
  if (!plane || !plane.normal || !plane.center || !plane.x || !plane.y) {
    throw new Error('holesOnContour: section needs a plane (center, normal, x, y)');
  }
  const centres = _holeCentres(_holeProfile(section));
  if (!centres.length) return part;
  const dia = _holeDia(opts);
  const side = _holeSide(opts);
  const entry = _holeFrameForSide(plane, side);
  const reach = _holeReach(part, entry, opts);
  const near = _holeEnd(opts.near, 'near');
  const farEnd = _holeEnd(opts.far, 'far');
  if (farEnd && !reach.through) throw new Error('holesOnContour: a blind hole has no far end');
  const M = manifoldModule.Manifold;
  const far = farEnd ? _holeFarFrame(part, entry) : null;
  let out = part;
  for (const c of centres) {
    const u = c.u;
    const v = side === 1 ? c.v : -c.v;
    out = _c4RequireValidSolid(
      M.difference(out, _c4PutCyl(M, entry, u, v, dia, reach.span)),
      'holesOnContour',
    );
    if (near) {
      out = _c4RequireValidSolid(
        M.difference(out, _holeEndCutter(M, entry, u, v, near, dia)),
        'holesOnContour',
      );
    }
    if (far) {
      out = _c4RequireValidSolid(
        M.difference(out, _holeEndCutter(M, far, u, -v, farEnd, dia)),
        'holesOnContour',
      );
    }
  }
  return out;
}

// ============================================================================
// C6 — Fillet helper (Manifold JS has no native fillet; this is the v1/v2
// geometric construction). v1 ported from cadgen-workspace/harness/c6_fillet.mjs
// (8 harness tests green, 08-25). v2 (09-08) adds CLOSED CIRCULAR RUN
// support so a tessellated circular edge (a hole rim, an outer cylinder rim
// — any curved surface meeting a planar face, which Manifold represents as
// a LOOP of many short straight mesh edges) fillets as ONE feature instead
// of silently losing its fillet edge-by-edge. This was a real, verified
// bug: a Ø12 hole rim at 48 segs has ~0.78mm segments, and r=1 needs
// t=1 > 0.45·0.78 — every single segment failed the old "tessellation
// sliver" guard and got skipped, part-wide, with no error.
//
// Per SINGLETON edge (both adjacent faces planar, edge convex, v1 —
// unchanged):
//   Cross-section perpendicular to the edge: the two faces meet at interior
//   angle θ (material side). A fillet arc of radius r is tangent to both
//   faces at distance t = r/tan(θ/2) from the corner, centered on the
//   INTERIOR angle bisector at distance r/sin(θ/2). Removed cross-section
//   (sliver between corner and arc) = r·t − ½·r²·(π − θ)  (90°: r²(1−π/4)).
//   Boundary rays f0/f1 (in-face, from the corner into the material) are
//   derived from the ADJACENT TRIANGLES' third vertices — NOT face normals
//   (valid at 90° only) and NOT faceID groups (Manifold can merge faces
//   from different planes, or both edge triangles, into one faceID —
//   verified on a box cut by a slanted prism, 08-25).
//   Cutter = parallelepiped(t·f0, t·f1, edge) − cylinder(r, on bisector
//   line); exact for every θ. Cutters for a SET of edges are unioned and
//   subtracted once (same batching as chamferEdges) — shared-corner
//   overlaps are counted once, matching analytic inclusion-exclusion.
//
// CLOSED CIRCULAR RUNS (v2): a maximal chain of INPUT edges that (a) share
// consecutive mesh vertices, (b) turn <=30° at each shared vertex
// (tangent-continuous — a genuine polygon corner turns 60-180°; a
// tessellated circle turns 360/segs°, which is <=30° for any segs>=12),
// and (c) keep the SAME θ (within 3°) and SAME r, are merged into a run;
// if the chain walk closes on itself, that run is a candidate circular rim.
//
// FIRST ATTEMPT (rejected by measurement, keeping the note as a warning):
// re-using the exact per-segment parallelepiped/cylinder cutter for every
// segment in the run (just not skipping short ones) looks tempting — v1
// already unions all cutters and subtracts once, so it seems like "batching
// was never the problem, only the length guard was." It is WRONG whenever
// t is not small relative to the segment length L (exactly the case a real
// fillet radius on a coarse rim produces, e.g. r=5 on a 96-seg, 2.6mm-pitch
// rim has t=5 ≈ 2·L): each segment's box/cylinder overshoots its own
// [0,L] span by a large fraction of L, so neighboring segments' cutters —
// each tilted slightly differently around the curve — overlap heavily and
// produce either a wasm trap (measured: part 95d717e6 crashed with "memory
// access out of bounds") or a badly wrong volume (measured: part b0c16861
// went from 0.7% symRel to 8.1%, removing ~640mm³ against an analytic
// ~35mm³). Verified on the actual regression corpus before shipping —
// see fillet-fix/FIX_REPORT.md.
//
// ACTUAL v2 CONSTRUCTION: a closed run is fit to an exact circle (3-point
// circumcircle through 3 well-separated run vertices, then every OTHER
// vertex in the run is checked to actually lie on that circle within
// tolerance — a real tessellated Manifold.cylinder rim fits to float
// precision; a coincidentally-closed loop of unrelated edges will not, and
// falls back below). Given the fit (center C, axis N, radius R) and the
// run's (θ, t, r) — constant across the run by the merge criterion — the
// SAME 2D corner-sliver construction used per-edge is built ONCE in the
// meridian half-plane (ρ = radial distance from the axis, z = height along
// it) and swept a full 360° with `makeRevolve`/`CrossSection.revolve`
// (box-in-the-meridian-plane minus a small offset circle, i.e. a torus) —
// exactly the "sweep the profile along the fillet edge" construction from
// the original sketch, specialized (and made exact, not tessellation-
// approximate) for the circular case, which is what every rim in this
// corpus (holes, cylinder rims) actually is. ONE boolean-quality cutter per
// run, no segment-length sensitivity at all, so the R11-class failure mode
// above cannot occur. If the fit or the in-meridian-plane check fails (a
// non-circular closed run — mixed topology), or the run isn't closed
// (a partial/open curved chain), filletEdges FALLS BACK to the v1
// per-EDGE construction for every edge in that run, INCLUDING the original
// t > 0.45·L skip guard — i.e. exactly v1 behaviour, not the rejected
// per-segment-run idea above. Known gap: an OPEN curved run (a fillet on a
// less-than-360° arc) does not get the new treatment and can still lose
// short segments to the skip guard; not exercised by the current corpus
// (every curved surface here comes from a full-revolution primitive).
//
// Curved-adjacent-face relaxation (v2): _c6AssertPlanarAtEdge (below)
// forbids a fillet whose adjacent face is curved — still enforced for
// SINGLETON edges (including fallback-run edges, treated as singletons).
// A run that gets the closed-circular-run treatment SKIPS that assert
// entirely: the circle fit + per-vertex on-circle check IS the validity
// proof for "this is one smooth curved feature," and is strictly more
// specific than the singleton assert's local coplanarity probe (which was
// never designed to look past one edge, and throws on any tessellation
// finer than 3°/facet — exactly what a genuinely curved rim looks like at
// high segment counts).
//
// Constraints (v1, still true for SINGLETON/fallback edges): planar faces
// at the edge (checked: all same-face neighbor triangles coplanar within
// 1e-3; curved-face fillets throw); convex edges only (ball probe, same
// criterion as convexEdges — concave rounding is material ADD and out of
// scope); radius = number (all edges) or number[] parallel to the edge
// list (per-edge radii); a SINGLETON/fallback edge must satisfy
// t < 0.45·edge length (larger r runs off the face — the boolean clips it,
// documented lower fidelity). A closed-circular-run cutter throws instead
// of silently clipping if r is so large the fillet would revolve through
// the rim's own axis. Per-edge arc tessellated at 384 segments (results sit
// ≤ L·(π−(n/2)sin(2π/n))·r² ABOVE the circle-exact volume per edge); a
// closed-run's revolve uses its own (generally coarser, still >=96-segment)
// resolution — see _c6ClosedRunCutter.
//
// opts.sphericalCorners: at every vertex where THREE filleted edges meet
// (~90° corners, equal radii only — v1 scope), the three fillet sails
// converge to a sharp cusp. The option replaces that cusp with the sphere
// of radius r about the trihedral incenter (equidistant r from all three
// faces and ON all three sail axes) — a spherical corner patch tangent to
// each sail along a circle (C1) and to each face at one point, i.e. the
// true CAD corner for an r/r/r box corner. An exact right-angle corner is
// built as meshes that share their ring vertices (trimmed edge prisms plus
// one pocket per corner, see "Spherical corners, mesh-built" below); a
// near-90° corner keeps the v1 ball cut. Closed circular runs never
// participate (a closed loop has no vertex where three DIFFERENT edges
// converge; interior run vertices are always degree-2).
// ============================================================================
function _c6Norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }
function _c6Cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function _c6Sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function _c6Len(v) { return Math.hypot(v[0], v[1], v[2]); }

// Per-edge geometry needed by both run-detection and singleton/fallback
// cutter construction. Throws on exactly the conditions v1 threw on
// (stale/degenerate mesh lookup, concave edge, degenerate face angle) —
// BEFORE any run decision is made, so a single bad edge anywhere in the
// list still fails loud, in the same order as before.
function _c6InFaceFromNormal(n, d, nOther) {
  if (!n || !d) return null;
  let f = _c6Cross(n, d);
  if (_c6Len(f) < 1e-8) return null;
  f = _c6Norm(f);
  if (nOther) {
    const toward = [-nOther[0], -nOther[1], -nOther[2]];
    if (f[0]*toward[0] + f[1]*toward[1] + f[2]*toward[2] < 0)
      f = [-f[0], -f[1], -f[2]];
  }
  return f;
}

/**
 * Sine floor for reading an in-face ray off a triangle's third vertex. Below
 * it the vertex sits (almost) on the edge line, so the component ⊥ the edge
 * is rounding noise and its direction is arbitrary.
 */
const _C6_IN_FACE_MIN_SIN = 0.02;

/**
 * In-face ray of one edge triangle, robust to sliver triangles.
 *
 * The ray is the third vertex's offset ⊥ the edge. Boolean seams leave
 * slivers whose third vertex is almost on the edge line: on the three-fillet
 * cube the y = −10 top edge (−8.02 → 8.02) has a front-face triangle whose
 * third vertex is (8.13, −10, 9.9957), 0.004 mm off a 16 mm edge. Measured
 * against the path segment instead of the edge, a segment tilted 0.015° (its
 * start knot sits on the resampled corner arc, y = −9.9957) adds a ⊥ error
 * of the same size, and the ray came out 45° off the face: the whole leg's
 * chamfer section turned 45° (the lip and step). Below the sine floor the
 * ray is the face normal × the edge, signed toward the vertex while it still
 * has a side, else away from the other face (convex edge); then put back ⊥
 * `d`. Well-conditioned triangles return exactly what they always did.
 *
 * `d` is the direction the ray must be ⊥ to; `dEdge` (default `d`) is the
 * mesh edge the triangle actually sits on.
 */
function _c6InFaceDirSafe(X, P0, d, nFace, nOther, dEdge = null) {
  const e = dEdge || d;
  const v = [X[0]-P0[0], X[1]-P0[1], X[2]-P0[2]];
  const L = Math.hypot(v[0], v[1], v[2]);
  const s = v[0]*e[0] + v[1]*e[1] + v[2]*e[2];
  const w = [v[0]-s*e[0], v[1]-s*e[1], v[2]-s*e[2]];
  const wl = Math.hypot(w[0], w[1], w[2]);
  // Well-conditioned (the usual case): unchanged, against the caller's `d`.
  if (L > 1e-12 && wl >= _C6_IN_FACE_MIN_SIN * L && wl > 1e-6) return _c6InFaceDir(X, P0, d);
  // Sliver: direction from the face normal about the EDGE, side from the
  // vertex while it still has one (near-tangent seams, where the other face
  // cannot tell the sides apart), else away from the other face.
  let f = _c6InFaceFromNormal(nFace, e, wl > 1e-9 ? null : nOther);
  if (!f) return _c6InFaceDir(X, P0, d);
  if (wl > 1e-9 && f[0]*w[0] + f[1]*w[1] + f[2]*w[2] < 0) f = [-f[0], -f[1], -f[2]];
  // Back into the plane ⊥ d (d is the path segment for the sweep probes).
  const t = f[0]*d[0] + f[1]*d[1] + f[2]*d[2];
  const g = [f[0]-t*d[0], f[1]-t*d[1], f[2]-t*d[2]];
  const gl = Math.hypot(g[0], g[1], g[2]);
  return gl > 1e-9 ? [g[0]/gl, g[1]/gl, g[2]/gl] : f;
}

/**
 * Face normals for the two triangles on an edge: the triangles' own normals.
 * The face-group normals (n0/n1) are a stand-in only for a triangle too
 * degenerate to have one — on a curved group they are an average over the
 * whole blend, not the local surface.
 */
function _c6EdgeTriNormals(e, triA, triB) {
  const own = (tri) => {
    if (!tri?.v) return null;
    const [v0, v1, v2] = tri.v;
    const c = _c6Cross([v1[0]-v0[0], v1[1]-v0[1], v1[2]-v0[2]], [v2[0]-v0[0], v2[1]-v0[1], v2[2]-v0[2]]);
    return Math.hypot(c[0], c[1], c[2]) > 1e-12 ? _c6Norm(c) : null;
  };
  let a = own(triA);
  let b = own(triB);
  if ((!a || !b) && e && Array.isArray(e.n0) && Array.isArray(e.n1)) {
    const d = (p, q) => p[0]*q[0] + p[1]*q[1] + p[2]*q[2];
    if (a && !b) b = d(a, e.n0) >= d(a, e.n1) ? e.n1 : e.n0;
    else if (b && !a) a = d(b, e.n0) >= d(b, e.n1) ? e.n1 : e.n0;
    else { a = e.n0; b = e.n1; }
  }
  return [a, b];
}

function _c6EdgeGeom(M, part, mesh, e, r, opts = {}) {
  const relaxPlanar = !!opts.relaxPlanar;
  const P0 = e.va, P1 = e.vb;
  const L = Math.hypot(P1[0]-P0[0], P1[1]-P0[1], P1[2]-P0[2]);
  if (L < 1e-9) return null;
  const d = [(P1[0]-P0[0])/L, (P1[1]-P0[1])/L, (P1[2]-P0[2])/L];

  // in-face boundary rays: prefer mesh triangles on the edge. Hard Accept
  // (relaxPlanar) may pass #49 coherent segments whose endpoints are not a
  // single mesh triangle edge — fall back to carried n0/n1 face normals.
  const eKey = e.a < e.b ? e.a * 1e9 + e.b : e.b * 1e9 + e.a;
  const ti = mesh.pairMap.get(eKey);
  let f0 = null;
  let f1 = null;
  if (ti && ti.length === 2) {
    const thirdVertex = (tri) => {
      for (let k = 0; k < 3; k++) if (tri.vs[k] !== e.a && tri.vs[k] !== e.b) return tri.v[k];
      throw new Error('filletEdges: degenerate edge triangle');
    };
    const [nA, nB] = _c6EdgeTriNormals(e, mesh.tris[ti[0]], mesh.tris[ti[1]]);
    f0 = _c6InFaceDirSafe(thirdVertex(mesh.tris[ti[0]]), P0, d, nA, nB);
    f1 = _c6InFaceDirSafe(thirdVertex(mesh.tris[ti[1]]), P0, d, nB, nA);
  } else if (relaxPlanar && e.n0 && e.n1) {
    f0 = _c6InFaceFromNormal(e.n0, d, e.n1);
    f1 = _c6InFaceFromNormal(e.n1, d, e.n0);
  } else if (!ti || ti.length !== 2) {
    throw new Error('filletEdges: edge not found in mesh (stale selection?)');
  }
  if (!f0 || !f1)
    throw new Error('filletEdges: could not resolve in-face directions for edge');

  // convexity guard: ball probe at the midpoint (same criterion as
  // convexEdges — a dot-product test cannot distinguish a 90° concave
  // corner from a 90° convex one).
  const mid = [(P0[0]+P1[0])/2, (P0[1]+P1[1])/2, (P0[2]+P1[2])/2];
  const rProbe = Math.min(0.05, L * 0.25);
  const sp = M.sphere(rProbe, 12, 6).transform(
    [1,0,0,0, 0,1,0,0, 0,0,1,0, mid[0],mid[1],mid[2], 1]);
  const fIn = M.intersection(part, sp).volume() / sp.volume();
  if (fIn >= 0.45)
    throw new Error('filletEdges: edge is concave (pass convexEdges() output)');

  // interior (material-side) angle between the boundary rays
  const cTheta = Math.max(-1, Math.min(1, f0[0]*f1[0] + f0[1]*f1[1] + f0[2]*f1[2]));
  const theta = Math.acos(cTheta);
  if (theta < 0.05 || theta > Math.PI - 0.05)
    throw new Error(`filletEdges: degenerate face angle ${theta} rad`);
  const t = r / Math.tan(theta / 2);
  // A FREE end has a face of the part capping it (a face at the end vertex
  // whose normal points on along the edge): beyond it is air, and a cutter
  // may overrun it by the face push so its end face is not left as a skin in
  // that cap (see _C6_FACE_PUSH_RATIO). An end that runs into other material (a
  // boss edge ending on a plate) has no such face and is cut flush.
  const capFree = (P, dir) => (typeof mesh.trisAtPoint === 'function')
    && mesh.trisAtPoint(P).some((ti) => {
      const n = mesh.tris[ti].n;
      return n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] > 0.3;
    });
  const freeA = capFree(P0, [-d[0], -d[1], -d[2]]);
  const freeB = capFree(P1, d);
  return { e, P0, P1, L, d, f0, f1, theta, t, r, freeA, freeB };
}

// Run detection (v2, see C6 block header). geoms = _c6EdgeGeom results,
// parallel to the input edge array (nulls for degenerate zero-length
// edges). Returns [{ idxs: [...], closed }] covering every geoms[] index
// exactly once; length-1 entries are singleton edges. Walk: at each shared
// mesh vertex, exactly one OTHER input edge must touch it (a real chain
// link, not a triple-junction or a branch), with matching r, matching θ
// (within 3°), and a turn angle <=30° between the two segments' directions
// (a tessellated circle turns 360/segs° — under 30° for any segs>=12; a
// genuine polygon corner turns 60-180° and is correctly rejected as a chain
// link, staying a singleton).
function _c6DetectRuns(geoms) {
  const TURN_COS_MIN = Math.cos(30 * Math.PI / 180);
  const THETA_TOL = 3 * Math.PI / 180;
  const byVertex = new Map(); // mesh vertex index -> [{idx, end}]
  geoms.forEach((g, i) => {
    if (!g) return;
    for (const end of ['a', 'b']) {
      const vk = g.e[end];
      if (!byVertex.has(vk)) byVertex.set(vk, []);
      byVertex.get(vk).push({ idx: i, end });
    }
  });
  // arrival(g,end): unit direction arriving AT the vertex `end`, walking g
  // in its natural a->b sense. departure(g,end): unit direction leaving
  // the vertex `end`, continuing along g in its natural a->b sense.
  const arrival = (g, end) => end === 'b' ? g.d : [-g.d[0], -g.d[1], -g.d[2]];
  const departure = (g, end) => end === 'a' ? g.d : [-g.d[0], -g.d[1], -g.d[2]];
  const findNext = (i, end) => {
    const vk = geoms[i].e[end];
    const touching = byVertex.get(vk);
    if (!touching || touching.length !== 2) return null; // branch/terminus
    const other = touching.find(x => x.idx !== i);
    if (!other) return null;
    const j = other.idx;
    if (Math.abs(geoms[i].r - geoms[j].r) > 1e-9) return null;
    if (Math.abs(geoms[i].theta - geoms[j].theta) > THETA_TOL) return null;
    const arr = arrival(geoms[i], end);
    const dep = departure(geoms[j], other.end);
    const cosAng = arr[0]*dep[0] + arr[1]*dep[1] + arr[2]*dep[2];
    if (cosAng < TURN_COS_MIN) return null; // real corner, not a curve
    return other;
  };
  const visited = new Array(geoms.length).fill(false);
  const runs = [];
  for (let i = 0; i < geoms.length; i++) {
    if (visited[i] || !geoms[i]) continue;
    visited[i] = true;
    const chain = [i];
    let closed = false;
    let curIdx = i, curEnd = 'b';
    for (;;) {
      const nxt = findNext(curIdx, curEnd);
      if (!nxt) break;
      if (nxt.idx === i) { closed = true; break; } // loop closes on itself
      if (visited[nxt.idx]) break;
      chain.push(nxt.idx);
      visited[nxt.idx] = true;
      curIdx = nxt.idx;
      curEnd = nxt.end === 'a' ? 'b' : 'a'; // continue from the far end
    }
    if (!closed) {
      curIdx = i; curEnd = 'a';
      for (;;) {
        const nxt = findNext(curIdx, curEnd);
        if (!nxt) break;
        if (visited[nxt.idx]) break;
        chain.unshift(nxt.idx);
        visited[nxt.idx] = true;
        curIdx = nxt.idx;
        curEnd = nxt.end === 'a' ? 'b' : 'a';
      }
    }
    runs.push({ idxs: chain, closed });
  }
  return runs;
}

// Exact circumcircle through 3 non-collinear 3D points -> {center, normal,
// radius}, or null if (near-)collinear. Standard vector formula relative
// to A: center = A + (|AC|²(AB×AC)×AB + |AB|²AC×(AB×AC)) / (2|AB×AC|²).
function _c6FitCircle3(A, B, C) {
  const ab = _c6Sub(B, A), ac = _c6Sub(C, A);
  const abLen2 = ab[0]*ab[0]+ab[1]*ab[1]+ab[2]*ab[2];
  const acLen2 = ac[0]*ac[0]+ac[1]*ac[1]+ac[2]*ac[2];
  const cr = _c6Cross(ab, ac);
  const denom = 2 * (cr[0]*cr[0]+cr[1]*cr[1]+cr[2]*cr[2]);
  if (denom < 1e-9) return null; // near-collinear: no well-defined circle
  const t1 = _c6Cross(cr, ab), t2 = _c6Cross(ac, cr);
  const center = [
    A[0] + (acLen2*t1[0] + abLen2*t2[0]) / denom,
    A[1] + (acLen2*t1[1] + abLen2*t2[1]) / denom,
    A[2] + (acLen2*t1[2] + abLen2*t2[2]) / denom,
  ];
  return { center, normal: _c6Norm(cr), radius: _c6Len(_c6Sub(A, center)) };
}

// Build the single exact revolve cutter for a CLOSED circular run (see C6
// block header). Returns null if the run doesn't fit a clean circle or its
// f0/f1 aren't in the meridian plane (axisymmetric geometry required) —
// the caller then falls back to the v1 per-edge path for every edge in the
// run. Throws if the fit is circular but r is too large for the rim
// (would revolve through the axis).
function _c6ClosedRunCutter(M, manifoldModule, run, geoms) {
  const { CrossSection } = manifoldModule;
  const n = run.idxs.length;
  const pt = (k) => geoms[run.idxs[k]].P0;
  const fit = _c6FitCircle3(pt(0), pt(Math.floor(n / 3)), pt(Math.floor(2 * n / 3)));
  if (!fit) return null;
  const { center: C, normal: N, radius: R } = fit;
  if (R < 1e-6) return null;
  // Sanity: every run vertex must actually lie on this circle (real
  // tessellated rims fit to float precision; a coincidental closed loop of
  // unrelated edges will not).
  const tol = Math.max(0.02 * R, 0.01);
  for (let k = 0; k < n; k++) {
    const rel = _c6Sub(pt(k), C);
    const z = rel[0]*N[0] + rel[1]*N[1] + rel[2]*N[2];
    const rho = _c6Len([rel[0]-z*N[0], rel[1]-z*N[1], rel[2]-z*N[2]]);
    if (Math.abs(z) > tol || Math.abs(rho - R) > tol) return null; // not circular
  }
  const g0 = geoms[run.idxs[0]];
  const rel0 = _c6Sub(pt(0), C);
  const z0 = rel0[0]*N[0] + rel0[1]*N[1] + rel0[2]*N[2];
  const rhoHat = _c6Norm(_c6Sub(rel0, [z0*N[0], z0*N[1], z0*N[2]]));
  const yHat = _c6Norm(_c6Cross(N, rhoHat));
  // f0/f1 SHOULD lie in the meridian plane (axisymmetric geometry), but the
  // "third vertex" in-face direction (see _c6EdgeGeom) is measured against
  // ONE mesh triangle, whose third vertex is one tessellation STEP away
  // around the curve — for an n-segment rim that leaks a genuine tangential
  // component of magnitude ~sin(π/n) into f0/f1 (verified: 96 segs ->
  // 0.0327, matches sin(1.875°) exactly). That leak is a tessellation
  // artifact, not a sign of non-axisymmetric geometry, and `to2d` below
  // already discards it (keeps only the (ρ,z) components) — so gate on how
  // much LENGTH survives the projection (near 1 for any reasonably fine
  // rim; n>=12 — the run-detection turn-angle filter's own floor — keeps
  // sin(π/12)=0.259 leak, length sqrt(1-0.259²)=0.966, comfortably clear of
  // this threshold) rather than rejecting on the leak itself.
  const to2d = (v) => [v[0]*rhoHat[0]+v[1]*rhoHat[1]+v[2]*rhoHat[2], v[0]*N[0]+v[1]*N[1]+v[2]*N[2]];
  let f0_2d = to2d(g0.f0), f1_2d = to2d(g0.f1);
  const f0Len = Math.hypot(f0_2d[0], f0_2d[1]), f1Len = Math.hypot(f1_2d[0], f1_2d[1]);
  if (f0Len < 0.9 || f1Len < 0.9) return null; // not axisymmetric -- fall back
  f0_2d = [f0_2d[0]/f0Len, f0_2d[1]/f0Len];
  f1_2d = [f1_2d[0]/f1Len, f1_2d[1]/f1Len];
  const { theta, t, r } = g0;
  const P0_2d = [R, 0];
  const sLen = Math.hypot(f0_2d[0]+f1_2d[0], f0_2d[1]+f1_2d[1]) || 1;
  const bis = [(f0_2d[0]+f1_2d[0])/sLen, (f0_2d[1]+f1_2d[1])/sLen];
  const dC = r / Math.sin(theta / 2);
  const O0 = [P0_2d[0] + dC*bis[0], P0_2d[1] + dC*bis[1]];
  const quad = [
    // The rim point, out of both faces (see _C6_FACE_PUSH_RATIO).
    [P0_2d[0] - _c6FacePush(r) * (f0_2d[0] + f1_2d[0]), P0_2d[1] - _c6FacePush(r) * (f0_2d[1] + f1_2d[1])],
    [P0_2d[0]+t*f0_2d[0], P0_2d[1]+t*f0_2d[1]],
    [P0_2d[0]+t*(f0_2d[0]+f1_2d[0]), P0_2d[1]+t*(f0_2d[1]+f1_2d[1])],
    [P0_2d[0]+t*f1_2d[0], P0_2d[1]+t*f1_2d[1]],
  ];
  const minX = Math.min(quad[0][0], quad[1][0], quad[2][0], quad[3][0], O0[0] - r);
  if (minX < 1e-6)
    throw new Error('filletEdges: fillet radius too large for this rim (would revolve through the axis)');
  // REVOLVE_SEGS MUST equal n exactly (verified empirically, not a style
  // choice): Manifold's boolean difference between the ORIGINAL part (an
  // n-segment tessellated rim) and a cutter revolved at a DIFFERENT segment
  // count is only PARTIALLY effective — even at a clean integer multiple of
  // n — silently removing less material than the cutter's own volume
  // (measured on a 40mm-radius rim: cutter built at 96 segs vs the part's
  // 64 has volume 53.91 but removes only 49.84; at EXACTLY 64 segs it
  // removes the full 53.86). The two meshes' angular samples must land at
  // the identical phase for the boolean to fully resolve — a real
  // robustness limit of the boolean engine at differing/misaligned
  // tessellation, not a quality/tolerance knob. ARC_SEGS (the small fillet
  // arc's own resolution) has no such constraint — it only touches the
  // cutter's OWN geometry, not the part/cutter alignment — so it is free to
  // be tuned for quality.
  const REVOLVE_SEGS = n;
  const ARC_SEGS = 128;
  // Wedge profile built as ONE 2D CrossSection boolean (quad minus the fillet
  // arc's disk), THEN revolved once. Do NOT revolve the box and the arc into
  // two 3D solids and difference those (the original construction): the box
  // corner and the arc are mathematically TANGENT along their whole shared
  // boundary -- that is the definition of a fillet -- and a 3D boolean
  // between two meshes meeting at a near-but-not-exactly-tangent surface
  // (float noise ~1e-7 from the fitted R/t) is the classic worst case for a
  // mesh boolean: it manufactures a sliver of near-zero-volume overlap that
  // triangulates into hundreds of degenerate triangles (measured: 316
  // zero-area tris + 508 q<0.01 needles on the 9e2b61bb flange; the
  // no-fillet baseline is 0/34). The 2D boolean is well-conditioned (both
  // shapes are flat; the "torus" is just a circle), the solid is identical
  // as a point set -- revolve(A\B) = revolve(A)\revolve(B) for full 360
  // revolutions -- with ZERO degenerate tris, at half the triangle count
  // (one revolve instead of two). Revolve still locks to n (see above): the
  // phase-lock constraint is about THIS solid vs the PART mesh, not internal.
  const quadCS = new CrossSection(_c8NormalizeContours([quad]));
  const arcCS = CrossSection.circle(r, ARC_SEGS).translate(O0);
  const cutter2D = _c8CheckValid(
    quadCS.subtract(arcCS).revolve(REVOLVE_SEGS), 'filletEdges (closed run)');
  const mat = frameToMatrix({ center: C, x: rhoHat, y: yHat, normal: N });
  return cutter2D.transform(mat);
}


// ============================================================================
// Spherical corners, mesh-built (see the sphericalCorners note in the block
// header above). Three right-angle fillets of one radius meeting at a vertex
// P leave a cusp. The true CAD corner is the sphere of radius r about the
// trihedral incenter O = P + r(d1 + d2 + d3), tangent to the three faces and
// to each sail along the circle where the sail's cylinder meets the plane
// through O perpendicular to that edge.
//
// v1 cut that corner with booleans: cornerBox ∩ cyl1 ∩ cyl2 ∩ cyl3 minus a
// 256-segment ball. The ball is TANGENT to every sail along its junction
// circle, and a boolean between two tangent surfaces zig-zags: on a 40×30×20
// box it left 1390 needle triangles and split one `.round` face into 226
// patches. Nothing in the result was wrong; everything downstream of it
// (face catalog, edge names, selection) was noisy.
//
// v2 never intersects tangent surfaces. Each edge that ends in a spherical
// corner gets a cutter that STOPS at the junction plane (a prism of the
// square-minus-quarter-circle section, built as a mesh), and each corner
// gets one pocket solid: the r-cube at P minus the sphere octant, also built
// as a mesh. The pocket's three far faces are the same polygons as the
// prisms' end faces, with the same vertex floats (both are computed from the
// corner record below), so the union of the cutters merges them away and the
// sail meets the sphere along a shared ring of vertices. One subtract.
//
// Only an EXACT right-angle corner (edge directions orthogonal and every
// dihedral 90° within _C6_EXACT_CORNER_TOL, each edge long enough to hold
// its caps) takes this path. A near-90° corner (a drafted box) keeps the v1
// ball cut: its sails and faces are not where the pocket assumes them.
//
// Sphere octant grid: a barycentric grid of FILLET_EDGES_CORNER_SEGMENTS/4
// steps per side, warped so every boundary arc is uniform in angle, with
// each boundary step split FILLET_EDGES_CIRCLE_SEGMENTS/FILLET_EDGES_CORNER_SEGMENTS
// times so the boundary ring has exactly the sail's vertices. Interior
// facets step 360°/FILLET_EDGES_CORNER_SEGMENTS; the face graph reads that
// as the corner's facet step.
// ============================================================================
const _C6_EXACT_CORNER_TOL = 1e-5;

/** Point v of nFine on a quarter circle, as (cos, sin); the ends are exact. */
function _c6QuarterArcU(v, nFine) {
  if (v <= 0) return [1, 0];
  if (v >= nFine) return [0, 1];
  const phi = (Math.PI / 2) * (v / nFine);
  return [Math.cos(phi), Math.sin(phi)];
}

/**
 * World point of a unit octant direction u = (u1, u2, u3) on the corner
 * sphere: O − r·(u1·d1 + u2·d2 + u3·d3). Every solid that touches the corner
 * computes its shared vertices through this one expression.
 */
function _c6CornerSpherePoint(c, u1, u2, u3) {
  const { O, r, d } = c;
  return [
    O[0] - r * (u1 * d[0][0] + u2 * d[1][0] + u3 * d[2][0]),
    O[1] - r * (u1 * d[0][1] + u2 * d[1][1] + u3 * d[2][1]),
    O[2] - r * (u1 * d[0][2] + u2 * d[1][2] + u3 * d[2][2]),
  ];
}

/**
 * How far a cutter's corner points sit OUTSIDE the part's faces, as a
 * fraction of the fillet radius (0.02·r: 0.08 mm on a 4 mm fillet).
 *
 * Manifold keeps a solid's planes in doubles but hands JavaScript a float32
 * mesh, so a box 68.7 wide has its face at x = 34.35 while every vertex we
 * read says 34.349998. A cutter built from those vertices with a face lying
 * exactly in the part's face sits two microns inside it, and the subtract
 * leaves the whole strip between the edge and the tangency line as a
 * two-micron skin: a sheet of the old face over the new fillet, a handle in
 * the genus, and a shell that reads the sheet as a flat and offsets it the
 * wrong way. Every corner point of a cutter (the point on the edge, a
 * pocket's apex) therefore moves this far out of each face it lies on; the
 * tangency rings stay exact, so the face-lying side runs from outside the
 * part to the tangency and crosses the face plane the way the sweep
 * kernel's legs do. The extra sliver of cutter lies outside the part and
 * removes nothing.
 *
 * Proportional to r so the tilt of that side (push/t) is the same at every
 * scale: the float32 gap grows with the part, Manifold's merge tolerance
 * with it, and the strip where the side crosses the true plane
 * (gap · t / push) stays under that tolerance. Measured on the 68.7 box at
 * r = 4: a 0.01 mm push still left a 0.6 µm fin along the tangency, 0.03 mm
 * and up left none, 0.3 mm broke the pocket's volume check.
 */
const _C6_FACE_PUSH_RATIO = 0.02;
const _c6FacePush = (r) => _C6_FACE_PUSH_RATIO * r;

/** p moved eps against each direction in dirs (into the air). */
function _c6PushOut(p, dirs, eps) {
  const out = [p[0], p[1], p[2]];
  for (const v of dirs) {
    out[0] -= eps * v[0];
    out[1] -= eps * v[1];
    out[2] -= eps * v[2];
  }
  return out;
}

/**
 * The square corner of edge k's junction section: P + r·dk, pushed out of
 * the two faces that meet along edge k (their in-face directions are the
 * other two edges). Shared by the prism of edge k and the pocket of c.
 */
function _c6CornerEdgePoint(c, k) {
  const { P, r, d } = c;
  const [i, j] = [0, 1, 2].filter((x) => x !== k);
  return _c6PushOut([P[0] + r * d[k][0], P[1] + r * d[k][1], P[2] + r * d[k][2]], [d[i], d[j]], _c6FacePush(r));
}

/**
 * The junction ring of edge k at corner c: nFine + 1 points on the quarter
 * circle from the tangent point on the face (k, j) to the one on (k, i),
 * where i < j are the other two edges. Shared verbatim by the prism of edge
 * k and the pocket of corner c.
 */
function _c6CornerArc(c, k, nFine) {
  const others = [0, 1, 2].filter((x) => x !== k);
  const [i, j] = others;
  const out = new Array(nFine + 1);
  for (let v = 0; v <= nFine; v++) {
    const [cs, sn] = _c6QuarterArcU(v, nFine);
    const u = [0, 0, 0];
    u[i] = cs;
    u[j] = sn;
    out[v] = _c6CornerSpherePoint(c, u[0], u[1], u[2]);
  }
  return out;
}

/** Signed volume of a triangle soup (positive when wound outward). */
function _c6SignedVolume(V, T) {
  let six = 0;
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
    six += V[a] * (V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1])
      - V[a + 1] * (V[b] * V[c + 2] - V[b + 2] * V[c])
      + V[a + 2] * (V[b] * V[c + 1] - V[b + 1] * V[c]);
  }
  return six / 6;
}

/** Build a Manifold from a closed triangle soup; loud on anything but a clean solid. */
function _c6SolidFromSoup(M, what, verts, tris, expectVol) {
  const { Mesh } = manifoldModule;
  // Compact: a welded ring end leaves its duplicate unreferenced.
  const remap = new Int32Array(verts.length).fill(-1);
  const used = [];
  for (const tri of tris) {
    for (const v of tri) if (remap[v] < 0) { remap[v] = used.length; used.push(v); }
  }
  const V = new Float64Array(used.length * 3);
  for (let i = 0; i < used.length; i++) {
    V[i * 3] = verts[used[i]][0];
    V[i * 3 + 1] = verts[used[i]][1];
    V[i * 3 + 2] = verts[used[i]][2];
  }
  const T = new Uint32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    T[i * 3] = remap[tris[i][0]];
    T[i * 3 + 1] = remap[tris[i][1]];
    T[i * 3 + 2] = remap[tris[i][2]];
  }
  if (_c6SignedVolume(V, T) < 0) {
    for (let i = 0; i < T.length; i += 3) { const b = T[i + 1]; T[i + 1] = T[i + 2]; T[i + 2] = b; }
  }
  let solid;
  try {
    solid = new M(new Mesh({ numProp: 3, vertProperties: new Float32Array(V), triVerts: T }));
  } catch (e) {
    throw new Error(`filletEdges: ${what} mesh is not a solid (${e && e.message ? e.message : e})`);
  }
  const se = _c4StatusError(solid);
  if (se) throw new Error(`filletEdges: bad ${what} (${se})`);
  const vol = solid.volume();
  if (!(vol > 1e-9) || Math.abs(vol - expectVol) > 0.01 * expectVol) {
    throw new Error(`filletEdges: ${what} volume ${vol} is off the expected ${expectVol}`);
  }
  return solid;
}

/**
 * Cutter for one edge of an exact corner: the square-minus-quarter-circle
 * section extruded along the edge from s0 to s1, where a capped end sits at
 * the junction plane (r from the vertex) and takes its ring from that
 * corner, and an open end sits at the vertex like the v1 box did. Quads are
 * stitched between the two rings vertex for vertex.
 */
function _c6TrimmedEdgeCutter(M, g, capA, capB) {
  const nFine = FILLET_EDGES_CIRCLE_SEGMENTS / 4;
  const { L, d, r } = g;
  const shift = (ring, s) => ring.map((p) => [p[0] + s * d[0], p[1] + s * d[1], p[2] + s * d[2]]);
  let ring0;
  let ring1;
  let Q0;
  let Q1;
  if (capA) {
    ring0 = _c6CornerArc(capA.corner, capA.k, nFine);
    Q0 = _c6CornerEdgePoint(capA.corner, capA.k);
  }
  if (capB) {
    ring1 = _c6CornerArc(capB.corner, capB.k, nFine);
    Q1 = _c6CornerEdgePoint(capB.corner, capB.k);
    if (ring0) {
      // Pair the rings along the generators: the two corners label the
      // adjacent faces independently, so the far ring may run the other way.
      const b = _c6Sub(ring1[0], Q1);
      const dot = (p) => { const a = _c6Sub(p, Q0); return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
      if (dot(ring0[ring0.length - 1]) > dot(ring0[0])) ring1 = ring1.slice().reverse();
    }
  }
  // An open end overruns a free end face by the push (see _c6EdgeGeom).
  const push = _c6FacePush(r);
  const s0 = capA ? r : (g.freeA ? -push : 0);
  const s1 = capB ? L - r : (g.freeB ? L + push : L);
  if (!(s1 > s0 + 1e-9)) throw new Error('filletEdges: corner caps overlap on a short edge');
  if (!ring0) {
    ring0 = shift(ring1, -(s1 - s0));
    Q0 = [Q1[0] - (s1 - s0) * d[0], Q1[1] - (s1 - s0) * d[1], Q1[2] - (s1 - s0) * d[2]];
  }
  if (!ring1) {
    ring1 = shift(ring0, s1 - s0);
    Q1 = [Q0[0] + (s1 - s0) * d[0], Q0[1] + (s1 - s0) * d[1], Q0[2] + (s1 - s0) * d[2]];
  }
  const n = ring0.length;
  // Vertex layout: Q0, ring0[0..n), Q1, ring1[0..n).
  const verts = [Q0, ...ring0, Q1, ...ring1];
  const R0 = (v) => 1 + v;
  const R1 = (v) => n + 2 + v;
  const tris = [];
  // Section cycle: Q → ring[0] → … → ring[n−1] → Q.
  const cycle0 = [0];
  const cycle1 = [n + 1];
  for (let v = 0; v < n; v++) { cycle0.push(R0(v)); cycle1.push(R1(v)); }
  for (let v = 0; v < cycle0.length; v++) {
    const p0 = cycle0[v], q0 = cycle0[(v + 1) % cycle0.length];
    const p1 = cycle1[v], q1 = cycle1[(v + 1) % cycle1.length];
    tris.push([p0, q0, q1], [p0, q1, p1]);
  }
  for (let v = 0; v + 1 < n; v++) {
    tris.push([0, R0(v + 1), R0(v)]);
    tris.push([n + 1, R1(v), R1(v + 1)]);
  }
  // Section: the square minus the quarter disc, plus the strip the pushed
  // corner adds (shoelace over Q', T_A, C, T_B gives r² + ε·r).
  const expectVol = (s1 - s0) * (r * r * (1 - Math.PI / 4) + push * r);
  return _c6SolidFromSoup(M, 'corner edge cutter', verts, tris, expectVol);
}

/**
 * The pocket of an exact corner: the r-cube at P minus the sphere octant,
 * as one mesh. Flat faces: three squares on the part's faces, three
 * square-minus-quarter-circle far faces that match the edge cutters' end
 * faces. Curved face: the octant grid, boundary rings shared with the sails.
 */
function _c6CornerPocket(M, c, pocketOpts = {}) {
  // Rings handed in (a sweep chain's own end ring, see _s23JunctionPockets)
  // set the boundary; the grid then has that many steps per side.
  const given = Array.isArray(pocketOpts.arcs) ? pocketOpts.arcs : null;
  const nFine = given ? given[0].length - 1 : FILLET_EDGES_CIRCLE_SEGMENTS / 4;
  const n = given ? nFine : FILLET_EDGES_CORNER_SEGMENTS / 4;
  const m = nFine / n;
  if (given && (given.length !== 3 || given.some((a) => a.length !== nFine + 1) || nFine < 3)) {
    throw new Error('filletEdges: corner pocket rings must be three arcs of one length');
  }
  const { P, O, r } = c;
  const verts = [];
  const tris = [];
  const add = (p) => { verts.push(p); return verts.length - 1; };
  // Oriented push: wind so the normal points along `outward`.
  const face = (a, b, cc, outward) => {
    const A = verts[a], B = verts[b], C = verts[cc];
    const nrm = _c6Cross(_c6Sub(B, A), _c6Sub(C, A));
    if (nrm[0] * outward[0] + nrm[1] * outward[1] + nrm[2] * outward[2] < 0) tris.push([a, cc, b]);
    else tris.push([a, b, cc]);
  };
  // The apex lies on all three faces and moves out of each; the edge points
  // move out of their two (see _C6_FACE_PUSH_RATIO). The tangent points stay.
  const iP = add(_c6PushOut(P, c.d, _c6FacePush(r)));
  const iC = [0, 1, 2].map((k) => add(_c6CornerEdgePoint(c, k)));
  // Junction rings, one per edge; their ends are the three face tangent
  // points, which are also the octant grid's corners.
  const arcs = [0, 1, 2].map((k) => (given ? given[k] : _c6CornerArc(c, k, nFine)).map(add));
  // Grid corner e_i ↔ tangent point on the face opposite edge i: arc k runs
  // from e_i to e_j (i < j the other two edges).
  const corner = [arcs[1][0], arcs[0][0], arcs[0][nFine]]; // e1 (arc of edge 2 start), e2 (arc 1 start), e3 (arc 1 end)
  // Boundary vertex lookup: grid (i, j) on a boundary line → ring vertex.
  //   edge e1–e2 (i = 0): arc of edge 3, v = j·m
  //   edge e1–e3 (j = 0): arc of edge 2, v = i·m
  //   edge e2–e3 (i + j = n): arc of edge 1, v = i·m
  // Arc ends are separate vertices per arc; weld them to one index each.
  const weld = new Map();
  weld.set(arcs[2][0], corner[0]);        // e1
  weld.set(arcs[2][nFine], corner[1]);    // e2
  weld.set(arcs[1][nFine], corner[2]);    // e3
  const w = (idx) => (weld.has(idx) ? weld.get(idx) : idx);
  const ringAt = (k, v) => w(arcs[k][v]);
  const grid = new Map();
  const gkey = (i, j) => i * (n + 1) + j;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; i + j <= n; j++) {
      let idx;
      if (i === 0) idx = ringAt(2, j * m);
      else if (j === 0) idx = ringAt(1, i * m);
      else if (i + j === n) idx = ringAt(0, i * m);
      else {
        const w1 = Math.sin(((n - i - j) / n) * (Math.PI / 2));
        const w2 = Math.sin((j / n) * (Math.PI / 2));
        const w3 = Math.sin((i / n) * (Math.PI / 2));
        const len = Math.hypot(w1, w2, w3);
        idx = add(_c6CornerSpherePoint(c, w1 / len, w2 / len, w3 / len));
      }
      grid.set(gkey(i, j), idx);
    }
  }
  const G = (i, j) => grid.get(gkey(i, j));
  // Refined boundary between two adjacent boundary grid vertices, as the ring
  // vertices strictly between them, ordered from (i0,j0) to (i1,j1).
  const between = (i0, j0, i1, j1) => {
    const out = [];
    const pick = (k, va, vb) => {
      const step = va < vb ? 1 : -1;
      for (let v = va + step; v !== vb; v += step) out.push(ringAt(k, v));
    };
    if (i0 === 0 && i1 === 0) pick(2, j0 * m, j1 * m);
    else if (j0 === 0 && j1 === 0) pick(1, i0 * m, i1 * m);
    else pick(0, i0 * m, i1 * m);
    return out;
  };
  const onBoundary = (i, j) => i === 0 || j === 0 || i + j === n;
  const sameLine = (a, b) => (a[0] === 0 && b[0] === 0) || (a[1] === 0 && b[1] === 0) || (a[0] + a[1] === n && b[0] + b[1] === n);
  const sphereFace = (a, b, cc) => {
    const A = verts[a], B = verts[b], C = verts[cc];
    const cen = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
    face(a, b, cc, _c6Sub(O, cen));
  };
  // Fan from apex over the polyline [p0, p1, …].
  const fan = (apex, chain) => {
    for (let q = 0; q + 1 < chain.length; q++) sphereFace(apex, chain[q], chain[q + 1]);
  };
  // Base grid triangles as (i, j) corner triples.
  const base = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; i + j < n; j++) {
      base.push([[i, j], [i, j + 1], [i + 1, j]]);
      if (i + j + 1 < n) base.push([[i, j + 1], [i + 1, j + 1], [i + 1, j]]);
    }
  }
  const tkey = (tri) => tri.map(([i, j]) => gkey(i, j)).sort((x, y) => x - y).join(',');
  const byEdge = new Map();
  const ekey = (a, b) => { const x = gkey(a[0], a[1]), y = gkey(b[0], b[1]); return x < y ? `${x}-${y}` : `${y}-${x}`; };
  for (const tri of base) {
    for (let e = 0; e < 3; e++) {
      const k = ekey(tri[e], tri[(e + 1) % 3]);
      if (!byEdge.has(k)) byEdge.set(k, []);
      byEdge.get(k).push(tri);
    }
  }
  const boundaryEdgesOf = (tri) => {
    const bEdges = [];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      if (onBoundary(a[0], a[1]) && onBoundary(b[0], b[1]) && sameLine(a, b)) bEdges.push(e);
    }
    return bEdges;
  };
  // A corner triangle absorbs its neighbour across the interior edge; mark
  // those first, since two of the three neighbours come earlier in \`base\`.
  const consumed = new Set();
  for (const tri of base) {
    const bEdges = boundaryEdgesOf(tri);
    if (bEdges.length !== 2) continue;
    const eInt = [0, 1, 2].find((e) => !bEdges.includes(e));
    const nb = (byEdge.get(ekey(tri[eInt], tri[(eInt + 1) % 3])) || []).find((t) => t !== tri);
    if (!nb) throw new Error('filletEdges: corner grid has no neighbour across the corner triangle');
    if (boundaryEdgesOf(nb).length) throw new Error('filletEdges: corner grid is too coarse for its boundary fans');
    consumed.add(tkey(nb));
  }
  for (const tri of base) {
    if (consumed.has(tkey(tri))) continue;
    const bEdges = boundaryEdgesOf(tri);
    const V = tri.map(([i, j]) => G(i, j));
    if (bEdges.length === 0) {
      sphereFace(V[0], V[1], V[2]);
    } else if (bEdges.length === 1) {
      const e = bEdges[0];
      const a = tri[e], b = tri[(e + 1) % 3];
      const apex = V[(e + 2) % 3];
      fan(apex, [V[e], ...between(a[0], a[1], b[0], b[1]), V[(e + 1) % 3]]);
    } else {
      // Corner triangle: two boundary edges meet at the grid corner. Merge
      // with the neighbour across the interior edge and fan from its far
      // vertex, so no fan triangle lies along one arc.
      const eInt = [0, 1, 2].find((e) => !bEdges.includes(e));
      const a = tri[eInt], b = tri[(eInt + 1) % 3];
      const cornerIJ = tri[(eInt + 2) % 3];
      const nb = (byEdge.get(ekey(a, b)) || []).find((t) => t !== tri);
      const far = nb.find(([i, j]) => !((i === a[0] && j === a[1]) || (i === b[0] && j === b[1])));
      const chain = [
        G(b[0], b[1]),
        ...between(b[0], b[1], cornerIJ[0], cornerIJ[1]),
        G(cornerIJ[0], cornerIJ[1]),
        ...between(cornerIJ[0], cornerIJ[1], a[0], a[1]),
        G(a[0], a[1]),
      ];
      fan(G(far[0], far[1]), chain);
    }
  }
  // Flat faces. Near squares lie on the part's faces (outward −dk); far
  // faces are the cutters' end polygons (outward +dk), fanned from the edge
  // point exactly as _c6TrimmedEdgeCutter fans its end caps.
  const d = c.d;
  const neg = (v) => [-v[0], -v[1], -v[2]];
  // Tangent points: on face opposite edge k is grid corner e_k.
  const T = corner; // T[0] on face (2,3) = e1, T[1] on face (1,3) = e2, T[2] on face (1,2) = e3
  // Near face perpendicular to d1 (contains P, C2, C3, T[0]).
  face(iP, iC[1], T[0], neg(d[0])); face(iP, T[0], iC[2], neg(d[0]));
  face(iP, iC[0], T[1], neg(d[1])); face(iP, T[1], iC[2], neg(d[1]));
  face(iP, iC[0], T[2], neg(d[2])); face(iP, T[2], iC[1], neg(d[2]));
  for (let k = 0; k < 3; k++) {
    for (let v = 0; v < nFine; v++) face(iC[k], ringAt(k, v), ringAt(k, v + 1), d[k]);
  }
  // The r-cube minus the sphere octant, plus what the pushed apex and edge
  // points add under the three face squares (depth ε at the corner points,
  // 0 at the tangent point: 2ε·r² to first order).
  const expectVol = r * r * r * (1 - Math.PI / 6) + 2 * _c6FacePush(r) * r * r;
  return _c6SolidFromSoup(M, 'corner pocket', verts, tris, expectVol);
}

/**
 * Trihedral corners among the live edges: a vertex where exactly three
 * filleted edges of one radius meet at right angles. Each record carries the
 * vertex P, unit directions d[k] from P into edge k, the inward face normals
 * m[k] (v1 cap frame), the incenter O, and whether it is EXACT (pocket path)
 * or near (v1 ball path). Returns the records and a per-edge cap map.
 */
function _c6TrihedralCorners(live) {
  const byVertex = new Map();
  for (const g of live) {
    for (const k of [g.e.a, g.e.b]) {
      if (!byVertex.has(k)) byVertex.set(k, []);
      byVertex.get(k).push(g);
    }
  }
  const corners = [];
  for (const [vk, eg] of byVertex) {
    if (eg.length !== 3) continue;
    const [g1, g2, g3] = eg;
    if (Math.abs(g1.r - g2.r) > 1e-6 || Math.abs(g1.r - g3.r) > 1e-6) continue;
    // v1: only ~90° corners (all three face angles)
    if (!eg.every((g) => Math.abs(g.theta - Math.PI / 2) < 0.02)) continue;
    const P = g1.e.a === vk ? g1.P0 : g1.P1;
    const dOf = (g) => _c6Norm(_c6Sub(g.e.a === vk ? g.P1 : g.P0, P));
    const d = eg.map(dOf);
    if (_c6Len(_c6Cross(d[0], d[1])) < 0.5 || _c6Len(_c6Cross(d[1], d[2])) < 0.5
      || _c6Len(_c6Cross(d[2], d[0])) < 0.5) continue; // two edges nearly parallel
    const inwardOf = (a, b, third) => {
      const nrm = _c6Norm(_c6Cross(a, b));
      const dot = nrm[0] * third[0] + nrm[1] * third[1] + nrm[2] * third[2];
      return dot < 0 ? [-nrm[0], -nrm[1], -nrm[2]] : nrm;
    };
    const m = [inwardOf(d[0], d[1], d[2]), inwardOf(d[1], d[2], d[0]), inwardOf(d[2], d[0], d[1])];
    const r = g1.r;
    const O = [
      P[0] + r * (m[0][0] + m[1][0] + m[2][0]),
      P[1] + r * (m[0][1] + m[1][1] + m[2][1]),
      P[2] + r * (m[0][2] + m[1][2] + m[2][2]),
    ];
    const dist = _c6Len(_c6Sub(O, P));
    const dev = Math.abs(dist - r * Math.sqrt(3));
    if (dev > 1e-3 * r + 1e-6)
      throw new Error(`filletEdges: corner-cap incenter sanity failed (|O−P|=${dist}, want ${r * Math.sqrt(3)})`);
    const dot = (a, b) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
    const exact = dot(d[0], d[1]) < _C6_EXACT_CORNER_TOL
      && dot(d[1], d[2]) < _C6_EXACT_CORNER_TOL
      && dot(d[2], d[0]) < _C6_EXACT_CORNER_TOL
      && eg.every((g) => Math.abs(g.theta - Math.PI / 2) < _C6_EXACT_CORNER_TOL);
    corners.push({ vk, P, r, geoms: eg, d, m, O: exact ? [
      P[0] + r * (d[0][0] + d[1][0] + d[2][0]),
      P[1] + r * (d[0][1] + d[1][1] + d[2][1]),
      P[2] + r * (d[0][2] + d[1][2] + d[2][2]),
    ] : O, exact });
  }
  // An exact corner trims its edges to the junction plane, so each edge must
  // hold its caps: demote every corner on an edge that cannot.
  const caps = new Map(); // g → { A: cap|null, B: cap|null }
  const capOf = (g) => { if (!caps.has(g)) caps.set(g, { A: null, B: null }); return caps.get(g); };
  for (const c of corners) {
    if (!c.exact) continue;
    c.geoms.forEach((g, k) => {
      const slot = capOf(g);
      if (g.e.a === c.vk) slot.A = { corner: c, k }; else slot.B = { corner: c, k };
    });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [g, slot] of caps) {
      const need = (slot.A ? g.r : 0) + (slot.B ? g.r : 0);
      if (g.L > need + 1e-6) continue;
      for (const cap of [slot.A, slot.B]) {
        if (cap && cap.corner.exact) { cap.corner.exact = false; changed = true; }
      }
    }
    if (changed) {
      for (const slot of caps.values()) {
        if (slot.A && !slot.A.corner.exact) slot.A = null;
        if (slot.B && !slot.B.corner.exact) slot.B = null;
      }
    }
  }
  return { corners, caps };
}

/**
 * filletEdges(part, edges, radius, opts) — circular fillet of radius r on
 * a SET of straight convex edges.
 *   edges  = objects from convexEdges() (required: they carry the mesh
 *            indices this helper needs; edges from OTHER selections can
 *            still be filleted if the edge object has {a, b, va, vb}
 *            vertex data).
 *   radius = number (same r for all edges) OR number[] parallel to the
 *            edge list (per-edge radii).
 *   opts   = { sphericalCorners: true, relaxPlanar: false } —
 *            sphericalCorners rounds box-like (~90°, equal-radius) corners
 *            where THREE filleted edges meet (spherical patch / C1 junction).
 *            relaxPlanar (Slice C2 hard Accept) skips the curved-face planar
 *            assert so loft generators use per-segment rolling-ball cutters.
 * Returns the filleted part. v2: edges that chain into a CLOSED CIRCULAR
 * RUN (see block header) fillet as one exact revolved feature even though
 * each mesh segment is individually short (a tessellated circular rim).
 */
function filletEdges(part, edgesIn, radiusIn, opts = {}) {
  const M = manifoldModule.Manifold;
  // Arc tessellation. 96 segments left a measurable sliver: each flat facet
  // between chord vertices dips inward by r·(1−cos(π/96)) ≈ 1.07e-3 mm for
  // r=2, leaving a thin residual band of the original flat face along the
  // whole fillet (measured 4.5e-2 mm³ per 20 mm edge vs the analytic
  // circle-exact fillet). 384 segments cut that ~16x (2.7e-3 mm³) for a
  // trivial mesh cost (~400 tris per edge vs ~108).
  const SEGMENTS = FILLET_EDGES_CIRCLE_SEGMENTS;
  const sphericalCorners = !!opts.sphericalCorners;
  // Slice C2 hard path: skip local planar-adjacent assert so loft generators
  // can use the same parallelepiped−cylinder cutter per coherent segment.
  const relaxPlanar = !!opts.relaxPlanar;

  let edges = edgesIn;
  let radiusArr = radiusIn;
  // [{edge, radius}] form: auto-detect on the first entry
  if (Array.isArray(edgesIn) && edgesIn.length && edgesIn[0] && edgesIn[0].edge) {
    radiusArr = null;
    edges = edgesIn.map(x => x.edge);
    const perEdge = new Map();
    for (const x of edgesIn) perEdge.set(x.edge, x.radius);
    radiusArr = edges.map(e => perEdge.get(e));
  }
  if (!edges.length) return part;

  const radii = new Map(); // edge object -> r
  if (Array.isArray(radiusArr)) {
    if (radiusArr.length !== edges.length)
      throw new Error(`filletEdges: radius array length ${radiusArr.length} != edge count ${edges.length}`);
    edges.forEach((e, i) => {
      const rr = radiusArr[i];
      if (!(rr > 0)) throw new Error(`filletEdges: r must be > 0 (edge ${i}, got ${rr})`);
      radii.set(e, rr);
    });
  } else {
    const rr = radiusArr;
    if (!(rr > 0)) throw new Error(`filletEdges: r must be > 0 (got ${rr})`);
    for (const e of edges) radii.set(e, rr);
  }

  const mesh = _c6BuildMeshInfo(part);
  // Per-edge geometry ONCE (also validates every edge — same throws as v1,
  // same order), THEN run detection, THEN try the exact closed-circular-run
  // cutter per run; runs that don't fit one fall back to v1 per-edge.
  const geoms = edges.map(e => _c6EdgeGeom(M, part, mesh, e, radii.get(e), { relaxPlanar }));
  const runs = _c6DetectRuns(geoms);
  const runCutter = new Map(); // run -> cutter Manifold (only for successful closed runs)
  const runOf = new Array(edges.length);
  for (const run of runs) {
    run.idxs.forEach(i => { runOf[i] = run; });
    if (run.closed && run.idxs.length > 1) {
      const c = _c6ClosedRunCutter(M, manifoldModule, run, geoms);
      if (c) runCutter.set(run, c);
    }
  }
  const isHandled = (i) => runCutter.has(runOf[i]);


  // Planarity assert: SINGLETON and fallback edges only (v1 behaviour).
  // Successfully-fit closed circular runs skip it — the circle fit + on-
  // circle check IS the run-level validity proof; see block header.
  // Hard Accept (C2) passes relaxPlanar and skips this assert so generator
  // walls use per-segment rolling-ball cutters instead of loud-failing.
  for (let i = 0; i < edges.length; i++) {
    if (!geoms[i] || isHandled(i)) continue;
    if (!relaxPlanar) _c6AssertPlanarAtEdge(mesh, edges[i]);
  }

  const cutters = [];
  // per SINGLETON/fallback edge: { kA, kB, V0, V1, r, theta, cyl() } for the v1 corner caps
  const edgeGeom = [];
  const skippedShort = []; // {L, t} per SINGLETON/fallback edge skipped as a sliver
  const doneRuns = new Set();
  const live = []; // singleton / fallback edges past the size guard
  for (let i = 0; i < edges.length; i++) {
    const g = geoms[i];
    if (!g) continue;
    if (isHandled(i)) {
      const run = runOf[i];
      if (!doneRuns.has(run)) {
        doneRuns.add(run);
        cutters.push(runCutter.get(run));
      }
      continue;
    }
    if (g.t > 0.45 * g.L) {
      // SKIP, don't throw: short edges are tessellation slivers of a curved
      // arc (96/384-seg fillet/chamfer seams) that a filtered edge list
      // picks up alongside the real edge, OR a curved run that didn't fit
      // a clean circle (see block header) — filing one off would only add
      // noise, and one bad sliver must not kill the whole part.
      skippedShort.push({ L: +g.L.toFixed(4), t: +g.t.toFixed(4) });
      continue;
    }
    live.push(g);
  }
  // Spherical corners are decided before any cutter is built: an exact
  // right-angle corner trims its three edge cutters to the junction plane and
  // adds one pocket solid (mesh-built, see _c6CornerPocket); every other
  // triple corner keeps the v1 ball cut after the main subtract.
  const cornerInfo = sphericalCorners ? _c6TrihedralCorners(live) : { corners: [], caps: new Map() };
  for (const g of live) {
    const { e, P0, P1, L, d, f0, f1, theta, t, r } = g;
    // arc center line: interior bisector, distance r/sin(θ/2) from the edge
    const sLen = Math.hypot(f0[0]+f1[0], f0[1]+f1[1], f0[2]+f1[2]) || 1;
    const bis = [(f0[0]+f1[0])/sLen, (f0[1]+f1[1])/sLen, (f0[2]+f1[2])/sLen];
    const dC = r / Math.sin(theta / 2);
    const O0 = [P0[0] + dC*bis[0], P0[1] + dC*bis[1], P0[2] + dC*bis[2]];
    // cylinder: radius r, axis along the edge, centered on the bisector
    // line (1mm overshoot each end). Rows = local x,y,z axes (row-vector
    // convention, see frameToMatrix): x = f1, z = d, y = x̂z. The v1 cutter
    // is box − cyl; a prism-built edge only needs it for a v1 corner cap.
    const cyU = _c6Norm(_c6Cross(d, f1));
    const C = [O0[0] + (L/2)*d[0], O0[1] + (L/2)*d[1], O0[2] + (L/2)*d[2]];
    const mat = [
      f1[0], f1[1], f1[2], 0,
      cyU[0], cyU[1], cyU[2], 0,
      d[0],  d[1],  d[2],   0,
      C[0], C[1], C[2], 1,
    ];
    let cyl = null;
    const cylOf = () => {
      if (!cyl) cyl = M.cylinder(L + 2, r, r, SEGMENTS, true).transform(mat);
      return cyl;
    };
    const caps = cornerInfo.caps.get(g) || null;
    let cutter;
    if (caps && (caps.A || caps.B)) {
      cutter = _c6TrimmedEdgeCutter(M, g, caps.A, caps.B);
    } else {
      // parallelepiped spanned by t·f0 and t·f1, extruded along the edge
      const B = [];
      const push = _c6FacePush(r);
      for (const s of [g.freeA ? -push : 0, g.freeB ? L + push : L]) {
        const P = [P0[0]+s*d[0], P0[1]+s*d[1], P0[2]+s*d[2]];
        B.push(
          _c6PushOut(P, [f0, f1], push), // the edge point, out of both faces
          [P[0]+t*f0[0], P[1]+t*f0[1], P[2]+t*f0[2]],
          [P[0]+t*f1[0], P[1]+t*f1[1], P[2]+t*f1[2]],
          [P[0]+t*(f0[0]+f1[0]), P[1]+t*(f0[1]+f1[1]), P[2]+t*(f0[2]+f1[2])],
        );
      }
      const box = M.hull(B);
      cutter = M.difference(box, cylOf());
    }
    const seC = _c4StatusError(cutter);
    if (seC)
      throw new Error(`filletEdges: bad cutter (${seC})`);
    cutters.push(cutter);
    edgeGeom.push({ kA: e.a, kB: e.b, V0: P0, V1: P1, r, theta, cyl: cylOf, g });
  }
  for (const c of cornerInfo.corners) {
    if (!c.exact) continue;
    const pocket = _c6CornerPocket(M, c);
    // Face identity: the pocket's runs are the `<block>.corner` face. A
    // mesh-built solid reports originalID −1; its one run carries the id.
    try {
      const ids = pocket.getMesh().runOriginalID;
      for (let i = 0; i < ids.length; i++) _blendCornerIDs.add(ids[i]);
    } catch { /* no id: stays .round */ }
    cutters.push(pocket);
  }
  if (!cutters.length) {
    // Slice-01: never silently "succeed" with an unchanged part when the
    // caller asked for fillets. Empty edge list → no-op; non-empty with
    // zero cutters → loud failure (the old console.warn hid hole-rim misses).
    if (!edges.length) return part;
    const hint = skippedShort.length
      ? `all ${skippedShort.length} edges failed the size guard (t > 0.45·L); example t=${skippedShort[0].t} L=${skippedShort[0].L}`
      : 'no valid cutters (geometry/status rejected every edge)';
    throw new Error(
      `filletEdges: no edges could be filleted (${hint}). ` +
      `For circular rims pass convexEdges(part) unfiltered so closed-run detection can fire; or reduce r. ` +
      `Curved-face singleton fillets are unsupported.`,
    );
  }
  // Union cutters, subtract once: shared-corner overlaps counted once
  // (matches analytic inclusion-exclusion — see block header).
  let tool = cutters[0];
  for (let i = 1; i < cutters.length; i++) tool = M.union([tool, cutters[i]]);
  let out = M.difference(part, tool);
  const seOut = _c4StatusError(out);
  if (seOut) throw new Error(`filletEdges: bad result (${seOut})`);

  // ------------------------------------------------------------------
  // Optional: spherical corner caps. When THREE filleted edges meet at
  // one vertex, the three fillet "sails" converge to a sharp cusp point.
  // Cutting the corner hexahedron with a ball of radius r centered at
  // the trihedral incenter replaces the cusp with a spherical patch:
  //   - the incenter is equidistant r from all three faces → the patch
  //     is tangent to all three faces;
  //   - the incenter lies ON each fillet cylinder's axis at the same
  //     radius → the patch is tangent to each fillet sail ALONG A
  //     CIRCLE (C1-smooth junction).
  // Only applied to box-like (~90°) triple-vertex corners with equal
  // radii; other corners keep the cusp (v1 scope).
  // v1 path, kept for the near-90° corners _c6TrihedralCorners did not take:
  // cut the cusp pocket out of the already-filleted solid with a ball.
  if (sphericalCorners) {
    const caps = [];
    const geomOf = new Map(edgeGeom.map((row) => [row.g, row]));
    for (const c of cornerInfo.corners) {
      if (c.exact) continue;
      const eg = c.geoms.map((g) => geomOf.get(g)).filter(Boolean);
      if (eg.length !== 3) continue;
      const { P, r: r0 } = c;
      const [m12, m23, m31] = c.m;
      const O = c.O;
      const unitBall = M.sphere(r0, FILLET_EDGES_CORNER_SEGMENTS);
      // Face identity: the ball's runs are the `<block>.corner` face. Read
      // the id before the transform; a transformed manifold reports -1 while
      // its runs still carry the sphere's id.
      try { _blendCornerIDs.add(unitBall.originalID()); } catch { /* no id: stays .round */ }
      const ball = unitBall.transform(
        [1,0,0,0, 0,1,0,0, 0,0,1,0, O[0],O[1],O[2], 1]);
      // cap = (cornerBox ∩ cyl1 ∩ cyl2 ∩ cyl3) \ (ball ∩ cornerBox):
      //   cornerBox ∩ all three sails = material T left in the corner
      //     box by the three fillets; ball ∩ cornerBox = the IDEAL
      //     rounded corner (every octant point is inside all three sail
      //     cylinders, so the sphere IS the true CAD corner patch).
      //   T \ octant = the cusp pocket the plain fillets leave.
      // A zero coordinate puts the point on that face: push it out of it.
      const mkPt = (a, b, c) => _c6PushOut([
        P[0] + r0*(a*m12[0] + b*m23[0] + c*m31[0]),
        P[1] + r0*(a*m12[1] + b*m23[1] + c*m31[1]),
        P[2] + r0*(a*m12[2] + b*m23[2] + c*m31[2]),
      ], [a ? null : m12, b ? null : m23, c ? null : m31].filter(Boolean), _c6FacePush(r0));
      const cornerBox = M.hull([
        mkPt(0,0,0), mkPt(1,0,0), mkPt(0,1,0), mkPt(0,0,1),
        mkPt(1,1,0), mkPt(1,0,1), mkPt(0,1,1), mkPt(1,1,1),
      ]);
      let cap = cornerBox;
      for (const g of eg) cap = M.intersection(cap, g.cyl());
      const seCap = _c4StatusError(cap);
      if (seCap || cap.volume() < 1e-9)
        throw new Error(`filletEdges: bad corner material (${seCap || 'ok'}, vol ${cap.volume()})`);
      const octant = M.intersection(ball, cornerBox);
      const seOct = _c4StatusError(octant);
      if (seOct || octant.volume() < 1e-9)
        throw new Error(`filletEdges: bad corner octant (${seOct || 'ok'})`);
      cap = M.difference(cap, octant);
      const seCap2 = _c4StatusError(cap);
      if (seCap2 || cap.volume() < 1e-9)
        throw new Error(`filletEdges: bad corner cap (${seCap2 || 'ok'}, vol ${cap.volume()})`);
      caps.push(cap);
    }
    if (caps.length) {
      let capTool = caps[0];
      for (let i = 1; i < caps.length; i++) capTool = M.union([capTool, caps[i]]);
      out = M.difference(out, capTool);
      const seCapTool = _c4StatusError(out);
      if (seCapTool)
        throw new Error(`filletEdges: bad corner-cap result (${seCapTool})`);
    }
  }
  // Hard rolling-ball (relaxPlanar): loud-fail scrap rather than leave Area≈0
  // needles unlabeled — Auto-Run restores the prior solid; Undo still works.
  // Fail closed: scrap throw and any unexpected inspection fault must
  // propagate — never swallow unrecognized errors into `return out`.
  if (relaxPlanar) {
    const mOut = out.getMesh();
    const np = mOut.numProp || 3;
    const V = mOut.vertProperties;
    const T = mOut.triVerts;
    const nTri = T.length / 3;
    let tiny = 0;
    for (let ti = 0; ti < nTri; ti++) {
      const i0 = T[ti * 3] * np;
      const i1 = T[ti * 3 + 1] * np;
      const i2 = T[ti * 3 + 2] * np;
      const ax = V[i1] - V[i0], ay = V[i1 + 1] - V[i0 + 1], az = V[i1 + 2] - V[i0 + 2];
      const bx = V[i2] - V[i0], by = V[i2 + 1] - V[i0 + 1], bz = V[i2 + 2] - V[i0 + 2];
      const A = 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
      if (A < 1e-8) tiny++;
    }
    if (isFilletSliverDirty(tiny, nTri)) {
      throw new Error(
        `filletEdges: result has ${tiny}/${nTri} degenerate triangles (sliver scraps) — `
        + 'failing loud rather than shipping a dirty solid; try a different size',
      );
    }
  }
  return out;
}

// (X − P0) projected perpendicular to the edge direction, normalized.
function _c6InFaceDir(X, P0, d) {
  let v = [X[0]-P0[0], X[1]-P0[1], X[2]-P0[2]];
  const s = v[0]*d[0] + v[1]*d[1] + v[2]*d[2];
  v = [v[0]-s*d[0], v[1]-s*d[1], v[2]-s*d[2]];
  return _c6Norm(v);
}

// Per-triangle {vs, v, n, p0} + (vertex-pair) → triangle list map.
function _c6BuildMeshInfo(part) {
  const mesh = part.getMesh();
  const np = mesh.numProp;
  const V = [];
  for (let i = 0; i < mesh.triVerts.length / 3; i++)
    V.push([mesh.vertProperties[i*np], mesh.vertProperties[i*np+1], mesh.vertProperties[i*np+2]]);
  const tris = [];
  const pairMap = new Map();
  // Triangles touching a POSITION (a corner Manifold holds as several
  // vertex indices still reads as one corner).
  const atPoint = new Map();
  const pointKey = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
  for (let i = 0; i < mesh.numTri; i++) {
    const vs = [mesh.triVerts[i*3], mesh.triVerts[i*3+1], mesh.triVerts[i*3+2]];
    const v0 = V[vs[0]], v1 = V[vs[1]], v2 = V[vs[2]];
    let n = _c6Cross([v1[0]-v0[0], v1[1]-v0[1], v1[2]-v0[2]], [v2[0]-v0[0], v2[1]-v0[1], v2[2]-v0[2]]);
    if (Math.hypot(n[0], n[1], n[2]) < 1e-12) n = [0, 0, 1]; // degenerate tri
    tris.push({ vs, v: [v0, v1, v2], n: _c6Norm(n), p0: v0 });
    for (let k = 0; k < 3; k++) {
      const a = vs[k], b = vs[(k+1) % 3];
      const key = a < b ? a * 1e9 + b : b * 1e9 + a;
      if (!pairMap.has(key)) pairMap.set(key, []);
      pairMap.get(key).push(i);
      const pk = pointKey(V[a]);
      if (!atPoint.has(pk)) atPoint.set(pk, []);
      atPoint.get(pk).push(i);
    }
  }
  const trisAtPoint = (p) => atPoint.get(pointKey(p)) || [];
  return { tris, pairMap, trisAtPoint };
}

// Local planarity on each side of the edge: the edge triangle's plane must
// also hold for all same-face neighbor triangles (shared edge + normal
// within 3° of the edge triangle's). Deliberately local, NOT per faceID
// group (Manifold can merge faces from different planes into one group).
// Called for SINGLETON/fallback edges only (v2): a successfully-fit closed
// circular run skips this and relies on the circle fit + on-circle check
// instead — see the C6 block header for why (this probe throws on any
// tessellation finer than 3°/facet, which is exactly what a genuine
// curved run looks like).
const _C6_COS3DEG = Math.cos(3 * Math.PI / 180);
function _c6AssertPlanarAtEdge(mesh, e) {
  const { tris, pairMap } = mesh;
  const key = e.a < e.b ? e.a * 1e9 + e.b : e.b * 1e9 + e.a;
  const ti = pairMap.get(key);
  if (!ti || ti.length !== 2)
    throw new Error('filletEdges: edge not found in mesh (stale selection?)');
  for (const idx of [0, 1]) {
    const A = tris[ti[idx]];
    const refN = A.n, refP0 = A.p0;
    for (let k = 0; k < 3; k++) {
      const a = A.vs[k], b = A.vs[(k+1) % 3];
      const nk = a < b ? a * 1e9 + b : b * 1e9 + a;
      if (nk === key) continue; // the fillet edge itself
      const nti = pairMap.get(nk);
      if (!nti) continue;
      for (const tidx of nti) {
        if (tidx === ti[idx] || tidx === ti[1 - idx]) continue;
        const T = tris[tidx];
        const dot = T.n[0]*refN[0] + T.n[1]*refN[1] + T.n[2]*refN[2];
        if (dot <= _C6_COS3DEG) continue; // different face (3rd face at a corner)
        for (const v of T.v) {
          const dev = (v[0]-refP0[0])*refN[0] + (v[1]-refP0[1])*refN[1] + (v[2]-refP0[2])*refN[2];
          if (Math.abs(dev) > 1e-3)
            throw new Error('filletEdges: adjacent face is not planar at this edge (curved-face fillet not supported)');
        }
      }
    }
  }
}

// ------------------------------------------------------------------ revolve / extrude (C8)
// Manifold requires a very specific contour winding (outer CCW, holes CW)
// and fails SILENTLY when it's wrong: status 'InvalidConstruction', volume
// 0, no exception. That's how C8 produced "empty geometry" parts with no
// actionable error. These helpers normalize winding, drop an explicit
// closing point, and throw a loud, fixable error if the build is still
// invalid — so the LLM loop gets a real correction instead of "no geometry".
function _c8ContourArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
function _c8NormalizeContours(contours) {
  // Accept both makeRevolve([outer, hole]) and makeRevolve(outerPoints).
  if (!Array.isArray(contours) || !contours.length || !Array.isArray(contours[0]))
    throw new Error('makeRevolve/makeExtrude: expected an array of contours (array of [x,y] point arrays)');
  if (typeof contours[0][0] === 'number') contours = [contours]; // bare point list
  const cleaned = contours.map(pts => {
    const p = pts.map(v => [v[0], v[1]]);
    const f = p[0], l = p[p.length - 1];
    if (p.length > 3 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-9) p.pop(); // explicit close
    return p;
  });
  for (const p of cleaned)
    if (p.length < 3)
      throw new Error('makeRevolve/makeExtrude: every contour needs >= 3 distinct points — the profile is not closed');
  // outermost = largest |area| must be CCW; all others are holes -> CW.
  const order = cleaned.map((p, i) => i)
    .sort((a, b) => Math.abs(_c8ContourArea(cleaned[b])) - Math.abs(_c8ContourArea(cleaned[a])));
  return order.map((idx, rank) => {
    const p = cleaned[idx];
    if (_c8ContourArea(p) < 0 === (rank === 0)) return p.slice().reverse();
    return p;
  });
}
function _c8CheckValid(m, what) {
  // Build-tolerant status check: the npm `manifold-3d` returns the string
  // 'NoError' for valid manifolds, but the bundled `built/manifold.js`
  // (what the browser worker loads) returns an opaque {} for EVERYTHING.
  // So only treat a NON-STRING non-NoError status as an error; when status()
  // is an object (bundled build) the volume check below is the real
  // degeneracy guard (verified: valid → real volume, bad profile → 0).
  const se = _c4StatusError(m);
  if (se)
    throw new Error(`${what}: invalid result (status ${se}) — the profile must be a closed polygon; for revolve: x >= 0 (radial), y = height around the axis`);
  if (m.volume() <= 1e-9)
    throw new Error(`${what}: result is EMPTY (volume 0) — check the profile has real area and (for revolve) does not sit on the axis`);
  return m;
}
/**
 * makeRevolve(contours, segments=96, degrees=360) — revolve a 2D profile
 * around its Y axis (result's axis = Z). contours = [[x,y]...] outer first
 * + optional holes; winding is normalized automatically; throws loudly on
 * an invalid profile instead of returning a silent empty manifold.
 * Profile: x = radial (>= 0), y = height along the axis.
 * If polygons cross the Y-axis, only the positive-X side is used.
 */
function makeRevolve(contours, segments = 96, degrees = 360) {
  const { CrossSection } = manifoldModule;
  const loops = _c8NormalizeContours(contours);
  const cs = new CrossSection(loops);
  const segs = Number(segments);
  if (!(segs >= 3) || !Number.isFinite(segs)) {
    throw new Error('makeRevolve: segments must be >= 3');
  }
  const deg = degrees == null ? 360 : Number(degrees);
  if (!(deg > 0) || !Number.isFinite(deg) || deg > 360) {
    throw new Error('makeRevolve: angle must be > 0 and ≤ 360');
  }
  return _stampRevolve(_c8CheckValid(cs.revolve(Math.round(segs), deg), 'makeRevolve'), loops, deg);
}
/**
 * makeExtrude(contours, height) — extrude a 2D profile by `height` along Z.
 * Same contour rules as makeRevolve (outer CCW + CW holes, auto-normalized).
 */
function makeExtrude(contours, height) {
  const { CrossSection } = manifoldModule;
  const loops = _c8NormalizeContours(contours);
  const cs = new CrossSection(loops);
  return _stampExtrude(_c8CheckValid(cs.extrude(height), 'makeExtrude'), loops, Number(height));
}

/**
 * Sheet thickness and bend radius for the fillet span. Set when the script
 * builds a sheet, cleared around each executeScript so a later box fillet
 * does not inherit it. Same numbers as sheetCutExtrudeSpan.
 */
let _sheetFilletSpan = null;

/**
 * sheetMetalSolid(spec) — SendCutSend sheet-metal part from its JSON spec
 * (base flange, bends, tabs, holes, automatic corner reliefs). Written by
 * Sheet Metal mode inside the sheet-metal markers; see utils/sheetMetal.
 */
function sheetMetalSolid(spec) {
  const { Manifold, CrossSection } = manifoldModule;
  const solid = _c8CheckValid(buildSheetMetalSolid(Manifold, CrossSection, spec), 'sheetMetalSolid');
  const t = Number(spec && spec.t);
  const bendR = Number(spec && spec.r);
  if (t > 0) {
    let angle = 0;
    const bends = spec && Array.isArray(spec.bends) ? spec.bends : [];
    for (const b of bends) {
      const a = Math.abs(Number(b && b.angle) || 0);
      if (a > angle) angle = a;
    }
    _sheetFilletSpan = { t, bendR: bendR > 0 ? bendR : 0, angle: angle > 0 ? angle : 90 };
  }
  return solid;
}

/**
 * makeLoft(sections, opts?) — loft two or more profiles on parallel or angled planes.
 * Parallel planes (same workplane + offset along the normal): result is
 * local (z=0 at the lowest station). Confirm places it with placeInFrame.
 * Ring and slice counts follow a chordal tolerance of the part size, so
 * straight spans stay coarse and corners stay sharp. opts.resolution, when
 * set, caps the polar gap at 2π/N. A circle does not spin the other profile.
 * Angled planes: each profile is mapped through its own frame and carried
 * on a spine between the planes. The solid is local to the first profile.
 * Loud-fail on <2 profiles, coincident stations, a self-intersecting turn,
 * or empty volume. Legacy loft({ topCS, bottomCS, height }) is unchanged.
 */
function makeLoft(sections, opts = {}) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  const { Manifold, CrossSection, Mesh } = manifoldModule;
  const identity = {};
  const out = _c8CheckValid(
    buildMakeLoftSolid(Manifold, CrossSection, sections, { ...opts, Mesh, identity }),
    'makeLoft',
  );
  return _stampLoft(out, identity);
}


// ---------------------------------------------------------------- Slice 21 cross-section substrate
// Reusable plane + 2D profile value for later edge→sweep / fillet-via-sweep /
// extrude-revolve-loft siblings. Plain object (no class inheritance).
// Contours are in plane UV; plane is a workplaneFromFace frame.
function _xsRequirePlane(plane, what) {
  if (!plane || !plane.center || !plane.normal || !plane.x || !plane.y) {
    throw new Error(`${what}: plane must come from workplaneFromFace (needs center/normal/x/y)`);
  }
}
function _xsContourArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
function _xsNormalizeLoop(points, what) {
  if (!Array.isArray(points) || points.length < 3)
    throw new Error(`${what}: need ≥ 3 points for a closed polyline`);
  const p = points.map(v => [Number(v[0]), Number(v[1])]);
  if (p.some(v => !Number.isFinite(v[0]) || !Number.isFinite(v[1])))
    throw new Error(`${what}: points must be finite [u,v]`);
  const f = p[0], l = p[p.length - 1];
  if (p.length > 3 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-9) p.pop();
  if (p.length < 3) throw new Error(`${what}: need ≥ 3 distinct points`);
  if (Math.abs(_xsContourArea(p)) < 1e-12)
    throw new Error(`${what}: degenerate profile (zero area)`);
  if (_xsContourArea(p) < 0) p.reverse();
  return p;
}
/**
 * profileCircle(radius, segments=32) → { type:'circle', radius, segments, contours }
 * Contours centered at UV origin — enough for basic extrude / future fillet.
 */
function profileCircle(radius, segments = 32) {
  _c4RequirePositive('profileCircle', 'radius', radius);
  const seg = Math.max(3, Math.round(segments || 32));
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    pts.push([radius * Math.cos(t), radius * Math.sin(t)]);
  }
  return { type: 'circle', radius, segments: seg, contours: [pts] };
}
/**
 * profileRectangle(width, height, centered=true) → rectangle profile in UV.
 */
function profileRectangle(width, height, centered = true) {
  _c4RequirePositive('profileRectangle', 'width', width);
  _c4RequirePositive('profileRectangle', 'height', height);
  let pts;
  if (centered) {
    const hw = width / 2, hh = height / 2;
    pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  } else {
    pts = [[0, 0], [width, 0], [width, height], [0, height]];
  }
  return { type: 'rectangle', width, height, centered: !!centered, contours: [pts] };
}
/**
 * profilePolygon(points) → closed polyline/polygon profile in UV.
 * Accepts ≥3 [u,v] points (explicit close optional). Winding normalized CCW.
 */
function profilePolygon(points) {
  const pts = _xsNormalizeLoop(points, 'profilePolygon');
  return { type: 'polygon', points: pts, contours: [pts] };
}
/**
 * makeCrossSection(plane, profile) → reusable { kind, plane, profile, contours }.
 * plane: workplaneFromFace frame. profile: profileCircle/Rectangle/Polygon result,
 * or { type, ... }, a { type:'path', points, closed } wire (two or more [u,v],
 * zero area allowed), or bare contours / point list (same rules as makeExtrude).
 * Does NOT extrude/sweep — substrate only for later slices.
 */
function makeCrossSection(plane, profile) {
  _xsRequirePlane(plane, 'makeCrossSection');
  let desc;
  let contours;
  if (profile && typeof profile === 'object' && profile.type && Array.isArray(profile.contours)) {
    desc = { type: profile.type };
    for (const k of Object.keys(profile)) {
      // References stay on the contour statement. They are not profile rings.
      if (k === 'contours' || k === 'refs' || k === 'polyline') continue;
      desc[k] = profile[k];
    }
    contours = profile.contours.map(loop => _xsNormalizeLoop(loop, 'makeCrossSection'));
  } else if (profile && typeof profile === 'object' && profile.type === 'circle') {
    const built = profileCircle(profile.radius, profile.segments);
    desc = { type: 'circle', radius: built.radius, segments: built.segments };
    contours = built.contours;
  } else if (profile && typeof profile === 'object' && profile.type === 'rectangle') {
    const built = profileRectangle(profile.width, profile.height, profile.centered !== false);
    desc = { type: 'rectangle', width: built.width, height: built.height, centered: built.centered };
    contours = built.contours;
  } else if (profile && typeof profile === 'object' && profile.type === 'polygon' && profile.points) {
    const built = profilePolygon(profile.points);
    desc = { type: 'polygon', points: built.points };
    contours = built.contours;
  } else if (profile && typeof profile === 'object' && profile.type === 'path' && Array.isArray(profile.points)) {
    // Open sweep wire. Two points and zero area are legal. Do not close,
    // reverse, or run the closed-loop area check.
    if (profile.points.length < 2) {
      throw new Error('makeCrossSection: a path needs at least 2 points');
    }
    const pts = profile.points.map(v => {
      if (!Array.isArray(v) || v.length < 2) {
        throw new Error('makeCrossSection: path points must be finite [u, v]');
      }
      const u = Number(v[0]);
      const vv = Number(v[1]);
      if (!Number.isFinite(u) || !Number.isFinite(vv)) {
        throw new Error('makeCrossSection: path points must be finite [u, v]');
      }
      return [u, vv];
    });
    desc = { type: 'path', closed: !!profile.closed, points: pts };
    contours = [pts];
  } else if (Array.isArray(profile)) {
    // bare point list or contours array — reuse C8 normalizer shape rules
    const cleaned = _c8NormalizeContours(profile);
    contours = cleaned;
    desc = { type: 'polygon', points: cleaned[0] };
  } else {
    throw new Error(
      'makeCrossSection: profile must be profileCircle/profileRectangle/profilePolygon, '
      + 'solveContour, a { type } descriptor, a { type: \'path\' } wire, or a contours / point list'
    );
  }
  return {
    kind: 'crossSection',
    plane: {
      center: plane.center.slice(),
      normal: plane.normal.slice(),
      x: plane.x.slice(),
      y: plane.y.slice(),
    },
    profile: desc,
    contours,
  };
}

/**
 * makeSweepPath(edges, opts?) → reusable ordered sweep path / wire.
 * edges: feature / convexEdges-style {a,b,va,vb,...} (selection or query).
 * Soft topology: empty / disconnected / branched → loud Error (UI soft-fails before insert).
 * Recovers the largest simple component when the set is mostly one chain + strays.
 * Does NOT sweep a cutter — path value only (consume later via sweepPoints / fillet-via-sweep).
 */
function makeSweepPath(edges, opts = {}) {
  // An edge SET: every connected chain or loop, with Y/T junctions split into
  // chains. One component is the plain path. Several come back as the
  // longest one (so sweep / sweepPoints behave as before) with `components`
  // carrying every chain for filletAlongPath, which fillets them all.
  const set = assembleSweepPathSet(edges, opts);
  if (set.ok) return set.value;
  const r = set;
  if (r.code === 'empty') {
    const noUsable = /usable|endpoint/i.test(r.message || '');
    throw new Error(
      noUsable
        ? 'makeSweepPath: no usable edges (need va/vb endpoints)'
        : 'makeSweepPath: need at least one edge — pick edges in Edge mode (Tangent for circular rims)',
    );
  }
  throw new Error(`makeSweepPath: could not order edges into a path${r.message ? ` — ${r.message}` : ''}`);
}

// ---------------------------------------------------------------- Slice 23 fillet via swept cross-section
// Unlock fillets on compound / curved-adjacent edges by sweeping a quarter-circle
// (or chamfer triangle) cutter along makeSweepPath and boolean-subtracting.
// Path is a LINEAR polyline (edge wire) — Catmull-Rom bulges off chords and left
// purple sliver scraps. Planar–planar uses filletEdges only when UI Strategy=planar.
// Extrude/revolve/loft FEAT tools live in contour mode (Slices 25/26/28).
function _s23Norm(v) {
  const L = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / L, v[1] / L, v[2] / L];
}
function _s23Sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function _s23Cross(a, b) {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function _s23Dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

/** Fillet wedge contour: square−quarterDisk@ (r,r). Chamfer: right triangle. */
function _s23WedgeContour(radius, profile, arcSegments) {
  const r = Number(radius);
  if (!(r > 0) || !Number.isFinite(r)) {
    throw new Error('filletAlongPath: radius must be > 0');
  }
  if (profile === 'chamfer') {
    return [[0, 0], [r, 0], [0, r]];
  }
  const seg = Math.max(2, Math.round(Number(arcSegments) || 12));
  const pts = [[0, 0], [r, 0]];
  for (let i = 1; i <= seg; i++) {
    const t = (i / seg) * (Math.PI / 2);
    pts.push([r - r * Math.sin(t), r - r * Math.cos(t)]);
  }
  return pts;
}

/**
 * Normalize path → { points, closed, length }. Loud on bad input.
 */
function _s23NormalizePath(path, opts) {
  if (!path) throw new Error('filletAlongPath: path is required (makeSweepPath result or points[])');
  let points;
  let closed = !!(opts && opts.closed);
  if (Array.isArray(path)) {
    points = path;
  } else if (typeof path === 'object') {
    if (path.kind && path.kind !== 'sweepPath') {
      throw new Error(`filletAlongPath: unexpected path.kind "${path.kind}" (want sweepPath)`);
    }
    if (!Array.isArray(path.points)) {
      throw new Error('filletAlongPath: path.points must be an array of [x,y,z]');
    }
    points = path.points;
    if (path.closed != null) closed = !!path.closed;
  } else {
    throw new Error('filletAlongPath: path must be makeSweepPath result or points[]');
  }
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('filletAlongPath: path needs ≥ 2 points');
  }
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Array.isArray(p) || p.length < 3) {
      throw new Error(`filletAlongPath: point[${i}] must be [x,y,z]`);
    }
    const x = Number(p[0]), y = Number(p[1]), z = Number(p[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`filletAlongPath: point[${i}] has non-finite coords`);
    }
    if (out.length) {
      const prev = out[out.length - 1];
      if (Math.hypot(x - prev[0], y - prev[1], z - prev[2]) < 1e-9) continue;
    }
    out.push([x, y, z]);
  }
  if (out.length < 2) throw new Error('filletAlongPath: path collapsed to < 2 distinct points');
  if (closed && out.length > 2) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-5) out.pop();
  }
  if (closed && out.length < 3) {
    throw new Error('filletAlongPath: closed path needs ≥ 3 distinct points');
  }
  let length = 0;
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i], b = out[i + 1];
    length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  if (closed) {
    const a = out[out.length - 1], b = out[0];
    length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  if (!(length > 1e-9)) throw new Error('filletAlongPath: path has zero length');
  return { points: out, closed, length };
}

/**
 * Probe in-face directions at path start from the part mesh (no planarity assert —
 * curved-adjacent faces are the point of this helper). Returns { T, f0, f1 } or null.
 */
function _s23ProbeFrame(M, part, points) {
  const p0 = points[0];
  const p1 = points[1];
  const T = _s23Norm(_s23Sub(p1, p0));
  const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];

  // Prefer convexEdges mid match — carries {a,b,va,vb} for mesh lookup.
  let best = null;
  let bestD = Infinity;
  try {
    const edges = convexEdges(part);
    for (const e of edges) {
      if (!e || !Array.isArray(e.va) || !Array.isArray(e.vb)) continue;
      const em = Array.isArray(e.mid)
        ? e.mid
        : [(e.va[0] + e.vb[0]) / 2, (e.va[1] + e.vb[1]) / 2, (e.va[2] + e.vb[2]) / 2];
      const d = Math.hypot(em[0] - mid[0], em[1] - mid[1], em[2] - mid[2]);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
  } catch (_) {
    best = null;
  }
  // Tolerance: half segment length or 0.5mm floor
  const segL = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) || 1;
  if (!best || bestD > Math.max(0.5, 0.55 * segL)) {
    return null;
  }

  const mesh = _c6BuildMeshInfo(part);
  const eKey = best.a < best.b ? best.a * 1e9 + best.b : best.b * 1e9 + best.a;
  const ti = mesh.pairMap.get(eKey);
  if (!ti || ti.length !== 2) return null;

  const P0 = best.va;
  const thirdVertex = (tri) => {
    for (let k = 0; k < 3; k++) {
      if (tri.vs[k] !== best.a && tri.vs[k] !== best.b) return tri.v[k];
    }
    return null;
  };
  const X0 = thirdVertex(mesh.tris[ti[0]]);
  const X1 = thirdVertex(mesh.tris[ti[1]]);
  if (!X0 || !X1) return null;
  const [nA, nB] = _c6EdgeTriNormals(best, mesh.tris[ti[0]], mesh.tris[ti[1]]);
  const eDir = _s23EdgeDirAlong(best, T);
  const f0 = _c6InFaceDirSafe(X0, P0, T, nA, nB, eDir);
  const f1 = _c6InFaceDirSafe(X1, P0, T, nB, nA, eDir);
  // Convexity: ball at mid should be mostly outside (same criterion as filletEdges).
  const rProbe = Math.min(0.05, segL * 0.25);
  const sp = M.sphere(rProbe, 12, 6).transform(
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, mid[0], mid[1], mid[2], 1],
  );
  const fIn = M.intersection(part, sp).volume() / sp.volume();
  if (fIn >= 0.45) {
    throw new Error('filletAlongPath: edge is concave (sweep fillet is external / material-remove only)');
  }
  return { T, f0, f1, mid };
}

/**
 * When the closed path fits a circle, build the fillet cutter by revolving the
 * 2D wedge in the meridian plane (same idea as C6 closed-run). Avoids closed
 * extrude+warp RMF seams that leave purple sliver sheets.
 * Returns null if the path is not a clean circle.
 */
function _s23TryRevolveCutter(CrossSection, points, radius, profileKind, arcSegs, probed) {
  if (!points || points.length < 6) return null;
  const n = points.length;
  const fit = _c6FitCircle3(points[0], points[Math.floor(n / 3)], points[Math.floor((2 * n) / 3)]);
  if (!fit) return null;
  const { center: C, normal: N, radius: R } = fit;
  if (!(R > 1e-6)) return null;
  const tol = Math.max(0.02 * R, 0.05);
  for (let k = 0; k < n; k++) {
    const rel = _s23Sub(points[k], C);
    const z = _s23Dot(rel, N);
    const rhoVec = _s23Sub(rel, [z * N[0], z * N[1], z * N[2]]);
    const rho = Math.hypot(rhoVec[0], rhoVec[1], rhoVec[2]);
    if (Math.abs(z) > tol || Math.abs(rho - R) > tol) return null;
  }
  // Meridian frame at points[0]
  const rel0 = _s23Sub(points[0], C);
  const z0 = _s23Dot(rel0, N);
  const rhoHat = _s23Norm(_s23Sub(rel0, [z0 * N[0], z0 * N[1], z0 * N[2]]));
  const yHat = _s23Norm(_s23Cross(N, rhoHat));

  // Map in-face rays into meridian (ρ, z). Prefer probed f0/f1.
  const to2d = (v) => [_s23Dot(v, rhoHat), _s23Dot(v, N)];
  let f0 = probed && probed.f0 ? probed.f0 : rhoHat.map((x) => -x); // into top ≈ -radial for outer rim
  let f1 = probed && probed.f1 ? probed.f1 : N.map((x) => -x); // into wall ≈ -axis for top rim
  let f0_2d = to2d(f0);
  let f1_2d = to2d(f1);
  let f0Len = Math.hypot(f0_2d[0], f0_2d[1]);
  let f1Len = Math.hypot(f1_2d[0], f1_2d[1]);
  if (f0Len < 0.85 || f1Len < 0.85) {
    // Fallback for axisymmetric top rim: -ρ and -N
    f0_2d = [-1, 0];
    f1_2d = [0, -1];
  } else {
    f0_2d = [f0_2d[0] / f0Len, f0_2d[1] / f0Len];
    f1_2d = [f1_2d[0] / f1Len, f1_2d[1] / f1Len];
  }
  // Ensure first-quadrant wedge maps into the solid (both axes point "inward")
  // If either axis points outward in ρ, flip.
  // Place wedge origin at (R, 0) in a local meridian where z'=0 at the rim.
  // Orthonormal meridian axes. A 90° rim (f0 ⟂ f1) matches the old
  // u·f0+v·f1 map; a non-orthogonal rim uses the dihedral contour instead
  // of shearing a quarter-circle through non-orthogonal axes.
  const e0 = f0_2d;
  const proj = f1_2d[0] * e0[0] + f1_2d[1] * e0[1];
  let e1x = f1_2d[0] - proj * e0[0];
  let e1y = f1_2d[1] - proj * e0[1];
  const e1L = Math.hypot(e1x, e1y);
  if (e1L < 1e-6) return null;
  e1x /= e1L;
  e1y /= e1L;
  const cth = Math.max(-1, Math.min(1, f0_2d[0] * f1_2d[0] + f0_2d[1] * f1_2d[1]));
  const theta = Math.acos(cth);
  if (theta < 0.05 || theta > Math.PI - 0.05) return null;
  let wedge;
  try {
    const nominal = profileKind === 'chamfer'
      ? dihedralChamferContour(radius, theta)
      : dihedralFilletContour(radius, theta, arcSegs);
    wedge = expandDihedralCutterContour(nominal, radius, theta);
  } catch (_) {
    return null;
  }
  const mapped = [];
  for (const [u, v] of wedge) {
    const rho = R + u * e0[0] + v * e1x;
    const zRel = u * e0[1] + v * e1y;
    mapped.push([rho, zRel]);
  }
  // Ensure CCW in (ρ,z)
  let a2 = 0;
  for (let i = 0; i < mapped.length; i++) {
    const a = mapped[i], b = mapped[(i + 1) % mapped.length];
    a2 += a[0] * b[1] - b[0] * a[1];
  }
  if (a2 < 0) mapped.reverse();
  // Must stay ρ≥0
  for (const p of mapped) {
    if (p[0] < 1e-6) {
      throw new Error('filletAlongPath: fillet radius too large for this rim (would revolve through the axis)');
    }
  }
  const REVOLVE_SEGS = n; // phase-lock with tessellation (see C6)
  const cs = new CrossSection([mapped]);
  let solid;
  try {
    solid = cs.revolve(REVOLVE_SEGS);
  } catch (e) {
    return null;
  }
  // Shift so zRel=0 lies at the rim height along N, then frame to world.
  // mapped uses zRel about the rim; rim world = C + R*rhoHat + z0*N, and
  // revolve is about Y in CrossSection... Manifold revolve: profile x=radial, y=height → axis Z.
  // Our CrossSection (ρ, zRel) revolved → solid with axis Z. Transform to world:
  // x_axis = rhoHat, y_axis = yHat, z_axis = N, origin = C + z0*N
  // frameToMatrix expects {center, x, y, normal} where normal is Z.
  const origin = [C[0] + z0 * N[0], C[1] + z0 * N[1], C[2] + z0 * N[2]];
  const mat = frameToMatrix({ center: origin, x: rhoHat, y: yHat, normal: N });
  return solid.transform(mat);
}

/**
 * Linear polyline path for fillet sweep (NOT Catmull-Rom).
 * Catmull-Rom bulges off mesh chords / rounds corners and leaves thin purple
 * cutter scraps after boolean subtract — follow the edge wire exactly.
 */
function _s23PolylinePath(points, closed) {
  const n = points.length;
  const segCount = closed ? n : Math.max(1, n - 1);
  const segLens = [];
  let total = 0;
  for (let i = 0; i < segCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    segLens.push(L);
    total += L;
  }
  if (!(total > 1e-12)) {
    throw new Error('filletAlongPath: polyline path has zero length');
  }
  const cum = [0];
  for (const L of segLens) cum.push(cum[cum.length - 1] + L);

  const atS = (s) => {
    const ss = Math.max(0, Math.min(total, s));
    let i = 0;
    while (i < segCount - 1 && cum[i + 1] < ss - 1e-12) i++;
    const L = segLens[i] || 1;
    const local = (ss - cum[i]) / L;
    const a = points[i];
    const b = points[(i + 1) % n];
    return {
      p: [
        a[0] + local * (b[0] - a[0]),
        a[1] + local * (b[1] - a[1]),
        a[2] + local * (b[2] - a[2]),
      ],
      i,
    };
  };

  return {
    position: (t) => atS(Math.max(0, Math.min(1, t)) * total).p,
    derivative: (t) => {
      const { i } = atS(Math.max(0, Math.min(1, t)) * total);
      const a = points[i];
      const b = points[(i + 1) % n];
      const L = segLens[i] || 1;
      // dpos/dt = tangent * totalLength (t ∈ [0,1] arc-length fraction)
      return [
        ((b[0] - a[0]) / L) * total,
        ((b[1] - a[1]) / L) * total,
        ((b[2] - a[2]) / L) * total,
      ];
    },
    tMin: 0,
    tMax: 1,
  };
}


const _S23_THETA_TOL = (3 * Math.PI) / 180;

function _s23CarryFrame(src, T) {
  const Tn = _s23Norm(T);
  let N = _s23Sub(src.N, [
    _s23Dot(src.N, Tn) * Tn[0],
    _s23Dot(src.N, Tn) * Tn[1],
    _s23Dot(src.N, Tn) * Tn[2],
  ]);
  if (Math.hypot(N[0], N[1], N[2]) < 1e-8) N = src.N.slice();
  else N = _s23Norm(N);
  let B = _s23Norm(_s23Cross(Tn, N));
  if (_s23Dot(B, src.B) < 0) {
    N = [-N[0], -N[1], -N[2]];
    B = [-B[0], -B[1], -B[2]];
  }
  return { N, B, theta: src.theta, f0: src.f0, f1: src.f1, T: Tn };
}

/** cos 2°: the matched edge must run within this of the segment to lend its direction. */
const _S23_EDGE_DIR_MIN_COS = Math.cos((2 * Math.PI) / 180);

/** Unit direction of a mesh edge, signed to run with `T` (falls back to T). */
function _s23EdgeDirAlong(edge, T) {
  const d = _s23Sub(edge.vb, edge.va);
  const L = Math.hypot(d[0], d[1], d[2]);
  if (!(L > 1e-9)) return T;
  const u = [d[0] / L, d[1] / L, d[2] / L];
  const c = _s23Dot(u, T);
  // Only a matched edge that runs WITH the segment: a loose mid match onto a
  // crossing seam must not lend its direction.
  if (Math.abs(c) < _S23_EDGE_DIR_MIN_COS) return T;
  return c < 0 ? [-u[0], -u[1], -u[2]] : u;
}

function _s23NearestMatched(raw, i, closed) {
  for (let d = 1; d < raw.length; d++) {
    const idxs = closed
      ? [(i - d + raw.length) % raw.length, (i + d) % raw.length]
      : [i - d, i + d].filter((k) => k >= 0 && k < raw.length);
    for (const k of idxs) {
      if (raw[k].matched) return raw[k];
    }
  }
  return null;
}

/**
 * In-face frame at every path segment. One convexEdges pass + one mesh info.
 * Smooth G1 bridges are not convex edges: they keep the neighboring dihedral
 * frame. Throws when no segment matches, the edge is concave, or θ is
 * degenerate — a 90° start-frame fallback is the acute-edge hook.
 */
function _s23ProbeSegments(part, points, closed) {
  const edges = _s23ProbeFeatureEdges(part);
  const mesh = _c6BuildMeshInfo(part);
  const n = points.length;
  const segCount = closed ? n : n - 1;
  const raw = [];
  for (let i = 0; i < segCount; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % n];
    const segL = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const T = _s23Norm(_s23Sub(p1, p0));
    const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    let best = null;
    let bestScore = Infinity;
    let bestD = Infinity;
    for (const e of edges) {
      if (!e || !Array.isArray(e.va) || !Array.isArray(e.vb)) continue;
      const em = [(e.va[0] + e.vb[0]) / 2, (e.va[1] + e.vb[1]) / 2, (e.va[2] + e.vb[2]) / 2];
      const d = Math.hypot(em[0] - mid[0], em[1] - mid[1], em[2] - mid[2]);
      // Prefer edges whose chord aligns with the path tangent. On a fillet-on-
      // fillet wrap, dense path samples sit near prior-blend seams whose mids
      // can be closer than the true rim edge but run the wrong direction —
      // matching those left vertical fin-slivers at rounded corners.
      const eT = _s23Norm(_s23Sub(e.vb, e.va));
      const align = Math.abs(_s23Dot(eT, T)); // 1 = parallel, 0 = perpendicular
      // Distance primary; misalignment adds a penalty in mm-equivalent units.
      const score = d + (1 - align) * Math.max(0.55, 0.35 * (segL || 1));
      if (score < bestScore - 1e-12 || (Math.abs(score - bestScore) <= 1e-12 && d < bestD)) {
        bestScore = score;
        bestD = d;
        best = e;
      }
    }
    // Densified variable-profile knots are shorter than mesh edges — allow a
    // slightly looser mid match so loft generators still pick up local walls.
    const hit = best && bestD <= Math.max(0.85, Math.max(0.55 * (segL || 1), 0.35));
    raw.push({ p0, p1, T, length: segL, mid, best: hit ? best : null, matched: false });
  }

  const thirdVertex = (tri, edge) => {
    for (let k = 0; k < 3; k++) {
      if (tri.vs[k] !== edge.a && tri.vs[k] !== edge.b) return tri.v[k];
    }
    return null;
  };

  let prevN = null;
  for (const seg of raw) {
    if (!seg.best) continue;
    const best = seg.best;
    const eKey = best.a < best.b ? best.a * 1e9 + best.b : best.b * 1e9 + best.a;
    const ti = mesh.pairMap.get(eKey);
    if (!ti || ti.length !== 2) continue;
    const X0 = thirdVertex(mesh.tris[ti[0]], best);
    const X1 = thirdVertex(mesh.tris[ti[1]], best);
    if (!X0 || !X1) continue;
    // Read the in-face rays against the matched MESH edge, not the path
    // segment. A knot off the resampled corner arc tilts the next straight
    // leg's segment ~0.015° off its edge; against a sliver third vertex
    // (0.004 mm off a 16 mm edge) that tilt alone swung the ray 45°.
    const [nA, nB] = _c6EdgeTriNormals(best, mesh.tris[ti[0]], mesh.tris[ti[1]]);
    const eDir = _s23EdgeDirAlong(best, seg.T);
    const f0 = _c6InFaceDirSafe(X0, best.va, seg.T, nA, nB, eDir);
    const f1 = _c6InFaceDirSafe(X1, best.va, seg.T, nB, nA, eDir);
    // Per-segment, not once-per-path: a chain that changes sign mid-way used to
    // be classified by its first matched segment and silently got the wrong
    // cutter for the rest. The dihedral sweep is material-remove only, so any
    // concave segment belongs to the variable-profile filler path instead.
    if (best.convex === false) {
      throw new Error(_S23_CONCAVE_MSG);
    }
    const frame = orientFilletFrame(seg.T, f0, f1, prevN);
    if (!(frame.theta > 0.05) || frame.theta > Math.PI - 0.05) {
      throw new Error(
        `filletAlongPath: face angle ${frame.theta.toFixed(3)} rad is degenerate — re-pick edges.`,
      );
    }
    seg.matched = true;
    seg.N = frame.N;
    seg.B = frame.B;
    seg.theta = frame.theta;
    seg.f0 = f0;
    seg.f1 = f1;
    seg.planar = !!(best.planar0 && best.planar1);
    prevN = frame.N;
  }

  if (!raw.some((seg) => seg.matched)) {
    throw new Error(
      'filletAlongPath: could not orient cutter to part (no nearby convex edge along the path). '
      + 'Pass opts.initialNormal, or re-pick edges.',
    );
  }

  for (let i = 0; i < raw.length; i++) {
    if (raw[i].matched) continue;
    const src = _s23NearestMatched(raw, i, closed);
    const carried = _s23CarryFrame(src, raw[i].T);
    raw[i].N = carried.N;
    raw[i].B = carried.B;
    raw[i].theta = carried.theta;
    raw[i].f0 = carried.f0;
    raw[i].f1 = carried.f1;
    raw[i].T = carried.T;
    raw[i].planar = !!src.planar;
  }

  return raw.map((seg) => ({
    T: seg.T,
    N: seg.N,
    B: seg.B,
    theta: seg.theta,
    length: seg.length,
    f0: seg.f0,
    f1: seg.f1,
    p0: seg.p0,
    p1: seg.p1,
    planar: !!seg.planar,
  }));
}

function _s23GroupRuns(segs, closed) {
  if (!segs.length) return [];
  const runs = [];
  let cur = [segs[0]];
  for (let i = 1; i < segs.length; i++) {
    if (Math.abs(segs[i].theta - cur[0].theta) < _S23_THETA_TOL) cur.push(segs[i]);
    else {
      runs.push(cur);
      cur = [segs[i]];
    }
  }
  runs.push(cur);
  if (closed && runs.length > 1) {
    const head = runs[0];
    const tail = runs[runs.length - 1];
    if (Math.abs(head[0].theta - tail[0].theta) < _S23_THETA_TOL) {
      runs[0] = tail.concat(head);
      runs.pop();
    }
  }
  return runs;
}

function _s23RunGeometry(run, closedPath, onlyRun) {
  const pts = [run[0].p0.slice()];
  for (const seg of run) pts.push(seg.p1.slice());
  const frames = run.map((seg) => ({
    N: seg.N, B: seg.B, T: seg.T, f0: seg.f0, f1: seg.f1,
  }));
  if (onlyRun && closedPath && pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-5) pts.pop();
    return { points: pts, frames, closed: true };
  }
  return { points: pts, frames, closed: false };
}

function _s23DihedralContour(radius, theta, profileKind, arcSegs, testScale, exactLegs = false) {
  const nominal = profileKind === 'chamfer'
    ? dihedralChamferContour(radius, theta)
    : dihedralFilletContour(radius, theta, arcSegs);
  const contour = expandDihedralCutterContour(nominal, radius, theta, exactLegs ? { faceEps: 0 } : {});
  if (testScale > 1) {
    for (const p of contour) {
      p[0] *= testScale;
      p[1] *= testScale;
    }
  }
  let area2 = 0;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  if (area2 < 0) contour.reverse();
  return contour;
}

/**
 * One dihedral sweep's ring stations, for the quality golden.
 * Each filletAlongPath call appends `{ knots, origins }`. `knots` are the
 * path points after densify (the 5° stations). `origins` are the cutter-ring
 * centers actually placed. A uniform extrude can skip a short chord; this
 * log is how the golden checks that did not happen.
 */
function _s23BeginSweepRingCall() {
  if (typeof globalThis === 'undefined') return;
  if (!globalThis.__filletSweepRingLog) globalThis.__filletSweepRingLog = [];
  const call = { knots: [], origins: [] };
  globalThis.__filletSweepRingLog.push(call);
  globalThis.__filletSweepRingCall = call;
}

function _s23SetSweepRingKnots(points) {
  const call = typeof globalThis !== 'undefined' ? globalThis.__filletSweepRingCall : null;
  if (!call || !Array.isArray(points)) return;
  call.knots = points.map((p) => [p[0], p[1], p[2]]);
}

function _s23AddRingOrigins(origins) {
  const call = typeof globalThis !== 'undefined' ? globalThis.__filletSweepRingCall : null;
  if (!call || !origins) return;
  for (let i = 0; i < origins.length; i++) {
    const p = origins[i];
    call.origins.push([p[0], p[1], p[2]]);
  }
}

/**
 * Weld tolerance for the fillet result. Long "fins" on the wrap are
 * triangles with a short edge under this distance and a long edge along a
 * ruling; the rounded-wrap rim comes back as several chains because those
 * duplicated vertices are not shared by index. Snapping them does not move
 * a real feature: arc chords at FILLET_ARC_SEGMENTS are ~0.2 mm.
 */
const _S23_RESULT_WELD_MM = 0.001;

/**
 * A straight fillet whose ruling is the whole edge (30 mm on the playtest
 * cube) comes back with the cap loop in three chains. One interpolated
 * ring on a span longer than this, still on the ruled quad, makes that
 * loop a single chain. The volume is unchanged. Path knots are not moved
 * and arcs under this length stay one quad. `__FILLET_REF_STATION_MM`,
 * when set, replaces this step with a finer measurement grid.
 */
const _S23_LONG_CHORD_MM = 29;

/**
 * Fill spans longer than the chord step with linearly interpolated rings.
 * New vertices lie on the ruled quad between the knots.
 */
function _s23RefineReferenceRings(rings, closed) {
  const ref = typeof globalThis !== 'undefined' ? Number(globalThis.__FILLET_REF_STATION_MM) : 0;
  const step = ref > 0 ? ref : _S23_LONG_CHORD_MM;
  if (!(step > 0) || !Array.isArray(rings) || rings.length < 2) return rings;
  const n = rings.length;
  const spans = closed ? n : n - 1;
  const out = [];
  for (let i = 0; i < spans; i++) {
    const a = rings[i];
    const b = rings[(i + 1) % n];
    if (!out.length) out.push(a);
    const K = a.length;
    let span = 0;
    for (let k = 0; k < K; k++) {
      const d = Math.hypot(b[k][0] - a[k][0], b[k][1] - a[k][1], b[k][2] - a[k][2]);
      if (d > span) span = d;
    }
    const cuts = Math.max(1, Math.ceil(span / step - 1e-9));
    for (let s = 1; s < cuts; s++) {
      const t = s / cuts;
      const ring = new Array(K);
      for (let k = 0; k < K; k++) {
        ring[k] = [
          a[k][0] + (b[k][0] - a[k][0]) * t,
          a[k][1] + (b[k][1] - a[k][1]) * t,
          a[k][2] + (b[k][2] - a[k][2]) * t,
        ];
      }
      out.push(ring);
    }
    if (!closed || i < spans - 1) out.push(b);
  }
  return out;
}

/**
 * Drop triangles out of their original runs. runIndex counts halfedges
 * (3 per triangle). A run that loses every triangle is removed; the
 * survivors keep that run's originalID and each triangle's faceID.
 * @returns {object|null}
 */
function _s23CompactFilletRuns(mesh, triVerts, keptTri) {
  const runIndex = mesh.runIndex;
  const runOriginalID = mesh.runOriginalID;
  const faceID = mesh.faceID;
  const nTri = triVerts.length / 3;
  if (!runIndex || !runOriginalID || runIndex.length !== runOriginalID.length + 1) return null;
  const nRun = runOriginalID.length;
  const triRun = new Int32Array(nTri);
  triRun.fill(-1);
  for (let r = 0; r < nRun; r++) {
    const a = runIndex[r];
    const b = runIndex[r + 1];
    if ((a % 3) !== 0 || (b % 3) !== 0 || b < a) return null;
    const t0 = a / 3;
    const t1 = b / 3;
    if (t1 > nTri) return null;
    for (let t = t0; t < t1; t++) triRun[t] = r;
  }
  const groups = Array.from({ length: nRun }, () => []);
  for (let i = 0; i < keptTri.length; i++) {
    const t = keptTri[i];
    const r = triRun[t];
    if (r < 0) return null;
    groups[r].push(t);
  }
  const outTri = [];
  const outFace = [];
  const outRunIndex = [0];
  const outRunId = [];
  const outTransform = [];
  const transforms = mesh.runTransform;
  const hasXform = transforms && transforms.length === nRun;
  for (let r = 0; r < nRun; r++) {
    const g = groups[r];
    if (!g.length) continue;
    for (let i = 0; i < g.length; i++) {
      const t = g[i];
      outTri.push(triVerts[t * 3], triVerts[t * 3 + 1], triVerts[t * 3 + 2]);
      outFace.push(faceID[t] >>> 0);
    }
    outRunIndex.push(outTri.length);
    outRunId.push(runOriginalID[r] >>> 0);
    if (hasXform) outTransform.push(transforms[r]);
  }
  if (outRunId.length < 1) return null;
  return {
    triVerts: new Uint32Array(outTri),
    faceID: new Uint32Array(outFace),
    runIndex: new Uint32Array(outRunIndex),
    runOriginalID: new Uint32Array(outRunId),
    runTransform: hasXform ? outTransform : null,
  };
}

/**
 * Snap vertices closer than `_S23_RESULT_WELD_MM` and drop the collapsed
 * triangles. A rebuild that is not a strict solid, or that moves the volume
 * by more than 0.001 mm³, is discarded and the boolean result stands.
 */
function _s23WeldFilletResult(manifold) {
  let mesh;
  try {
    mesh = manifold.getMesh();
  } catch {
    return manifold;
  }
  const np = mesh.numProp || 3;
  const src = mesh.vertProperties;
  const n = src.length / np;
  if (!(n >= 4) || !mesh.triVerts || mesh.triVerts.length < 3) return manifold;
  const xyz = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    xyz[i * 3] = src[i * np];
    xyz[i * 3 + 1] = src[i * np + 1];
    xyz[i * 3 + 2] = src[i * np + 2];
  }
  const welded = _weldMeshData(xyz, mesh.triVerts, _S23_RESULT_WELD_MM);
  const T = welded.triVerts;
  const nTri = T.length / 3;
  if (!mesh.faceID || mesh.faceID.length < nTri) return manifold;
  const keptTri = [];
  for (let t = 0; t < nTri; t++) {
    const a = T[t * 3];
    const b = T[t * 3 + 1];
    const c = T[t * 3 + 2];
    if (a === b || b === c || c === a) continue;
    keptTri.push(t);
  }
  if (keptTri.length < 1 || keptTri.length === nTri) {
    // Nothing collapsed, or the whole mesh did. Identical vertices are not
    // a fin until a triangle loses a corner, so an unchanged set is a no-op.
    if (keptTri.length === nTri) return manifold;
    return manifold;
  }
  const packed = _s23CompactFilletRuns(mesh, T, keptTri);
  if (!packed) return manifold;
  let builtManifold;
  try {
    const { Mesh, Manifold } = manifoldModule;
    const meshIn = {
      numProp: 3,
      vertProperties: welded.vertProperties,
      triVerts: packed.triVerts,
      faceID: packed.faceID,
      runIndex: packed.runIndex,
      runOriginalID: packed.runOriginalID,
    };
    if (packed.runTransform) meshIn.runTransform = packed.runTransform;
    builtManifold = new Manifold(new Mesh(meshIn));
  } catch {
    return manifold;
  }
  if (_c4StatusError(builtManifold)) return manifold;
  const v0 = manifold.volume();
  const v1 = builtManifold.volume();
  // Snapping the tangency needles on a sheet bend (vertices ~1e-5 mm apart)
  // rebuilds about 0.002 mm³ off on a ~30 cm³ part — float from the new mesh,
  // not removed material. 0.001 mm³ rejected that snap and left the needles.
  if (!(Number.isFinite(v1) && Math.abs(v1 - v0) < 0.02)) return manifold;
  return builtManifold;
}

function _s23PlaceContourRing(contour, origin, N, B) {
  const ring = new Array(contour.length);
  const ox = origin[0];
  const oy = origin[1];
  const oz = origin[2];
  const Nx = N[0];
  const Ny = N[1];
  const Nz = N[2];
  const Bx = B[0];
  const By = B[1];
  const Bz = B[2];
  for (let k = 0; k < contour.length; k++) {
    const u = contour[k][0];
    const v = contour[k][1];
    ring[k] = [
      ox + u * Nx + v * Bx,
      oy + u * Ny + v * By,
      oz + u * Nz + v * Bz,
    ];
  }
  return ring;
}

/**
 * Dihedral cutter as one ring per path point. The ring at knot i uses that
 * segment's frame; the end knot reuses the last frame. Nothing is inserted
 * between knots — a long straight and a 0.3 mm arc chord both get exactly
 * their own stations, which a uniform extrude slice count does not.
 * Caps come from varyingProfileTubeMesh (fan from the rear bumper).
 */
function _s23SweepKnotRings(points, frames, contour) {
  const nSeg = points.length - 1;
  if (nSeg < 1 || frames.length !== nSeg) {
    throw new Error('filletAlongPath: sweep frame count does not match the path');
  }
  const rings = new Array(nSeg + 1);
  const origins = new Array(nSeg + 1);
  for (let i = 0; i < nSeg; i++) {
    const fr = frames[i];
    origins[i] = points[i];
    rings[i] = _s23PlaceContourRing(contour, points[i], fr.N, fr.B);
  }
  const frLast = frames[nSeg - 1];
  origins[nSeg] = points[nSeg];
  rings[nSeg] = _s23PlaceContourRing(contour, points[nSeg], frLast.N, frLast.B);
  _s23AddRingOrigins(origins);
  const mesh = varyingProfileTubeMesh(_s23RefineReferenceRings(rings, false), false);
  let solid;
  let repair;
  try {
    ({ manifold: solid, repair } = _meshDataToManifold(mesh.vertProperties, mesh.triVerts));
  } catch (e) {
    throw new Error(
      `filletAlongPath: sweep cutter is not a valid solid (${e && e.message ? e.message : e})`,
    );
  }
  // Same loud fail as the varying-profile tube: a weld means two rings collided.
  if (repair !== 'strict') {
    throw new Error(
      `filletAlongPath: sweep cutter needed mesh repair (${repair}) — `
      + 'rings collide along the path. Reduce radius or re-pick edges.',
    );
  }
  return solid;
}

function _s23SweepRun(Manifold, CrossSection, runGeom, radius, profileKind, arcSegs, testScale, runOpts = {}) {
  const thetaUse = runGeom.theta;
  if (runGeom.closed && !(testScale > 1)) {
    try {
      const probed = { f0: runGeom.frames[0].f0, f1: runGeom.frames[0].f1 };
      const rev = _s23TryRevolveCutter(
        CrossSection, runGeom.points, radius, profileKind, arcSegs, probed,
      );
      if (rev) return rev;
    } catch (e) {
      if (/too large for this rim/i.test(String(e && e.message))) throw e;
    }
  }
  let sweepPts = runGeom.points;
  let sweepFrames = runGeom.frames;
  if (runGeom.closed && runGeom.points.length >= 3) {
    const a = runGeom.points[0];
    const b = runGeom.points[1];
    const overlap = 0.08;
    sweepPts = runGeom.points.concat([
      a.slice(),
      [
        a[0] + overlap * (b[0] - a[0]),
        a[1] + overlap * (b[1] - a[1]),
        a[2] + overlap * (b[2] - a[2]),
      ],
    ]);
    sweepFrames = runGeom.frames.concat([runGeom.frames[0]]);
  }
  const contour = _s23DihedralContour(radius, thetaUse, profileKind, arcSegs, testScale, !!runOpts.exactLegs);
  // One ring at every knot of this run, including the closed-loop overlap
  // stations appended above. Uniform Manifold.extrude slices space themselves
  // by arc length, so a 28 mm straight in the same run as 0.3 mm arc chords
  // leaves the turns unsampled. The cross-section between knots is the
  // contour itself (FILLET_ARC_SEGMENTS), not a second densify.
  return _s23SweepKnotRings(sweepPts, sweepFrames, contour);
}

/**
 * Minimum spacing between variable-profile knots after densify. Arc chords at
 * FILLET_ARC_SEGMENTS are ~0.2 mm, so nothing real lives below this.
 */
const _S23_MICRO_KNOT_MM = 0.05;
/** Turn above which a knot is a real corner and is never dropped. */
const _S23_MICRO_KEEP_TURN_DEG = 20;

/**
 * Drop knots closer than `gap` to the previous kept knot; path ends stay.
 * densifyPathByMaxTurn bisects both segments at any turn above 5° for up to
 * 8 passes, and bisecting cannot reduce the turn AT a true corner vertex, so
 * each such corner (and each prior-fillet arc whose raw chords did not
 * resample) grows a cluster of 0.001–0.05 mm segments. Every one of them
 * gets its own probe, frame and cutter ring, with a tangent set by the
 * corner, and the rings fold over each other where three cutters meet
 * (a genus-1 handle on the three-fillet corner wrap).
 */
function _s23DropMicroKnots(points, closed, gap = _S23_MICRO_KNOT_MM) {
  if (!Array.isArray(points) || points.length < 3 || !(gap > 0)) return points;
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const n = points.length;
  // A real corner vertex stays: dropping it would chamfer the path across
  // the turn. Only the bisection debris around it goes.
  const cosCorner = Math.cos((_S23_MICRO_KEEP_TURN_DEG * Math.PI) / 180);
  const corner = (i) => {
    const a = points[(i - 1 + n) % n];
    const b = points[i];
    const c = points[(i + 1) % n];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const lu = Math.hypot(u[0], u[1], u[2]);
    const lv = Math.hypot(v[0], v[1], v[2]);
    if (!(lu > 1e-12) || !(lv > 1e-12)) return false;
    return (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv) < cosCorner;
  };
  const keep = [points[0]];
  const pinned = [true];
  const lastIdx = closed ? n : n - 1;
  for (let i = 1; i < lastIdx; i++) {
    if (corner(i)) {
      while (keep.length > 1 && !pinned[pinned.length - 1] && d(keep[keep.length - 1], points[i]) < gap) {
        keep.pop();
        pinned.pop();
      }
      keep.push(points[i]);
      pinned.push(true);
      continue;
    }
    if (d(keep[keep.length - 1], points[i]) >= gap) {
      keep.push(points[i]);
      pinned.push(false);
    }
  }
  if (closed) {
    while (keep.length > 3 && !pinned[pinned.length - 1] && d(keep[keep.length - 1], keep[0]) < gap) {
      keep.pop();
      pinned.pop();
    }
    return keep.length >= 3 ? keep : points;
  }
  const end = points[n - 1];
  while (keep.length > 1 && !pinned[pinned.length - 1] && d(keep[keep.length - 1], end) < gap) {
    keep.pop();
    pinned.pop();
  }
  keep.push(end);
  return keep.length >= 2 ? keep : points;
}

/** Last variable-profile framing meta — golden pin (m3 bypass → missing / undensified). */
let _filletVariableProfileMeta = null;

function _recordVariableProfileMeta(meta) {
  _filletVariableProfileMeta = meta;
  if (typeof globalThis !== 'undefined') {
    globalThis.__filletVariableProfileMeta = meta;
  }
}

/** Distance from p to the segment ab (clamped). A long edge's ends are not near its midpoint. */
function _s23PointSegDist(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const L2 = abx * abx + aby * aby + abz * abz;
  if (!(L2 > 1e-18)) return Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
  let u = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / L2;
  if (u < 0) u = 0;
  else if (u > 1) u = 1;
  const qx = a[0] + abx * u;
  const qy = a[1] + aby * u;
  const qz = a[2] + abz * u;
  return Math.hypot(p[0] - qx, p[1] - qy, p[2] - qz);
}

/**
 * Probe wall normals (n0/n1) at each densified knot from the feature edge
 * the knot actually lies on. Midpoint distance misses the ends of a long
 * edge (a cutout corner running through a bend is one edge of several mm):
 * those knots bound a neighbouring seam, the path was split into convex
 * cutters and concave fillers, and the subtract ate the round. Distance is
 * to the edge segment, with the same alignment penalty as _s23ProbeSegments
 * so a seam that only touches the endpoint does not win.
 */
function _s23Unit(v) {
  return _s23Norm(v);
}

function _s23NormalsMatch(a0, a1, b0, b1) {
  if (!a0 || !a1 || !b0 || !b1) return false;
  const d = (p, q) => _s23Dot(_s23Unit(p), _s23Unit(q));
  return (d(a0, b0) > 0.92 && d(a1, b1) > 0.92) || (d(a0, b1) > 0.92 && d(a1, b0) > 0.92);
}

function _s23FacesMatch(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return false;
  const ax = Number(a[0]);
  const ay = Number(a[1]);
  const bx = Number(b[0]);
  const by = Number(b[1]);
  if (![ax, ay, bx, by].every((n) => Number.isFinite(n))) return false;
  return (ax === bx && ay === by) || (ax === by && ay === bx);
}

/** Edges makeSweepPath kept from the pick (normals + adjacent faces). */
/**
 * Every path knot sits on an edge of `part` (within 0.05 mm, or 2e-4 of the
 * part's diagonal on a large part). A literal edge wire written when the
 * part was different, or an `edge()` id that now names another edge, used
 * to sweep the cutter through air; the near-no-op guard did not always see
 * it, and the result came back `ok` with the wrong solid (Banner End Cap,
 * B15). Loud instead, naming the knot and the gap.
 */
function _s23DistSqToSeg(p, a, b) {
  const ab = _c4Sub(b, a);
  const L2 = _c4Dot(ab, ab);
  let t = L2 > 1e-18 ? _c4Dot(_c4Sub(p, a), ab) / L2 : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const d = _c4Sub(p, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]]);
  return _c4Dot(d, d);
}

/** va / vb of every edge a makeSweepPath result carries (the picked wire), else none. */
function _s23PathEdgeEndpoints(path) {
  const list = path && typeof path === 'object' && !Array.isArray(path) ? path.edges : null;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list) {
    if (!e || !Array.isArray(e.va) || !Array.isArray(e.vb)) continue;
    if (e.va.length >= 3 && e.va.every(Number.isFinite)) out.push(e.va);
    if (e.vb.length >= 3 && e.vb.every(Number.isFinite)) out.push(e.vb);
  }
  return out;
}

function _s23AssertPathOnSolid(part, points, profileKind) {
  if (!part || typeof part.getMesh !== 'function' || !Array.isArray(points) || !points.length) return;
  let data;
  try { data = c4MeshData(part); } catch { return; }
  const edges = data && Array.isArray(data.edges) ? data.edges : [];
  if (!edges.length) return;
  let diag = 0;
  try {
    const bb = part.boundingBox();
    diag = Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);
  } catch { diag = 0; }
  const tol = Math.max(0.05, 2e-4 * diag);
  const tol2 = tol * tol;
  for (const p of points) {
    let best = Infinity;
    for (const e of edges) {
      if (!e.va || !e.vb) continue;
      const d = _s23DistSqToSeg(p, e.va, e.vb);
      if (d < best) {
        best = d;
        if (best <= tol2) break;
      }
    }
    if (best > tol2) {
      const off = Math.sqrt(best);
      throw new Error(
        `filletAlongPath: ${profileKind} edge endpoint [${p.map((v) => +v.toFixed(3)).join(', ')}] is ${+off.toFixed(3)} mm off every edge of this solid `
        + '— the stored edge wire belongs to an earlier version of the part; re-pick edges (edgesNamed keeps a pick stable across edits)',
      );
    }
  }
}

function _s23CarriedEdges(path) {
  const list = path && typeof path === 'object' && !Array.isArray(path) ? path.edges : null;
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const e of list) {
    if (!e || !Array.isArray(e.va) || !Array.isArray(e.vb)) continue;
    if (!e.n0 || !e.n1) continue;
    out.push(e);
  }
  return out.length ? out : null;
}

/**
 * The picked edge under this knot, when the path carried its walls.
 * A knot on the bend-root line is 0 mm from both the concave facet edge and
 * the convex bottom edge; without this, list order takes the convex twin.
 */
function _s23CarriedOnSegment(carried, mid, T) {
  if (!carried) return null;
  let best = null;
  let bestD = Infinity;
  for (const e of carried) {
    const d = _s23PointSegDist(mid, e.va, e.vb);
    const eT = _s23Norm(_s23Sub(e.vb, e.va));
    const align = Math.abs(_s23Dot(eT, T));
    if (align < 0.85) continue;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best || bestD > 0.85) return null;
  return best;
}

/**
 * Among mesh edges on the same line as the pick, keep the one with the
 * pick's faces, else its normals. Returns null when the pick does not
 * disambiguate (one edge, or no identity match).
 */
function _s23EdgeMatchingCarry(edges, carried, mid, T) {
  if (!carried) return null;
  const onLine = [];
  for (const e of edges) {
    if (!e || !e.n0 || !e.n1 || !Array.isArray(e.va) || !Array.isArray(e.vb)) continue;
    const d = _s23PointSegDist(mid, e.va, e.vb);
    if (d > 0.2) continue;
    const eT = _s23Norm(_s23Sub(e.vb, e.va));
    if (Math.abs(_s23Dot(eT, T)) < 0.95) continue;
    onLine.push(e);
  }
  if (onLine.length < 2) return null;
  const byFace = onLine.find((e) => _s23FacesMatch(carried.faces, e.faces)
    || (Number.isFinite(carried.faceA) && Number.isFinite(carried.faceB)
      && _s23FacesMatch([carried.faceA, carried.faceB], e.faces)));
  if (byFace) return byFace;
  const byNorm = onLine.find((e) => _s23NormalsMatch(carried.n0, carried.n1, e.n0, e.n1));
  return byNorm || null;
}

function _s23ProbeKnotNormals(part, points, closed, carried = null) {
  const edges = _s23ProbeFeatureEdges(part);
  const n = points.length;
  const segCount = closed ? n : n - 1;
  const segmentNormals = new Array(segCount).fill(null);
  const segmentConvex = new Array(segCount).fill(null);
  let seedNormals = null;
  const matchedIdx = [];

  for (let i = 0; i < segCount; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % n];
    const segL = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const T = _s23Norm(_s23Sub(p1, p0));
    const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    let best = null;
    let bestScore = Infinity;
    let bestD = Infinity;
    for (const e of edges) {
      if (!e || !Array.isArray(e.va) || !Array.isArray(e.vb)) continue;
      if (!e.n0 || !e.n1) continue;
      const d = _s23PointSegDist(mid, e.va, e.vb);
      const eT = _s23Norm(_s23Sub(e.vb, e.va));
      const align = Math.abs(_s23Dot(eT, T));
      const score = d + (1 - align) * Math.max(0.55, 0.35 * (segL || 1));
      if (score < bestScore - 1e-12 || (Math.abs(score - bestScore) <= 1e-12 && d < bestD)) {
        bestScore = score;
        bestD = d;
        best = e;
      }
    }
    const carriedHit = _s23CarriedOnSegment(carried, mid, T);
    const identified = _s23EdgeMatchingCarry(edges, carriedHit, mid, T);
    if (identified) best = identified;
    const hit = best && (identified || bestD <= Math.max(0.85, Math.max(0.55 * (segL || 1), 0.35)));
    if (!hit) continue;
    const nr = { n0: best.n0, n1: best.n1 };
    segmentNormals[i] = nr;
    // Per-knot sign. C3.3 and earlier sampled convexity ONCE per path, so a
    // chain that changed sign mid-way was cut as whatever its first segment was.
    segmentConvex[i] = best.convex !== false;
    matchedIdx.push(i);
    if (!seedNormals) seedNormals = nr;
  }

  if (!seedNormals) {
    throw new Error(
      'filletAlongPath: could not orient cutter to part (no nearby convex edge along the path). '
      + 'Pass opts.initialNormal, or re-pick edges.',
    );
  }

  // Carry nearest matched normals onto densified knots that missed a wall hit.
  for (let i = 0; i < segCount; i++) {
    if (segmentNormals[i]) continue;
    let bestJ = matchedIdx[0];
    let bestDist = Math.abs(i - bestJ);
    for (const j of matchedIdx) {
      let d = Math.abs(i - j);
      if (closed) d = Math.min(d, segCount - d);
      if (d < bestDist) {
        bestDist = d;
        bestJ = j;
      }
    }
    segmentNormals[i] = segmentNormals[bestJ];
    segmentConvex[i] = segmentConvex[bestJ];
  }

  return { segmentNormals, seedNormals, segmentConvex };
}

/**
 * Shared run-group → sweep union. EASY path only since C3.3.
 *
 * opts.singleRun (C3.2) forced one continuous sweep at the MEDIAN θ. It cured
 * the loft saw-tooth by replacing many small θ errors with one large one, and
 * gouged instead (see `.claude/skills/fillets/SKILL.md` and `golden:fillet-c3.3-varying-profile`). The hard path now
 * uses _s23VaryingProfileCutter, which needs no θ collapse at all. The option
 * is kept only because this helper still serves the easy dihedral path; do not
 * reach for it as a loft fix.
 */
/**
 * Break θ-runs at sharp direction changes.
 *
 * θ-grouping only looks at the dihedral, so a face-perimeter wrap — every
 * corner 90°, every θ exactly 90° — grouped into ONE run and was swept as a
 * single piece straight through the corners. Sweeping one section through a
 * 90° turn makes consecutive cross-sections cross on the INSIDE of the bend:
 * the cutter self-intersects, and the boolean resolves the crossing into
 * inward-facing facets. Those render dark — Artur's wrap-fillet surface
 * sliver. Measured on a plain 40×30×20 cube with nothing but the wrap: the
 * sweep path is 4 points, all four turning 90°, and the result carries 13
 * inverted triangles (7 with visible area) sitting exactly on those corners.
 *
 * densifyPathByMaxTurn cannot prevent this: densifying splits SEGMENTS, and a
 * corner is a vertex, not an arc, so splitting the legs leaves the turn at the
 * vertex untouched.
 *
 * Splitting gives each straight leg its own swept piece; `M.union` then
 * resolves the corner overlap properly instead of a self-intersecting single
 * solid. Smooth runs (tessellated rims, loft ridges) stay in one piece — the
 * gate is well above their per-segment turn.
 */
// Half the ~10° shell normal cluster. A run that still bends more than this
// at one vertex is a real corner (split into its own cutter). Smooth arcs are
// resampled to ≤ this before the sweep, so they stay ONE piece — do not split
// a G1 arc into a cutter per step.
const _S23_RUN_CORNER_DEG = FRAME_DENSIFY_MAX_TURN_DEG;

function _s23SplitRunsAtCorners(runs) {
  if (!Array.isArray(runs) || !runs.length) return runs;
  const cosGate = Math.cos((_S23_RUN_CORNER_DEG * Math.PI) / 180);
  const dirOf = (s) => {
    if (!s?.p0 || !s?.p1) return null;
    const d = [s.p1[0] - s.p0[0], s.p1[1] - s.p0[1], s.p1[2] - s.p0[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    return L > 1e-12 ? [d[0] / L, d[1] / L, d[2] / L] : null;
  };
  const out = [];
  for (const run of runs) {
    if (!Array.isArray(run) || run.length < 2) {
      if (run?.length) out.push(run);
      continue;
    }
    let cur = [run[0]];
    for (let i = 1; i < run.length; i++) {
      const a = dirOf(run[i - 1]);
      const b = dirOf(run[i]);
      const sharp = a && b && _c4Dot(a, b) < cosGate;
      if (sharp) {
        const turnDeg = (Math.acos(Math.max(-1, Math.min(1, _c4Dot(a, b)))) * 180) / Math.PI;
        const prev = cur[cur.length - 1];
        if (prev) prev._splitOutDeg = turnDeg;
        if (run[i]) run[i]._splitInDeg = turnDeg;
        out.push(cur);
        cur = [run[i]];
      } else {
        cur.push(run[i]);
      }
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

function _s23CuttersFromSegs(M, CrossSection, segs, closed, radius, profileKind, arcSegs, testScale, opts = {}) {
  const singleRun = !!opts.singleRun;
  const thetaRunCount = countThetaRuns(segs);
  const runs = singleRun
    ? (segs.length ? [segs] : [])
    : _s23SplitRunsAtCorners(_s23GroupRuns(segs, closed));
  const cutters = [];
  let expectVol = 0;
  for (let ri = 0; ri < runs.length; ri++) {
    const run = runs[ri];
    if (opts.part && !(closed && runs.length === 1)) {
      // A chain end that meets a mesh-built corner pocket stops at the
      // junction plane: no draft extension past that knot.
      _s23ExtendOpenRunEnds(opts.part, run, radius, profileKind, arcSegs, {
        start: ri === 0 && !!opts.trimStart,
        end: ri === runs.length - 1 && !!opts.trimEnd,
      });
    }
    let theta = run[0].theta;
    if (singleRun && run.length > 1) {
      const ts = run.map((s) => Number(s.theta)).filter((t) => t > 0.05 && t < Math.PI - 0.05).sort((a, b) => a - b);
      if (ts.length) theta = ts[Math.floor(ts.length / 2)];
    }
    const area = profileKind === 'chamfer'
      ? chamferRemovedArea(radius, theta)
      : filletRemovedArea(radius, theta);
    const len = run.reduce((s, seg) => s + seg.length, 0);
    expectVol += area * len;
    const geom = _s23RunGeometry(run, closed, runs.length === 1);
    geom.theta = theta;
    for (const fr of geom.frames) fr.theta = theta;
    // Legs end exactly on the faces when both walls of the whole run are
    // planes (the box case, which hollow and the corner pocket need); a
    // curved wall keeps the 2.5 µm nudge that keeps the boolean clean on
    // bends and lofts.
    const exactLegs = !!opts.exactLegs || (profileKind !== 'chamfer' && run.every((seg) => seg.planar));
    let piece;
    try {
      piece = _s23SweepRun(M, CrossSection, geom, radius, profileKind, arcSegs, testScale, { exactLegs });
    } catch (e) {
      if (/too large for this rim|face angle|radius/i.test(String(e && e.message))) throw e;
      throw new Error(`filletAlongPath: sweep failed — ${e && e.message ? e.message : e}`);
    }
    const se = _c4StatusError(piece);
    if (se) throw new Error(`filletAlongPath: bad cutter (${se})`);
    cutters.push(piece);
  }
  let cutter = cutters[0];
  if (cutters.length > 1) {
    try {
      cutter = M.union(cutters);
    } catch (e) {
      throw new Error(`filletAlongPath: sweep failed — ${e && e.message ? e.message : e}`);
    }
    const se = _c4StatusError(cutter);
    if (se) throw new Error(`filletAlongPath: bad cutter (${se})`);
  }
  return { cutter, expectVol, runCount: runs.length, thetaRunCount, singleRun };
}

/** Concave rejection shared by the dihedral (material-remove only) paths. */
const _S23_CONCAVE_MSG =
  'filletAlongPath: edge is concave (sweep fillet is external / material-remove only)';

/** Numerical band for a per-knot theta. Outside it the wedge is degenerate. */
const _S23_THETA_MIN = 0.08;
const _S23_THETA_MAX = Math.PI - 0.08;

/**
 * C3.3 hard: VARYING cross-section cutter — one profile per knot.
 *
 * C3.1 approximated a ramping dihedral with piecewise-constant theta runs
 * (staircase); C3.2 replaced that with ONE median-theta run (gouge: on the
 * playtest loft ridge theta ramps 161.5 deg -> 92.8 deg, so a median 109.7 deg
 * profile cut 4.3x too deep at the shallow end). Both were the same bug — a
 * constant section swept along a path whose section must change.
 *
 * Volume guards could not see it: the median-theta total landed within 1.2x of
 * the true integral. The error was distributional, not integral. So expectVol
 * here is the true per-knot integral, which makes those guards meaningful again.
 *
 * Builds the cutter mesh directly (ring per knot, stitched) instead of
 * extrude+warp, because extrude+warp can only reorient one fixed profile.
 */
function _s23VaryingProfileTube(runSegs, wrapClosed, radius, profileKind, arcSegs, testScale) {
  const place = (contour, origin, N, B) => contour.map(([u, v]) => [
    origin[0] + u * N[0] + v * B[0],
    origin[1] + u * N[1] + v * B[1],
    origin[2] + u * N[2] + v * B[2],
  ]);
  const rings = [];
  const thetas = [];
  let expectVol = 0;
  let clampedKnots = 0;
  for (const seg of runSegs) {
    let th = Number(seg.theta);
    if (!Number.isFinite(th)) th = Math.PI / 2;
    // Clamp, don't throw: one noisy knot must not kill a 48-knot blend. A
    // near-flat knot clamps to a near-zero wedge and a knife-edge knot clamps
    // its setback — both are the conservative answer. Count them; a path that
    // is mostly clamped fails the volume guards downstream.
    if (th < _S23_THETA_MIN) { th = _S23_THETA_MIN; clampedKnots++; }
    else if (th > _S23_THETA_MAX) { th = _S23_THETA_MAX; clampedKnots++; }
    thetas.push(th);
    const area = profileKind === 'chamfer'
      ? chamferRemovedArea(radius, th)
      : filletRemovedArea(radius, th);
    expectVol += area * (Number(seg.length) || 0);
    rings.push(place(
      _s23DihedralContour(radius, th, profileKind, arcSegs, testScale),
      seg.p0, seg.N, seg.B,
    ));
  }
  if (!wrapClosed) {
    const tail = runSegs[runSegs.length - 1];
    rings.push(place(
      _s23DihedralContour(radius, thetas[thetas.length - 1], profileKind, arcSegs, testScale),
      tail.p1, tail.N, tail.B,
    ));
  }
  const ringOrigins = [];
  for (let i = 0; i < runSegs.length; i++) ringOrigins.push(runSegs[i].p0);
  if (!wrapClosed) ringOrigins.push(runSegs[runSegs.length - 1].p1);
  _s23AddRingOrigins(ringOrigins);
  const mesh = varyingProfileTubeMesh(_s23RefineReferenceRings(rings, wrapClosed), wrapClosed);
  let solid;
  let repair;
  try {
    ({ manifold: solid, repair } = _meshDataToManifold(mesh.vertProperties, mesh.triVerts));
  } catch (e) {
    throw new Error(
      'filletAlongPath: varying-profile cutter is not a valid solid (rings likely '
      + `self-intersect — path curves tighter than the blend radius): ${e && e.message ? e.message : e}`,
    );
  }
  // A tube that needed welding is a warning sign, not a pass: the rings are
  // built to be watertight by construction, so a weld means two rings collided.
  if (repair !== 'strict') {
    throw new Error(
      `filletAlongPath: varying-profile cutter needed mesh repair (${repair}) — `
      + 'rings collide along the path. Reduce radius or re-pick edges.',
    );
  }
  const se = _c4StatusError(solid);
  if (se) throw new Error(`filletAlongPath: bad cutter (${se})`);
  return { solid, expectVol, thetas, ringCount: rings.length, clampedKnots };
}

/**
 * C3.3 hard: VARYING cross-section cutter — one profile per knot.
 *
 * C3.1 approximated a ramping dihedral with piecewise-constant theta runs
 * (staircase); C3.2 replaced that with ONE median-theta run (gouge: on the
 * playtest loft ridge theta ramps 161.5 deg -> 92.8 deg, so a median 109.7 deg
 * profile cut 4.3x too deep at the shallow end). Both were the same bug — a
 * constant section swept along a path whose section must change.
 *
 * Volume guards could not see it: the median-theta total landed within 1.2x of
 * the true integral. The error was distributional, not integral. So expectVol
 * here is the true per-knot integral, which makes those guards meaningful again.
 *
 * Builds the cutter mesh directly (ring per knot, stitched) instead of
 * extrude+warp, because extrude+warp can only reorient one fixed profile.
 *
 * C4: the path is split into maximal same-SIGN runs. Convex runs become
 * cutters (material remove); concave runs become fillers (material add). The
 * wedge, the frame and the ring machinery are identical for both — only the
 * boolean differs — because for a concave edge the angle between the two
 * in-face directions IS the empty-side angle, so the same contour that carves
 * a convex corner fills a concave one.
 */
function _s23VaryingProfileCutter(segs, closed, radius, profileKind, arcSegs, testScale, part) {
  if (!Array.isArray(segs) || !segs.length) {
    throw new Error('filletAlongPath: varying-profile cutter needs ≥ 1 segment');
  }
  // Maximal same-sign runs.
  const runs = [];
  for (const seg of segs) {
    const convex = seg.convex !== false;
    const cur = runs[runs.length - 1];
    if (!cur || cur.convex !== convex) runs.push({ convex, segs: [seg] });
    else cur.segs.push(seg);
  }
  // A closed path whose head and tail share a sign is one run around the loop.
  if (closed && runs.length > 1 && runs[0].convex === runs[runs.length - 1].convex) {
    runs[0].segs = runs[runs.length - 1].segs.concat(runs[0].segs);
    runs.pop();
  }
  // Same corner split the easy path already applies. A 90° wrap was one
  // varying-profile tube, and on a drafted face that tube self-intersects
  // (shredded mesh, crease left on the second leg). Smooth runs stay one
  // piece: the gate is FRAME_DENSIFY_MAX_TURN_DEG, and densify already holds
  // per-segment turns to that. No draft flag — the turn is the corner.
  const splitRuns = [];
  for (const run of runs) {
    const pieces = _s23SplitRunsAtCorners([run.segs]);
    for (const segs of pieces) {
      if (segs && segs.length) splitRuns.push({ convex: run.convex, segs });
    }
  }
  let wrapClosed = closed && splitRuns.length === 1;
  if (wrapClosed && splitRuns[0].segs.length >= 2) {
    const segs = splitRuns[0].segs;
    const dirOf = (s) => {
      if (!s?.p0 || !s?.p1) return null;
      const d = [s.p1[0] - s.p0[0], s.p1[1] - s.p0[1], s.p1[2] - s.p0[2]];
      const L = Math.hypot(d[0], d[1], d[2]);
      return L > 1e-12 ? [d[0] / L, d[1] / L, d[2] / L] : null;
    };
    const a = dirOf(segs[segs.length - 1]);
    const b = dirOf(segs[0]);
    const cosGate = Math.cos((_S23_RUN_CORNER_DEG * Math.PI) / 180);
    if (a && b && _c4Dot(a, b) < cosGate) wrapClosed = false;
  }

  const cutters = [];
  const fillers = [];
  let expectRemove = 0;
  let expectAdd = 0;
  let clampedKnots = 0;
  let ringCount = 0;
  const allThetas = [];
  let endExtend = 0;
  for (const run of splitRuns) {
    if (!wrapClosed && part && run.convex) {
      endExtend = Math.max(
        endExtend,
        _s23ExtendOpenRunEnds(part, run.segs, radius, profileKind, arcSegs),
      );
    }
    const t = _s23VaryingProfileTube(
      run.segs, wrapClosed, radius, profileKind, arcSegs, testScale,
    );
    clampedKnots += t.clampedKnots;
    ringCount += t.ringCount;
    for (const th of t.thetas) allThetas.push(th);
    if (run.convex) {
      cutters.push(t.solid);
      expectRemove += t.expectVol;
    } else {
      fillers.push(t.solid);
      expectAdd += t.expectVol;
    }
  }
  const M = manifoldModule.Manifold;
  const merge = (list, what) => {
    if (!list.length) return null;
    let m = list[0];
    for (let i = 1; i < list.length; i++) m = M.union([m, list[i]]);
    const se = _c4StatusError(m);
    if (se) throw new Error(`filletAlongPath: bad ${what} (${se})`);
    return m;
  };
  const degs = allThetas.map((t) => (t * 180) / Math.PI);
  return {
    cutter: merge(cutters, 'cutter'),
    filler: merge(fillers, 'filler'),
    expectVol: expectRemove,
    expectAdd,
    runCount: splitRuns.length,
    convexRuns: splitRuns.filter((r) => r.convex).length,
    concaveRuns: splitRuns.filter((r) => !r.convex).length,
    thetaRunCount: countThetaRuns(segs),
    singleRun: splitRuns.length === 1,
    varyingProfile: true,
    ringCount,
    clampedKnots,
    thetaMinDeg: +Math.min(...degs).toFixed(2),
    thetaMaxDeg: +Math.max(...degs).toFixed(2),
    endExtend,
  };
}

/**
 * C3 hard: per-knot path-normal inscribed-arc frames via buildVariableProfileFrames.
 * Probes wall normals at densified knots, then sweeps with those N/B/theta frames.
 */

/**
 * Bbox as plain arrays. Manifold's min/max are indexable vec3s.
 */
function _s23ReadBBox(part) {
  const bb = part.boundingBox();
  return {
    min: [Number(bb.min[0]), Number(bb.min[1]), Number(bb.min[2])],
    max: [Number(bb.max[0]), Number(bb.max[1]), Number(bb.max[2])],
  };
}

/**
 * How far a concave fillet section reaches past the edge, in the wall plane.
 * The open-end pad is along the tangent and is not part of this.
 */
function _s23FilletSectionReach(radius, theta) {
  const th = Math.min(Math.PI - 0.08, Math.max(0.08, Number(theta) || Math.PI / 2));
  const e = filletSweepCutterExpand(radius);
  const tanHalf = Math.tan(th / 2);
  if (!(tanHalf > 1e-6)) return radius + e + 0.05;
  // Leg setback, plus the rear bumper's own setback. 0.05 keeps the
  // tangent point off the clip face (the box also carries a 1e-3 skin).
  return (radius + e) / tanHalf + 0.05;
}

/**
 * An open end that leaves through a face of the part box must not grow
 * that side: the pad along the tangent is what the clip is for. Other
 * sides grow by the fillet section, so a round that fills an exterior
 * corner (the bend root, below the sheet) is kept.
 */
function _s23ZeroGrowOnBBoxExit(growMin, growMax, bb, pt, tout) {
  const eps = 0.05;
  const sides = [
    [pt[0] - bb.min[0], growMin, 0, [-1, 0, 0]],
    [bb.max[0] - pt[0], growMax, 0, [1, 0, 0]],
    [pt[1] - bb.min[1], growMin, 1, [0, -1, 0]],
    [bb.max[1] - pt[1], growMax, 1, [0, 1, 0]],
    [pt[2] - bb.min[2], growMin, 2, [0, 0, -1]],
    [bb.max[2] - pt[2], growMax, 2, [0, 0, 1]],
  ];
  for (const [d, arr, k, n] of sides) {
    if (d <= eps && _c4Dot(tout, n) > _S23_EXIT_ALIGN) arr[k] = 0;
  }
}

/**
 * Drop the open-end pad that left the pre-fillet bbox. `grow` widens the
 * box by the fillet section on sides the path does not exit, so the round
 * itself can sit outside the part. eps keeps the original skin (float).
 */
function _s23ClipToBBox(M, solid, bb, grow) {
  const eps = 1e-3;
  const g0 = grow && grow.min ? grow.min : [0, 0, 0];
  const g1 = grow && grow.max ? grow.max : [0, 0, 0];
  const min = [
    bb.min[0] - (Number(g0[0]) || 0),
    bb.min[1] - (Number(g0[1]) || 0),
    bb.min[2] - (Number(g0[2]) || 0),
  ];
  const max = [
    bb.max[0] + (Number(g1[0]) || 0),
    bb.max[1] + (Number(g1[1]) || 0),
    bb.max[2] + (Number(g1[2]) || 0),
  ];
  const size = [
    max[0] - min[0] + 2 * eps,
    max[1] - min[1] + 2 * eps,
    max[2] - min[2] + 2 * eps,
  ];
  const c = [
    (max[0] + min[0]) / 2,
    (max[1] + min[1]) / 2,
    (max[2] + min[2]) / 2,
  ];
  const box = M.cube(size, true).translate(c);
  const clipped = M.intersection(solid, box);
  const se = _c4StatusError(clipped);
  if (se) throw new Error(`filletAlongPath: bad open-end clip (${se})`);
  return clipped;
}

/**
 * Face the concave chain is leaving through, or null when the end runs into
 * material (a hollow cavity's inner ceiling). The sheet skin of a through
 * cutout is exterior even when a flange puts it inside the part bbox.
 * Alignment is the outward tangent against the face normal: the two hole
 * walls sit on the same vertex and are perpendicular, so they lose.
 */
const _S23_EXIT_ALIGN = 0.85;
const _S23_EXIT_NEAR2 = 0.75 * 0.75;

function _s23ExteriorExitPlane(pt, tout) {
  if (!pt || !tout || !_s23FaceSoup || !_s23FaceSoup.length) return null;
  let bestN = null;
  let bestP = null;
  let bestAlign = _S23_EXIT_ALIGN;
  let bestD2 = Infinity;
  for (const tri of _s23FaceSoup) {
    const d2 = _pointTriDist2(pt, tri.a, tri.b, tri.c);
    if (d2 > _S23_EXIT_NEAR2) continue;
    const n = _s23Norm(tri.n);
    const align = _c4Dot(tout, n);
    if (!(align > _S23_EXIT_ALIGN)) continue;
    // The face the end lies on wins over a parallel face nearby. B6: a boss
    // 10 mm wide on a 10.75 mm plate — the plate side 0.375 mm out tied the
    // boss end wall on alignment, took the clip plane out to itself, and the
    // filler grew 0.375 mm wings past both ends of the edge.
    const nearer = d2 < bestD2 - 1e-9;
    const sameAndStraighter = Math.abs(d2 - bestD2) <= 1e-9 && align > bestAlign;
    if (nearer || sameAndStraighter) {
      bestD2 = d2;
      bestAlign = align;
      bestN = n;
      bestP = tri.a;
    }
  }
  if (!bestN || !bestP) return null;
  return { p: [bestP[0], bestP[1], bestP[2]], n: bestN };
}

/**
 * Is there material just past an open concave end, where the pad would go?
 * Probes a point a little beyond the endpoint along the outward tangent and
 * a little into the empty wedge the filler occupies (f0 + f1 span that
 * wedge on a concave segment). Inside the part: the end runs into material
 * (a pocket end wall, an inner ceiling) and the pad is swallowed. Outside:
 * the end meets air, as at a corner a previous fillet rounded (B7, follow-up
 * 4): the straight concave segment stops where the round begins, no face is
 * aligned with the tangent there, and a pad would stand proud as a nub or a
 * flap through the round. Two tiny booleans per chain, never per edge.
 */
function _s23MaterialPastEnd(part, pt, tout, seg, radius) {
  const f0 = seg && seg.f0;
  const f1 = seg && seg.f1;
  if (!part || !pt || !tout || !f0 || !f1) return true;
  const bis = [f0[0] + f1[0], f0[1] + f1[1], f0[2] + f1[2]];
  const bl = Math.hypot(bis[0], bis[1], bis[2]);
  if (!(bl > 1e-9)) return true;
  const along = Math.max(0.05, Math.min(0.1, 0.25 * filletSweepCutterExpand(radius)));
  const into = Math.max(0.05, Math.min(0.3, 0.1 * (Number(radius) || 0)));
  const p = [
    pt[0] + tout[0] * along + (bis[0] / bl) * into,
    pt[1] + tout[1] * along + (bis[1] / bl) * into,
    pt[2] + tout[2] * along + (bis[2] / bl) * into,
  ];
  const M = manifoldModule.Manifold;
  const s = 0.02;
  try {
    const probe = M.cube([s, s, s], true).translate(p);
    const hit = M.intersection(part, probe);
    return !_c4StatusError(hit) && hit.volume() > 0.5 * s * s * s;
  } catch (_) {
    return true;
  }
}

/**
 * The pre-fillet bbox clip already cuts a pad that leaves through a face of
 * the part box (a shell opening, or the outer skin of a flat plate). Skip
 * the local face clip there so that boolean stays the one the hollow golden
 * measured. A sheet skin inside the box — the base under a flange, the
 * inner face of a wall — is not this case.
 */
function _s23ExitsThroughBBox(bb, pt, tout) {
  const eps = 0.05;
  const faces = [
    [pt[0] - bb.min[0], [-1, 0, 0]],
    [bb.max[0] - pt[0], [1, 0, 0]],
    [pt[1] - bb.min[1], [0, -1, 0]],
    [bb.max[1] - pt[1], [0, 1, 0]],
    [pt[2] - bb.min[2], [0, 0, -1]],
    [bb.max[2] - pt[2], [0, 0, 1]],
  ];
  for (const [d, n] of faces) {
    if (d <= eps && _c4Dot(tout, n) > _S23_EXIT_ALIGN) return true;
  }
  return false;
}

/**
 * Cut `solid` back to the keep side of each plane (dot(X − p, n) ≤ 1e-3).
 * The filler was padded past the face; this intersection throws that
 * overshoot away. The 1e-3 is the same skin margin as the bbox clip: a
 * cap cut exactly on the face comes back as the open-end fan. The part
 * itself is not clipped, so a flange stays.
 */
function _s23ClipSolidToPlanes(M, solid, planes) {
  let out = solid;
  for (const plane of planes) {
    const bb = _s23ReadBBox(out);
    const c = [
      (bb.min[0] + bb.max[0]) / 2,
      (bb.min[1] + bb.max[1]) / 2,
      (bb.min[2] + bb.max[2]) / 2,
    ];
    const diag = Math.hypot(
      bb.max[0] - bb.min[0],
      bb.max[1] - bb.min[1],
      bb.max[2] - bb.min[2],
    ) + 4;
    const N = _s23Norm(plane.n);
    const hint = Math.abs(N[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const X = _s23Norm(_s23Cross(hint, N));
    const Y = _s23Norm(_s23Cross(N, X));
    const side = _c4Dot(_s23Sub(c, plane.p), N);
    // Same 1e-3 the bbox clip leaves outside the skin. Exact coincidence
    // puts the filler cap back in the opening plane and the fan returns.
    const eps = 1e-3;
    const face = [
      c[0] - N[0] * side + N[0] * eps,
      c[1] - N[1] * side + N[1] * eps,
      c[2] - N[2] * side + N[2] * eps,
    ];
    const center = [face[0] - N[0] * diag, face[1] - N[1] * diag, face[2] - N[2] * diag];
    const S = diag * 2;
    const box = M.cube([S, S, S], true).transform([
      X[0], X[1], X[2], 0,
      Y[0], Y[1], Y[2], 0,
      N[0], N[1], N[2], 0,
      center[0], center[1], center[2], 1,
    ]);
    const clipped = M.intersection(out, box);
    const se = _c4StatusError(clipped);
    if (se) throw new Error(`filletAlongPath: bad face clip (${se})`);
    out = clipped;
  }
  return out;
}

/**
 * Outward wall planes of a straight concave run (the empty side of each
 * face). A turning chain returns null — its walls are not one pair of planes.
 */
function _s23StraightEmptySidePlanes(segs) {
  const conc = (segs || []).filter((s) => s && s.convex === false && s.f0 && s.f1 && s.T && s.p0);
  if (!conc.length) return null;
  const f0 = _s23Norm(conc[0].f0);
  const f1 = _s23Norm(conc[0].f1);
  for (let i = 1; i < conc.length; i++) {
    const a0 = _s23Norm(conc[i].f0);
    const a1 = _s23Norm(conc[i].f1);
    const same = (Math.abs(_s23Dot(a0, f0)) > 0.98 && Math.abs(_s23Dot(a1, f1)) > 0.98)
      || (Math.abs(_s23Dot(a0, f1)) > 0.98 && Math.abs(_s23Dot(a1, f0)) > 0.98);
    if (!same) return null;
  }
  const T = _s23Norm(conc[0].T);
  let n0 = _s23Cross(T, f0);
  if (_s23Dot(n0, f1) < 0) n0 = [-n0[0], -n0[1], -n0[2]];
  n0 = _s23Norm(n0);
  let n1 = _s23Cross(T, f1);
  if (_s23Dot(n1, f0) < 0) n1 = [-n1[0], -n1[1], -n1[2]];
  n1 = _s23Norm(n1);
  if (!(Math.hypot(n0[0], n0[1], n0[2]) > 0.5) || !(Math.hypot(n1[0], n1[1], n1[2]) > 0.5)) return null;
  const p = conc[0].p0;
  return [{ p, n: n0 }, { p, n: n1 }];
}

/**
 * The expand pad pushes a strip past each wall so the union is not coplanar.
 * On a convex cutter that strip sits in empty space and the subtract ignores
 * it. On this concave edge one wall is the base's end face, and below the
 * sheet that "material" side is void, so the strip hangs as a lip and the
 * added volume is about twice the section. Cut that lip off the filler that
 * left the part box. Filler inside the box (a cutout corner) is not touched.
 * The nominal round is on the empty side of both walls and stays.
 */
function _s23ClipExteriorFillerLip(M, filler, bb, segs) {
  const walls = _s23StraightEmptySidePlanes(segs);
  if (!walls || !filler || !bb) return filler;
  const eps = 1e-3;
  const size = [
    bb.max[0] - bb.min[0] + 2 * eps,
    bb.max[1] - bb.min[1] + 2 * eps,
    bb.max[2] - bb.min[2] + 2 * eps,
  ];
  const c = [
    (bb.max[0] + bb.min[0]) / 2,
    (bb.max[1] + bb.min[1]) / 2,
    (bb.max[2] + bb.min[2]) / 2,
  ];
  const box = M.cube(size, true).translate(c);
  let outside;
  try {
    outside = M.difference(filler, box);
  } catch (_) {
    return filler;
  }
  if (_c4StatusError(outside) || !(outside.volume() > 1e-6)) return filler;
  // _s23ClipSolidToPlanes keeps the side opposite the given normal.
  // Negating the outward wall normal keeps the empty side, plus 1e-3.
  const planes = walls.map((w) => ({
    p: w.p,
    n: [-w.n[0], -w.n[1], -w.n[2]],
  }));
  let kept;
  try {
    kept = _s23ClipSolidToPlanes(M, outside, planes);
  } catch (_) {
    return filler;
  }
  if (_c4StatusError(kept)) return filler;
  let inside;
  try {
    inside = M.intersection(filler, box);
  } catch (_) {
    return filler;
  }
  if (_c4StatusError(inside)) return filler;
  try {
    const out = M.union([inside, kept]);
    if (_c4StatusError(out)) return filler;
    return out;
  } catch (_) {
    return filler;
  }
}

/**
 * Concave filler caps are coplanar with the face the edge ends on.
 * On an open shell the free end is the opening (outside the bbox): the cap
 * leaves a triangular fan. The other end sits on the inner ceiling, inside
 * the bbox: the same coplanar cap is a shallow lip along the wall-ceiling
 * junction. Extend EVERY concave open-chain end by the usual cutter-expand
 * pad (not a deeper blend). The caller still clips the result to the
 * pre-fillet bbox, widened by the fillet section except on a side the
 * open end leaves through. That cuts the pad off and keeps a round that
 * fills an exterior corner outside the box.
 *
 * That bbox is the wrong slab on a bent sheet. The inside corner of a
 * rectangular cutout runs through the thickness; a flange makes the part
 * box taller than the base and wider than a wall, so the pad stays proud
 * of the local skin. Ends that leave through an exterior face inside the
 * part box are recorded here and the filler is cut back to those planes
 * before the union. An end on the part box stays with the bbox clip. An
 * end that runs into material is not recorded — its pad is swallowed.
 * Convex sweeps are not extended.
 */
function _s23ExtendConcaveOpenEnds(part, segs, closed, radius) {
  if (closed || !Array.isArray(segs) || !segs.length) return null;
  const pad = filletSweepCutterExpand(radius);
  if (!(pad > 1e-9)) return null;
  const bb = _s23ReadBBox(part);
  const planes = [];
  let reach = 0;
  for (const seg of segs) {
    if (!seg || seg.convex !== false) continue;
    const got = _s23FilletSectionReach(radius, seg.theta);
    if (got > reach) reach = got;
  }
  const growMin = [reach, reach, reach];
  const growMax = [reach, reach, reach];
  const bump = (seg, which) => {
    if (!seg || seg.convex !== false || !seg.T || !seg.p0 || !seg.p1) return false;
    const T = seg.T;
    const dir = which === 'start' ? [-T[0], -T[1], -T[2]] : [T[0], T[1], T[2]];
    const pt = which === 'start' ? seg.p0 : seg.p1;
    const tLen = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const tout = [dir[0] / tLen, dir[1] / tLen, dir[2] / tLen];
    _s23ZeroGrowOnBBoxExit(growMin, growMax, bb, pt, tout);
    const exitsBox = _s23ExitsThroughBBox(bb, pt, tout);
    const plane = _s23ExteriorExitPlane(pt, tout);
    if (plane && !exitsBox) planes.push(plane);
    // No face to clip against and nothing past the end to swallow the pad:
    // the tube ends flush at the endpoint (B7: a nub at a rounded corner).
    if (!plane && !exitsBox && !_s23MaterialPastEnd(part, pt, tout, seg, radius)) return false;
    const moved = [pt[0] + dir[0] * pad, pt[1] + dir[1] * pad, pt[2] + dir[2] * pad];
    if (which === 'start') seg.p0 = moved;
    else seg.p1 = moved;
    seg.length = (Number(seg.length) || 0) + pad;
    return true;
  };
  const a = bump(segs[0], 'start');
  const b = bump(segs[segs.length - 1], 'end');
  return (a || b) ? { bb, planes, grow: { min: growMin, max: growMax } } : null;
}

/**
 * How far an open cutter end must travel along its outward tangent so the
 * whole end profile clears a face that is not perpendicular to the path.
 * A face the end profile already clears (clearance about 0) needs no
 * extension — a perpendicular cap, including a 90° end. Alignment with the
 * face normal is not that test: a 2° draft is tighter than cos(2°) and the
 * profile still stops short. Clearance is the worst profile point, then the
 * sweep expand pad. Not a sphere cap, and not the concave open-end pad
 * above (that one runs on every concave end and is clipped back to the bbox).
 */
// Plain-JS copy of the faces c4MeshData already walked. A second getMesh()
// on the live fillet input shifts a later decompose by ~0.01 and fails the
// move centroid gate, so the end extension must not touch the solid again.
let _s23CaptureFaceSoupOn = false;
let _s23FaceSoupPart = null;
let _s23FaceSoup = null;

// One fillet builds every cutter against the same solid. signedFeatureEdges
// walks the whole mesh. Cache that walk on the part object so each semi-arc
// run does not rebuild it. The boolean result is a different object, so the
// next fillet misses and rebuilds.
let _s23FeatureEdgePart = null;
let _s23FeatureEdges = null;

function _s23ProbeFeatureEdges(part) {
  if (part && part === _s23FeatureEdgePart && _s23FeatureEdges) return _s23FeatureEdges;
  _s23CaptureFaceSoupOn = true;
  try {
    const edges = signedFeatureEdges(part);
    _s23FeatureEdgePart = part;
    _s23FeatureEdges = edges;
    return edges;
  } finally {
    _s23CaptureFaceSoupOn = false;
  }
}

function _s23RememberFaceSoup(part, faces, V, triVerts) {
  const soup = [];
  for (const f of faces) {
    const n = f && f.normal;
    if (!n || _c4Len(n) < 0.5 || !Array.isArray(f.tris)) continue;
    const nn = [n[0], n[1], n[2]];
    for (const t of f.tris) {
      const i0 = triVerts[t * 3];
      const i1 = triVerts[t * 3 + 1];
      const i2 = triVerts[t * 3 + 2];
      const a = V[i0];
      const b = V[i1];
      const c = V[i2];
      if (!a || !b || !c) continue;
      soup.push({
        n: nn,
        a: [a[0], a[1], a[2]],
        b: [b[0], b[1], b[2]],
        c: [c[0], c[1], c[2]],
      });
    }
  }
  _s23FaceSoupPart = part;
  _s23FaceSoup = soup;
}

function _s23DraftEndExtension(part, origin, tout, N, B, theta, radius, profileKind, arcSegs) {
  if (!part || !origin || !tout || !N || !B) return 0;
  if (!(Number(theta) > 0.05) || !(Number(radius) > 0)) return 0;
  if (_s23FaceSoupPart !== part || !_s23FaceSoup) return 0;
  const alignGate = 0.2;
  const near2 = 0.35 * 0.35;
  let faceN = null;
  let bestAlign = alignGate;
  for (const tri of _s23FaceSoup) {
    if (_pointTriDist2(origin, tri.a, tri.b, tri.c) > near2) continue;
    const align = _c4Dot(tout, tri.n);
    if (align > bestAlign) {
      bestAlign = align;
      faceN = tri.n;
    }
  }
  if (!faceN) return 0;
  const contour = _s23DihedralContour(radius, theta, profileKind, arcSegs, 1);
  let geom = 0;
  for (const uv of contour) {
    const u = Number(uv[0]);
    const v = Number(uv[1]);
    const Q = [
      u * N[0] + v * B[0],
      u * N[1] + v * B[1],
      u * N[2] + v * B[2],
    ];
    const need = -_c4Dot(Q, faceN) / bestAlign;
    if (need > geom) geom = need;
  }
  if (!(geom > 1e-4)) return 0;
  const pad = filletSweepCutterExpand(radius);
  const cap = 2 * radius + pad;
  return Math.min(geom, cap) + pad;
}

/**
 * Internal splits milder than a real corner. Same-radius semi-arc cuts and
 * a shallow arc-to-straight kink (over the 5° corner gate, under ~20°) both
 * leave two open ends. Their face alignment is often under the 0.2 draft
 * gate, so the geometric extension stays 0 and the cutters meet with no
 * overlap. Push those ends by the sweep expand pad. A 90° corner split is
 * not this case.
 */
const _S23_SHALLOW_SPLIT_DEG = 20;

/** Turn (degrees) where two open runs meet, or null when they do not share an end. */
function _s23RunJunctionTurn(prev, next) {
  if (!Array.isArray(prev) || !Array.isArray(next) || prev.length < 2 || next.length < 2) return null;
  const a = prev[prev.length - 1];
  const b = next[0];
  if (!a || !b) return null;
  if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-3) return null;
  const da = [
    a[0] - prev[prev.length - 2][0],
    a[1] - prev[prev.length - 2][1],
    a[2] - prev[prev.length - 2][2],
  ];
  const db = [next[1][0] - b[0], next[1][1] - b[1], next[1][2] - b[2]];
  const la = Math.hypot(da[0], da[1], da[2]);
  const lb = Math.hypot(db[0], db[1], db[2]);
  if (!(la > 1e-12) || !(lb > 1e-12)) return null;
  const dot = (da[0] * db[0] + da[1] * db[1] + da[2] * db[2]) / (la * lb);
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

function _s23StampJunctionTurns(segs, junction) {
  if (!junction || !Array.isArray(segs) || !segs.length) return;
  if (Number.isFinite(junction.in) && junction.in <= _S23_SHALLOW_SPLIT_DEG && segs[0]) {
    segs[0]._splitInDeg = junction.in;
  }
  const last = segs[segs.length - 1];
  if (Number.isFinite(junction.out) && junction.out <= _S23_SHALLOW_SPLIT_DEG && last) {
    last._splitOutDeg = junction.out;
  }
}

/**
 * Extend an open run end without moving the knot. The original station stays
 * a cutter ring; the pad is a new colinear station past it, same frame.
 * Moving the knot instead left that 5° station with no ring (the quality
 * golden) and pulled the junction off the neighbor run.
 */
function _s23SpliceOpenEnd(segs, which, dist) {
  if (!Array.isArray(segs) || !segs.length || !(dist > 1e-4)) return 0;
  const seg = which === 'end' ? segs[segs.length - 1] : segs[0];
  if (!seg?.T || !seg.N || !seg.B || !seg.p0 || !seg.p1) return 0;
  const tLen = Math.hypot(seg.T[0], seg.T[1], seg.T[2]);
  if (!(tLen > 1e-12)) return 0;
  const T = [seg.T[0] / tLen, seg.T[1] / tLen, seg.T[2] / tLen];
  const tout = which === 'end' ? T : [-T[0], -T[1], -T[2]];
  const origin = (which === 'end' ? seg.p1 : seg.p0).slice();
  const moved = [
    origin[0] + tout[0] * dist,
    origin[1] + tout[1] * dist,
    origin[2] + tout[2] * dist,
  ];
  const ext = {
    T: seg.T.slice(),
    N: seg.N.slice(),
    B: seg.B.slice(),
    theta: seg.theta,
    length: dist,
    f0: seg.f0,
    f1: seg.f1,
    convex: seg.convex,
    p0: which === 'end' ? origin : moved,
    p1: which === 'end' ? moved : origin.slice(),
  };
  if (which === 'end') segs.push(ext);
  else segs.unshift(ext);
  return dist;
}

function _s23PadShallowSplitEnd(segs, which, turnDeg, radius) {
  // No tag: this is an original path end (the draft extension owns it).
  // Above ~20°: a hard corner split, left to the two cutters' own overlap.
  // A same-radius joint can be far under the 5° corner gate after densify
  // and still meets as two open ends with no overlap.
  if (!Number.isFinite(turnDeg) || turnDeg > _S23_SHALLOW_SPLIT_DEG) return 0;
  const pad = filletSweepCutterExpand(radius);
  if (!(pad > 1e-9)) return 0;
  return _s23SpliceOpenEnd(segs, which, pad);
}

/** A run whose ends do not share a tangent is a rounded path. */
function _s23RunRounded(segs) {
  if (!Array.isArray(segs) || segs.length < 2) return false;
  const dir = (s) => {
    if (!s?.T) return null;
    const L = Math.hypot(s.T[0], s.T[1], s.T[2]);
    return L > 1e-12 ? [s.T[0] / L, s.T[1] / L, s.T[2] / L] : null;
  };
  const a = dir(segs[0]);
  const b = dir(segs[segs.length - 1]);
  if (!a || !b) return false;
  return _c4Dot(a, b) < Math.cos((8 * Math.PI) / 180);
}

/**
 * Push open cutter ends that land on a tilted face. Convex runs only.
 * A rounded path samples the face at the back end and extends only that end.
 * Returns the longest extension applied (mm).
 */
function _s23ExtendOpenRunEnds(part, segs, radius, profileKind, arcSegs, skip = null) {
  if (!part || !Array.isArray(segs) || !segs.length) return 0;
  if (segs.some((s) => s && s.convex === false)) return 0;
  const whichEnds = (_s23RunRounded(segs) ? ['end'] : ['start', 'end'])
    .filter((which) => !(skip && skip[which]));
  let applied = 0;
  const drafted = new Set();
  for (const which of whichEnds) {
    const seg = which === 'end' ? segs[segs.length - 1] : segs[0];
    if (!seg?.T || !seg.N || !seg.B || !seg.p0 || !seg.p1) continue;
    const tLen = Math.hypot(seg.T[0], seg.T[1], seg.T[2]);
    if (!(tLen > 1e-12)) continue;
    const T = [seg.T[0] / tLen, seg.T[1] / tLen, seg.T[2] / tLen];
    const tout = which === 'end' ? T : [-T[0], -T[1], -T[2]];
    const origin = which === 'end' ? seg.p1 : seg.p0;
    const dist = _s23DraftEndExtension(
      part, origin, tout, seg.N, seg.B, seg.theta, radius, profileKind, arcSegs,
    );
    if (!(dist > 1e-4)) continue;
    const spliced = _s23SpliceOpenEnd(segs, which, dist);
    if (!(spliced > 0)) continue;
    drafted.add(which);
    if (spliced > applied) applied = spliced;
  }
  // Shallow internal splits only. Original path ends have no split tag, and
  // an end the draft extension already moved is left at that distance.
  const shallow = [
    ['start', segs[0] && segs[0]._splitInDeg],
    ['end', segs[segs.length - 1] && segs[segs.length - 1]._splitOutDeg],
  ];
  for (const [which, turn] of shallow) {
    if (drafted.has(which)) continue;
    const pad = _s23PadShallowSplitEnd(segs, which, turn, radius);
    if (pad > applied) applied = pad;
  }
  return applied;
}

function _s23BuildVariableProfileCutter(
  M, CrossSection, part, points, closed, radius, profileKind, arcSegs, testScale, rawSegCount, junction, carried = null,
) {
  const { segmentNormals, seedNormals, segmentConvex } = _s23ProbeKnotNormals(part, points, closed, carried);
  const built = buildVariableProfileFrames(points, closed, {
    radius,
    segmentNormals,
    seedNormals,
    segmentConvex,
  });
  const frames = built.frames || [];
  const n = points.length;
  const segCount = closed ? n : n - 1;
  // buildVariableProfileFrames always emits one frame per segment (strong or weak),
  // so a length≠segCount throw is unreachable; strongFrames loud-fail covers the gap.
  const strong = frames.filter((fr) => !fr.weak).length;
  if (!strong) {
    throw new Error(
      'filletAlongPath: could not orient cutter to part (no inscribed-arc frames along the path). '
      + 'Pass opts.initialNormal, or re-pick edges.',
    );
  }
  const segs = [];
  for (let i = 0; i < segCount; i++) {
    const fr = frames[i];
    const p0 = points[i];
    const p1 = points[(i + 1) % n];
    const length = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    segs.push({
      T: fr.T,
      N: fr.N,
      B: fr.B,
      theta: fr.theta,
      length,
      f0: fr.f0,
      f1: fr.f1,
      p0,
      p1,
      convex: segmentConvex[i] !== false,
    });
  }
  _s23StampJunctionTurns(segs, junction);
  // Open-shell concave ends: pad past the open face so the filler cap is not
  // coplanar with it (the inner-corner triangle). Convex runs are left alone.
  // The probe above already filled the face soup this reads.
  const openEnd = _s23ExtendConcaveOpenEnds(part, segs, closed, radius);
  // C3.3: one continuous cutter with a PER-KNOT section. C3.2's single median
  // θ removed the staircase but gouged wherever the true θ was far from the
  // median; θ-grouped runs (C3.1) put the same error back as steps.
  const cut = _s23VaryingProfileCutter(segs, closed, radius, profileKind, arcSegs, testScale, part);
  if (openEnd && cut.filler) {
    const Mclip = manifoldModule.Manifold;
    if (openEnd.planes.length) cut.filler = _s23ClipSolidToPlanes(Mclip, cut.filler, openEnd.planes);
    cut.filler = _s23ClipExteriorFillerLip(Mclip, cut.filler, openEnd.bb, segs);
  }
  _recordVariableProfileMeta({
    usedFrames: true,
    frameCount: frames.length,
    densifiedPoints: points.length,
    rawSegCount: Number(rawSegCount) || segCount,
    strongFrames: strong,
    alongPathTransport: built.transported !== false,
    maxFrameJumpDeg: typeof built.maxFrameJumpDeg === 'number'
      ? built.maxFrameJumpDeg
      : maxConsecutiveFrameAngleDeg(frames),
    singleRunCutter: cut.singleRun,
    varyingProfile: true,
    convexRuns: cut.convexRuns,
    concaveRuns: cut.concaveRuns,
    expectAdd: cut.expectAdd,
    ringCount: cut.ringCount,
    clampedKnots: cut.clampedKnots,
    thetaMinDeg: cut.thetaMinDeg,
    thetaMaxDeg: cut.thetaMaxDeg,
    runCount: cut.runCount,
    thetaRunCount: cut.thetaRunCount,
    endExtend: cut.endExtend || 0,
  });
  cut.openEndBBox = openEnd ? openEnd.bb : null;
  cut.openEndGrow = openEnd ? openEnd.grow : null;
  return cut;
}

function _s23BuildDihedralCutter(M, CrossSection, part, points, closed, radius, profileKind, arcSegs, testScale, junction, ends = null) {
  const segs = _s23ProbeSegments(part, points, closed);
  _s23StampJunctionTurns(segs, junction);
  const trimStart = !!(ends && ends.start);
  const trimEnd = !!(ends && ends.end);
  return _s23CuttersFromSegs(M, CrossSection, segs, closed, radius, profileKind, arcSegs, testScale, {
    part, trimStart, trimEnd, exactLegs: trimStart || trimEnd,
  });
}

/** Up to 48 samples along an already-normalized path, endpoints included. */
function _filletPathSamples(points) {
  const n = points.length;
  if (n <= 48) return points;
  const out = [];
  const last = n - 1;
  for (let i = 0; i < 48; i++) out.push(points[Math.round((i * last) / 47)]);
  return out;
}

/** Squared distance from p to triangle abc (Ericson, closest point on the triangle). */
function _pointTriDist2(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const d1 = _c4Dot(ab, ap);
  const d2 = _c4Dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return _c4Dot(ap, ap);
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
  const d3 = _c4Dot(ab, bp);
  const d4 = _c4Dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return _c4Dot(bp, bp);
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const d5 = _c4Dot(ab, cp);
  const d6 = _c4Dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return _c4Dot(cp, cp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const proj = [a[0] + ab[0] * v - p[0], a[1] + ab[1] * v - p[1], a[2] + ab[2] * v - p[2]];
    return _c4Dot(proj, proj);
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const proj = [a[0] + ac[0] * w - p[0], a[1] + ac[1] * w - p[1], a[2] + ac[2] * w - p[2]];
    return _c4Dot(proj, proj);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const edge = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const proj = [b[0] + edge[0] * w - p[0], b[1] + edge[1] * w - p[1], b[2] + edge[2] * w - p[2]];
    return _c4Dot(proj, proj);
  }
  const denom = va + vb + vc;
  if (!(Math.abs(denom) > 1e-20)) return _c4Dot(ap, ap);
  const v = vb / denom;
  const w = vc / denom;
  const proj = [
    a[0] + ab[0] * v + ac[0] * w - p[0],
    a[1] + ab[1] * v + ac[1] * w - p[1],
    a[2] + ab[2] * v + ac[2] * w - p[2],
  ];
  return _c4Dot(proj, proj);
}

/** Max, over samples, of the min squared distance to this body's triangles. */
function _filletBodyWorstDist2(body, samples) {
  const mesh = body.getMesh();
  const vp = mesh.vertProperties;
  const np = mesh.numProp || 3;
  const tv = mesh.triVerts;
  const nTri = Math.floor(tv.length / 3);
  if (!nTri || !samples.length) return Infinity;
  let worst = 0;
  for (const p of samples) {
    let best = Infinity;
    for (let t = 0; t < nTri; t++) {
      const i0 = tv[t * 3];
      const i1 = tv[t * 3 + 1];
      const i2 = tv[t * 3 + 2];
      const a = [vp[i0 * np], vp[i0 * np + 1], vp[i0 * np + 2]];
      const b = [vp[i1 * np], vp[i1 * np + 1], vp[i1 * np + 2]];
      const c = [vp[i2 * np], vp[i2 * np + 1], vp[i2 * np + 2]];
      const d = _pointTriDist2(p, a, b, c);
      if (d < best) best = d;
      if (best === 0) break;
    }
    if (best > worst) worst = best;
  }
  return worst;
}

/**
 * Multi-body input: fillet only the body that owns the path, then compose
 * the untouched bodies back. The scrap check inside the recursive call then
 * sees one result. A bad path throws before decompose. One body returns null
 * so the caller runs the existing path unchanged. Ties (shared cut edge,
 * both distances ~0) keep the first decompose index.
 * Returns null when there is nothing to split.
 */
/**
 * Union decompose pieces of one fillet result back into that body.
 * A wedge that shares a face with the owner was its own body; union joins
 * that contact and the volume stays. Pieces that remain separate are
 * returned unchanged so the 5% / 0.01 scrap gate still decides them.
 * Not for keep-both siblings — union would weld the cut back together.
 */
function _filletJoinOwnedPieces(M, solid) {
  if (!solid || typeof solid.decompose !== 'function') return solid;
  let parts;
  try { parts = solid.decompose(); } catch (_) { return solid; }
  if (!Array.isArray(parts) || parts.length < 2) return solid;
  try {
    let joined = parts[0];
    for (let i = 1; i < parts.length; i++) joined = M.union([joined, parts[i]]);
    const se = _c4StatusError(joined);
    if (se) return solid;
    const again = joined.decompose();
    if (Array.isArray(again) && again.length < parts.length) return joined;
  } catch (_) { /* scrap gate still sees the original pieces */ }
  return solid;
}

function _filletOnlyOwningBody(M, part, path, radius, opts) {
  const norm = _s23NormalizePath(path, opts);
  const bodies = _cutBodiesOf(part);
  if (!bodies || bodies.length < 2) return null;
  const samples = _filletPathSamples(norm.points);
  let owner = 0;
  let best = Infinity;
  for (let i = 0; i < bodies.length; i++) {
    const w = _filletBodyWorstDist2(bodies[i], samples);
    if (i === 0 || w < best - 1e-8) {
      best = w;
      owner = i;
    }
  }
  let filleted = null;
  try {
    filleted = filletAlongPath(
      bodies[owner],
      path,
      radius,
      Object.assign({}, opts, { _filletBodySplit: true }),
    );
    const kept = [];
    for (let i = 0; i < bodies.length; i++) kept.push(i === owner ? filleted : bodies[i]);
    const result = M.compose(kept);
    const status = _c4StatusError(result);
    if (status) {
      if (result && result !== filleted && result !== part) _safeDeleteManifold(result);
      throw new Error(`filletAlongPath: bad compose (${status})`);
    }
    const ownerBody = bodies[owner];
    if (ownerBody && ownerBody !== part && ownerBody !== filleted && ownerBody !== result) {
      _safeDeleteManifold(ownerBody);
    }
    return result;
  } catch (err) {
    if (filleted && filleted !== part) _safeDeleteManifold(filleted);
    for (const b of bodies) {
      if (b && b !== part && b !== filleted) _safeDeleteManifold(b);
    }
    throw err;
  }
}

/**
 * On a sheet, an open fillet continues past a flat/bend seam along the same
 * corner. The flange straight and the outer bend arc meet in space and not
 * at a vertex index, so a path of the straight used to stop on the tangent
 * plane: the round missed the bend and the thickness there. Walk feature
 * edges that touch the open end, stay tangent, and share a wall.
 *
 * The bend is a chain of facets, not one tangent edge. A length cap of
 * "the arc plus the thickness" rejected the flange straight (~28 mm) even
 * when the corner had not turned yet, so a pick that started on a facet
 * never reached the flange and left a step there. The cap applies only
 * after the tangent has turned through the bend. A midpoint within 0.25 mm
 * of the path also matched the next short facet (its midpoint is half a
 * chord past the open end) and the walk died on the first facet; 0.05 mm
 * is the endpoint weld, so only an edge already on the path is skipped.
 *
 * The arc's last vertex is the base corner, where the outer surface is
 * tangent to the panel. A cutter ring on that vertex lies in the panel and
 * the boolean stacks a skin, a gap, and the solid. Stop short of it. The
 * base edge stays sharp; the arc up to that inset is the round.
 * @param {object} part
 * @param {number[][]} points
 * @returns {number[][]}
 */
function _s23ExtendSheetCornerSpan(part, points) {
  const spec = _sheetFilletSpan;
  if (!spec || !part || !Array.isArray(points) || points.length < 2) return points;
  let edges;
  try {
    edges = _s23ProbeFeatureEdges(part);
  } catch (_) {
    return points;
  }
  if (!Array.isArray(edges) || edges.length < 2) return points;

  const t = spec.t;
  const bendR = spec.bendR;
  const bendRad = Math.min(Math.max(spec.angle, 1), 180) * Math.PI / 180;
  const arcLen = bendRad * (bendR + t);
  const chordMax = arcLen + t + 1;
  const budget = chordMax;
  const cosTol = Math.cos((28 * Math.PI) / 180);
  const cosWall = Math.cos((25 * Math.PI) / 180);
  const cosFlat = Math.cos((12 * Math.PI) / 180);
  const touch = 0.08;
  const turnedStop = Math.max(0, bendRad - (15 * Math.PI) / 180);

  const edgeGeom = (e) => {
    if (!e || !Array.isArray(e.va) || !Array.isArray(e.vb)) return null;
    const d = [e.vb[0] - e.va[0], e.vb[1] - e.va[1], e.vb[2] - e.va[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    if (!(L > 0.05)) return null;
    return { d, L, u: [d[0] / L, d[1] / L, d[2] / L] };
  };
  const distPt = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const distPoly = (p, poly) => {
    let best = Infinity;
    for (let i = 1; i < poly.length; i++) {
      const d = _s23PointSegDist(p, poly[i - 1], poly[i]);
      if (d < best) best = d;
    }
    return best;
  };
  const shareWall = (a, b) => {
    if (!a || !b || !a.n0 || !a.n1 || !b.n0 || !b.n1) return true;
    const hit = (p, q) => Math.abs(_s23Dot(_s23Unit(p), _s23Unit(q))) >= cosWall;
    return hit(a.n0, b.n0) || hit(a.n0, b.n1) || hit(a.n1, b.n0) || hit(a.n1, b.n1);
  };
  const wallAt = (origin, dir) => {
    let best = null;
    let bestD = Infinity;
    for (const e of edges) {
      const g = edgeGeom(e);
      if (!g) continue;
      if (Math.abs(_s23Dot(g.u, dir)) < 0.9) continue;
      const d = _s23PointSegDist(origin, e.va, e.vb);
      if (d > 0.35 || d >= bestD) continue;
      bestD = d;
      best = e;
    }
    return best;
  };

  const pts = points.map((p) => p.slice());
  // A chord already on the path has its midpoint on a segment. The next
  // facet's midpoint is half a chord past the open end — 0.25 mm treated
  // every chord shorter than 0.5 mm as already consumed and the walk died
  // on the first facet. 0.05 mm is the endpoint weld: on the path, or not.
  const onPath = 0.05;
  // Land this far short of a vertex that also belongs to the panel the arc
  // becomes tangent to. A ring on that vertex is coplanar with the panel
  // and the end face, and the boolean leaves a stack of sheets there.
  const panelInset = 0.15;
  const panelAt = (p) => {
    for (const e of edges) {
      const g = edgeGeom(e);
      if (!g || g.L <= t + 1) continue;
      if (Math.min(distPt(e.va, p), distPt(e.vb, p)) <= touch) return true;
    }
    return false;
  };
  const grow = (which) => {
    const start = (which === 'end' ? pts[pts.length - 1] : pts[0]).slice();
    const prev0 = which === 'end' ? pts[pts.length - 2] : pts[1];
    let seed = [start[0] - prev0[0], start[1] - prev0[1], start[2] - prev0[2]];
    const seedL = Math.hypot(seed[0], seed[1], seed[2]);
    if (!(seedL > 1e-9)) return;
    seed = [seed[0] / seedL, seed[1] / seedL, seed[2] / seedL];
    let added = 0;
    for (let guard = 0; guard < 64 && added < budget; guard++) {
      const origin = which === 'end' ? pts[pts.length - 1] : pts[0];
      const prev = which === 'end' ? pts[pts.length - 2] : pts[1];
      let tout = [origin[0] - prev[0], origin[1] - prev[1], origin[2] - prev[2]];
      const tl = Math.hypot(tout[0], tout[1], tout[2]);
      if (!(tl > 1e-9)) break;
      tout = [tout[0] / tl, tout[1] / tl, tout[2] / tl];
      const turned = Math.acos(Math.max(-1, Math.min(1, _s23Dot(tout, seed))));
      const wall = wallAt(origin, tout);
      let best = null;
      for (const e of edges) {
        const g = edgeGeom(e);
        if (!g) continue;
        // The arc-length cap stops a long panel only after the corner has
        // turned through the bend. Before that, the long edge is the flange
        // straight: a pick that starts on a bend facet has to reach it.
        // chordMax (~arc + t) is shorter than the flange, so capping first
        // left the round on the arc and a step where the flange meets it.
        if (g.L > chordMax && turned >= turnedStop) continue;
        const da = distPt(e.va, origin);
        const db = distPt(e.vb, origin);
        const nearA = da <= touch;
        const nearB = db <= touch;
        if (nearA === nearB) continue;
        const travel = nearA ? g.u : [-g.u[0], -g.u[1], -g.u[2]];
        const align = _s23Dot(travel, tout);
        if (align < cosTol) continue;
        const far = nearA ? e.vb : e.va;
        const mid = [
          (e.va[0] + e.vb[0]) / 2,
          (e.va[1] + e.vb[1]) / 2,
          (e.va[2] + e.vb[2]) / 2,
        ];
        if (distPoly(mid, pts) <= onPath) continue;
        if (wall && !shareWall(wall, e)) continue;
        if (typeof e.convex === 'boolean' && typeof wall?.convex === 'boolean' && e.convex !== wall.convex) {
          continue;
        }
        // The bend has turned; a longer collinear run is the panel edge.
        if (turned >= turnedStop && g.L > t + 1 && align >= cosFlat) continue;
        if (!best || align > best.align + 1e-4) best = { far, L: g.L, align, turned };
      }
      if (!best) break;
      let dest = [best.far[0], best.far[1], best.far[2]];
      let step = best.L;
      if (best.turned >= turnedStop && panelAt(dest)) {
        // The far vertex is the panel corner. A ring on it lies in the panel
        // and the boolean stacks sheets on the bend. Stop short of it.
        const back = Math.min(panelInset, best.L * 0.85);
        const dir = [dest[0] - origin[0], dest[1] - origin[1], dest[2] - origin[2]];
        const dl = Math.hypot(dir[0], dir[1], dir[2]);
        if (!(dl > back + 1e-6)) break;
        dest = [
          dest[0] - (dir[0] / dl) * back,
          dest[1] - (dir[1] / dl) * back,
          dest[2] - (dir[2] / dl) * back,
        ];
        step = dl - back;
      }
      if (which === 'end') pts.push(dest);
      else pts.unshift(dest);
      added += step;
      if (step < best.L - 1e-6) break;
    }
  };
  grow('end');
  grow('start');
  return pts;
}

/**
 * Count the zero-area triangles of a solid (the sliver-scrap signal).
 * @returns {{ tiny: number, nTri: number }}
 */
function _s23TinyTriangles(solid) {
  const mesh = solid.getMesh();
  const np = mesh.numProp || 3;
  const V = mesh.vertProperties;
  const T = mesh.triVerts;
  const nTri = T.length / 3;
  let tiny = 0;
  for (let ti = 0; ti < nTri; ti++) {
    const i0 = T[ti * 3] * np;
    const i1 = T[ti * 3 + 1] * np;
    const i2 = T[ti * 3 + 2] * np;
    const ax = V[i1] - V[i0], ay = V[i1 + 1] - V[i0 + 1], az = V[i1 + 2] - V[i0 + 2];
    const bx = V[i2] - V[i0], by = V[i2 + 1] - V[i0 + 1], bz = V[i2 + 2] - V[i0 + 2];
    const A = 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    if (A < 1e-8) tiny++;
  }
  return { tiny, nTri };
}

/**
 * Fillet an edge SET: one filletAlongPath per component in collect mode
 * (cutters and fillers built against the untouched solid, no boolean), then
 * one n-way subtract, the fillers unioned, and the set-level guards: removed
 * volume against the summed expectation, scrap components, degenerate
 * triangles. Components are built in pick order; the probes of a later chain
 * still see the vertex it shares with an earlier one.
 */
/**
 * Spherical corners inside a sweep edge set. A vertex where exactly three
 * chains end at right angles, all convex and all long enough, is the same
 * corner the planar kernel builds (`_c6CornerPocket`): the three chains are
 * trimmed to the junction planes r from the vertex, lose their draft end
 * extension there, keep their legs exactly on the faces, and one pocket
 * solid holds the sphere octant. The pocket's boundary arcs ARE the chains'
 * own end rings (the dihedral contour placed through the probed frame), so
 * the sail and the sphere share every ring vertex. Fillet profile only; a
 * chamfer, a variable-profile chain, or a legacy initialNormal sweep keeps
 * the cusp. Returns the trimmed components (with their trim flags) and the
 * pocket solids.
 */
function _s23JunctionPockets(M, part, path, radius, opts, arcSegs) {
  const comps = path.components.map((c) => ({ comp: c, trimStart: false, trimEnd: false }));
  const none = { components: comps, pockets: [] };
  if (opts.profile === 'chamfer' || opts.variableProfile || opts.initialNormal || opts._rawPath) return none;
  const ends = [];
  comps.forEach((row, ci) => {
    const pts = row.comp.points;
    if (row.comp.closed || !Array.isArray(pts) || pts.length < 2) return;
    const dirAt = (a, b) => _s23Norm(_s23Sub(pts[b], pts[a]));
    ends.push({ ci, which: 'start', P: pts[0], d: dirAt(0, 1) });
    ends.push({ ci, which: 'end', P: pts[pts.length - 1], d: dirAt(pts.length - 1, pts.length - 2) });
  });
  if (ends.length < 3) return none;
  // Group chain ends by vertex.
  const groups = [];
  for (const e of ends) {
    const g = groups.find((grp) => _c6Len(_c6Sub(grp[0].P, e.P)) <= 0.05);
    if (g) g.push(e); else groups.push([e]);
  }
  const candidates = groups.filter((g) => g.length === 3);
  if (!candidates.length) return none;
  const dot = (a, b) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
  const orthogonal = (g) => dot(g[0].d, g[1].d) < 1e-4 && dot(g[1].d, g[2].d) < 1e-4 && dot(g[2].d, g[0].d) < 1e-4;
  const probes = new Map(); // ci → segs | null
  const probe = (ci) => {
    if (probes.has(ci)) return probes.get(ci);
    let segs = null;
    try {
      const pts = comps[ci].comp.points;
      const carried = _s23CarriedEdges(comps[ci].comp);
      const scan = _s23ProbeKnotNormals(part, pts, false, carried);
      if (scan.segmentConvex.every((c) => c !== false)) segs = _s23ProbeSegments(part, pts, false);
    } catch { segs = null; }
    probes.set(ci, segs);
    return segs;
  };
  const endSeg = (e) => {
    const segs = probe(e.ci);
    if (!segs || !segs.length) return null;
    return e.which === 'start' ? segs[0] : segs[segs.length - 1];
  };
  const right = (seg) => seg && Number.isFinite(seg.theta) && Math.abs(seg.theta - Math.PI / 2) < 1e-4 && seg.N && seg.B;
  const corners = candidates
    .filter(orthogonal)
    .filter((g) => g.every((e) => right(endSeg(e))));
  if (!corners.length) return none;
  // Each trimmed end costs r of its chain; a chain too short for its caps
  // demotes every corner it touches.
  const trimmed = new Map();
  for (const g of corners) for (const e of g) trimmed.set(e.ci, (trimmed.get(e.ci) || 0) + 1);
  const keep = corners.filter((g) => g.every((e) => {
    const L = pathPolylineLength(comps[e.ci].comp.points, false);
    return L > radius * trimmed.get(e.ci) + 1e-6;
  }));
  if (!keep.length) return none;
  const pockets = [];
  for (const g of keep) {
    const P = g[0].P;
    const d = g.map((e) => e.d);
    const O = [
      P[0] + radius * (d[0][0] + d[1][0] + d[2][0]),
      P[1] + radius * (d[0][1] + d[1][1] + d[2][1]),
      P[2] + radius * (d[0][2] + d[1][2] + d[2][2]),
    ];
    const c = { P, r: radius, d, O };
    const arcs = g.map((e, k) => {
      const seg = endSeg(e);
      const K = [P[0] + radius * d[k][0], P[1] + radius * d[k][1], P[2] + radius * d[k][2]];
      // The chain's own end ring: dihedral contour with exact legs, placed
      // through the probed frame at the junction knot. Arc = contour[1..].
      const nominal = dihedralFilletContour(radius, seg.theta, arcSegs);
      const expanded = expandDihedralCutterContour(nominal, radius, seg.theta, { faceEps: 0 });
      const arc2D = expanded.slice(2, expanded.length - 1);
      let ring = _s23PlaceContourRing(arc2D, K, seg.N, seg.B);
      // Canonical order for the pocket: from the tangent point on face (k, j)
      // to the one on face (k, i), i < j the other two edges.
      const [i] = [0, 1, 2].filter((x) => x !== k);
      const want = [O[0] - radius * d[i][0], O[1] - radius * d[i][1], O[2] - radius * d[i][2]];
      if (_c6Len(_c6Sub(ring[0], want)) > _c6Len(_c6Sub(ring[ring.length - 1], want))) ring = ring.slice().reverse();
      // Trim the chain to the junction plane.
      const row = comps[e.ci];
      const pts = row.comp.points.slice();
      if (e.which === 'start') { pts[0] = K; row.trimStart = true; } else { pts[pts.length - 1] = K; row.trimEnd = true; }
      row.comp = { ...row.comp, points: pts };
      return ring;
    });
    const pocket = _c6CornerPocket(M, c, { arcs });
    try {
      const ids = pocket.getMesh().runOriginalID;
      for (let i = 0; i < ids.length; i++) _blendCornerIDs.add(ids[i]);
    } catch { /* no id: stays .round */ }
    pockets.push(pocket);
  }
  return { components: comps, pockets };
}

function _s23FilletEdgeSet(M, part, path, radius, opts) {
  const arcSegs = opts.segments != null ? opts.segments : FILLET_ARC_SEGMENTS;
  const prep = _s23JunctionPockets(M, part, path, radius, opts, arcSegs);
  const pieces = prep.components.map((row) => filletAlongPath(part, row.comp, radius, {
    ...opts, _collect: true, _trimStart: row.trimStart, _trimEnd: row.trimEnd,
  }));
  const cutters = [...prep.pockets];
  const fillers = [];
  let expectVol = 0;
  let expectAdd = 0;
  for (const piece of pieces) {
    for (const c of piece.cutters) cutters.push(c);
    for (const f of piece.fillers) fillers.push(f);
    if (Number.isFinite(piece.expectVol)) expectVol += piece.expectVol;
    if (Number.isFinite(piece.expectAdd)) expectAdd += piece.expectAdd;
  }
  // A corner pocket removes the cusp: r³(1 − π/6) less the three sail
  // overlaps it replaces. The sum is only a [2 %, 8×] band, so the cube is
  // close enough.
  expectVol += prep.pockets.length * radius * radius * radius * (1 - Math.PI / 6);
  if (!cutters.length && !fillers.length) {
    throw new Error('filletAlongPath: the edge set produced no cutter — re-pick edges');
  }
  let out = part;
  let removed = 0;
  if (cutters.length) {
    let cut;
    try {
      cut = cutters.length === 1 ? M.difference(out, cutters[0]) : M.difference([out, ...cutters]);
    } catch (e) {
      throw new Error(`filletAlongPath: edge-set subtract failed — ${e && e.message ? e.message : e}`);
    }
    const se = _c4StatusError(cut);
    if (se) throw new Error(`filletAlongPath: bad edge-set result (${se})`);
    const v = cut.volume();
    if (!(v > 1e-9)) throw new Error('filletAlongPath: result is EMPTY (cutters consumed the solid) — reduce radius');
    removed = out.volume() - v;
    out = cut;
    if (expectVol > 1e-3 && removed < 0.02 * expectVol) {
      throw new Error(
        `filletAlongPath: edge set removed only ${removed.toFixed(4)} vs expected ~${expectVol.toFixed(4)} `
        + '(orientation/overlap failure) — failing loud rather than shipping a near-no-op solid',
      );
    }
    if (expectVol > 1e-3 && removed > 8 * expectVol) {
      throw new Error(
        `filletAlongPath: edge set removed ${removed.toFixed(4)} vs expected ~${expectVol.toFixed(4)} `
        + '(cutter far larger than requested radius) — failing loud',
      );
    }
  }
  if (fillers.length) {
    const vPre = out.volume();
    let add;
    try {
      add = M.union([out, ...fillers.map((f) => f.filler)]);
    } catch (e) {
      throw new Error(`filletAlongPath: edge-set union failed — ${e && e.message ? e.message : e}`);
    }
    const se = _c4StatusError(add);
    if (se) throw new Error(`filletAlongPath: bad edge-set result (${se})`);
    const added = add.volume() - vPre;
    out = add;
    if (expectAdd > 1e-3 && added < 0.02 * expectAdd) {
      throw new Error(
        `filletAlongPath: edge set added only ${added.toFixed(4)} vs expected ~${expectAdd.toFixed(4)} — failing loud`,
      );
    }
    for (const f of fillers) {
      if (f.openEndBBox) out = _s23ClipToBBox(M, out, f.openEndBBox, f.openEndGrow);
    }
  }
  // Scrap: the open-path rule (keep the largest when the rest is dust).
  out = _filletJoinOwnedPieces(M, out);
  if (typeof out.decompose === 'function') {
    const bodies = out.decompose();
    if (Array.isArray(bodies) && bodies.length > 1) {
      let best = bodies[0];
      let bestVol = best.volume();
      let total = bestVol;
      for (let i = 1; i < bodies.length; i++) {
        const v = bodies[i].volume();
        total += v;
        if (v > bestVol) { bestVol = v; best = bodies[i]; }
      }
      const scrapVol = total - bestVol;
      if (scrapVol > 0.05 * bestVol && scrapVol > 1e-2) {
        throw new Error(
          `filletAlongPath: edge set left ${bodies.length} components with scrap vol ${scrapVol.toFixed(4)} — failing loud rather than shipping a dirty solid`,
        );
      }
      out = best;
    }
  }
  out = _s23WeldFilletResult(out);
  const { tiny, nTri } = _s23TinyTriangles(out);
  if (isFilletSliverDirty(tiny, nTri)) {
    throw new Error(
      `filletAlongPath: edge set result has ${tiny}/${nTri} degenerate triangles (sliver scraps) — failing loud rather than shipping a dirty solid`,
    );
  }
  return out;
}

/**
 * filletAlongPath(part, path, radius, opts?)
 * Sweep a dihedral fillet (or equal-leg chamfer) along path → boolean subtract.
 *
 * Default: each path segment gets an in-face frame. Consecutive segments whose
 * interior angle stays within 3° share one cutter profile (that run's θ) and
 * are swept with those frames — not a 90° wedge spun by a single start RMF.
 * opts.initialNormal keeps the legacy 90° RMF sweep (explicit override).
 *
 * @param {Manifold} part
 * @param {object|number[][]} path — makeSweepPath result or points
 * @param {number} radius
 * @param {object} [opts]
 * @param {'fillet'|'chamfer'} [opts.profile='fillet']
 * @param {number} [opts.segments=24] — arc segments for fillet wedge
 * @param {number[]} [opts.initialNormal] — override probed frame
 * @param {boolean} [opts.closed] — when path is bare points[]
 * @param {number} [opts.arcSamples]
 * @param {number} [opts.extrudeSegments]
 * @param {number} [opts._testCutterScale] — test-only: scale 2D cutter vertices
 *   (e.g. 4) against nominal r so the 8× oversize guard can be pinned
 * @param {boolean} [opts.variableProfile] — C3 hard: densify path + per-knot
 *   path-normal inscribed-arc frames (adapts to loft twist)
 */

function filletAlongPath(part, path, radius, opts = {}) {
  const M = manifoldModule.Manifold;
  const { CrossSection } = manifoldModule;
  _c4RequirePositive('filletAlongPath', 'radius', radius);

  // An edge set (makeSweepPath of several chains or loops, or a pick with a
  // junction): every component builds its cutters against the ORIGINAL solid,
  // with its own frames, then one n-way subtract. Chains that meet at a
  // vertex share it; filleting them one after another would move that
  // vertex off the solid before the second chain was probed.
  if (path && typeof path === 'object' && Array.isArray(path.components) && path.components.length > 1 && !opts._collect) {
    if (!opts._filletBodySplit) {
      const owned = _filletOnlyOwningBody(M, part, path, radius, opts);
      if (owned) return owned;
    }
    return _s23FilletEdgeSet(M, part, path, radius, opts);
  }

  // Keep-both siblings are real components. Filleting the whole compose makes
  // the scrap check name the other body. Fillet the owner, compose the rest,
  // and leave the 5% / 0.01 test on the single result.
  if (!opts._filletBodySplit && !opts._collect) {
    const owned = _filletOnlyOwningBody(M, part, path, radius, opts);
    if (owned) return owned;
  }
  _s23BeginSweepRingCall();

  const profileKind = (opts.profile === 'chamfer') ? 'chamfer' : 'fillet';
  const arcSegs = opts.segments != null ? opts.segments : FILLET_ARC_SEGMENTS;
  let { points, closed, length } = _s23NormalizePath(path, opts);
  const carried = _s23CarriedEdges(path);
  // A stored edge wire that no longer lies on this solid must fail here,
  // not sweep a cutter through air and pass the volume guards. The path's
  // own knots may sit off the edges (smoothed corners), so the check is on
  // the endpoints of the edges the path was made from.
  if (!opts._rawPath) _s23AssertPathOnSolid(part, _s23PathEdgeEndpoints(path), profileKind);
  if (!opts._rawPath && !closed && _sheetFilletSpan) {
    const spanned = _s23ExtendSheetCornerSpan(part, points);
    if (spanned.length !== points.length) {
      points = spanned;
      length = pathPolylineLength(points, false);
    }
  }

  // C3 hard: densify + per-knot path-normal inscribed-arc frames (buildVariableProfileFrames).
  // C4: a concave run is material-ADD, which the dihedral sweep cannot express
  // at all — so any concave segment routes to the varying-profile builder,
  // which handles convex, concave and mixed chains. Cheap now that the sign is
  // a local test rather than a per-edge CSG probe.
  let variableProfile = !!opts.variableProfile;
  // Every segment convex (material remove only)? Gates the tight-arc split.
  let pathConvex = false;
  if (!opts._rawPath) {
    try {
      const scan = _s23ProbeKnotNormals(part, points, closed, carried);
      pathConvex = scan.segmentConvex.every((c) => c !== false);
      if (!variableProfile && !pathConvex) variableProfile = true;
    } catch (e) {
      // No match / unorientable — let the normal builder raise the real error.
    }
  }
  const rawSegCount = opts._c3RawSegCount != null
    ? Number(opts._c3RawSegCount)
    : (closed ? points.length : Math.max(0, points.length - 1));
  // Resample consistent circular arcs BEFORE variable-profile chord densify.
  // densifyPathByMaxTurn only inserts colinear chord midpoints, which cannot
  // shrink the turn at an existing vertex and pull those points off the
  // circle. Doing that first (the old order) left a prior-fillet quarter-arc
  // at ~15–22° chords: arc resample no longer saw a circle, and the same-
  // radius semi-arc split missed the site, so the wrap stayed one sweep
  // over the coarse arc (pinched corner). Sharp corners and long straights
  // are still copied unchanged. Semi-arc split below still owns the corner;
  // within each half this stays one sweep at ≤ FRAME_DENSIFY_MAX_TURN_DEG.
  if (!opts._rawPath) {
    const turned = densifySweepArcTurns(points, closed, FRAME_DENSIFY_MAX_TURN_DEG, {
      alignFilletLattice: profileKind !== 'chamfer',
    });
    if (Array.isArray(turned) && turned.length >= 2 && turned.length !== points.length) {
      points = turned;
      length = pathPolylineLength(points, closed);
    }
  }
  if (variableProfile && !opts._rawPath) {
    // C3.2: step from min(0.28R, pathLen/48) + max-turn densify so large-R /
    // high-curvature loft ridges get enough knots (0.75R alone was too sparse).
    // Runs after arc resample so a fitted fillet arc is not chord-poisoned.
    const plen0 = (typeof length === 'number' && length > 0)
      ? length
      : pathPolylineLength(points, closed);
    const step = variableProfileDensifyStep(radius, plen0);
    const dense = densifyPathPoints(points, closed, step, {
      maxTurnDeg: FRAME_DENSIFY_MAX_TURN_DEG,
    });
    if (dense.length > points.length) {
      points = _s23DropMicroKnots(dense, closed);
      length = pathPolylineLength(points, closed);
    }
  }
  _s23SetSweepRingKnots(points);

  // Sweep-path policy seam (planFilletSweepPath): keep the full wire by
  // default (never skip-micro). Corner arcs (same-r or R≠cutter) return
  // mode:'runs' — each straight / semi-arc is an independent cutter.

  if (!opts._rawPath) {
    const plan = planFilletSweepPath(points, closed, radius, {
      profile: profileKind,
      splitTighterArcs: pathConvex,
    });
    if (plan.mode === 'runs') {
      // Build each straight / semi-arc cutter independently against the ORIGINAL
      // part (so probes see pre-fillet faces), union, then ONE subtract.
      // Equivalent to independent subtracts but avoids stacking open-run endcap
      // seams that spiked long-fin counts on the Artur box-stack wrap.
      const scale = 1;
      const cutters = [];
      const collectedFillers = [];
      let expectVolSum = 0;
      const closedRuns = Array.isArray(plan.closedRuns) ? plan.closedRuns : null;
      for (let ri = 0; ri < plan.runs.length; ri++) {
        const run = plan.runs[ri];
        if (!Array.isArray(run) || run.length < 2) continue;
        const runClosed = closedRuns ? !!closedRuns[ri] : false;
        let built;
        const junction = {
          in: ri > 0 ? _s23RunJunctionTurn(plan.runs[ri - 1], run) : null,
          out: ri + 1 < plan.runs.length ? _s23RunJunctionTurn(run, plan.runs[ri + 1]) : null,
        };
        try {
          built = variableProfile
            ? _s23BuildVariableProfileCutter(
              M, CrossSection, part, run, runClosed, radius, profileKind, arcSegs, scale, rawSegCount, junction, carried,
            )
            : _s23BuildDihedralCutter(
              M, CrossSection, part, run, runClosed, radius, profileKind, arcSegs, scale, junction,
              { start: ri === 0 && !!opts._trimStart, end: ri === plan.runs.length - 1 && !!opts._trimEnd },
            );
        } catch (err) {
          // Diagnostics only: a golden reads which semi-arc run was skipped.
          if (globalThis.__filletRunErrors) {
            globalThis.__filletRunErrors.push({ run: ri, knots: run.length, message: String(err && err.message ? err.message : err) });
          }
          continue;
        }
        if (built?.cutter) {
          cutters.push(built.cutter);
          if (Number.isFinite(built.expectVol)) expectVolSum += built.expectVol;
        }
        if (built?.filler) {
          if (opts._collect) {
            collectedFillers.push({ filler: built.filler, openEndBBox: built.openEndBBox || null, openEndGrow: built.openEndGrow || null });
            continue;
          }
          // Concave filler runs: apply as union into part after the subtract batch.
          // Rare on same-r wrap; keep sequential for fillers.
          try {
            part = M.union([part, built.filler]);
          } catch (_) { /* keep */ }
          // Clip outside the swallow: a failed open-end clip must not drop the filler silently.
          if (built.openEndBBox) part = _s23ClipToBBox(M, part, built.openEndBBox, built.openEndGrow);
        }
      }
      if (!cutters.length) {
        throw new Error('filletAlongPath: corner-arc semi-arc split produced no valid cutters');
      }
      if (opts._collect) {
        return { cutters, fillers: collectedFillers, expectVol: expectVolSum, expectAdd: 0, closed };
      }
      // One n-way subtract. A − (C1 ∪ C2 ∪ …) is the same solid as A − C1 − C2 − …,
      // and Manifold evaluates that as a single arrangement. Chaining
      // union(union(C1, C2), C3) … forced a full boolean per semi-arc on the
      // growing cutter. Each cutter was already status-checked when it was swept.
      let out;
      try {
        out = cutters.length === 1
          ? M.difference(part, cutters[0])
          : M.difference([part, ...cutters]);
      } catch (e) {
        throw new Error(`filletAlongPath: semi-arc subtract failed — ${e && e.message ? e.message : e}`);
      }
      const seOut = _c4StatusError(out);
      if (seOut) throw new Error(`filletAlongPath: bad semi-arc result (${seOut})`);
      const removed = part.volume() - out.volume();
      if (expectVolSum > 1e-3 && removed < 0.02 * expectVolSum) {
        throw new Error(
          `filletAlongPath: semi-arc batch removed only ${removed.toFixed(4)} vs expected ~${expectVolSum.toFixed(4)} `
          + '(orientation/overlap failure) — failing loud rather than shipping a near-no-op solid',
        );
      }
      if (expectVolSum > 1e-3 && removed > 8 * expectVolSum) {
        throw new Error(
          `filletAlongPath: semi-arc batch removed ${removed.toFixed(4)} vs expected ~${expectVolSum.toFixed(4)} `
          + '(cutter far larger than requested radius) — failing loud',
        );
      }
      // Semi-arc batch is composed of open runs — keep largest if the union
      // leaves scrap (do not apply the closed-path hard multi-component fail).
      // Join a wedge that shares a face with the owner before that gate.
      out = _filletJoinOwnedPieces(M, out);
      try {
        if (typeof out.decompose === 'function') {
          const parts = out.decompose();
          if (Array.isArray(parts) && parts.length > 1) {
            let best = parts[0];
            let bestVol = best.volume();
            for (let i = 1; i < parts.length; i++) {
              const v = parts[i].volume();
              if (v > bestVol) { bestVol = v; best = parts[i]; }
            }
            const scrapVol = parts.reduce((s, c) => s + c.volume(), 0) - bestVol;
            if (scrapVol > 0.05 * bestVol && scrapVol > 1e-2) {
              throw new Error(
                `filletAlongPath: semi-arc batch decompose found ${parts.length} components with scrap vol `
                + `${scrapVol.toFixed(4)} — failing loud rather than shipping a dirty solid`,
              );
            }
            out = best;
          }
        }
      } catch (e) {
        if (/semi-arc batch decompose|dirty solid/i.test(String(e && e.message))) throw e;
      }
      return out;
    }
    if (plan.mode !== 'as-is') {
      throw new Error(`filletAlongPath: unexpected sweep-path plan mode=${plan.mode}`);
    }
  }

  const testCutterScale = Number(opts._testCutterScale);
  const testingOversize = Number.isFinite(testCutterScale) && testCutterScale > 1;
  let cutter = null;
  let filler = null;
  let expectAddOverride = 0;
  let expectVolOverride = null;
  let openEndBBox = null;
  let openEndGrow = null;
  if (!opts.initialNormal) {
    const scale = testingOversize ? testCutterScale : 1;
    const built = variableProfile
      ? _s23BuildVariableProfileCutter(
        M, CrossSection, part, points, closed, radius, profileKind, arcSegs, scale, rawSegCount, null, carried,
      )
      : _s23BuildDihedralCutter(
        M, CrossSection, part, points, closed, radius, profileKind, arcSegs, scale, null,
        { start: !!opts._trimStart, end: !!opts._trimEnd },
      );
    cutter = built.cutter;
    filler = built.filler || null;
    expectAddOverride = built.expectAdd || 0;
    expectVolOverride = built.expectVol;
    openEndBBox = built.openEndBBox || null;
    openEndGrow = built.openEndGrow || null;
  }

  // Legacy 90° RMF — only when opts.initialNormal is set. May reverse the path.
  // A filler-only build (every run concave) leaves `cutter` null legitimately,
  // so both must be absent before falling back here.
  if (!cutter && !filler) {
  let initialNormal = opts.initialNormal ? opts.initialNormal.slice() : null;
  let probed = null;
  if (!initialNormal) {
    probed = _s23ProbeFrame(M, part, points);
    if (probed) {
      const { T, f0, f1 } = probed;
      // Project f0 onto plane ⊥ T
      let N = _s23Sub(f0, [ _s23Dot(f0, T) * T[0], _s23Dot(f0, T) * T[1], _s23Dot(f0, T) * T[2] ]);
      if (Math.hypot(N[0], N[1], N[2]) < 1e-8) {
        N = _s23Sub(f1, [ _s23Dot(f1, T) * T[0], _s23Dot(f1, T) * T[1], _s23Dot(f1, T) * T[2] ]);
      }
      N = _s23Norm(N);
      let B = _s23Cross(T, N);
      // If B opposes f1, reverse path (flips T and thus B) without flipping N into exterior.
      if (_s23Dot(B, f1) < 0) {
        points = points.slice().reverse();
        // Recompute T after reverse
        const T2 = _s23Norm(_s23Sub(points[1], points[0]));
        N = _s23Sub(f0, [ _s23Dot(f0, T2) * T2[0], _s23Dot(f0, T2) * T2[1], _s23Dot(f0, T2) * T2[2] ]);
        if (Math.hypot(N[0], N[1], N[2]) < 1e-8) {
          N = _s23Sub(f1, [ _s23Dot(f1, T2) * T2[0], _s23Dot(f1, T2) * T2[1], _s23Dot(f1, T2) * T2[2] ]);
        }
        N = _s23Norm(N);
        B = _s23Cross(T2, N);
        if (_s23Dot(B, f1) < 0 && _s23Dot(B, f0) > _s23Dot(N, f0)) {
          // Swap: use f1 as N
          N = _s23Sub(f1, [ _s23Dot(f1, T2) * T2[0], _s23Dot(f1, T2) * T2[1], _s23Dot(f1, T2) * T2[2] ]);
          N = _s23Norm(N);
        }
      }
      // Prefer the face-ray that is more orthogonal as the "other" axis.
      const Tuse = _s23Norm(_s23Sub(points[1], points[0]));
      const Bnow = _s23Cross(Tuse, N);
      if (Math.abs(_s23Dot(Bnow, f1)) < Math.abs(_s23Dot(N, f1)) * 0.25
          && Math.abs(_s23Dot(N, f0)) < Math.abs(_s23Dot(Bnow, f0)) + 0.5) {
        // Axes swapped relative to (f0,f1) — start with f1 as N
        let N2 = _s23Sub(f1, [ _s23Dot(f1, Tuse) * Tuse[0], _s23Dot(f1, Tuse) * Tuse[1], _s23Dot(f1, Tuse) * Tuse[2] ]);
        if (Math.hypot(N2[0], N2[1], N2[2]) > 1e-8) N = _s23Norm(N2);
      }
      initialNormal = N;
    }
  }

  if (!initialNormal) {
    throw new Error(
      'filletAlongPath: could not orient cutter to part (no nearby convex edge at path start). '
      + 'Pass opts.initialNormal, or ensure path follows a convex feature edge.',
    );
  }

  const contour = expandFilletCutterContour(
    _s23WedgeContour(radius, profileKind, arcSegs),
    radius,
  );
  if (testingOversize) {
    for (const p of contour) {
      p[0] *= testCutterScale;
      p[1] *= testCutterScale;
    }
  }
  // Ensure CCW. Exterior (−e,−e) overlap (not skip-micro, not a radius grow)
  // provides the boolean margin so cutter legs are not face-coincident.
  let area2 = 0;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length];
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  if (area2 < 0) contour.reverse();

  const cs = new CrossSection([contour]);
  // Mobile-friendly sampling: scale with path complexity, capped.
  const nPts = points.length;
  const arcSamples = opts.arcSamples != null
    ? opts.arcSamples
    : Math.min(320, Math.max(48, Math.round(nPts * (closed ? 3 : 4))));
  const extrudeSegments = opts.extrudeSegments != null
    ? opts.extrudeSegments
    : Math.min(64, Math.max(16, Math.round(nPts * (closed ? 1.5 : 0.75))));

  // Polyline along the edge wire. Closed loops are swept as an OPEN path that
  // covers one full lap + a small overlap — a true closed extrude+warp leaves
  // an RMF seam that triangulates into purple sliver sheets.
  let sweepPts = points;
  let sweepClosed = closed;
  if (closed && points.length >= 3) {
    const a = points[0];
    const b = points[1];
    const overlap = 0.08; // fraction of first segment
    sweepPts = points.concat([
      a.slice(),
      [
        a[0] + overlap * (b[0] - a[0]),
        a[1] + overlap * (b[1] - a[1]),
        a[2] + overlap * (b[2] - a[2]),
      ],
    ]);
    sweepClosed = false;
  }

  // Skip revolve fast-path when pinning an oversized sweep cutter.
  if (closed && !testingOversize) {
    try {
      cutter = _s23TryRevolveCutter(CrossSection, points, radius, profileKind, arcSegs, probed);
    } catch (e) {
      if (/too large for this rim/i.test(String(e && e.message))) throw e;
      cutter = null;
    }
  }
  if (!cutter) {
    try {
      const polyPath = _s23PolylinePath(sweepPts, sweepClosed);
      cutter = sweep(cs, polyPath, {
        initialNormal,
        arcSamples,
        extrudeSegments,
      });
    } catch (e) {
      throw new Error(`filletAlongPath: sweep failed — ${e && e.message ? e.message : e}`);
    }
  }
  }
  if (cutter) {
    const seC = _c4StatusError(cutter);
    if (seC) throw new Error(`filletAlongPath: bad cutter (${seC})`);
    const cutterVol = typeof cutter.volume === 'function' ? cutter.volume() : 0;
    if (!(cutterVol > 1e-9)) {
      throw new Error('filletAlongPath: cutter has zero volume — check radius / path');
    }
  }
  if (filler) {
    const seF = _c4StatusError(filler);
    if (seF) throw new Error(`filletAlongPath: bad filler (${seF})`);
    const fillerVol = typeof filler.volume === 'function' ? filler.volume() : 0;
    if (!(fillerVol > 1e-9)) {
      throw new Error('filletAlongPath: filler has zero volume — check radius / path');
    }
  }
  if (!cutter && !filler) {
    throw new Error('filletAlongPath: no cutter or filler was built — re-pick edges');
  }

  if (opts._collect) {
    const area = profileKind === 'chamfer'
      ? 0.5 * radius * radius
      : radius * radius * (1 - Math.PI / 4);
    return {
      cutters: cutter ? [cutter] : [],
      fillers: filler ? [{ filler, openEndBBox, openEndGrow }] : [],
      expectVol: cutter ? (expectVolOverride != null ? expectVolOverride : area * length) : 0,
      expectAdd: filler ? expectAddOverride : 0,
      closed,
    };
  }

  let out = part;
  // The two booleans run SEPARATELY and are measured separately. A mixed-sign
  // chain removes on its convex runs and adds on its concave ones, so a single
  // net-volume check could pass while both halves were wrong.
  let removed = 0;
  if (cutter) {
    let cut;
    try {
      cut = M.difference(out, cutter);
    } catch (e) {
      throw new Error(`filletAlongPath: boolean subtract failed — ${e && e.message ? e.message : e}`);
    }
    const seCut = _c4StatusError(cut);
    if (seCut) throw new Error(`filletAlongPath: bad result (${seCut})`);
    const v = cut.volume();
    if (!(v > 1e-9)) {
      throw new Error('filletAlongPath: result is EMPTY (cutter consumed the solid) — reduce radius');
    }
    removed = out.volume() - v;
    out = cut;
    if (!(removed > 1e-6)) {
      throw new Error(
        'filletAlongPath: subtract removed ~0 volume — cutter likely outside the solid '
        + '(wrong orientation / path). Try reversing the path or pass opts.initialNormal.',
      );
    }
  }
  // Concave runs ADD material: the same wedge, unioned instead of subtracted.
  // Guards mirror the remove side — volume must go UP by ~the per-knot integral.
  if (filler) {
    const vPre = out.volume();
    let add;
    try {
      add = M.union([out, filler]);
    } catch (e) {
      throw new Error(`filletAlongPath: boolean union failed — ${e && e.message ? e.message : e}`);
    }
    const seAdd = _c4StatusError(add);
    if (seAdd) throw new Error(`filletAlongPath: bad result (${seAdd})`);
    const added = add.volume() - vPre;
    out = add;
    if (!(added > 1e-6)) {
      throw new Error(
        'filletAlongPath: union added ~0 volume — filler likely already inside the solid '
        + '(wrong orientation / path). Re-pick edges.',
      );
    }
    if (!testingOversize && expectAddOverride > 1e-3 && added < 0.02 * expectAddOverride) {
      throw new Error(
        `filletAlongPath: added only ${added.toFixed(4)} vs expected ~${expectAddOverride.toFixed(4)} `
        + '(orientation/overlap failure) — failing loud rather than shipping a near-no-op solid',
      );
    }
    if (expectAddOverride > 1e-3 && added > 8 * expectAddOverride) {
      throw new Error(
        `filletAlongPath: added ${added.toFixed(4)} vs expected ~${expectAddOverride.toFixed(4)} `
        + '(filler far larger than requested radius) — failing loud rather than shipping an oversized blend',
      );
    }
    // The end pad leaves the pre-fillet bbox along the tangent. Clip after
    // the volume guard so expectAdd (which includes the pad length) still
    // matches `added`. The box is widened by the fillet section, so a round
    // that fills an exterior corner is not cut off with the pad.
    if (openEndBBox) out = _s23ClipToBBox(M, out, openEndBBox, openEndGrow);
  }
  // Near-no-op and oversize guards use the dihedral removed-area when the
  // per-segment cutter ran. A 90°-only expect false-trips an acute fillet
  // (removed area grows as θ shrinks) and misses a hooked 90° wedge.
  const expectArea = profileKind === 'chamfer'
    ? 0.5 * radius * radius
    : radius * radius * (1 - Math.PI / 4);
  const expectVol = expectVolOverride != null ? expectVolOverride : expectArea * length;
  // Neutralise near-no-op when pinning the sibling 8× oversize guard —
  // a coordinated oversize probe would otherwise throw here first.
  if (cutter && !testingOversize && expectVol > 1e-3 && removed < 0.02 * expectVol) {
    throw new Error(
      `filletAlongPath: removed only ${removed.toFixed(4)} vs expected ~${expectVol.toFixed(4)} `
      + '(orientation/overlap failure) — failing loud rather than shipping a near-no-op solid',
    );
  }
  if (cutter && expectVol > 1e-3 && removed > 8 * expectVol) {
    throw new Error(
      `filletAlongPath: removed ${removed.toFixed(4)} vs expected ~${expectVol.toFixed(4)} `
      + '(cutter far larger than requested radius) — failing loud rather than shipping an oversized blend',
    );
  }
  // Join a fillet wedge that shares a face with the owner, then drop
  // disconnected cutter scraps (thin purple sheets) via decompose.
  // A closed sweep seam leaves empty shells (measured ~1e-14 mm³ on a face
  // loop that runs through prior fillet arcs). Those are not a second body.
  // Two components that both have volume are still a hard fail — no
  // keep-largest of a real split. Corner arcs are split upstream
  // (planFilletSweepPath mode:'runs' → independent semi-arc subtracts).
  // No sphere-cap post-pass (#107 bulges).
  const CLOSED_SEAM_DUST_MM3 = 1e-8;
  out = _filletJoinOwnedPieces(M, out);
  try {
    if (typeof out.decompose === 'function') {
      const parts = out.decompose();
      if (Array.isArray(parts) && parts.length > 1) {
        let best = parts[0];
        let bestVol = best.volume();
        const volumes = [bestVol];
        for (let i = 1; i < parts.length; i++) {
          const v = parts[i].volume();
          volumes.push(v);
          if (v > bestVol) { bestVol = v; best = parts[i]; }
        }
        if (closed) {
          const real = volumes.filter((v) => v > CLOSED_SEAM_DUST_MM3).length;
          if (real > 1) {
            throw new Error(
              `filletAlongPath: decompose found ${parts.length} components on closed path `
              + '— failing loud rather than shipping a dirty solid',
            );
          }
          out = best;
        } else {
          const scrapVol = volumes.reduce((s, v) => s + v, 0) - bestVol;
          // If scraps are a real fraction of the solid, something is badly wrong.
          if (scrapVol > 0.05 * bestVol && scrapVol > 1e-2) {
            throw new Error(
              `filletAlongPath: decompose found ${parts.length} components with scrap vol `
              + `${scrapVol.toFixed(4)} — failing loud rather than shipping a dirty solid`,
            );
          }
          out = best;
        }
      }
    }
  } catch (e) {
    if (/decompose found|dirty solid/i.test(String(e && e.message))) throw e;
  }
  // Duplicated vertices along a ruling split the convex rim and leave
  // long degenerate fins. The weld is index-only; volume must stay put.
  out = _s23WeldFilletResult(out);
  // Loud fail if the kept solid still has many degenerate tris (attached slivers).
  try {
    const mesh = out.getMesh();
    const np = mesh.numProp || 3;
    const V = mesh.vertProperties;
    const T = mesh.triVerts;
    const nTri = T.length / 3;
    let tiny = 0;
    for (let ti = 0; ti < nTri; ti++) {
      const i0 = T[ti * 3] * np;
      const i1 = T[ti * 3 + 1] * np;
      const i2 = T[ti * 3 + 2] * np;
      const ax = V[i1] - V[i0], ay = V[i1 + 1] - V[i0 + 1], az = V[i1 + 2] - V[i0 + 2];
      const bx = V[i2] - V[i0], by = V[i2 + 1] - V[i0 + 1], bz = V[i2 + 2] - V[i0 + 2];
      const A = 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
      if (A < 1e-8) tiny++;
    }
    // C6 closed-run filletEdges itself yields ~0.5–1% needles @1e-8 from
    // mesh boolean — only fail when the mesh is clearly scrap-sheet dirty.
    if (isFilletSliverDirty(tiny, nTri)) {
      throw new Error(
        `filletAlongPath: result has ${tiny}/${nTri} degenerate triangles (sliver scraps) — `
        + 'failing loud rather than shipping a dirty solid; try a different size or Strategy=planar',
      );
    }
  } catch (e) {
    if (/sliver scraps|degenerate triangles/i.test(String(e && e.message))) throw e;
  }
  return out;
}

// ---------------------------------------------------------------- Fillet edge ids (edge-spec A)
// Ids come from the current mesh, and only from sharp edges that survive the
// boundary filter (shallow dihedral / tiny blend faces are not addressable).
// faceID is Manifold provenance and can merge or split after a boolean, so a
// miss throws instead of guessing.
const _boundaryCache = new WeakMap();

function _boundaryPositions(mesh) {
  const np = mesh.numProp || 3;
  const src = mesh.vertProperties;
  if (np === 3) return src;
  const nVert = Math.floor(src.length / np);
  const positions = new Float64Array(nVert * 3);
  for (let i = 0; i < nVert; i++) {
    positions[i * 3] = src[i * np];
    positions[i * 3 + 1] = src[i * np + 1];
    positions[i * 3 + 2] = src[i * np + 2];
  }
  return positions;
}

function _boundaryIndex(part) {
  if (!part || typeof part.getMesh !== 'function') {
    throw new Error('part must be a Manifold');
  }
  if (_boundaryCache.has(part)) return _boundaryCache.get(part);
  const mesh = part.getMesh();
  const topo = indexBoundaryEdges({
    positions: _boundaryPositions(mesh),
    indices: mesh.triVerts,
    faceIDs: mesh.faceID,
  });
  _boundaryCache.set(part, topo);
  return topo;
}

function _rePickEdges(detail) {
  throw new Error(
    `re-pick edges — ${detail}. Face and edge ids belong to this mesh; `
    + 'Manifold faceID can merge or split after a boolean, so the previous ids are not reused.',
  );
}

/**
 * edge(part, id) → mesh segments of one boundary edge.
 * id is the integer shown as e{id} in Fillet mode. Suitable for makeSweepPath.
 */
function edge(part, id) {
  const topo = _boundaryIndex(part);
  const n = Number(id);
  const found = (topo.edges || []).find((e) => e.id === n);
  if (!found) _rePickEdges(`edge ${id} is not on this solid`);
  return found.segments.map((seg) => ({ ...seg }));
}

/**
 * edgesBetween(part, faceA, faceB) → segments of the only boundary between
 * those face ids. Two disconnected boundaries of the same pair throw —
 * use edge(part, id) for the one you want.
 */
function edgesBetween(part, faceA, faceB) {
  const topo = _boundaryIndex(part);
  const fa = Number(faceA);
  const fb = Number(faceB);
  const hits = (topo.edges || []).filter((e) => (
    (e.faceA === fa && e.faceB === fb) || (e.faceA === fb && e.faceB === fa)
  ));
  if (!hits.length) _rePickEdges(`no boundary between faces ${fa} and ${fb}`);
  if (hits.length > 1) {
    _rePickEdges(
      `faces ${fa} and ${fb} share ${hits.length} boundary edges — use edge(part, id)`,
    );
  }
  return hits[0].segments.map((seg) => ({ ...seg }));
}

/**
 * boundaryEdges(part) → catalog { id, faceA, faceB, mid, length } for the
 * current mesh. Discovery helper; Fillet Accept emits edge / edgesBetween.
 */
function boundaryEdges(part) {
  const topo = _boundaryIndex(part);
  return (topo.edges || []).map((e) => ({
    id: e.id,
    faceA: e.faceA,
    faceB: e.faceB,
    mid: e.mid.slice(),
    length: e.length,
  }));
}

/**
 * cut(manifold, plane, opts) — split one or more bodies with a plane, then
 * optionally delete pieces. Uses Manifold.splitByPlane (no separate kernel).
 *
 * plane is a face `{ center, normal }` or an explicit `{ normal, originOffset }`.
 * `offset` on a face shifts the plane along the normal (positive with the
 * normal) and is added to center·normal. Offset 0 is the face itself.
 * A face is never read as a world-axis name. The first splitByPlane result is
 * the '+' side (along the normal); the second is '-'.
 *
 * A body that does not cross the plane is returned unchanged (same solid, so
 * the same volume, still one body). Pieces that are kept stay separate via
 * Manifold.compose, which decompose() splits back apart.
 *
 * opts.bodies — subset to cut, each `{ at }` near that body's vertex centroid.
 *   Omit to cut every body.
 * opts.keep — 'both' (default) | '+' | '-'.
 * opts.drop — `{ at, side }` pieces to delete when keep is not a whole side.
 */
function cut(manifold, plane, opts = {}) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  if (!manifold || typeof manifold.splitByPlane !== 'function') {
    throw new Error('cut: expected a Manifold');
  }
  const { Manifold } = manifoldModule;
  const pl = _cutResolvePlane(plane);
  const options = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  const keep = _cutKeepMode(options);
  const bodies = _cutBodiesOf(manifold);
  const selected = _cutSelected(bodies, options.bodies);
  const drops = _cutDrops(bodies, selected, options.drop, keep);
  const kept = [];
  const discard = [];
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!selected.has(i)) {
      kept.push(body);
      continue;
    }
    const split = _cutSplitOrOriginal(body, pl);
    for (const piece of split.pieces) {
      const drop = _cutPieceDropped(piece.side, i, keep, drops);
      if (drop) {
        if (!piece.original) discard.push(piece.manifold);
        continue;
      }
      kept.push(piece.manifold);
    }
    for (const extra of split.discard) discard.push(extra);
  }
  for (const m of discard) _safeDeleteManifold(m);
  if (!kept.length) throw new Error('cut: every piece was deleted');
  const result = kept.length === 1 ? kept[0] : Manifold.compose(kept);
  const status = _c4StatusError(result);
  if (status) throw new Error(`cut: result is not a valid solid (${status})`);
  return result;
}

/**
 * move(manifold, [dx, dy, dz], { bodies: [{ at }] }) — translate one body.
 * Same Manifold.translate center() already uses, and the same decompose /
 * centroid / compose split cut() uses. Not a second kernel. The named body
 * moves; every other body stays. A zero delta returns the input solid.
 *
 * The { at } point is that body's vertex centroid. cut() requires squared
 * distance ≤ 1e-4. A fillet does not retessellate the same way on the next
 * run, so that average can move by a few hundredths and a valid pick would
 * miss the tight gate. move() still takes the exact match, and otherwise
 * the nearest body within 1% of its radius (at least 0.05) when the next
 * body is farther than that. A point that is not near a centroid throws.
 */
function move(manifold, delta, opts = {}) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  if (!manifold || typeof manifold.translate !== 'function') {
    throw new Error('move: expected a Manifold');
  }
  if (!Array.isArray(delta) || delta.length < 3) {
    throw new Error('move: delta must be finite [dx, dy, dz]');
  }
  const d = [Number(delta[0]), Number(delta[1]), Number(delta[2])];
  if (d.some((v) => !Number.isFinite(v))) {
    throw new Error('move: delta must be finite [dx, dy, dz]');
  }
  const options = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  if (!Array.isArray(options.bodies) || options.bodies.length !== 1) {
    throw new Error('move: name one body with { bodies: [{ at }] }');
  }
  let bodies;
  let selected;
  try {
    bodies = _cutBodiesOf(manifold);
    selected = _moveSelected(manifold, bodies, options.bodies);
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    throw new Error(msg.replace(/^cut:/, 'move:'));
  }
  if (selected.size !== 1) {
    throw new Error('move: name one body with { bodies: [{ at }] }');
  }
  const zero = d[0] === 0 && d[1] === 0 && d[2] === 0;
  if (bodies.length === 1 && bodies[0] === manifold) {
    if (zero) return manifold;
    const moved = manifold.translate(d);
    const status = _c4StatusError(moved);
    if (status) throw new Error(`move: result is not a valid solid (${status})`);
    return moved;
  }
  if (zero) {
    for (const body of bodies) {
      if (body && body !== manifold) _safeDeleteManifold(body);
    }
    return manifold;
  }
  const { Manifold } = manifoldModule;
  const kept = [];
  const discard = [];
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!selected.has(i)) {
      kept.push(body);
      continue;
    }
    kept.push(body.translate(d));
    if (body !== manifold) discard.push(body);
  }
  for (const m of discard) _safeDeleteManifold(m);
  const result = kept.length === 1 ? kept[0] : Manifold.compose(kept);
  const status = _c4StatusError(result);
  if (status) throw new Error(`move: result is not a valid solid (${status})`);
  return result;
}

/** Unit axis for rotateAbout: 'x' | 'y' | 'z' (a leading '-' flips it) or [ax, ay, az]. */
function _rotateAxisVector(axis) {
  if (typeof axis === 'string') {
    const key = axis.trim().toLowerCase();
    const named = {
      x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], '-x': [-1, 0, 0], '-y': [0, -1, 0], '-z': [0, 0, -1],
    }[key];
    if (named) return named;
    throw new Error(`rotateAbout: axis must be 'x', 'y', 'z' or [ax, ay, az], not '${axis}'`);
  }
  if (!Array.isArray(axis) || axis.length < 3) {
    throw new Error("rotateAbout: axis must be 'x', 'y', 'z' or [ax, ay, az]");
  }
  const v = [Number(axis[0]), Number(axis[1]), Number(axis[2])];
  if (v.some((n) => !Number.isFinite(n))) throw new Error('rotateAbout: axis must be finite [ax, ay, az]');
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 1e-12)) throw new Error('rotateAbout: axis has zero length');
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Column-major 4x4 (Manifold.transform) turning angleDeg about unit axis k through pivot p. */
function _rotateAboutMatrix(k, angleDeg, p) {
  const t = (angleDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const u = 1 - c;
  const [x, y, z] = k;
  const r = [
    [c + x * x * u, x * y * u - z * s, x * z * u + y * s],
    [y * x * u + z * s, c + y * y * u, y * z * u - x * s],
    [z * x * u - y * s, z * y * u + x * s, c + z * z * u],
  ];
  const tx = p[0] - (r[0][0] * p[0] + r[0][1] * p[1] + r[0][2] * p[2]);
  const ty = p[1] - (r[1][0] * p[0] + r[1][1] * p[1] + r[1][2] * p[2]);
  const tz = p[2] - (r[2][0] * p[0] + r[2][1] * p[1] + r[2][2] * p[2]);
  return [
    r[0][0], r[1][0], r[2][0], 0,
    r[0][1], r[1][1], r[2][1], 0,
    r[0][2], r[1][2], r[2][2], 0,
    tx, ty, tz, 1,
  ];
}

/**
 * rotateAbout(manifold, axis, angleDeg, center, { bodies: [{ at }] }) — turn one body.
 * Rotates the named body by angleDeg degrees (right-hand rule) about the
 * line through center along axis. axis is 'x', 'y', 'z' or [ax, ay, az];
 * center is [x, y, z] in mm, or null for that body's own vertex centroid.
 * The body is named the way move() names it ({ at } is its centroid): the
 * named body turns, every other body stays. A zero angle returns the input
 * solid. Volume is unchanged; the bounding box follows the turn.
 */
function rotateAbout(manifold, axis, angleDeg, center = null, opts = {}) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  if (!manifold || typeof manifold.transform !== 'function') {
    throw new Error('rotateAbout: expected a Manifold');
  }
  const dir = _rotateAxisVector(axis);
  const angle = Number(angleDeg);
  if (!Number.isFinite(angle)) throw new Error('rotateAbout: angle must be a finite number of degrees');
  let pivot = null;
  if (center != null) {
    if (!Array.isArray(center) || center.length < 3) {
      throw new Error('rotateAbout: center must be [x, y, z] in mm, or null for the body centroid');
    }
    pivot = [Number(center[0]), Number(center[1]), Number(center[2])];
    if (pivot.some((v) => !Number.isFinite(v))) throw new Error('rotateAbout: center must be finite [x, y, z]');
  }
  const options = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  if (!Array.isArray(options.bodies) || options.bodies.length !== 1) {
    throw new Error('rotateAbout: name one body with { bodies: [{ at }] }');
  }
  let bodies;
  let selected;
  try {
    bodies = _cutBodiesOf(manifold);
    selected = _moveSelected(manifold, bodies, options.bodies);
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    throw new Error(msg.replace(/^(?:cut|move):/, 'rotateAbout:'));
  }
  if (selected.size !== 1) {
    throw new Error('rotateAbout: name one body with { bodies: [{ at }] }');
  }
  const idx = selected.values().next().value;
  if (!pivot) pivot = _moveCentroidSpan(bodies[idx]).at.slice(0, 3).map(Number);
  const zero = Math.abs(angle) < 1e-12;
  const matrix = _rotateAboutMatrix(dir, angle, pivot);
  if (bodies.length === 1 && bodies[0] === manifold) {
    if (zero) return manifold;
    const turned = manifold.transform(matrix);
    const status = _c4StatusError(turned);
    if (status) throw new Error(`rotateAbout: result is not a valid solid (${status})`);
    return turned;
  }
  if (zero) {
    for (const body of bodies) {
      if (body && body !== manifold) _safeDeleteManifold(body);
    }
    return manifold;
  }
  const { Manifold } = manifoldModule;
  const kept = [];
  const discard = [];
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (i !== idx) {
      kept.push(body);
      continue;
    }
    kept.push(body.transform(matrix));
    if (body !== manifold) discard.push(body);
  }
  for (const m of discard) _safeDeleteManifold(m);
  const result = kept.length === 1 ? kept[0] : Manifold.compose(kept);
  const status = _c4StatusError(result);
  if (status) throw new Error(`rotateAbout: result is not a valid solid (${status})`);
  return result;
}

/** Face { center, normal, offset? } or explicit { normal, originOffset }. Never an axis name. */
function _cutResolvePlane(plane) {
  if (plane == null || typeof plane !== 'object' || Array.isArray(plane)) {
    throw new Error("cut: plane must be a face { center, normal } or { normal, originOffset } — not a world-axis name");
  }
  const nRaw = plane.normal;
  if (!Array.isArray(nRaw) || nRaw.length < 3) {
    throw new Error('cut: plane.normal must be [x, y, z]');
  }
  const nx = Number(nRaw[0]);
  const ny = Number(nRaw[1]);
  const nz = Number(nRaw[2]);
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 1e-12) || !Number.isFinite(len)) throw new Error('cut: plane normal has zero length');
  const normal = [nx / len, ny / len, nz / len];
  let originOffset;
  if (plane.originOffset != null && plane.originOffset !== '') {
    originOffset = Number(plane.originOffset);
    if (!Number.isFinite(originOffset)) throw new Error('cut: originOffset must be a finite number');
  } else if (Array.isArray(plane.center) && plane.center.length >= 3) {
    const c = plane.center.map(Number);
    if (c.some((v) => !Number.isFinite(v))) throw new Error('cut: plane.center must be finite');
    originOffset = normal[0] * c[0] + normal[1] * c[1] + normal[2] * c[2];
  } else {
    throw new Error('cut: plane needs originOffset or a center from the picked face');
  }
  if (plane.offset != null && plane.offset !== '') {
    const extra = Number(plane.offset);
    if (!Number.isFinite(extra)) throw new Error('cut: offset must be a finite number');
    originOffset += extra;
  }
  return { normal, originOffset };
}

function _cutKeepMode(options) {
  const keep = options.keep == null ? 'both' : options.keep;
  if (keep !== 'both' && keep !== '+' && keep !== '-') {
    throw new Error(`cut: keep must be 'both', '+', or '-' (got ${keep})`);
  }
  if (keep !== 'both' && Array.isArray(options.drop) && options.drop.length) {
    throw new Error('cut: pass keep or drop, not both');
  }
  return keep;
}

function _cutVol(m) {
  try {
    const v = m.volume();
    return Number.isFinite(v) ? v : 0;
  } catch (_) {
    return 0;
  }
}

function _cutNegligible(m, total) {
  if (!m) return true;
  if (typeof m.isEmpty === 'function') {
    try { if (m.isEmpty()) return true; } catch (_) { /* volume floor below */ }
  }
  const floor = Math.max(1e-6, Math.abs(total) * 1e-8);
  return !(_cutVol(m) > floor);
}

/** More than one component → those bodies. One component → the input, unchanged. */
function _cutBodiesOf(manifold) {
  if (typeof manifold.decompose !== 'function') return [manifold];
  let parts = null;
  try { parts = manifold.decompose(); } catch (_) { parts = null; }
  if (!Array.isArray(parts) || parts.length <= 1) {
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (p && p !== manifold) _safeDeleteManifold(p);
      }
    }
    return [manifold];
  }
  return parts;
}

/**
 * Centroids move() will accept for each decomposed body. Computed on a clone
 * so the cached solid stays put. The viewport mesh's own average can miss
 * these by enough to fail the 1e-4 gate after a cut of a filleted shell.
 */
function _kernelBodyCentroids(manifold) {
  if (!manifold || typeof manifold.clone !== 'function') return [];
  const clone = manifold.clone();
  const extra = [];
  try {
    const bodies = _cutBodiesOf(clone);
    const at = [];
    for (const body of bodies) {
      if (body !== clone) extra.push(body);
      const c = _cutCentroid(body);
      at.push([Number(c[0]), Number(c[1]), Number(c[2])]);
    }
    return at;
  } catch (_) {
    return [];
  } finally {
    for (const body of extra) _safeDeleteManifold(body);
    _safeDeleteManifold(clone);
  }
}

function _cutCentroid(body) {
  const mesh = body.getMesh();
  const vp = mesh.vertProperties;
  const np = mesh.numProp || 3;
  const n = Math.floor(vp.length / np);
  if (!n) return [0, 0, 0];
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < n; i++) {
    sx += vp[i * np];
    sy += vp[i * np + 1];
    sz += vp[i * np + 2];
  }
  return [sx / n, sy / n, sz / n];
}

function _cutDist2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function _cutBodyIndex(bodies, at) {
  const point = [Number(at[0]), Number(at[1]), Number(at[2])];
  if (point.some((v) => !Number.isFinite(v))) {
    throw new Error('cut: body point must be finite [x, y, z]');
  }
  let best = -1;
  let bestD = Infinity;
  let second = Infinity;
  for (let i = 0; i < bodies.length; i++) {
    const d = _cutDist2(_cutCentroid(bodies[i]), point);
    if (d < bestD) {
      second = bestD;
      bestD = d;
      best = i;
    } else if (d < second) {
      second = d;
    }
  }
  // 4-decimal script literals land well inside 1e-2 of the vertex centroid.
  if (!(bestD <= 1e-4)) {
    throw new Error('cut: that point is not a body centroid — re-pick the body');
  }
  if (second <= 1e-4 && Math.sqrt(second) - Math.sqrt(bestD) < 1e-4) {
    throw new Error('cut: that point matches more than one body');
  }
  return best;
}

/** Vertex centroid plus the farthest vertex, for move()'s looser match. */
function _moveCentroidSpan(body) {
  const mesh = body.getMesh();
  const vp = mesh.vertProperties;
  const np = mesh.numProp || 3;
  const n = Math.floor(vp.length / np);
  if (!n) return { at: [0, 0, 0], radius: 0 };
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < n; i++) {
    sx += vp[i * np];
    sy += vp[i * np + 1];
    sz += vp[i * np + 2];
  }
  const at = [sx / n, sy / n, sz / n];
  let max2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = vp[i * np] - at[0];
    const dy = vp[i * np + 1] - at[1];
    const dz = vp[i * np + 2] - at[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > max2) max2 = d2;
  }
  return { at, radius: Math.sqrt(max2) };
}

/**
 * Body named by { at }. Exact literals use cut()'s 1e-4 gate. A drifted
 * pick still names the nearest body when it sits within 1% of that body's
 * radius (at least 0.05) and the next body is outside that distance.
 */
function _moveBodyIndex(manifold, bodies, at, tri) {
  const point = [Number(at[0]), Number(at[1]), Number(at[2])];
  if (point.some((v) => !Number.isFinite(v))) {
    throw new Error('move: body point must be finite [x, y, z]');
  }
  if (manifold && tri != null && Number.isFinite(Number(tri)) && bodies.length > 1) {
    const byTri = decomposedBodyIndexForTri(manifold, bodies, tri);
    if (byTri >= 0) return byTri;
  }
  const spans = bodies.map((body) => _moveCentroidSpan(body));
  let best = -1;
  let bestD = Infinity;
  let second = Infinity;
  for (let i = 0; i < spans.length; i++) {
    const d = _cutDist2(spans[i].at, point);
    if (d < bestD) {
      second = bestD;
      bestD = d;
      best = i;
    } else if (d < second) {
      second = d;
    }
  }
  if (best < 0) {
    throw new Error('move: that point is not a body centroid — re-pick the body');
  }
  if (bestD <= 1e-4) {
    if (second <= 1e-4 && Math.sqrt(second) - Math.sqrt(bestD) < 1e-4) {
      throw new Error('move: that point matches more than one body');
    }
    return best;
  }
  const tol = Math.max(0.05, spans[best].radius * 0.01);
  const tol2 = tol * tol;
  if (bestD <= tol2 && !(second <= tol2)) return best;
  if (bestD <= tol2) {
    throw new Error('move: that point matches more than one body');
  }
  throw new Error('move: that point is not a body centroid — re-pick the body');
}

function _moveSelected(manifold, bodies, spec) {
  if (!Array.isArray(spec) || spec.length !== 1) {
    throw new Error('move: name one body with { bodies: [{ at }] }');
  }
  const entry = spec[0];
  const at = entry && (entry.at || entry.center);
  if (!Array.isArray(at)) throw new Error('move: name one body with { bodies: [{ at }] }');
  const tri = entry && entry.tri != null ? Number(entry.tri) : null;
  return new Set([_moveBodyIndex(manifold, bodies, at, tri)]);
}

function _cutSelected(bodies, spec) {
  const selected = new Set();
  if (Array.isArray(spec) && spec.length) {
    for (const entry of spec) {
      const at = entry && (entry.at || entry.center);
      if (!Array.isArray(at)) throw new Error('cut: bodies entries need { at: [x, y, z] }');
      selected.add(_cutBodyIndex(bodies, at));
    }
    return selected;
  }
  for (let i = 0; i < bodies.length; i++) selected.add(i);
  return selected;
}

function _cutDrops(bodies, selected, spec, keep) {
  const drops = [];
  if (keep !== 'both' || !Array.isArray(spec)) return drops;
  for (const entry of spec) {
    const at = entry && (entry.at || entry.center);
    const side = entry && entry.side;
    if (side !== '+' && side !== '-') throw new Error("cut: drop side must be '+' or '-'");
    if (!Array.isArray(at)) throw new Error('cut: drop entries need { at, side }');
    const idx = _cutBodyIndex(bodies, at);
    if (!selected.has(idx)) throw new Error('cut: cannot drop a piece of a body that was not cut');
    drops.push({ idx, side });
  }
  return drops;
}

function _cutPieceDropped(side, idx, keep, drops) {
  if (keep === '+') return side === '-';
  if (keep === '-') return side === '+';
  return drops.some((d) => d.idx === idx && d.side === side);
}

function _cutExtents(body, normal, originOffset) {
  const mesh = body.getMesh();
  const vp = mesh.vertProperties;
  const np = mesh.numProp || 3;
  let min = Infinity;
  let max = -Infinity;
  const n = Math.floor(vp.length / np);
  for (let i = 0; i < n; i++) {
    const d = vp[i * np] * normal[0] + vp[i * np + 1] * normal[1] + vp[i * np + 2] * normal[2] - originOffset;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/**
 * Split only when vertices lie strictly on both sides. Otherwise hand back
 * the same body (a tangent plane is not a cut). Empty split halves are the
 * same case — discard them and keep the original.
 */
function _cutSplitOrOriginal(body, plane) {
  const eps = 1e-5;
  const { min, max } = _cutExtents(body, plane.normal, plane.originOffset);
  const crosses = min < -eps && max > eps;
  const wholeSide = min >= -eps ? '+' : '-';
  if (!crosses) {
    return { pieces: [{ side: wholeSide, manifold: body, original: true }], discard: [] };
  }
  const total = _cutVol(body);
  const halves = body.splitByPlane(plane.normal, plane.originOffset);
  const pos = halves && halves[0];
  const neg = halves && halves[1];
  const posEmpty = _cutNegligible(pos, total);
  const negEmpty = _cutNegligible(neg, total);
  if (posEmpty || negEmpty) {
    return {
      pieces: [{ side: posEmpty ? '-' : '+', manifold: body, original: true }],
      discard: [pos, neg].filter(Boolean),
    };
  }
  return {
    pieces: [
      { side: '+', manifold: pos, original: false },
      { side: '-', manifold: neg, original: false },
    ],
    discard: [],
  };
}

/**
 * booleanBodies(manifold, { op, bodies, drop }) — union, difference, or
 * intersect of named bodies. The first { at } is the target. Later entries
 * are tools, unioned together, then subtracted from or intersected with the
 * target. Bodies that were not named stay in the solid.
 *
 * op: 'union' | 'difference' | 'intersect'.
 * bodies: [{ at }] near each body's vertex centroid, in pick order.
 *   Omit to use every body, in decompose order.
 * drop: intersect only. [{ at }] centroids of leftover pieces to delete.
 *   A piece that is not listed stays. Deleting every piece throws.
 */
function booleanBodies(manifold, opts = {}) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  if (!manifold || typeof manifold.decompose !== 'function') {
    throw new Error('booleanBodies: expected a Manifold');
  }
  const { Manifold } = manifoldModule;
  const options = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  const op = _booleanOp(options.op);
  const tools = _booleanExternalTools(options.tools);
  const bodies = _cutBodiesOf(manifold);
  let selected;
  try {
    // With external tools, an omitted list is the first body only (the target),
    // not every body: the tools come from another part.
    const spec = (tools.length && (!Array.isArray(options.bodies) || !options.bodies.length))
      ? [{ at: _cutCentroid(bodies[0]) }]
      : options.bodies;
    selected = _booleanSelected(bodies, spec);
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    throw new Error(msg.replace(/^cut:/, 'booleanBodies:'));
  }
  if (selected.length + tools.length < 2) {
    throw new Error('booleanBodies: pick a target and at least one tool body');
  }
  // External tools (frozen copies from another part) follow the named
  // bodies. The first named body is still the target.
  const picked = [...selected.map((i) => bodies[i]), ...tools];
  const sel = new Set(selected);
  const rest = [];
  for (let i = 0; i < bodies.length; i++) {
    if (!sel.has(i)) rest.push(bodies[i]);
  }
  const combined = _booleanCombine(op, picked);
  let shaped = combined.result;
  const discard = combined.temps.slice();
  for (const tool of tools) {
    if (tool !== shaped) discard.push(tool);
  }
  if (op === 'intersect' && Array.isArray(options.drop) && options.drop.length) {
    const dropped = _booleanDropPieces(shaped, options.drop);
    shaped = dropped.kept;
    for (const extra of dropped.discard) discard.push(extra);
  }
  if (_booleanEmpty(shaped)) {
    for (const extra of discard) _safeDeleteManifold(extra);
    for (const body of bodies) {
      if (body && body !== manifold) _safeDeleteManifold(body);
    }
    throw new Error(op === 'intersect'
      ? 'booleanBodies: intersection is empty'
      : 'booleanBodies: result is empty');
  }
  const kept = [shaped, ...rest];
  const keepSet = new Set(kept);
  for (const body of bodies) {
    if (body && body !== manifold && !keepSet.has(body)) discard.push(body);
  }
  if (combined.result && combined.result !== shaped && !keepSet.has(combined.result)) {
    discard.push(combined.result);
  }
  for (const extra of discard) {
    if (extra && extra !== manifold && !keepSet.has(extra)) _safeDeleteManifold(extra);
  }
  const result = kept.length === 1 ? kept[0] : Manifold.compose(kept);
  const status = _c4StatusError(result);
  if (status) throw new Error(`booleanBodies: result is not a valid solid (${status})`);
  return result;
}

function _booleanExternalTools(list) {
  if (list == null) return [];
  const arr = Array.isArray(list) ? list : [list];
  const out = [];
  for (const m of arr) {
    if (!m || typeof m.decompose !== 'function') {
      throw new Error('booleanBodies: tools entries must be solids (externalBody(...))');
    }
    out.push(m);
  }
  return out;
}

/**
 * Pick bodies out of a copied solid and pose them into the target frame.
 * `bodies` are [{ at }] vertex centroids in the source part's frame.
 * Omit them to keep the whole solid. `offset` is source position − target
 * position (assembly placement is a translation).
 */
function _externalPick(solid, bodies, offset, label = 'externalBody') {
  const { Manifold } = manifoldModule;
  if (!solid || typeof solid.decompose !== 'function') {
    throw new Error(`${label}: the copied script must return a Manifold`);
  }
  let picked = solid;
  if (Array.isArray(bodies) && bodies.length) {
    const all = _cutBodiesOf(solid);
    const idx = [];
    for (const entry of bodies) {
      const at = entry && (entry.at || entry.center);
      if (!Array.isArray(at)) throw new Error(`${label}: bodies entries need { at: [x, y, z] }`);
      let i;
      try {
        i = _cutBodyIndex(all, at);
      } catch (err) {
        const msg = err && err.message ? String(err.message) : String(err);
        throw new Error(msg.replace(/^cut:/, `${label}:`));
      }
      if (!idx.includes(i)) idx.push(i);
    }
    const keep = idx.map((i) => all[i]);
    for (let i = 0; i < all.length; i++) {
      if (!idx.includes(i) && all[i] !== solid) _safeDeleteManifold(all[i]);
    }
    picked = keep.length === 1 ? keep[0] : Manifold.compose(keep);
    if (keep.length > 1) {
      for (const k of keep) if (k !== solid) _safeDeleteManifold(k);
    }
  }
  const off = Array.isArray(offset) ? offset.map(Number) : [0, 0, 0];
  if (off.some((v) => !Number.isFinite(v))) throw new Error(`${label}: offset must be finite [dx, dy, dz]`);
  if (off[0] || off[1] || off[2]) {
    const moved = picked.translate(off);
    if (picked !== solid) _safeDeleteManifold(picked);
    picked = moved;
  }
  return picked;
}

/**
 * externalBody(source, { bodies, offset }) — a frozen copy of geometry from
 * another part. `source` is a function holding that part's script text as
 * it was at Accept (or a Manifold). It is not linked: editing the source part
 * later does not change this copy. `bodies` picks bodies by vertex centroid
 * in the source frame; `offset` poses the copy into this part's frame.
 */
function externalBody(source, opts = {}) {
  if (!manifoldModule) throw new Error('Manifold not initialized');
  const options = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  const solid = typeof source === 'function' ? source() : source;
  const posed = _externalPick(solid, options.bodies, options.offset);
  if (posed !== solid && typeof source === 'function') _safeDeleteManifold(solid);
  return posed;
}

function _booleanOp(op) {
  const v = op == null ? 'union' : String(op).toLowerCase();
  if (v === 'union' || v === 'add') return 'union';
  if (v === 'difference' || v === 'subtract' || v === 'cut') return 'difference';
  if (v === 'intersect' || v === 'intersection') return 'intersect';
  throw new Error(`booleanBodies: op must be 'union', 'difference', or 'intersect' (got ${op})`);
}

function _booleanSelected(bodies, spec) {
  if (!Array.isArray(spec) || !spec.length) {
    return bodies.map((_, i) => i);
  }
  const selected = [];
  const seen = new Set();
  for (const entry of spec) {
    const at = entry && (entry.at || entry.center);
    if (!Array.isArray(at)) throw new Error('booleanBodies: bodies entries need { at: [x, y, z] }');
    let idx;
    try {
      idx = _cutBodyIndex(bodies, at);
    } catch (err) {
      const msg = err && err.message ? String(err.message) : String(err);
      throw new Error(msg.replace(/^cut:/, 'booleanBodies:'));
    }
    if (seen.has(idx)) continue;
    seen.add(idx);
    selected.push(idx);
  }
  return selected;
}

function _booleanCombine(op, picked) {
  const { Manifold } = manifoldModule;
  if (op === 'union') {
    if (picked.length === 1) return { result: picked[0], temps: [] };
    return { result: Manifold.union(picked), temps: [] };
  }
  const target = picked[0];
  const tools = picked.slice(1);
  const temps = [];
  let tool = tools[0];
  if (tools.length > 1) {
    tool = Manifold.union(tools);
    temps.push(tool);
  }
  const result = op === 'difference'
    ? Manifold.difference(target, tool)
    : Manifold.intersection(target, tool);
  return { result, temps };
}

function _booleanEmpty(m) {
  if (!m) return true;
  if (typeof m.isEmpty === 'function') {
    try { if (m.isEmpty()) return true; } catch (_) { /* volume floor below */ }
  }
  return !(_cutVol(m) > 1e-8);
}

function _booleanDropPieces(result, spec) {
  const pieces = _cutBodiesOf(result);
  const dropIdx = new Set();
  for (const entry of spec) {
    const at = entry && (entry.at || entry.center);
    if (!Array.isArray(at)) throw new Error('booleanBodies: drop entries need { at: [x, y, z] }');
    try {
      dropIdx.add(_cutBodyIndex(pieces, at));
    } catch (err) {
      const msg = err && err.message ? String(err.message) : String(err);
      throw new Error(msg.replace(/^cut:/, 'booleanBodies:'));
    }
  }
  const kept = [];
  const discard = [];
  for (let i = 0; i < pieces.length; i++) {
    if (dropIdx.has(i)) {
      if (pieces[i] !== result) discard.push(pieces[i]);
      continue;
    }
    kept.push(pieces[i]);
  }
  if (!kept.length) throw new Error('booleanBodies: every piece was deleted');
  if (kept.length === 1) return { kept: kept[0], discard };
  const { Manifold } = manifoldModule;
  return { kept: Manifold.compose(kept), discard };
}

// Collection of all helper functions to inject
/**
 * Feature-op brackets for the face graph. Manifold hands out originalIDs in
 * order, so the IDs reserved while one fillet / chamfer call ran are exactly
 * that op's cutter pieces (legs, corner patches, welded rebuilds). The face
 * graph never merges a curved patch across two feature keys, so a fillet
 * stays one face and does not spill onto a tangent loft wall or the next
 * fillet. Reset per execute.
 */
let _featureOps = [];
/** Positive originalIDs tagged with a facet step, without becoming a fillet op. */
let _sourceTess = [];
/**
 * originalID range each marked block allocated: `{ id, lo, hi }` (hi is null
 * while the block is open). A run no helper stamped is named after the
 * block that made it (`<block id>.f<k>`), else `script.f<k>`.
 */
let _blockRanges = [];
function _probeOriginalID() {
  try {
    const probe = manifoldModule.Manifold.cube([1e-3, 1e-3, 1e-3]);
    const id = probe.originalID();
    probe.delete?.();
    return Number.isFinite(id) ? id : -1;
  } catch {
    return -1;
  }
}
/**
 * Full-circle counts inside filletEdges. The cylinder is the fillet arc;
 * the corner count is the spherical corner's grid (a quarter of it per
 * side of the octant) and must divide the cylinder count, so the corner's
 * boundary ring is the sail's own vertices. The face graph turns these into
 * a per-source facet step (360°/count).
 */
const FILLET_EDGES_CIRCLE_SEGMENTS = 384;
const FILLET_EDGES_CORNER_SEGMENTS = 128;
if ((FILLET_EDGES_CIRCLE_SEGMENTS / 4) % (FILLET_EDGES_CORNER_SEGMENTS / 4) !== 0) {
  throw new Error('filletEdges: the corner grid must divide the sail ring');
}
/**
 * originalIDs of the corner balls the current blend op built
 * (`filletEdges` with `sphericalCorners`). Their runs are stamped
 * `<block>.corner`, not `.round`, so a spherical corner is its own named
 * face between the sails it joins. Reset per op by `_featureOp`.
 */
let _blendCornerIDs = new Set();
function _featureOp(fn, describe, blendRole = null) {
  return function featureOp(...args) {
    const lo = _probeOriginalID();
    _blendCornerIDs = new Set();
    const out = fn.apply(this, args);
    const hi = _probeOriginalID();
    let tess = null;
    if (describe) {
      try { tess = describe(args); } catch { tess = null; }
    }
    if (lo >= 0 && hi > lo + 1) {
      _featureOps.push({
        lo,
        hi,
        facetDeg: tess && tess.facetDeg > 0 ? tess.facetDeg : 0,
        cornerDeg: tess && tess.cornerDeg > 0 ? tess.cornerDeg : 0,
      });
      // Face identity: the surface the blend made gets a name too
      // (`fillet1.round`, `chamfer2.bevel`, a spherical corner
      // `fillet1.corner[k]`; a block with no id= is positional,
      // `fillet-16`), so an edge on it can be written by name like any
      // other.
      if (blendRole) {
        let role = null;
        try { role = blendRole(args); } catch { role = null; }
        if (role) {
          const corners = _blendCornerIDs;
          _stampRunsInRange(out, role === 'bevel' ? 'chamfer' : 'fillet', lo, hi, (originalID) => (corners.has(originalID) ? 'corner' : role));
        }
      }
    }
    return out;
  };
}

/**
 * Stamp every run of `manifold` whose originalID the op bracket (lo, hi)
 * allocated with the role `roleOf(originalID)` gives it: the blend surface a
 * fillet or chamfer cut (`round` / `bevel`), or `corner` for a spherical
 * corner ball. Runs outside the bracket (the host) keep their stamps.
 *
 * One originalID can own several runs: a corner cap reuses the sail
 * cylinders, so after the cap boolean each cylinder is three runs. The
 * faceIDs of every run are merged before the stamp is written; writing per
 * run kept only the last run's ranges and left the other runs' triangles
 * nameless (249 unnamed catalog rows on a 40×30×20 box with corners).
 */
function _stampRunsInRange(manifold, helper, lo, hi, roleOf) {
  if (!manifold || typeof manifold.getMesh !== 'function') return;
  let mesh;
  try { mesh = manifold.getMesh(); } catch { return; }
  const nTri = mesh.numTri;
  if (!nTri || !mesh.faceID || !mesh.runIndex || !mesh.runOriginalID) return;
  const roleFor = typeof roleOf === 'function' ? roleOf : () => roleOf;
  const idsByOriginal = new Map();
  for (let r = 0; r + 1 < mesh.runIndex.length; r++) {
    const originalID = mesh.runOriginalID[r];
    if (!(originalID > lo && originalID < hi)) continue;
    const t0 = mesh.runIndex[r] / 3;
    const t1 = Math.min(nTri, mesh.runIndex[r + 1] / 3);
    if (!(t1 > t0)) continue;
    let ids = idsByOriginal.get(originalID);
    if (!ids) { ids = []; idsByOriginal.set(originalID, ids); }
    for (let t = t0; t < t1; t++) ids.push(mesh.faceID[t]);
  }
  if (!idsByOriginal.size) return;
  const feature = _stampFeatureId(helper);
  for (const [originalID, ids] of idsByOriginal) {
    ids.sort((a, b) => a - b);
    const role = roleFor(originalID);
    _faceStamps.set(originalID, { feature, helper, roles: [{ role, record: { kind: 'mesh' }, ranges: _idRanges(ids) }] });
  }
}
/**
 * Tag the originalIDs a call allocates, and leave those keys positive.
 * roundedBox is a hull, not a fillet op: its flats must still earn the flat lock.
 */
function _tagTessellation(fn, describe) {
  return function tagTessellation(...args) {
    const lo = _probeOriginalID();
    const out = fn.apply(this, args);
    const hi = _probeOriginalID();
    let tess = null;
    try { tess = describe(args); } catch { tess = null; }
    if (lo >= 0 && hi > lo && tess && (tess.facetDeg > 0 || tess.cornerDeg > 0)) {
      _sourceTess.push({
        lo,
        hi,
        facetDeg: tess.facetDeg > 0 ? tess.facetDeg : 0,
        cornerDeg: tess.cornerDeg > 0 ? tess.cornerDeg : 0,
      });
    }
    return out;
  };
}
/** roundedBox(size, radius, segments=16) — sphere circularSegments, full circle. */
function _roundedBoxTess(args) {
  const segments = Math.max(3, Math.round(Number(args[2] == null ? 16 : args[2]) || 16));
  return { facetDeg: 360 / segments, cornerDeg: 0 };
}
/** filletEdges cylinder is a full circle; the corner ball is its own count. */
function _filletEdgesTess() {
  return {
    facetDeg: 360 / FILLET_EDGES_CIRCLE_SEGMENTS,
    cornerDeg: 360 / FILLET_EDGES_CORNER_SEGMENTS,
  };
}
/**
 * filletAlongPath segments are the arc of a right-angle wedge (90°),
 * unless the profile is a straight chamfer, which has no facet step.
 */
function _filletAlongPathTess(args) {
  const opts = args[3] && typeof args[3] === 'object' ? args[3] : {};
  if (opts.profile === 'chamfer') return null;
  const segments = Math.max(2, Math.round(Number(opts.segments != null ? opts.segments : FILLET_ARC_SEGMENTS) || FILLET_ARC_SEGMENTS));
  return { facetDeg: 90 / segments, cornerDeg: 0 };
}
/** Per run: the outermost op that reserved its originalID (−(op+1)), else the originalID. */
function _runFeatureKeys(runOriginalID) {
  const out = new Array(runOriginalID.length);
  for (let r = 0; r < runOriginalID.length; r++) {
    const id = runOriginalID[r];
    let key = id;
    for (let k = 0; k < _featureOps.length; k++) {
      const op = _featureOps[k];
      if (id > op.lo && id < op.hi) { key = -(k + 1); break; }
    }
    out[r] = key;
  }
  return out;
}
/** One row per tagged source: facet step (and corner step, when known). */
function _featureTessellation(runOriginalID) {
  const out = [];
  for (let k = 0; k < _featureOps.length; k++) {
    const op = _featureOps[k];
    if (!(op.facetDeg > 0) && !(op.cornerDeg > 0)) continue;
    out.push({ source: -(k + 1), facetDeg: op.facetDeg, cornerDeg: op.cornerDeg });
  }
  const seen = new Set();
  const ids = runOriginalID || [];
  for (let r = 0; r < ids.length; r++) {
    const id = ids[r];
    if (seen.has(id)) continue;
    for (const row of _sourceTess) {
      if (id > row.lo && id < row.hi) {
        seen.add(id);
        out.push({ source: id, facetDeg: row.facetDeg, cornerDeg: row.cornerDeg });
        break;
      }
    }
  }
  return out;
}

// ============================================================================
// FACE IDENTITY — provenance stamps (mvp/surfcad-face-identity-design.md)
//
// Every helper that knows what it builds records, for the solid it returns,
// which of its triangles play which role (cube.top, cylinder.side,
// extrude.wall[3]). Nothing in the mesh changes: Manifold already gives
// every run of triangles an `originalID` (one per primitive or helper
// result) and every triangle a `faceID`, and carries both through every
// boolean and transform (verified on built/manifold.js). A stamp is the
// pair (originalID, faceID range) → role, kept in `_faceStamps` for the
// current run; serializeResult ships the rows the final mesh still uses,
// and the main thread groups triangles by them (src/utils/faceIdentity.js).
// Because the ids are Manifold's own, the boundary ids that Fillet mode
// writes into scripts (`edgesBetween(part, 3, 6)`), the face graph and the
// C4 face helpers see exactly what they always saw.
//
// The feature of a label is the id of the marked block that was running
// (`cube1`, `tapDrillHole-11`), else a synthetic `<helper>@<n>` counted in
// script order. A hull, a fillet cutter, or a freehand Manifold.* call made
// outside the stamped helpers has no row and so no name.
// ============================================================================
/**
 * originalID -> { feature, helper, roles: [{ role, record, ranges: [[from, to], …] }] }
 * for this run. `ranges` are faceID intervals, from <= id < to, sorted.
 */
let _faceStamps = new Map();
/** helper -> count, for calls outside a marked block (`cube@2`). */
let _stampCounters = new Map();
/** Innermost marked feature block id while the script runs, else null. */
let _featureNow = () => null;

function _resetFaceStamps() {
  _faceStamps = new Map();
  _stampCounters = new Map();
}

function _stampFeatureId(helper) {
  let id = null;
  try { id = _featureNow(); } catch { id = null; }
  if (typeof id === 'string' && id) return id;
  const n = (_stampCounters.get(helper) || 0) + 1;
  _stampCounters.set(helper, n);
  return `${helper}@${n}`;
}

/** One triangle as a role classifier sees it. */
function _stampTri(mesh, t) {
  const np = mesh.numProp;
  const vp = mesh.vertProperties;
  const i0 = mesh.triVerts[t * 3];
  const i1 = mesh.triVerts[t * 3 + 1];
  const i2 = mesh.triVerts[t * 3 + 2];
  const a = [vp[i0 * np], vp[i0 * np + 1], vp[i0 * np + 2]];
  const b = [vp[i1 * np], vp[i1 * np + 1], vp[i1 * np + 2]];
  const c = [vp[i2 * np], vp[i2 * np + 1], vp[i2 * np + 2]];
  const cross = _c4Cross(_c4Sub(b, a), _c4Sub(c, a));
  return {
    a,
    b,
    c,
    n: _c4Norm(cross),
    area: 0.5 * _c4Len(cross),
    center: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3],
  };
}

/** Plane record from the triangles of one role: area-weighted origin and normal. */
function _planeRecord(tris) {
  let area = 0;
  const c = [0, 0, 0];
  const n = [0, 0, 0];
  for (const tri of tris) {
    area += tri.area;
    for (let k = 0; k < 3; k++) {
      c[k] += tri.center[k] * tri.area;
      n[k] += tri.n[k] * tri.area;
    }
  }
  if (!(area > 0)) return { kind: 'mesh' };
  return { kind: 'plane', origin: _c4Mul(1 / area, c), normal: _c4Norm(n) };
}

/** Sorted, merged [from, to) intervals of a sorted id list. */
function _idRanges(sortedIds) {
  const out = [];
  for (const id of sortedIds) {
    const last = out[out.length - 1];
    if (last && id === last[1]) last[1] = id + 1;
    else if (!last || id > last[1]) out.push([id, id + 1]);
  }
  return out;
}

/** The role row of (originalID, faceID), or null (binary search over the ranges). */
function _stampRoleFor(stamp, faceID) {
  if (!stamp) return null;
  for (const row of stamp.roles) {
    const r = row.ranges;
    let lo = 0;
    let hi = r.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (faceID < r[mid][0]) hi = mid - 1;
      else if (faceID >= r[mid][1]) lo = mid + 1;
      else return row;
    }
  }
  return null;
}

/**
 * Record the roles of `manifold`'s faces under the helper that built it.
 * `roleOf(tri)` names the role of one triangle (see _stampTri);
 * `records(role, tris)` returns the SurfaceRecord for a role, or null for
 * `{ kind: 'mesh' }`. Every run of the mesh (one for a primitive, two for a
 * tube) gets a row under its own originalID. The solid is returned as is:
 * the mesh, its ids and its triangle order are untouched, so stamping can
 * never change what a script builds. On any failure the faces simply have
 * no name.
 */
function _stampFaces(manifold, helper, roleOf, records = null) {
  if (!manifoldModule || !manifold || typeof manifold.getMesh !== 'function') return manifold;
  let mesh;
  try { mesh = manifold.getMesh(); } catch { return manifold; }
  const nTri = mesh.numTri;
  if (!nTri || !mesh.faceID || !mesh.runIndex || !mesh.runOriginalID) return manifold;
  const feature = _stampFeatureId(helper);
  try {
    for (let r = 0; r + 1 < mesh.runIndex.length; r++) {
      const originalID = mesh.runOriginalID[r];
      const t0 = mesh.runIndex[r] / 3;
      const t1 = Math.min(nTri, mesh.runIndex[r + 1] / 3);
      if (!(t1 > t0)) continue;
      const roleIds = new Map();
      const roleTris = new Map();
      for (let t = t0; t < t1; t++) {
        const tri = _stampTri(mesh, t);
        let role;
        try { role = roleOf(tri, t); } catch { role = null; }
        if (typeof role !== 'string' || !role) role = 'mesh';
        let ids = roleIds.get(role);
        if (!ids) { ids = []; roleIds.set(role, ids); roleTris.set(role, []); }
        ids.push(mesh.faceID[t]);
        roleTris.get(role).push(tri);
      }
      const roles = [];
      for (const [role, ids] of roleIds) {
        let record = null;
        if (typeof records === 'function') {
          try { record = records(role, roleTris.get(role)); } catch { record = null; }
        }
        ids.sort((a, b) => a - b);
        roles.push({
          role,
          record: record && typeof record === 'object' ? record : { kind: 'mesh' },
          ranges: _idRanges(ids),
        });
      }
      // A run that already carries a stamp (a tube's inner cylinder built
      // by the stamped cylinder helper) is re-labelled by the outer helper.
      _faceStamps.set(originalID, { feature, helper, roles });
    }
  } catch (err) {
    console.warn(`[identity] ${helper}: faces left unnamed (${err?.message || err})`);
  }
  return manifold;
}

/**
 * Coplanar groups of one triangle range: triangles that share an edge and
 * lie in one plane (0.1°, 1e-3 mm offset) are one group. Returns the group
 * index per triangle (relative to t0) with groups numbered by their lowest
 * faceID, so a rerun of the same mesh numbers them the same way.
 */
function _coplanarGroups(mesh, t0, t1) {
  const n = t1 - t0;
  const np = mesh.numProp;
  const vp = mesh.vertProperties;
  const tv = mesh.triVerts;
  const nx = new Float64Array(n);
  const ny = new Float64Array(n);
  const nz = new Float64Array(n);
  const off = new Float64Array(n);
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    parent[i] = i;
    const t = t0 + i;
    const a = tv[t * 3] * np;
    const b = tv[t * 3 + 1] * np;
    const c = tv[t * 3 + 2] * np;
    const e1 = [vp[b] - vp[a], vp[b + 1] - vp[a + 1], vp[b + 2] - vp[a + 2]];
    const e2 = [vp[c] - vp[a], vp[c + 1] - vp[a + 1], vp[c + 2] - vp[a + 2]];
    const cr = _c4Norm(_c4Cross(e1, e2));
    nx[i] = cr[0]; ny[i] = cr[1]; nz[i] = cr[2];
    off[i] = cr[0] * vp[a] + cr[1] * vp[a + 1] + cr[2] * vp[a + 2];
  }
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const cosPlanar = Math.cos((0.1 * Math.PI) / 180);
  const byEdge = new Map();
  for (let i = 0; i < n; i++) {
    const t = t0 + i;
    for (let k = 0; k < 3; k++) {
      const u = tv[t * 3 + k];
      const w = tv[t * 3 + ((k + 1) % 3)];
      const key = u < w ? u * 67108864 + w : w * 67108864 + u;
      const prev = byEdge.get(key);
      if (prev === undefined) { byEdge.set(key, i); continue; }
      if (nx[prev] * nx[i] + ny[prev] * ny[i] + nz[prev] * nz[i] < cosPlanar) continue;
      if (Math.abs(off[prev] - off[i]) > 1e-3) continue;
      const a = find(prev);
      const b = find(i);
      if (a !== b) parent[b] = a;
    }
  }
  const minFace = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const fid = mesh.faceID ? mesh.faceID[t0 + i] : t0 + i;
    const prev = minFace.get(r);
    if (prev === undefined || fid < prev) minFace.set(r, fid);
  }
  const roots = [...minFace.entries()].sort((a, b) => a[1] - b[1]).map(([r]) => r);
  const index = new Map(roots.map((r, k) => [r, k]));
  const group = new Int32Array(n);
  for (let i = 0; i < n; i++) group[i] = index.get(find(i));
  return group;
}

/**
 * Stamp a solid no helper built (an import) by coplanar group: role `f<k>`
 * per plane, numbered by lowest faceID. Weaker than a helper's roles, but
 * a name, so an edge on it can be written and resolved like any other.
 */
function _stampCoplanarFaces(manifold, helper) {
  if (!manifold || typeof manifold.getMesh !== 'function') return manifold;
  let mesh;
  try { mesh = manifold.getMesh(); } catch { return manifold; }
  if (!mesh.numTri || !mesh.runIndex) return manifold;
  const groupOf = new Int32Array(mesh.numTri);
  for (let r = 0; r + 1 < mesh.runIndex.length; r++) {
    const t0 = mesh.runIndex[r] / 3;
    const t1 = Math.min(mesh.numTri, mesh.runIndex[r + 1] / 3);
    if (!(t1 > t0)) continue;
    const g = _coplanarGroups(mesh, t0, t1);
    for (let t = t0; t < t1; t++) groupOf[t] = g[t - t0];
  }
  return _stampFaces(manifold, helper, (tri, t) => `f${groupOf[t]}`, (role, tris) => _planeRecord(tris));
}

/** The innermost marked block whose originalID range holds `id`, or null. */
function _blockFor(originalID) {
  let best = null;
  for (const range of _blockRanges) {
    if (!(originalID > range.lo)) continue;
    if (range.hi !== null && !(originalID < range.hi)) continue;
    if (!best || range.lo > best.lo) best = range;
  }
  return best ? best.id : null;
}

/**
 * Name the runs of `mesh` that no helper stamped: a hull, a raw extrude or
 * revolve, `smooth`, `refine`. Roles are coplanar groups (`f<k>`), the
 * feature is the marked block that allocated the run, else `script`, so
 * nothing in a result is left nameless and every edge can be written by
 * name. Idempotent: a run that already has a stamp is left alone.
 */
function _synthesizeStamps(mesh) {
  if (!mesh || !mesh.numTri || !mesh.faceID || !mesh.runIndex || !mesh.runOriginalID) return;
  const nTri = mesh.numTri;
  for (let r = 0; r + 1 < mesh.runIndex.length; r++) {
    const originalID = mesh.runOriginalID[r];
    if (_faceStamps.has(originalID)) continue;
    const t0 = mesh.runIndex[r] / 3;
    const t1 = Math.min(nTri, mesh.runIndex[r + 1] / 3);
    if (!(t1 > t0)) continue;
    const feature = _blockFor(originalID) || 'script';
    const group = _coplanarGroups(mesh, t0, t1);
    const roleIds = new Map();
    const roleTris = new Map();
    for (let t = t0; t < t1; t++) {
      const role = `f${group[t - t0]}`;
      let ids = roleIds.get(role);
      if (!ids) { ids = []; roleIds.set(role, ids); roleTris.set(role, []); }
      ids.push(mesh.faceID[t]);
      roleTris.get(role).push(_stampTri(mesh, t));
    }
    const roles = [];
    for (const [role, ids] of roleIds) {
      ids.sort((a, b) => a - b);
      roles.push({ role, record: _planeRecord(roleTris.get(role)), ranges: _idRanges(ids) });
    }
    _faceStamps.set(originalID, { feature, helper: 'mesh', roles });
  }
}

/** The stamp rows this mesh still uses (serializeResult). */
function _faceStampRows(runOriginalID) {
  if (!runOriginalID || !_faceStamps.size) return [];
  const rows = [];
  const seen = new Set();
  for (let r = 0; r < runOriginalID.length; r++) {
    const id = runOriginalID[r];
    if (seen.has(id)) continue;
    seen.add(id);
    const s = _faceStamps.get(id);
    if (s) rows.push({ originalID: id, feature: s.feature, helper: s.helper, roles: s.roles });
  }
  return rows;
}

/** top/bottom/left/right/front/back for an axis-aligned normal, else null. */
function _axisRole(n, tol = 0.999) {
  const ax = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  const k = ax[0] >= ax[1] && ax[0] >= ax[2] ? 0 : (ax[1] >= ax[2] ? 1 : 2);
  if (ax[k] < tol) return null;
  const pos = n[k] > 0;
  if (k === 0) return pos ? 'right' : 'left';
  if (k === 1) return pos ? 'back' : 'front';
  return pos ? 'top' : 'bottom';
}

function _stampCube(m, helper = 'cube') {
  return _stampFaces(m, helper, (tri) => _axisRole(tri.n), (role, tris) => (role === 'mesh' ? null : _planeRecord(tris)));
}

function _sideOrCap(tri) {
  if (tri.n[2] > 0.999) return 'top';
  if (tri.n[2] < -0.999) return 'bottom';
  return 'side';
}

function _coneRecord(z0, height, rLow, rHigh) {
  if (Math.abs(rLow - rHigh) < 1e-9) {
    return { kind: 'cylinder', axisOrigin: [0, 0, z0], axisDir: [0, 0, 1], radius: rLow };
  }
  const h = Number(height);
  // The apex sits where the radius reaches zero along the axis.
  const apexZ = rLow > rHigh ? z0 + (h * rLow) / (rLow - rHigh) : z0 - (h * rHigh) / (rHigh - rLow);
  return {
    kind: 'cone',
    apex: [0, 0, apexZ],
    axisDir: [0, 0, rLow > rHigh ? -1 : 1],
    halfAngle: Math.atan2(Math.abs(rLow - rHigh), Math.abs(h)),
  };
}

function _stampCylinder(m, height, radiusLow, radiusHigh, center) {
  const rl = Number(radiusLow);
  const rh = radiusHigh == null || !(Number(radiusHigh) >= 0) ? rl : Number(radiusHigh);
  const z0 = center ? -Number(height) / 2 : 0;
  return _stampFaces(m, 'cylinder', _sideOrCap, (role, tris) => (
    role === 'side' ? _coneRecord(z0, height, rl, rh) : _planeRecord(tris)
  ));
}

function _stampSphere(m, radius) {
  return _stampFaces(m, 'sphere', () => 'surface', () => ({ kind: 'sphere', center: [0, 0, 0], radius: Number(radius) }));
}

/** hexPrism: top, bottom, wall[0..5] counter-clockwise from +X. */
function _stampHexPrism(m) {
  return _stampFaces(m, 'hexPrism', (tri) => {
    const cap = _sideOrCap(tri);
    if (cap !== 'side') return cap;
    const deg = ((Math.atan2(tri.center[1], tri.center[0]) * 180) / Math.PI + 360) % 360;
    return `wall[${Math.min(5, Math.floor(deg / 60))}]`;
  }, (role, tris) => _planeRecord(tris));
}

/** tube: side (outer wall), inner, top, bottom. */
function _stampTube(m, outerRadius, innerRadius) {
  const ro = Number(outerRadius);
  const ri = Number(innerRadius);
  const mid = (ro + ri) / 2;
  return _stampFaces(m, 'tube', (tri) => {
    const cap = _sideOrCap(tri);
    if (cap !== 'side') return cap;
    return Math.hypot(tri.center[0], tri.center[1]) < mid ? 'inner' : 'side';
  }, (role, tris) => {
    if (role === 'side') return { kind: 'cylinder', axisOrigin: [0, 0, 0], axisDir: [0, 0, 1], radius: ro };
    if (role === 'inner') return { kind: 'cylinder', axisOrigin: [0, 0, 0], axisDir: [0, 0, 1], radius: ri };
    return _planeRecord(tris);
  });
}

/**
 * roundedBox: the six flats keep the cube names; the twelve rounded edges
 * are band[i] (i = axis*4 + signs of the two other axes, 0..11) and the
 * eight corners corner[i] (sign octant, 0..7). Classified by where the
 * triangle centroid sits against the inner core (size/2 - r), which is
 * exact for a hull of corner spheres.
 */
function _stampRoundedBox(m, size, r) {
  const half = [size[0] / 2 - r, size[1] / 2 - r, size[2] / 2 - r];
  const eps = 1e-6 * Math.max(size[0], size[1], size[2], 1);
  return _stampFaces(m, 'roundedBox', (tri) => {
    const c = tri.center;
    const beyond = [0, 1, 2].filter((k) => Math.abs(c[k]) > half[k] + eps);
    if (beyond.length === 1) {
      const k = beyond[0];
      const pos = c[k] > 0;
      if (k === 0) return pos ? 'right' : 'left';
      if (k === 1) return pos ? 'back' : 'front';
      return pos ? 'top' : 'bottom';
    }
    if (beyond.length === 2) {
      const axis = [0, 1, 2].find((k) => !beyond.includes(k));
      const [a, b] = beyond;
      return `band[${axis * 4 + (c[a] > 0 ? 2 : 0) + (c[b] > 0 ? 1 : 0)}]`;
    }
    if (beyond.length === 3) {
      return `corner[${(c[0] > 0 ? 4 : 0) + (c[1] > 0 ? 2 : 0) + (c[2] > 0 ? 1 : 0)}]`;
    }
    return null;
  }, (role, tris) => {
    let hit = /^band\[(\d+)\]$/.exec(role);
    if (hit) {
      const i = Number(hit[1]);
      const axis = Math.floor(i / 4);
      const others = [0, 1, 2].filter((k) => k !== axis);
      const origin = [0, 0, 0];
      origin[others[0]] = (i & 2 ? 1 : -1) * half[others[0]];
      origin[others[1]] = (i & 1 ? 1 : -1) * half[others[1]];
      const dir = [0, 0, 0];
      dir[axis] = 1;
      return { kind: 'cylinder', axisOrigin: origin, axisDir: dir, radius: r };
    }
    hit = /^corner\[(\d+)\]$/.exec(role);
    if (hit) {
      const i = Number(hit[1]);
      return {
        kind: 'sphere',
        center: [(i & 4 ? 1 : -1) * half[0], (i & 2 ? 1 : -1) * half[1], (i & 1 ? 1 : -1) * half[2]],
        radius: r,
      };
    }
    return role === 'mesh' ? null : _planeRecord(tris);
  });
}

/** Distance from point p to the segment ab, in 2D. */
function _segDist2(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

/**
 * Logical edges of normalized profile loops. A loop whose points all sit
 * at one distance from their centroid (8 or more of them) is one circle
 * edge; every other loop contributes one edge per point pair. Edges are
 * indexed across loops in order, so `wall[g]` / `seg[g]` is stable while
 * the profile keeps its point count.
 */
function _profileEdges(loops) {
  const edges = [];
  for (const pts of loops) {
    const n = pts.length;
    let cx = 0;
    let cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= n;
    cy /= n;
    let rMin = Infinity;
    let rMax = 0;
    for (const p of pts) {
      const r = Math.hypot(p[0] - cx, p[1] - cy);
      if (r < rMin) rMin = r;
      if (r > rMax) rMax = r;
    }
    if (n >= 8 && rMax > 0 && (rMax - rMin) <= 1e-6 * rMax + 1e-9) {
      edges.push({ kind: 'circle', center: [cx, cy], radius: (rMin + rMax) / 2 });
      continue;
    }
    for (let i = 0; i < n; i++) edges.push({ kind: 'line', a: pts[i], b: pts[(i + 1) % n] });
  }
  return edges;
}

function _nearestProfileEdge(edges, p) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const d = e.kind === 'circle'
      ? Math.abs(Math.hypot(p[0] - e.center[0], p[1] - e.center[1]) - e.radius)
      : _segDist2(p, e.a, e.b);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** makeExtrude: cap0 (z = 0), cap1 (z = height), wall[g] per logical profile edge. */
function _stampExtrude(m, loops, height) {
  const edges = _profileEdges(loops);
  return _stampFaces(m, 'extrude', (tri) => {
    if (tri.n[2] > 0.999) return height >= 0 ? 'cap1' : 'cap0';
    if (tri.n[2] < -0.999) return height >= 0 ? 'cap0' : 'cap1';
    const g = _nearestProfileEdge(edges, tri.center);
    return g >= 0 ? `wall[${g}]` : null;
  }, (role, tris) => {
    const hit = /^wall\[(\d+)\]$/.exec(role);
    if (hit) {
      const e = edges[Number(hit[1])];
      if (e && e.kind === 'circle') {
        return { kind: 'cylinder', axisOrigin: [e.center[0], e.center[1], 0], axisDir: [0, 0, 1], radius: e.radius };
      }
    }
    return role === 'mesh' ? null : _planeRecord(tris);
  });
}

/**
 * makeRevolve: seg[g] per profile segment (x is the radius, y the height
 * along the result's Z axis), end0 / end1 for the flat ends of a partial
 * revolve.
 */
function _stampRevolve(m, loops, degrees) {
  const edges = _profileEdges(loops);
  const partial = degrees < 360 - 1e-9;
  const angleOf = (v) => ((Math.atan2(v[1], v[0]) * 180) / Math.PI + 360) % 360;
  return _stampFaces(m, 'revolve', (tri) => {
    if (partial) {
      const t0 = angleOf(tri.a);
      const t1 = angleOf(tri.b);
      const t2 = angleOf(tri.c);
      const same = (x, y) => Math.abs(x - y) < 1e-4 || Math.abs(Math.abs(x - y) - 360) < 1e-4;
      if (same(t0, t1) && same(t1, t2)) {
        if (same(t0, 0)) return 'end0';
        if (same(t0, degrees)) return 'end1';
      }
    }
    const r = (Math.hypot(tri.a[0], tri.a[1]) + Math.hypot(tri.b[0], tri.b[1]) + Math.hypot(tri.c[0], tri.c[1])) / 3;
    const g = _nearestProfileEdge(edges, [r, tri.center[2]]);
    return g >= 0 ? `seg[${g}]` : null;
  }, (role, tris) => {
    const hit = /^seg\[(\d+)\]$/.exec(role);
    if (hit) {
      const e = edges[Number(hit[1])];
      if (e && e.kind === 'line') {
        const dx = e.b[0] - e.a[0];
        const dy = e.b[1] - e.a[1];
        if (Math.abs(dx) < 1e-9) {
          return { kind: 'cylinder', axisOrigin: [0, 0, 0], axisDir: [0, 0, 1], radius: Math.abs(e.a[0]) };
        }
        if (Math.abs(dy) < 1e-9) {
          return { kind: 'plane', origin: [0, 0, e.a[1]], normal: [0, 0, tris[0]?.n[2] >= 0 ? 1 : -1] };
        }
        const apexY = e.a[1] - e.a[0] * (dy / dx);
        return {
          kind: 'cone',
          apex: [0, 0, apexY],
          axisDir: [0, 0, dy / dx > 0 ? -1 : 1],
          halfAngle: Math.atan2(Math.abs(dx), Math.abs(dy)),
        };
      }
      return null;
    }
    return role === 'mesh' ? null : _planeRecord(tris);
  });
}

/** Logical edges of a CrossSection's polygons (toPolygons order), or null. */
function _crossSectionEdges(profile) {
  try {
    const loops = typeof profile?.toPolygons === 'function' ? profile.toPolygons() : null;
    if (!Array.isArray(loops) || !loops.length) return null;
    return _profileEdges(loops.map((loop) => loop.map((pt) => [Number(pt[0]), Number(pt[1])])));
  } catch {
    return null;
  }
}

/**
 * sweep / sweepPoints: cap0 on the path's start plane, cap1 on its end
 * plane, wall[g] per logical profile edge. Each triangle is read through
 * the path frame nearest its centroid: local (x, y) in that frame's
 * (N, B) picks the profile edge. Walls record the path when sweepPoints
 * gave one.
 */
function _stampSweep(m, ctx) {
  const edges = ctx && _crossSectionEdges(ctx.profile);
  const frames = ctx?.frames;
  const samples = ctx?.samples;
  if (!edges || !Array.isArray(frames) || !Array.isArray(samples) || frames.length !== samples.length || samples.length < 2) return m;
  const P0 = samples[0];
  const T0 = frames[0].T;
  const P1 = samples[samples.length - 1];
  const T1 = frames[frames.length - 1].T;
  let scale = 0;
  for (const e of edges) {
    if (e.kind === 'circle') scale = Math.max(scale, e.radius);
    else scale = Math.max(scale, Math.abs(e.a[0]), Math.abs(e.a[1]));
  }
  const eps = Math.max(1e-6, 1e-4 * Math.max(scale, 1));
  const onPlane = (tri, P, T) => [tri.a, tri.b, tri.c].every((v) => Math.abs(_c4Dot(_c4Sub(v, P), T)) < eps);
  const nearest = (c) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const dx = c[0] - s[0];
      const dy = c[1] - s[1];
      const dz = c[2] - s[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  return _stampFaces(m, 'sweep', (tri) => {
    if (onPlane(tri, P0, T0)) return 'cap0';
    if (onPlane(tri, P1, T1)) return 'cap1';
    const k = nearest(tri.center);
    const rel = _c4Sub(tri.center, samples[k]);
    const g = _nearestProfileEdge(edges, [_c4Dot(rel, frames[k].N), _c4Dot(rel, frames[k].B)]);
    return g >= 0 ? `wall[${g}]` : null;
  }, (role, tris) => {
    const hit = /^wall\[(\d+)\]$/.exec(role);
    if (hit) {
      const e = edges[Number(hit[1])];
      const record = { kind: 'swept', profileEdge: e && e.kind === 'line' ? [e.a[0], e.a[1], e.b[0], e.b[1]] : null };
      if (e && e.kind === 'circle') record.profileCircle = { center: e.center, radius: e.radius };
      if (Array.isArray(ctx.pathPoints) && ctx.pathPoints.length) record.path = ctx.pathPoints;
      return record;
    }
    return role === 'mesh' ? null : _planeRecord(tris);
  });
}

/**
 * makeLoft (parallel stations): cap0 at the first station, cap1 at the
 * last, span[i][j] for bottom-profile edge i between stations j and j + 1.
 * buildMakeLoftSolid fills `identity.roles` per triangle of its result; an
 * angled loft leaves it empty and is not stamped.
 */
function _stampLoft(m, identity) {
  const roles = identity && Array.isArray(identity.roles) ? identity.roles : null;
  if (!roles) return m;
  return _stampFaces(m, 'loft', (tri, tIdx) => roles[tIdx] || 'mesh', (role, tris) => {
    if (/^span\[/.test(role)) return { kind: 'lofted', stations: identity.stations || null };
    return role === 'mesh' ? null : _planeRecord(tris);
  });
}

/**
 * The `Manifold` a script sees: the same class, with cube / cylinder /
 * sphere recording their face roles. Every other static and `new Manifold`
 * pass through, and `instanceof` still works.
 */
function _scriptManifoldClass() {
  const M = manifoldModule.Manifold;
  const statics = {
    cube(...args) {
      return _stampCube(M.cube(...args));
    },
    cylinder(...args) {
      const [height, radiusLow, radiusHigh, , center] = args;
      return _stampCylinder(M.cylinder(...args), height, radiusLow, radiusHigh, center);
    },
    sphere(...args) {
      return _stampSphere(M.sphere(...args), args[0]);
    },
  };
  return new Proxy(M, {
    get(target, key, receiver) {
      if (Object.prototype.hasOwnProperty.call(statics, key)) return statics[key];
      return Reflect.get(target, key, receiver);
    },
  });
}

// ---------------------------------------------------------------- named faces (script side)
const _stampedFaceCache = new WeakMap();

/**
 * One face per connected piece (triangles sharing a vertex) of each
 * stamped label on `part`, named `feature.role`, with `[ordinal]` appended
 * when one label is in several pieces (ordered by centre x, y, z). Faces have the fields the C4 face
 * helpers read (center, normal, tris, verts, area, body) plus name, label
 * and record. Unstamped triangles (a hull, a cutter, a freehand
 * Manifold.* call) are not listed.
 */
function _stampedFaces(part) {
  if (!part || typeof part.getMesh !== 'function') throw new Error('facesNamed: part must be a Manifold');
  const hit = _stampedFaceCache.get(part);
  if (hit) return hit;
  const mesh = part.getMesh();
  _synthesizeStamps(mesh);
  const np = mesh.numProp;
  const vp = mesh.vertProperties;
  const nTri = mesh.numTri;
  const triBody = _triComponentIds(mesh.triVerts, nTri);
  // Label per triangle: the run's originalID picks the stamp, the faceID the role.
  const groups = new Map();
  const stampKey = new Map();
  if (mesh.faceID && mesh.runIndex && mesh.runOriginalID) {
    for (let r = 0; r + 1 < mesh.runIndex.length; r++) {
      const stamp = _faceStamps.get(mesh.runOriginalID[r]);
      if (!stamp) continue;
      const t1 = Math.min(nTri, mesh.runIndex[r + 1] / 3);
      for (let t = mesh.runIndex[r] / 3; t < t1; t++) {
        const row = _stampRoleFor(stamp, mesh.faceID[t]);
        if (!row) continue;
        const key = `${stamp.feature}.${row.role}`;
        let list = groups.get(key);
        if (!list) { list = []; groups.set(key, list); stampKey.set(key, { stamp, row }); }
        list.push(t);
      }
    }
  }
  const V = (i) => [vp[i * np], vp[i * np + 1], vp[i * np + 2]];
  const faces = [];
  for (const [key, tris] of groups) {
    const { stamp, row } = stampKey.get(key);
    // Connected pieces: triangles that share a vertex (the same rule as
    // src/utils/faceIdentity.js, which works on a mesh with needles dropped).
    const parent = tris.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const vertexOwner = new Map();
    tris.forEach((t, gi) => {
      for (let k = 0; k < 3; k++) {
        const v = mesh.triVerts[t * 3 + k];
        const prev = vertexOwner.get(v);
        if (prev === undefined) vertexOwner.set(v, gi);
        else { const a = find(prev); const b = find(gi); if (a !== b) parent[b] = a; }
      }
    });
    const byRoot = new Map();
    tris.forEach((t, gi) => {
      const r = find(gi);
      let list = byRoot.get(r);
      if (!list) { list = []; byRoot.set(r, list); }
      list.push(t);
    });
    const pieces = [];
    for (const sub of byRoot.values()) {
      const c = [0, 0, 0];
      const n = [0, 0, 0];
      let area = 0;
      const verts = [];
      const seen = new Set();
      for (const t of sub) {
        const i0 = mesh.triVerts[t * 3];
        const i1 = mesh.triVerts[t * 3 + 1];
        const i2 = mesh.triVerts[t * 3 + 2];
        const v0 = V(i0);
        const v1 = V(i1);
        const v2 = V(i2);
        const cross = _c4Cross(_c4Sub(v1, v0), _c4Sub(v2, v0));
        const a = 0.5 * _c4Len(cross);
        const tn = _c4Norm(cross);
        for (let k = 0; k < 3; k++) {
          c[k] += ((v0[k] + v1[k] + v2[k]) / 3) * a;
          n[k] += tn[k] * a;
        }
        area += a;
        for (const i of [i0, i1, i2]) if (!seen.has(i)) { seen.add(i); verts.push(V(i)); }
      }
      pieces.push({
        id: mesh.faceID[sub[0]],
        tris: sub,
        center: area > 1e-18 ? _c4Mul(1 / area, c) : [0, 0, 0],
        normal: _c4Norm(n),
        area,
        verts,
        body: triBody[sub[0]],
        label: { feature: stamp.feature, role: row.role, ordinal: 0 },
        helper: stamp.helper,
        record: row.record,
      });
    }
    pieces.sort((p, q) => p.center[0] - q.center[0] || p.center[1] - q.center[1] || p.center[2] - q.center[2]);
    pieces.forEach((p, i) => {
      p.label.ordinal = i;
      p.name = pieces.length > 1 ? `${key}[${i}]` : key;
      faces.push(p);
    });
  }
  faces.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  _stampedFaceCache.set(part, faces);
  return faces;
}

function _nameGlob(pattern) {
  const esc = String(pattern).split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${esc}$`);
}

/**
 * faceNames(part) → every face name on the part, sorted.
 * Names are `feature.role`, with `[k]` appended when one label is in several
 * pieces (`cube1.top`, `boss.wall[3]`, `plate.top[1]`). `feature` is the id
 * of the marked block that built the solid, else `<helper>@<n>`.
 */
function faceNames(part) {
  return _stampedFaces(part).map((f) => f.name);
}

/**
 * facesNamed(part, pattern) → the faces whose name matches `pattern`.
 * An exact name, a name without its `[k]` (every piece of that label), or a
 * glob with `*` (`boss.wall[*]`, `cube1.*`). Throws, naming the faces that
 * exist, when nothing matches; it never substitutes a nearby face. The
 * faces work with workplaneFromFace, hole, hollow, draftFaces, moveFace and
 * deleteFace like a facesByNormal result.
 */
function facesNamed(part, pattern) {
  const want = String(pattern ?? '').trim();
  if (!want) throw new Error('facesNamed: pass a face name (see faceNames(part))');
  const faces = _stampedFaces(part);
  let hits = faces.filter((f) => f.name === want);
  if (!hits.length) hits = faces.filter((f) => `${f.label.feature}.${f.label.role}` === want);
  if (!hits.length && want.includes('*')) {
    const re = _nameGlob(want);
    hits = faces.filter((f) => re.test(f.name) || re.test(`${f.label.feature}.${f.label.role}`));
  }
  if (!hits.length) {
    const names = faces.map((f) => f.name);
    const shown = names.slice(0, 16).join(', ') + (names.length > 16 ? `, … (${names.length} faces)` : '');
    throw new Error(`facesNamed: no face named '${want}' on this part${names.length ? ` — faces: ${shown}` : ' — this solid has no stamped faces'}`);
  }
  return hits;
}

/**
 * edgesOf(part, name, opts?) → the convex feature edges around the named
 * face(s), in the shape convexEdges returns, so they go straight into
 * filletEdges / chamferEdges. `name` is anything facesNamed accepts. Only
 * edges that touch the named face are returned (the four edges of a
 * box top, not every edge on the body that faces up), concave edges are
 * left out and counted on `result.skipped`; `opts.includeConcave` keeps
 * them, `opts.minAngleDeg` is the dihedral gate. Throws when the face has
 * no convex feature edge, naming the face and the concave count.
 */
function edgesOf(part, pattern, opts = {}) {
  const faces = facesNamed(part, pattern);
  const want = new Set();
  for (const f of faces) for (const t of f.tris) want.add(t);
  const touching = signedFeatureEdges(part, opts.minAngleDeg).filter((e) => e.tris.some((t) => want.has(t)));
  const out = opts.includeConcave ? touching.slice() : touching.filter((e) => e.convex);
  out.skipped = touching.length - out.length;
  out.faces = faces.map((f) => f.name);
  if (!out.length) {
    throw new Error(
      `edgesOf: no convex feature edge around '${pattern}'`
      + (out.skipped ? ` (${out.skipped} concave edge${out.skipped === 1 ? '' : 's'} skipped; pass { includeConcave: true } to blend them)` : ''),
    );
  }
  return out;
}

const _namedEdgeCache = new WeakMap();

/** Named faces plus the chained edges between them, cached per solid. */
function _namedEdgeTable(part) {
  const hit = _namedEdgeCache.get(part);
  if (hit) return hit;
  const faces = _stampedFaces(part);
  const mesh = part.getMesh();
  const nTri = mesh.numTri;
  const np = mesh.numProp;
  const vp = mesh.vertProperties;
  const triFace = new Int32Array(nTri).fill(-1);
  faces.forEach((f, i) => { for (const t of f.tris) triFace[t] = i; });
  const posAt = (v) => [vp[v * np], vp[v * np + 1], vp[v * np + 2]];
  const edges = chainNamedEdges({ nTri, triVerts: mesh.triVerts, posAt, triFace, faceName: (i) => faces[i].name });
  const table = { faces, edges, triFace, posAt, mesh };
  _namedEdgeCache.set(part, table);
  return table;
}

function _triNormalOf(mesh, t) {
  const np = mesh.numProp;
  const vp = mesh.vertProperties;
  const a = mesh.triVerts[t * 3] * np;
  const b = mesh.triVerts[t * 3 + 1] * np;
  const c = mesh.triVerts[t * 3 + 2] * np;
  const e1 = [vp[b] - vp[a], vp[b + 1] - vp[a + 1], vp[b + 2] - vp[a + 2]];
  const e2 = [vp[c] - vp[a], vp[c + 1] - vp[a + 1], vp[c + 2] - vp[a + 2]];
  return _c4Norm(_c4Cross(e1, e2));
}

/**
 * edgesNamed(part, ...names) → the mesh segments of the edges between two
 * named faces, for makeSweepPath / filletAlongPath. A name is the two face
 * names joined by `~` in either order (`plate.top~boss.side`); a bare pair
 * returns every chain between those faces, `[k]` one chain of a pair that
 * meets more than once, and `*` is a glob on either side. Several names, or
 * an array of names, make one list. Throws, listing the edges that exist,
 * when a name matches nothing, and when `[k]` names a chain the pair no
 * longer has; it never substitutes a nearby edge. Every face a helper built
 * has a name (fillet and chamfer surfaces are `<block>.round` / `.bevel`,
 * spherical corners `<block>.corner[k]`, uploads `import@1.f<k>`, freehand
 * runs `<block>.f<k>`), so this is the one
 * edge reference a script needs; `edge()` / `edgesBetween()` ids are not
 * stable across edits.
 */
function edgesNamed(part, ...names) {
  if (!part || typeof part.getMesh !== 'function') throw new Error('edgesNamed: part must be a Manifold');
  const list = names.flat(Infinity).filter((n) => n != null && n !== '');
  if (!list.length) throw new Error('edgesNamed: pass one or more edge names (faceA~faceB; see list_feature_edges or faceNames(part))');
  const table = _namedEdgeTable(part);
  const out = [];
  const seen = new Set();
  const picked = [];
  for (const raw of list) {
    const match = matchEdgeName(table.edges, String(raw));
    if (match.error) {
      throw new Error(`edgesNamed: ${match.message} — ${describeEdgeNames(table.edges)}. Re-pick the edge if the part changed.`);
    }
    for (const chain of match.hits) {
      if (!picked.includes(chain.name)) picked.push(chain.name);
      chain.segments.forEach(([u, w], j) => {
        const key = u < w ? `${u}-${w}` : `${w}-${u}`;
        if (seen.has(key)) return;
        seen.add(key);
        const va = table.posAt(u);
        const vb = table.posAt(w);
        const [ta, tb] = chain.tris[j];
        out.push({
          key,
          a: u,
          b: w,
          va,
          vb,
          length: _c4Len(_c4Sub(vb, va)),
          mid: [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2],
          n0: _triNormalOf(table.mesh, ta),
          n1: _triNormalOf(table.mesh, tb),
          name: chain.name,
        });
      });
    }
  }
  if (!out.length) throw new Error(`edgesNamed: the named edges have no segments on this solid — ${describeEdgeNames(table.edges)}`);
  out.names = picked;
  return out;
}

/**
 * surfaceOf(face) → the SurfaceRecord the helper that built the face
 * recorded: `{ kind: 'plane', origin, normal }`, `{ kind: 'cylinder',
 * axisOrigin, axisDir, radius }`, `{ kind: 'cone', apex, axisDir,
 * halfAngle }`, `{ kind: 'sphere', center, radius }`, or `{ kind: 'mesh' }`
 * when there is none. Records are in the frame the helper built in; a
 * later translate / rotate moves the face but not its record.
 */
function surfaceOf(face) {
  return face && face.record && typeof face.record === 'object' ? face.record : { kind: 'mesh' };
}

/**
 * solveContour(spec) → a contour profile in plane UV.
 * spec is `{ points, lines, arcs, dimensions, constraints, refs }`. Lengths are
 * millimetres and angles are degrees. Dimension names are strings on the
 * dimension; they are not script bindings. An under-defined contour solves
 * and reports status `under`. A conflict does not throw: status is
 * `conflict` and the shape is the least-squares result. A repeated
 * constraint is listed on `repeated` with warning `repeated`. More than
 * 128 points throws. Contours are tessellated point loops for makeExtrude.
 * `centers: true` keeps the points, skips the closing edge and the rings,
 * and is the profile `holesOnContour` cuts.
 */
function solveContour(spec) {
  return solveContourModel(spec);
}

const HELPER_FUNCTIONS = {
  shell,
  hollow,
  getScaleRatio,
  roundedBox: _tagTessellation(roundedBox, _roundedBoxTess),
  tube,
  rectTube,
  hexPrism,
  mirror,
  array3D,
  polarArray,
  patternOnPoints,
  center,
  align,
  getDimensions,
  addDraft,
  draftFaces,
  cut,
  booleanBodies,
  externalBody,
  move,
  rotateAbout,
  moveFace,
  deleteFace,
  loft,
  //loft helpers
  sumSqDist,
  rotateContour,
  sweep,
  sweepPoints,
  // sweeo helpers
  vecAdd,
  vecSub,
  vecMul,
  vecDot,
  vecCross,
  vecNorm,
  vecNormalize,
  // C4 selection + feature helpers (see block above)
  facesByNormal,
  planarFaceAt,
  edgesByOrientation,
  workplaneFromFace,
  placeInFrame,
  transformByFrame,
  placeOnFace,
  hole,
  holeSpan,
  cboreHole,
  cskHole,
  chamferEdges: _featureOp(chamferEdges, null, () => 'bevel'), // planar wedge: no segment count, gate falls back to 15°
  convexEdges,
  concaveEdges,
  signedFeatureEdges,
  holePattern,
  // Slice-01 fastener vocabulary
  clearanceHole,
  tapDrillHole,
  holesOnContour,
  fastenerClearanceDia,
  fastenerTapDrillDia,
  fastenerMajorDia,
  listFastenerSizes,
  resolveFastenerSize,
  // C6 fillet (see block above)
  filletEdges: _featureOp(filletEdges, _filletEdgesTess, () => 'round'),
  // C8 revolve/extrude with safe winding (see block above)
  makeRevolve,
  makeExtrude,
  makeLoft,
  offsetPlaneFrame,
  // SCS sheet metal
  sheetMetalSolid,
  // Slice 21 cross-section substrate (plane + 2D profile)
  profileCircle,
  profileRectangle,
  profilePolygon,
  makeCrossSection,
  solveContour,
  // Slice 22 edge → sweep path / wire
  makeSweepPath,
  // Slice 23 fillet via swept cross-section
  filletAlongPath: _featureOp(filletAlongPath, _filletAlongPathTess, (args) => (args[3] && args[3].profile === 'chamfer' ? 'bevel' : 'round')),
  // Fillet-mode edge ids
  edge,
  edgesBetween,
  boundaryEdges,
  // Face identity (provenance stamps)
  faceNames,
  facesNamed,
  edgesOf,
  edgesNamed,
  surfaceOf,
};

// ============================================================================
// WORKER CORE
// ============================================================================

/**
 * Load and initialize Manifold WASM
 */
const initializeManifold = async () => {
  if (isInitialized) return;
  
  try {
    manifoldModule = await Module();
    manifoldModule.setup();
    // part.add(solid, { merge: false }) + per-body booleans on overlapping bodies.
    installSeparateBodies(manifoldModule);
    installKernelArena(manifoldModule);
    
    isInitialized = true;
    console.log('[SandboxWorker] Manifold initialized');
  } catch (error) {
    console.error('[SandboxWorker] Failed to initialize Manifold:', error);
    throw error;
  }
};

// Captured before lockdown. The lockdown spreads `performance` into a frozen
// object, which drops `now` (it lives on the prototype), so a later
// `performance.now()` throws and the script never runs.
const _perfNow = (typeof performance !== 'undefined' && typeof performance.now === 'function')
  ? performance.now.bind(performance)
  : () => Date.now();

/**
 * Block dangerous globals
 */
const lockdownGlobals = () => {
  // Block dangerous globals by replacing with functions that throw
  for (const name of BLOCKED_GLOBALS) {
    if (name in self) {
      Object.defineProperty(self, name, {
        get() {
          throw new Error(`Access to '${name}' is not allowed in scripts`);
        },
        configurable: false
      });
    }
  }
  
  // Make certain globals read-only and return limited info
  for (const name of READONLY_GLOBALS) {
    const original = self[name];
    if (original) {
      Object.defineProperty(self, name, {
        get() {
          // Return a frozen proxy that only allows safe operations
          return Object.freeze({ ...original });
        },
        configurable: false
      });
    }
  }
  
  console.log('[SandboxWorker] Globals locked down');
};

/**
 * Reconstruct a Manifold from mesh data
 */
const reconstructManifold = (meshData) => {
  if (!manifoldModule) {
    throw new Error('Manifold not initialized');
  }
  
  const { Manifold } = manifoldModule;
  
  const vertProperties = new Float32Array(meshData.vertProperties);
  const triVerts = new Uint32Array(meshData.triVerts);
  
  const mesh = {
    numProp: meshData.numProp || 3,
    vertProperties,
    triVerts
  };
  
  return new Manifold(mesh);
};

/**
 * Execute the user script with the Manifold API and helper functions
 */
const executeScript = (script, importedModels) => {
  if (!manifoldModule) {
    throw new Error('Manifold not initialized');
  }
  _sheetFilletSpan = null;
  
  // Set up __importedManifolds with reconstructed Manifolds
  const importedManifolds = {};
  for (const [filename, meshData] of Object.entries(importedModels || {})) {
    importedManifolds[filename] = reconstructManifold(meshData);
  }
  
  // Create a limited window-like object for imports only
  const limitedWindow = {
    __importedManifolds: importedManifolds
  };

  // New uploads. The arrays were resolved on the main thread and passed
  // in `importedModels`; this worker has no IndexedDB and no fetch.
  const importMesh = (name) => {
    const key = String(name ?? '');
    const meshData = importedModels && importedModels[key];
    if (!meshData || !meshData.vertProperties || !meshData.triVerts) {
      throw new Error(`Missing mesh asset: ${key}`);
    }
    // Face identity: an upload has no helper, so its faces are named by
    // coplanar group (`import@1.f3`); the mesh only changes with the file.
    return _stampCoplanarFaces(reconstructManifold(meshData), 'import');
  };
  
  // Which marked feature block is running (feature strip red border). This
  // does not depend on the engine's stack format, unlike `scriptLine`.
  // The worker posts every block entry to the main thread (`_featureProgress`)
  // so a watchdog that kills this thread still knows which block was
  // running, and each closed block's time goes out with the result.
  // Feature memoisation: the evaluation copy restores the leading blocks
  // whose keys match and captures the ones that run (featureMemo.js).
  const memo = _memoPlan(script, importedModels);
  _memoRun = memo && !memo.disabled ? { plan: memo, pending: [], stopped: null } : null;
  const source = _memoRun ? memo.text : script;
  let memoHits = _memoRun ? memo.hits : 0;
  const traced = instrumentFeatureBlocks(source);
  let features = traced.features;
  const tracker = createFeatureTracker({
    onEnter(i) {
      const hit = features[i];
      if (hit && typeof _featureProgress === 'function') {
        try {
          _featureProgress({ featureId: hit.id, kind: hit.kind, label: hit.label, index: i, block: hit.block });
        } catch { /* progress is best effort */ }
      }
      // Face identity: the originalIDs this block allocates, so a run no
      // helper stamped is still named after its block (`<id>.f<k>`).
      if (hit && typeof hit.id === 'string') _blockRanges.push({ id: hit.id, lo: _probeOriginalID(), hi: null });
    },
    onLeave(i) {
      const hit = features[i];
      if (!hit || typeof hit.id !== 'string') return;
      for (let k = _blockRanges.length - 1; k >= 0; k--) {
        if (_blockRanges[k].id === hit.id && _blockRanges[k].hi === null) { _blockRanges[k].hi = _probeOriginalID(); break; }
      }
    },
  });
  // Face identity: a stamp made while a marked block is open takes that
  // block's id as its feature; the synthetic counters restart per attempt
  // so a rerun of the same script names the same faces.
  _stampCounters = new Map();
  _featureNow = () => {
    const open = tracker.current();
    const hit = open != null ? features[open] : null;
    return hit && typeof hit.id === 'string' ? hit.id : null;
  };

  // Build the execution scope with Manifold API + helper functions
  const scope = {
    ...manifoldModule,        // Core Manifold API (Manifold, CrossSection, etc.)
    Manifold: _scriptManifoldClass(), // cube / cylinder / sphere carry face stamps
    ...HELPER_FUNCTIONS,      // Extended helper functions
    window: limitedWindow,    // Limited window object for imports
    importMesh,               // return importMesh('<Part>.mesh')
    [FEATURE_TRACE_ENTER]: tracker.enter,
    [FEATURE_TRACE_LEAVE]: tracker.leave,
    [MEMO_CAPTURE]: _memoCapture,
    [MEMO_RESTORE]: _memoRestore,
  };
  
  const scopeKeys = Object.keys(scope);
  const scopeValues = Object.values(scope);
  
  // Create the function (strict mode). The instrumented body keeps every
  // line where it was; if it does not compile (a marker inside an
  // expression), run the script as written, untracked.
  // Both stay a plain top-level function body (no wrapper function), so a
  // user `let cut` still shadows the helper the way it always did.
  const wrappedScript = `"use strict";\n${script}`;
  let tracedScript = `"use strict";\n${traced.script}`;
  let fn;
  try {
    fn = new Function(...scopeKeys, tracedScript);
  } catch (compileErr) {
    if (source !== script) {
      // The memo copy did not compile (a shape the planner misjudged):
      // run this one cold, tracked as usual.
      if (_memoRun) _memoRun.stopped = `compile: ${compileErr?.message || compileErr}`;
      memoHits = 0;
      const plain = instrumentFeatureBlocks(script);
      features = plain.features;
      tracedScript = `"use strict";\n${plain.script}`;
      try {
        fn = new Function(...scopeKeys, tracedScript);
      } catch (plainErr) {
        if (tracedScript === wrappedScript) throw plainErr;
        fn = new Function(...scopeKeys, wrappedScript);
        features = [];
      }
    } else {
      if (tracedScript === wrappedScript) throw compileErr;
      fn = new Function(...scopeKeys, wrappedScript);
      features = [];
    }
  }
  try {
    return fn(...scopeValues);
  } catch (err) {
    // Blocks that closed before the throw are still good; the retry that
    // skips the failed block then starts from them.
    _memoCommitPending();
    if (err && typeof err === 'object') {
      // Primary: the open feature block (works on every engine).
      const open = tracker.current();
      const hit = open != null ? features[open] : null;
      if (hit) {
        try {
          err.featureId = hit.id;
          err.featureBlock = hit.block;
        } catch { /* frozen error */ }
      }
      // Fallback: script line of the failing call from the stack (V8 /
      // Firefox; Safari frames often do not match).
      if (_scriptLineOffset === undefined) _scriptLineOffset = calibrateScriptLineOffset();
      const line = scriptLineFromStack(err?.stack, _scriptLineOffset);
      if (line != null) {
        try { err.scriptLine = line; } catch { /* frozen error */ }
      }
    }
    throw err;
  } finally {
    _sheetFilletSpan = null;
    _lastFeatureTimings = tracker.timings()
      .map(({ index, ms }) => {
        const hit = features[index];
        if (!hit) return null;
        // A restored block ran no kernel code: zero time, served from cache.
        if (index < memoHits) return { id: hit.id, kind: hit.kind, ms: 0, cached: true };
        return { id: hit.id, kind: hit.kind, ms: Math.round(ms * 10) / 10 };
      })
      .filter(Boolean);
    _featureNow = () => null;
  }
};

/** Engine header lines before the script in a `new Function` body (lazy). */
let _scriptLineOffset;

/**
 * Where the worker's execute handler posts block entries while a script
 * runs (null outside a worker execute). Set per request by `bindWorker`.
 * @type {((progress: { featureId: string, kind: string, label: string, index: number, block: string }) => void) | null}
 */
let _featureProgress = null;

/** `{ id, kind, ms }` per block the last `executeScript` closed, in completion order. */
let _lastFeatureTimings = [];

/**
 * The error a block that ran past the budget stands in for in the
 * feature-skip report: the main thread killed the thread while it ran, so no
 * exception exists; this one names the block the way a thrown one would.
 */
function featureTimeoutError(script, row) {
  const text = String(script ?? '');
  const feature = parseFeatureMarkers(text).find((f) => f.id === row.id) || null;
  const kind = feature?.kind || (typeof row.kind === 'string' ? row.kind : null);
  const label = feature?.chipLabel || feature?.label || (typeof row.label === 'string' ? row.label : null) || kind;
  const elapsedMs = Number.isFinite(Number(row.elapsedMs)) ? Number(row.elapsedMs) : null;
  const budgetMs = Number.isFinite(Number(row.budgetMs)) ? Number(row.budgetMs) : null;
  const error = new Error(featureTimeoutMessage({ label, kind, elapsedMs, budgetMs }));
  error.name = 'FeatureTimeoutError';
  error.code = FEATURE_TIMEOUT_CODE;
  error.featureId = row.id;
  error.featureBlock = feature ? text.slice(feature.startOffset, feature.endOffset) : '';
  error.timeout = { id: row.id, kind, label, elapsedMs, budgetMs };
  error.hint = FEATURE_TIMEOUT_HINT;
  return error;
}

/** Copy the timeout fields from the primary error onto a feature-skip report. */
function withTimeoutFields(report, primary) {
  if (!report || primary?.code !== FEATURE_TIMEOUT_CODE) return report;
  return {
    ...report,
    code: FEATURE_TIMEOUT_CODE,
    timeout: primary.timeout && typeof primary.timeout === 'object' ? { ...primary.timeout } : null,
    hint: typeof primary.hint === 'string' ? primary.hint : FEATURE_TIMEOUT_HINT,
  };
}

/**
 * Run `script`, and when a marked feature throws, run an evaluation copy
 * that skips that feature and its hard dependents. Another throw repeats,
 * bounded by the feature count. The user's script is not rewritten.
 * A recovered run returns the surviving solid plus `featureSkip`. A run
 * that still has no solid throws the original error, with the same report
 * attached, so the viewport can keep the last mesh and mark every chip.
 */
function executeSkippingFailedFeatures(script, importedModels, anchorId, opts = {}) {
  const text = String(script ?? '');
  const plan = resolveRollback(text, anchorId);
  const anchored = plan.anchor === null || typeof plan.anchor === 'string';
  const limit = parseFeatureMarkers(text).length + 1;
  let skipIds = [];
  const thrown = [];
  let primary = null;
  // Blocks the main thread already saw run past the budget (the watchdog
  // killed the thread mid-block and re-posted this job): they are skipped
  // from the first attempt, with their hard dependents, and the first one
  // is the run's primary failure.
  const timedOut = Array.isArray(opts?.timedOut)
    ? opts.timedOut.filter((row) => row && typeof row.id === 'string' && row.id)
    : [];
  for (const row of timedOut) {
    if (thrown.includes(row.id)) continue;
    thrown.push(row.id);
    skipIds = unionSkipIds(text, skipIds, row.id);
    if (!primary) primary = featureTimeoutError(text, row);
  }
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const source = (skipIds.length || anchored)
      ? evaluationScript(text, {
          ...(skipIds.length ? { skipIds } : {}),
          ...(anchored ? { anchorId: plan.anchor } : {}),
        })
      : text;
    try {
      const result = manifoldFromScriptResult(executeScript(source, importedModels));
      const rolledBack = plan.skipIds;
      // A blanked block (skipped or rolled back) still passes its markers,
      // so the tracker times it at about zero; those rows are not kernel time.
      const blanked = new Set([...skipIds, ...(Array.isArray(rolledBack) ? rolledBack : [])]);
      return {
        result,
        featureSkip: primary ? withTimeoutFields(featureSkipFailure(text, primary, thrown, skipIds), primary) : null,
        rolledBack,
        featureTimings: _lastFeatureTimings.filter((row) => !blanked.has(row.id)),
      };
    } catch (error) {
      if (!primary) primary = error;
      const featureId = typeof error?.featureId === 'string' ? error.featureId : '';
      if (!featureId || thrown.includes(featureId)) throw attachFeatureSkip(primary, text, thrown, skipIds);
      thrown.push(featureId);
      const next = unionSkipIds(text, skipIds, featureId);
      if (next.length === skipIds.length) throw attachFeatureSkip(primary, text, thrown, skipIds);
      skipIds = next;
    }
  }
  throw attachFeatureSkip(primary, text, thrown, skipIds);
}

function attachFeatureSkip(error, script, thrown, skipIds) {
  if (!thrown.length) return error;
  const report = withTimeoutFields(featureSkipFailure(script, error, thrown, skipIds), error);
  try { error.featureSkip = report; } catch { /* frozen error */ }
  return error;
}

function _isManifoldValue(value) {
  return !!value && typeof value.getMesh === 'function';
}

/**
 * Script return shared by the worker `execute` path and `runPreparedScript`.
 * A Manifold is used as-is. A sheet wrapper — a plain object whose `solid`
 * is a Manifold and that carries a sheet spec, a flat pattern, or
 * `kind: 'sheet'` — unwraps to that solid. Numbers, strings, arrays, and
 * any other object still throw. Do not accept an arbitrary bag that merely
 * happens to hold a solid.
 */
export function manifoldFromScriptResult(result) {
  if (_isManifoldValue(result)) return result;
  if (result && typeof result === 'object' && !Array.isArray(result) && _isManifoldValue(result.solid)) {
    const spec = result.spec;
    const flat = result.flat;
    const sheetSpec = !!spec && typeof spec === 'object' && !Array.isArray(spec)
      && (spec.sku != null || spec.t != null || spec.width != null);
    const sheetFlat = !!flat && typeof flat === 'object' && !Array.isArray(flat)
      && (flat.area != null || Array.isArray(flat.loops) || Array.isArray(flat.panels));
    if (sheetSpec || sheetFlat || result.kind === 'sheet') return result.solid;
  }
  throw new Error('Script must return a Manifold object');
}

/**
 * Serialize a Manifold result to mesh data for transfer
 */
const serializeResult = (manifold) => {
  if (!manifold || typeof manifold.getMesh !== 'function') {
    throw new Error('Script must return a Manifold object');
  }
  
  const mesh = manifold.getMesh();
  _synthesizeStamps(mesh);
  
  // Typed copies out of the wasm heap. The main thread reads them as
  // array-likes, and the run result posts their buffers as transferables
  // (see `meshTransferList`), so a large part crosses to the page with no
  // structured clone of the vertex data.
  return {
    numProp: mesh.numProp,
    vertProperties: new Float32Array(mesh.vertProperties),
    triVerts: new Uint32Array(mesh.triVerts),
    numRun: mesh.numRun,
    runIndex: new Uint32Array(mesh.runIndex),
    runOriginalID: new Uint32Array(mesh.runOriginalID),
    runFeature: _runFeatureKeys(mesh.runOriginalID),
    featureTessellation: _featureTessellation(mesh.runOriginalID),
    faceID: mesh.faceID ? new Uint32Array(mesh.faceID) : null,
    faceStamps: _faceStampRows(mesh.runOriginalID),
  };
};

/**
 * The ArrayBuffers of a worker result, for a postMessage transfer list.
 * Meshes, preview pieces and trims all go through here. A view that does
 * not own its buffer is skipped so a shared allocation is not detached.
 */
const meshTransferList = (payload) => collectTransferBuffers(payload);

function _postWorkerResult(scope, id, payload) {
  scope.postMessage({ type: 'result', id, payload }, meshTransferList(payload));
}

function _rememberRigidBase(meta, triCount) {
  cachedFeatureRigid = meta.featureRigid || null;
  cachedMeshKey = meta.meshKey;
  cachedBaseCentroid = meta.baseCentroid;
  cachedBaseBBox = meta.baseBBox;
  cachedVolume = meta.volume;
  if (triCount != null) cachedTriCount = triCount;
  _dropBaked();
}

/**
 * Trailing whole-body move / rotate: run the prefix once, ship the unmoved
 * mesh, and let the page pose it. A later edit that only changes that
 * matrix (`knownMeshKey`) does not run the kernel or copy the mesh.
 * Returns a result payload, or null when the kernel must run the whole script.
 */
function _attemptRigidShip(script, importedModels, payload) {
  if (!payload || payload.rollbackAnchor != null || payload.timedOut) return null;
  const text = String(script ?? '');
  const salt = importedModelsKey(importedModels);
  const split = splitTrailingRigid(text);
  if (!split?.ops.length) return null;
  const scriptKey = memoKey(text, salt);
  const meshKey = memoKey(split.prefix, salt);
  if (payload.knownMeshKey === meshKey && cachedMeshKey === meshKey && cachedManifold && cachedBaseCentroid) {
    const rigid = rigidMatrixForOps(split.ops, cachedBaseCentroid);
    if (rigid) {
      const featureRigid = matrixIsIdentity(rigid.matrix) ? null : rigid.matrix.slice();
      _rememberRigidBase({
        featureRigid,
        meshKey,
        baseCentroid: cachedBaseCentroid,
        baseBBox: cachedBaseBBox,
        volume: cachedVolume,
      }, cachedTriCount);
      const movedBox = cachedBaseBBox ? transformBBox(rigid.matrix, cachedBaseBBox) : null;
      return {
        rigidOnly: true,
        meshOmitted: true,
        meshKey,
        scriptKey,
        salt,
        featureRigid,
        baseCentroid: cachedBaseCentroid,
        baseBBox: cachedBaseBBox,
        boundingBox: movedBox,
        bodyCentroids: [rigid.centroid],
        bodyCount: 1,
        unmoved: true,
        volume: cachedVolume,
        tris: cachedTriCount,
        status: 'NoError',
        timing: { execMs: 0, serializeMs: 0 },
      };
    }
  }
  const started = _perfNow();
  let arena;
  try {
    arena = _runInKernelArena(
      () => executeSkippingFailedFeatures(split.prefix, importedModels, undefined, {}),
    );
  } catch (_) {
    return null;
  }
  const solid = arena?.ran?.result;
  if (!solid || typeof solid.getMesh !== 'function') return null;
  // Reject before replacing the cached solid. A failed attempt falls through
  // to the full script; the omit-mesh warm must not answer from the old key.
  const centroids = _kernelBodyCentroids(solid);
  if (centroids.length !== 1) return null;
  const rigid = rigidMatrixForOps(split.ops, centroids[0]);
  if (!rigid) return null;
  _replaceCachedManifold(solid);
  const box = solid.boundingBox();
  const baseBBox = { min: [...box.min], max: [...box.max] };
  const featureRigid = matrixIsIdentity(rigid.matrix) ? null : rigid.matrix.slice();
  const volume = solid.volume();
  const meta = {
    featureRigid,
    meshKey,
    baseCentroid: centroids[0].slice(),
    baseBBox,
    volume,
  };
  const skipMesh = payload.omitMesh === true && payload.knownMeshKey === meshKey;
  let mesh = null;
  let serializeMs = 0;
  if (!skipMesh) {
    const ser = _perfNow();
    mesh = markSheetMesh(serializeResult(solid), text);
    serializeMs = _perfNow() - ser;
    if (featureRigid) mesh.featureRigid = featureRigid;
  }
  const tris = mesh ? mesh.triVerts.length / 3 : cachedTriCount;
  _rememberRigidBase(meta, tris);
  return {
    rigidOnly: true,
    ...(mesh ? { mesh } : { meshOmitted: true }),
    meshKey,
    scriptKey,
    salt,
    featureRigid,
    baseCentroid: meta.baseCentroid,
    baseBBox,
    boundingBox: transformBBox(rigid.matrix, baseBBox),
    bodyCentroids: [rigid.centroid],
    bodyCount: 1,
    unmoved: true,
    volume,
    surfaceArea: typeof solid.surfaceArea === 'function' ? solid.surfaceArea() : null,
    tris,
    status: _c4StatusError(solid) || 'NoError',
    timing: { execMs: _perfNow() - started - serializeMs, serializeMs },
    kernelFreed: arena.kernelFreed,
    ...(arena.ran.featureSkip ? { featureSkip: arena.ran.featureSkip } : {}),
    ...(arena.ran.rolledBack?.length ? { rolledBack: arena.ran.rolledBack } : {}),
    ...(arena.ran.featureTimings?.length ? { featureTimings: arena.ran.featureTimings } : {}),
    ...(_lastMemoReport ? { featureCache: _lastMemoReport } : {}),
  };
}

/**
 * Memory monitoring - check if we're using too much memory
 */
const checkMemoryUsage = (limitMB) => {
  if (performance.memory) {
    const usedMB = performance.memory.usedJSHeapSize / (1024 * 1024);
    if (usedMB > limitMB) {
      throw new Error(`Memory limit exceeded: ${usedMB.toFixed(1)}MB > ${limitMB}MB`);
    }
    return usedMB;
  }
  return null; // Can't measure in this browser
};

/**
 * Message handler
 */
// ============================================================================
// STAGE VERIFICATION (dev tooling, harness/pilot_eval.mjs)
// The staging environment is the single source of kernel truth: candidate
// scripts AND reference solids both execute against the SAME bundled
// built/manifold.wasm the browser uses, and the symmetric-difference verdict
// runs HERE, in the worker, against that build. The harness's npm manifold-3d
// copy stays a cross-check, never the arbiter.
//
// Reference channel: STEP has no browser import path (backend obj_converter is
// a x86_64 ELF and firejail is absent on this box), so references are pushed as
// OBJ. importOBJ uses this same ladder (strict, then weld) so an STL
// triangle soup can become a solid. Mesh.merge() is not used: that repair
// crashes on unwelded input.
// ============================================================================

const _stagedReferences = new Map();   // filename -> { manifold, volume, boundingBox, source }

function _weldMeshData(vertProperties, triVerts, tolerance) {
  const vp = vertProperties;
  const n = vp.length / 3;
  const remap = new Int32Array(n);
  const out = [];
  const seen = new Map();
  const inv = tolerance > 0 ? 1 / tolerance : 0;
  for (let i = 0; i < n; i++) {
    const key = inv
      ? `${Math.round(vp[i * 3] * inv)}|${Math.round(vp[i * 3 + 1] * inv)}|${Math.round(vp[i * 3 + 2] * inv)}`
      : `${vp[i * 3]}|${vp[i * 3 + 1]}|${vp[i * 3 + 2]}`;
    let j = seen.get(key);
    if (j === undefined) { j = out.length / 3; seen.set(key, j); out.push(vp[i * 3], vp[i * 3 + 1], vp[i * 3 + 2]); }
    remap[i] = j;
  }
  const nt = new Uint32Array(triVerts.length);
  for (let i = 0; i < triVerts.length; i++) nt[i] = remap[triVerts[i]];
  return { numProp: 3, vertProperties: new Float32Array(out), triVerts: nt };
}

/** Build a Manifold from raw mesh arrays: strict first, then weld-exact, then weld@tol. */
function _meshDataToManifold(vertProperties, triVerts, tolerance = 0.001) {
  const { Mesh, Manifold } = manifoldModule;
  const tryBuild = (data) => {
    try {
      const m = new Manifold(new Mesh({ numProp: 3, vertProperties: new Float32Array(data.vertProperties), triVerts: new Uint32Array(data.triVerts) }));
      if (m && !m.isEmpty()) {
        const vol = m.volume();
        if (isFinite(vol) && vol > 0) return m;
      }
    } catch (e) {
      // strict constructor throws 'Not manifold' on unwelded STL-style meshes; fall through
    }
    return null;
  };
  let m = tryBuild({ vertProperties, triVerts });
  if (m) return { manifold: m, repair: 'strict' };
  console.log(`[stage] strict build failed for ${vertProperties.length / 3}v/${triVerts.length / 3}t — trying weld-exact`);
  m = tryBuild(_weldMeshData(vertProperties, triVerts, 0));
  if (m) return { manifold: m, repair: 'weld-exact' };
  console.log('[stage] weld-exact failed — trying weld@tol');
  if (tolerance > 0) {
    m = tryBuild(_weldMeshData(vertProperties, triVerts, tolerance));
    if (m) return { manifold: m, repair: `weld@${tolerance}` };
  }
  throw new Error('stage: could not construct valid manifold from mesh data');
}

function _parseOBJToMeshData(objText) {
  const vertices = [];
  const triangles = [];
  for (const raw of String(objText).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'v') {
      const x = parseFloat(parts[1]), y = parseFloat(parts[2]), z = parseFloat(parts[3]);
      if (isFinite(x) && isFinite(y) && isFinite(z)) vertices.push([x, y, z]);
    } else if (parts[0] === 'f') {
      const idx = [];
      for (let i = 1; i < parts.length; i++) {
        if (!parts[i]) continue;
        const v = parseInt(parts[i].split('/')[0], 10);
        if (!v || isNaN(v)) continue;
        idx.push(v < 0 ? vertices.length + v : v - 1);
      }
      for (let i = 1; i < idx.length - 1; i++) triangles.push([idx[0], idx[i], idx[i + 1]]);
    }
  }
  if (!vertices.length || !triangles.length) throw new Error('stage: OBJ contains no geometry');
  const vertProperties = new Float32Array(vertices.length * 3);
  vertices.forEach((p, i) => vertProperties.set(p, i * 3));
  const triVerts = new Uint32Array(triangles.length * 3);
  triangles.forEach((p, i) => triVerts.set(p, i * 3));
  return { vertProperties, triVerts };
}

function _bboxArray(m) {
  const b = m.boundingBox();
  return { min: [...b.min], max: [...b.max] };
}

function _centerAtBbox(m) {
  const b = m.boundingBox();
  return m.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -(b.min[2] + b.max[2]) / 2]);
}

// All 24 proper cube rotations as euler triples in the manifold rotate()
// convention: rotate([rx,ry,rz]) applies world-frame X, then Y, then Z, so
// R = Rz(rz)·Ry(ry)·Rx(rx). Self-tested below at build time.
function _stage24Rotations() {
  const d = Math.PI / 180;
  const eulerToMatrix = (rx, ry, rz) => {
    rx *= d; ry *= d; rz *= d;
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    return [
      [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
      [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
      [-sy, cy * sx, cy * cx],
    ];
  };
  const matrixToEuler = (M) => {
    const ry = Math.asin(Math.max(-1, Math.min(1, -M[2][0]))) / d;
    let rx, rz;
    if (Math.abs(Math.cos(ry * d)) > 1e-9) {
      rx = Math.atan2(M[2][1], M[2][2]) / d;
      rz = Math.atan2(M[1][0], M[0][0]) / d;
    } else {
      rx = 0;
      rz = Math.atan2(-M[0][1], M[1][1]) / d;   // gimbal branch: M[1][1]=cos(rz)
    }
    return { rx, ry, rz };
  };
  const perms = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  const sgn = { '012':1,'120':1,'201':1,'021':-1,'102':-1,'210':-1 };
  const rots = [];
  for (const [ax, ay, az] of perms) {
    for (const sx of [1,-1]) for (const sy of [1,-1]) for (const sz of [1,-1]) {
      const det = sx * sy * sz * sgn[`${ax}${ay}${az}`];
      if (det !== 1) continue;
      const M = [[0,0,0],[0,0,0],[0,0,0]];
      M[0][ax] = sx; M[1][ay] = sy; M[2][az] = sz;
      const { rx, ry, rz } = matrixToEuler(M);
      const M2 = eulerToMatrix(rx, ry, rz);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        if (Math.abs(M2[i][j] - M[i][j]) > 1e-9) throw new Error(`stage rotation self-test failed: ${JSON.stringify({ M, M2 })}`);
      }
      rots.push({ name: (rx === 0 && ry === 0 && rz === 0) ? 'identity' : `r${rx}_${ry}_${rz}`, euler: [rx, ry, rz] });
    }
  }
  return rots;
}
const _STAGE_ORIENTATIONS = _stage24Rotations();

/**
 * Verdict of candidate vs target, computed entirely in THIS worker against the
 * bundled build (mirrors harness/verify.mjs verifyManifold semantics).
 * Both sides must already be live Manifolds. opts: { passRel=0.01, volGate=0.25 }.
 */
function _stageVerify(cand, target, opts = {}) {
  const { Manifold } = manifoldModule;
  const passRel = opts.passRel ?? 0.01;
  const volGate = opts.volGate ?? 0.25;
  const se = _c4StatusError(cand);
  if (se) return { pass: false, reason: 'invalid_manifold', status: se };
  const volC = cand.volume();
  const volT = target.volume();
  if (!(volC > 0) || !(volT > 0)) return { pass: false, reason: 'zero_volume', volC, volT };
  const volRel = Math.abs(volC - volT) / volT;
  if (volRel > volGate) return { pass: false, reason: 'volume_mismatch', volC, volT, volRel };
  const t = _centerAtBbox(target);
  const sym = (a, b) => {
    const u = Manifold.union(a, b);
    const i = Manifold.intersection(a, b);
    return Manifold.difference(u, i).volume();
  };
  const rel0 = sym(_centerAtBbox(cand), t) / volT;
  if (rel0 <= passRel) return { pass: true, orientation: 'identity', symRel: rel0, volC, volT };
  let best = { orientation: 'identity', symRel: rel0 };
  for (const o of _STAGE_ORIENTATIONS) {
    if (o.name === 'identity') continue;
    const r = sym(_centerAtBbox(cand.rotate(o.euler)), t) / volT;
    if (r < best.symRel) best = { orientation: o.name, symRel: r };
    if (r <= passRel) break;
  }
  if (best.symRel <= passRel) return { pass: true, ...best, volC, volT };
  return { pass: false, reason: 'symdiff_too_large', ...best, volC, volT };
}


/**
 * Game-mode match: attempt vs retained ghost, same coordinate frame.
 * Single criterion: V_symdiff / max(V_target, volFloor) < relEps
 * (empty diffs have volume 0, so exact match is covered by rel < relEps).
 * Uses stageVerify-style sym = difference(union, intersection); no isEmpty
 * typeof soft-fail. Volume pre-gate + catch fallback if booleans throw.
 */
function _gameMatchCompare(attempt, target, relEps, volFloor) {
  const { Manifold } = manifoldModule;
  const se = _c4StatusError(attempt);
  if (se) return { match: false, reason: 'invalid_manifold', status: se };
  const volA = attempt.volume();
  const volT = target.volume();
  if (!(volA > 0) || !(volT > 0)) {
    return { match: false, reason: 'zero_volume', volA, volT, volDiff: null, rel: null };
  }
  const denom = Math.max(volT, volFloor);
  const volDelta = Math.abs(volA - volT);
  if (volDelta / denom >= relEps) {
    return {
      match: false, reason: 'volume_mismatch',
      volA, volT, volDiff: volDelta, rel: volDelta / denom,
    };
  }
  let u = null;
  let i = null;
  let sym = null;
  try {
    // Prefer union/intersection/difference (more throw-resistant than two raw diffs).
    u = Manifold.union(attempt, target);
    i = Manifold.intersection(attempt, target);
    sym = Manifold.difference(u, i);
    const volDiff = sym.volume();
    const rel = volDiff / denom;
    const match = rel < relEps;
    return {
      match,
      reason: match ? 'match' : 'difference_too_large',
      volA, volT, volDiff, rel,
    };
  } catch (e) {
    // Booleans failed on near-identical solids: trust the volume pre-gate.
    return {
      match: true,
      reason: 'boolean_failed_vol_fallback',
      volA, volT,
      volDiff: volDelta,
      rel: volDelta / denom,
      warning: String(e && e.message || e),
    };
  } finally {
    _safeDeleteManifold(sym);
    _safeDeleteManifold(u);
    _safeDeleteManifold(i);
  }
}

/** MB of the kernel heap right now, or null. */
function _kernelHeapMB() {
  try {
    const buf = manifoldModule?.HEAP8?.buffer || manifoldModule?.wasmMemory?.buffer;
    return buf ? Math.round(buf.byteLength / 1048576 * 10) / 10 : null;
  } catch (_) {
    return null;
  }
}

export function bindWorker(self) {
// Set by the first fatal throw (a wasm abort, a trap, out of memory). The
// module cannot be used after it: every later message is answered at once
// with the same fatal report instead of hanging or throwing garbage, and
// the main thread replaces this worker.
let kernelDead = null;
self.onmessage = async (event) => {
  const { type, payload, id } = event.data;
  if (kernelDead) {
    self.postMessage({
      type: 'error',
      id,
      payload: {
        message: kernelDead.message,
        name: 'KernelDead',
        stack: '',
        scriptLine: null,
        featureId: null,
        featureBlock: null,
        featureSkip: null,
        fatal: true,
        dead: true,
        reason: kernelDead.reason,
        wasmHeapMB: _kernelHeapMB(),
      },
    });
    return;
  }

  try {
    switch (type) {
      case 'init': {
        await initializeManifold();
        lockdownGlobals();
        self.postMessage({ type: 'ready', id });
        break;
      }

      // Lightweight alive check after Safari freeze / bfcache restore.
      case 'ping': {
        self.postMessage({ type: 'result', id, payload: { ok: true } });
        break;
      }
      
      case 'execute': {
        if (!isInitialized) {
          throw new Error('Worker not initialized');
        }
        
        const { script, importedModels, memoryLimitMB, nonce, rollbackAnchor, timedOut, partId } = payload;
        if (typeof globalThis !== 'undefined') {
          globalThis.__filletSweepRingLog = [];
          globalThis.__filletSweepRingCall = null;
        }
        
        // Check memory before execution
        checkMemoryUsage(memoryLimitMB || 512);
        
        // Execute the script. execMs is the kernel; serializeMs is the mesh
        // copy that follows. The main thread adds the postMessage gap.
        const _execT0 = _perfNow();
        _featureOps = [];
        _sourceTess = [];
        _blockRanges = [];
        _resetFaceStamps();
        // With `progress: true` (what `ManifoldWorker` sends), block entries
        // go to the main thread as they happen, so the watchdog can name the
        // block it kills (`ManifoldWorker` keeps the latest per job).
        // `timedOut` is that list when this is a re-post. Harnesses that
        // drive the protocol by hand and take the first reply as the result
        // do not ask, and see no extra message.
        _featureProgress = payload.progress === true
          ? (progress) => self.postMessage({ type: 'featureProgress', id, payload: progress })
          : null;
        // Feature memoisation applies to this path (and runPreparedScript);
        // the part id scopes the cache report, the keys are content-addressed.
        _memoContext = { partId: typeof partId === 'string' && partId ? partId : null };
        _lastMemoReport = null;
        // Trailing whole-body Move / Rotate: ship the unmoved mesh and a
        // matrix. A later matrix-only edit does not enter the kernel.
        let rigidPayload = null;
        try {
          rigidPayload = _attemptRigidShip(script, importedModels || {}, payload);
        } catch (_) {
          rigidPayload = null;
        }
        if (rigidPayload) {
          _featureProgress = null;
          _memoContext = null;
          cachedExecuteNonce = (nonce !== undefined && nonce !== null) ? nonce : null;
          if (gameTargetManifold) {
            _safeDeleteManifold(gameAttemptManifold);
            const live = liveManifold();
            gameAttemptManifold = live ? live.clone() : null;
          }
          rigidPayload.nonce = cachedExecuteNonce;
          rigidPayload.memoryUsedMB = checkMemoryUsage(memoryLimitMB || 512);
          rigidPayload.wasmHeapMB = wasmHeapMB(manifoldModule);
          _postWorkerResult(self, id, rigidPayload);
          break;
        }
        // The page already has this mesh and the script has no trailing
        // Move / Rotate (a failed rigid attempt falls through and runs).
        // A warm asks not to copy the mesh again.
        const trailingCandidate = splitTrailingRigid(String(script ?? ''));
        if (
          !(trailingCandidate && trailingCandidate.ops.length)
          && payload.omitMesh === true
          && payload.knownMeshKey
          && cachedMeshKey === payload.knownMeshKey
          && cachedManifold
        ) {
          _featureProgress = null;
          _memoContext = null;
          const heldSalt = importedModelsKey(importedModels || {});
          const movedBox = cachedBaseBBox
            ? transformBBox(cachedFeatureRigid, cachedBaseBBox)
            : null;
          const centroid = cachedBaseCentroid
            ? (cachedFeatureRigid
              ? transformPoint(cachedFeatureRigid, cachedBaseCentroid)
              : cachedBaseCentroid.slice())
            : null;
          cachedExecuteNonce = (nonce !== undefined && nonce !== null) ? nonce : null;
          _postWorkerResult(self, id, {
            meshOmitted: true,
            meshKey: cachedMeshKey,
            scriptKey: memoKey(String(script ?? ''), heldSalt),
            salt: heldSalt,
            featureRigid: cachedFeatureRigid,
            baseCentroid: cachedBaseCentroid,
            baseBBox: cachedBaseBBox,
            boundingBox: movedBox,
            bodyCentroids: centroid ? [centroid] : [],
            ...(centroid ? { bodyCount: 1 } : {}),
            unmoved: true,
            volume: cachedVolume,
            tris: cachedTriCount,
            status: 'NoError',
            timing: { execMs: 0, serializeMs: 0 },
            nonce: cachedExecuteNonce,
          });
          break;
        }
        _lastMemoReport = null;
        _clearFeatureRigid();
        let arena;
        try {
          arena = _runInKernelArena(
            () => executeSkippingFailedFeatures(script, importedModels, rollbackAnchor, { timedOut }),
          );
        } finally {
          _featureProgress = null;
          _memoContext = null;
        }
        const { ran, kernelFreed } = arena;
        const result = ran.result;
        const _execMs = _perfNow() - _execT0;
        
        // Cache the manifold for cross-section operations (+ nonce for game
        // compare). The solid it replaces is freed.
        _replaceCachedManifold(result);
        cachedExecuteNonce = (nonce !== undefined && nonce !== null) ? nonce : null;
        // Independent attempt snapshot for game match (only while a ghost is live).
        if (gameTargetManifold) {
          _safeDeleteManifold(gameAttemptManifold);
          gameAttemptManifold = result.clone();
        }
        
        // Check memory after execution
        const memoryUsed = checkMemoryUsage(memoryLimitMB || 512);
        
        // Serialize result for transfer. A warm that only needs the solid
        // (cross-section) leaves the mesh on the page.
        let meshData = null;
        let _serializeMs = 0;
        if (payload.omitMesh !== true) {
          const _serT0 = _perfNow();
          meshData = markSheetMesh(serializeResult(result), script);
          _serializeMs = _perfNow() - _serT0;
        }
        
        // Get metadata for quoting/display
        const volume = result.volume();
        const bbox = result.boundingBox();
        const bodyCentroids = _kernelBodyCentroids(result);
        const salt = importedModelsKey(importedModels);
        const split = splitTrailingRigid(String(script ?? ''));
        const scriptKey = memoKey(String(script ?? ''), salt);
        const trailingRigid = !!(split && split.ops.length);
        const baseBBox = { min: [...bbox.min], max: [...bbox.max] };
        const triCount = meshData
          ? meshData.triVerts.length / 3
          : (Number.isFinite(cachedTriCount) ? cachedTriCount : null);
        if (!trailingRigid) {
          cachedMeshKey = scriptKey;
          cachedBaseCentroid = bodyCentroids[0] ? bodyCentroids[0].slice() : null;
          cachedBaseBBox = baseBBox;
          cachedVolume = volume;
          cachedTriCount = triCount;
          cachedFeatureRigid = null;
        }
        
        // Transfer the vertex buffers instead of cloning them.
        _postWorkerResult(self, id, {
            ...(meshData ? { mesh: meshData } : { meshOmitted: true }),
            memoryUsedMB: memoryUsed,
            volume: volume,
            surfaceArea: result.surfaceArea(),
            status: _c4StatusError(result) || 'NoError',
            tris: triCount,
            boundingBox: baseBBox,
            nonce: cachedExecuteNonce,
            bodyCentroids,
            scriptKey,
            salt,
            ...(!trailingRigid ? {
              unmoved: true,
              meshKey: scriptKey,
              baseCentroid: cachedBaseCentroid,
              baseBBox,
            } : {}),
            timing: { execMs: _execMs, serializeMs: _serializeMs },
            wasmHeapMB: wasmHeapMB(manifoldModule),
            kernelFreed,
            ...(ran.featureSkip ? { featureSkip: ran.featureSkip } : {}),
            ...(ran.rolledBack?.length ? { rolledBack: ran.rolledBack } : {}),
            ...(ran.featureTimings?.length ? { featureTimings: ran.featureTimings } : {}),
            ...(_lastMemoReport ? { featureCache: _lastMemoReport } : {}),
        });
        break;
      }

      // Feature memoisation control: clear, enable / disable, budget; the
      // reply is the cache's stats (the dev hook and goldens use it).
      case 'featureMemo': {
        const stats = configureFeatureMemo(payload && typeof payload === 'object' ? payload : {});
        self.postMessage({ type: 'result', id, payload: { ok: true, stats } });
        break;
      }

      // The page already has this mesh and only the rigid matrix changed.
      // Cross-section and export read liveManifold(), which bakes on demand.
      case 'setFeatureRigid': {
        const meshKey = payload && payload.meshKey;
        const matrix = payload && payload.matrix;
        if (!cachedManifold || !meshKey || cachedMeshKey !== meshKey) {
          self.postMessage({ type: 'result', id, payload: { held: false } });
          break;
        }
        _dropBaked();
        cachedFeatureRigid = matrix && !matrixIsIdentity(matrix) ? matrix.slice() : null;
        self.postMessage({ type: 'result', id, payload: { held: true, meshKey } });
        break;
      }

      // Get model info from cached manifold
      case 'getModelInfo': {
        if (!isInitialized) {
          throw new Error('Worker not initialized');
        }
        
        const infoSolid = liveManifold();
        if (!infoSolid) {
          throw new Error('No cached manifold - execute a script first');
        }
        
        const volume = infoSolid.volume();
        const surfaceArea = infoSolid.surfaceArea();
        const bbox = infoSolid.boundingBox();
        
        self.postMessage({
          type: 'result',
          id,
          payload: {
            volume,
            surfaceArea,
            boundingBox: {
              min: [...bbox.min],
              max: [...bbox.max]
            }
          }
        });
        break;
      }

      // ── Game-mode match: retain ghost solid, compare attempt via boolean difference ──
      case 'storeGameTarget': {
        if (!isInitialized) throw new Error('Worker not initialized');
        const targetSolid = liveManifold();
        if (!targetSolid) throw new Error('storeGameTarget: execute the target script first');
        const se = _c4StatusError(targetSolid);
        if (se) throw new Error(`storeGameTarget: target is invalid (${se})`);
        const volume = targetSolid.volume();
        if (!(volume > 0)) throw new Error('storeGameTarget: target has no volume');
        // Own retained handle — do not alias cachedManifold (attempt Run overwrites it).
        _safeDeleteManifold(gameTargetManifold);
        gameTargetManifold = targetSolid.clone();
        self.postMessage({
          type: 'result', id,
          payload: { ok: true, volume, boundingBox: _bboxArray(targetSolid) },
        });
        break;
      }

      // Drop every retained solid from the last run. The UI sends this when a run
      // clears the viewport (empty / comment-only / construction-plane-only script):
      // nothing downstream — cross-section, model info, game compare, stage tooling —
      // may keep serving the previous object once the screen is empty.
      case 'clearResult': {
        _clearFeatureRigid();
        _safeDeleteManifold(cachedManifold);
        cachedManifold = null;
        cachedExecuteNonce = null;
        _safeDeleteManifold(gameAttemptManifold);
        gameAttemptManifold = null;
        self.postMessage({ type: 'result', id, payload: { ok: true } });
        break;
      }

      case 'clearGameTarget': {
        _safeDeleteManifold(gameTargetManifold);
        gameTargetManifold = null;
        _safeDeleteManifold(gameAttemptManifold);
        gameAttemptManifold = null;
        self.postMessage({ type: 'result', id, payload: { ok: true } });
        break;
      }

      case 'compareGameMatch': {
        if (!isInitialized) throw new Error('Worker not initialized');
        if (!gameTargetManifold) throw new Error('compareGameMatch: no ghost target stored');
        if (!gameAttemptManifold) {
          throw new Error('compareGameMatch: no attempt snapshot — execute while a ghost target is stored');
        }
        if (payload?.nonce != null && payload.nonce !== cachedExecuteNonce) {
          self.postMessage({
            type: 'result', id,
            payload: {
              ignored: true, match: false, reason: 'stale_execute',
              nonce: payload.nonce, cachedNonce: cachedExecuteNonce,
            },
          });
          break;
        }
        const relEps = _positiveFinite(payload?.relEps, 0.002);
        const volFloor = _positiveFinite(payload?.volFloor, 1e-6);
        const verdict = _gameMatchCompare(gameAttemptManifold, gameTargetManifold, relEps, volFloor);
        self.postMessage({
          type: 'result', id,
          payload: { ...verdict, relEps, volFloor, nonce: cachedExecuteNonce },
        });
        break;
      }

      // Import OBJ string and create Manifold
      case 'importOBJ': {
        if (!isInitialized) {
          throw new Error('Worker not initialized');
        }
        
        const { objString, filename } = payload;
        
        // Parse OBJ string
        const vertices = [];
        const triangles = [];
        
        for (const line of objString.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          
          const parts = trimmed.split(/\s+/);
          const cmd = parts[0];
          
          if (cmd === 'v') {
            vertices.push([
              parseFloat(parts[1]) || 0,
              parseFloat(parts[2]) || 0,
              parseFloat(parts[3]) || 0
            ]);
          } else if (cmd === 'f') {
            const indices = [];
            for (let i = 1; i < parts.length; i++) {
              if (!parts[i]) continue;
              const idx = parseInt(parts[i].split('/')[0]);
              indices.push(idx < 0 ? vertices.length + idx : idx - 1);
            }
            // Fan triangulation for polygons with more than 3 vertices
            for (let i = 1; i < indices.length - 1; i++) {
              triangles.push([indices[0], indices[i], indices[i + 1]]);
            }
          }
        }
        
        if (vertices.length === 0 || triangles.length === 0) {
          throw new Error('OBJ contains no geometry');
        }
        
        console.log(`[Worker] Parsed OBJ: ${vertices.length} vertices, ${triangles.length} triangles`);
        
        // Create flat arrays for Manifold
        const vertProperties = new Float32Array(vertices.length * 3);
        for (let i = 0; i < vertices.length; i++) {
          vertProperties[i * 3] = vertices[i][0];
          vertProperties[i * 3 + 1] = vertices[i][1];
          vertProperties[i * 3 + 2] = vertices[i][2];
        }
        
        const triVerts = new Uint32Array(triangles.length * 3);
        for (let i = 0; i < triangles.length; i++) {
          triVerts[i * 3] = triangles[i][0];
          triVerts[i * 3 + 1] = triangles[i][1];
          triVerts[i * 3 + 2] = triangles[i][2];
        }
        
        // STL (and many OBJ/3MF files) repeats a corner on every triangle.
        // The strict constructor throws "Not manifold" on that soup. Try it
        // first, then weld identical positions, then a 0.0001 grid — the same
        // ladder the stage reference path uses. Mesh.merge() is not used.
        let manifold;
        try {
          manifold = _meshDataToManifold(vertProperties, triVerts, 0.0001).manifold;
        } catch {
          throw new Error('Invalid mesh. The mesh may not be watertight.');
        }
        
        // Cache for script access (import path — not a script execute nonce)
        _replaceCachedManifold(manifold);
        cachedExecuteNonce = null;
        
        const bbox = manifold.boundingBox();
        _postWorkerResult(self, id, {
          mesh: serializeResult(manifold),
          volume: manifold.volume(),
          boundingBox: { min: [...bbox.min], max: [...bbox.max] },
          filename,
        });
        break;
      }
      
      // ── Stage verification protocol (dev tooling; see _stageVerify above) ──

      // Push a reference solid into the worker-side registry.
      //   objString: OBJ text (canonical GT from the STEP converter).
      //   meshData:  { numProp, vertProperties, triVerts } (numbers; from the backend STEP
      //              converter route when the bundled obj_converter + firejail are fixed)
      case 'stageReferenceLoad': {
        if (!isInitialized) throw new Error('Worker not initialized');
        const { filename, objString, meshData, tolerance } = payload;
        if (!filename) throw new Error('stageReferenceLoad: filename required');
        let md;
        if (objString) {
          md = _parseOBJToMeshData(objString);
        } else if (meshData && meshData.vertProperties && meshData.triVerts) {
          md = { vertProperties: meshData.vertProperties, triVerts: meshData.triVerts };
        } else {
          throw new Error('stageReferenceLoad: provide objString or meshData');
        }
        const { manifold, repair } = _meshDataToManifold(md.vertProperties, md.triVerts, tolerance ?? 0.001);
        _stagedReferences.set(filename, {
          manifold,
          volume: manifold.volume(),
          surfaceArea: manifold.surfaceArea(),
          boundingBox: _bboxArray(manifold),
          tris: manifold.getMesh().triVerts.length / 3,
          repair,
          source: objString ? 'obj' : 'meshData',
        });
        self.postMessage({
          type: 'result', id,
          payload: { ok: true, filename, repair, volume: _stagedReferences.get(filename).volume,
                     surfaceArea: _stagedReferences.get(filename).surfaceArea,
                     boundingBox: _stagedReferences.get(filename).boundingBox,
                     tris: _stagedReferences.get(filename).tris,
                     staged: [..._stagedReferences.keys()] },
        });
        break;
      }

      case 'stageReferenceList': {
        const list = [];
        for (const [filename, ref] of _stagedReferences) {
          list.push({ filename, volume: ref.volume, surfaceArea: ref.surfaceArea,
                      boundingBox: ref.boundingBox, tris: ref.tris, repair: ref.repair, source: ref.source });
        }
        self.postMessage({ type: 'result', id, payload: { references: list } });
        break;
      }

      case 'stageReferenceClear': {
        const n = _stagedReferences.size;
        _stagedReferences.clear();
        self.postMessage({ type: 'result', id, payload: { ok: true, cleared: n } });
        break;
      }

      // Verify the script's LAST execution result (the cached candidate from the most
      // recent execute — the same object the Run path painted) against a staged
      // reference. Verdict computed against the bundled build, in-worker.
      case 'stageVerify': {
        if (!isInitialized) throw new Error('Worker not initialized');
        const { reference, passRel, volGate, candidateMesh } = payload;
        if (!cachedManifold && !candidateMesh) throw new Error('stageVerify: no candidate — execute a script first');
        const ref = _stagedReferences.get(reference);
        if (!ref) throw new Error(`stageVerify: reference '${reference}' not staged (staged: ${[..._stagedReferences.keys()].join(', ') || 'none'})`);
        let cand;
        if (candidateMesh) {
          cand = _meshDataToManifold(candidateMesh.vertProperties, candidateMesh.triVerts, payload.tolerance ?? 0).manifold;
        } else {
          cand = liveManifold();
        }
        const verdict = _stageVerify(cand, ref.manifold, { passRel, volGate });
        self.postMessage({
          type: 'result', id,
          payload: { ...verdict, reference, candidateVolume: cand.volume(),
                     referenceVolume: ref.volume },
        });
        break;
      }

      // Raw geometry probe of the last execution: the meshData the worker produced.
      case 'stageGetLastMesh': {
        const last = liveManifold();
        if (!last) throw new Error('stageGetLastMesh: nothing executed yet');
        const m = serializeResult(last);
        _postWorkerResult(self, id, {
          numProp: m.numProp,
          vertProperties: m.vertProperties,
          triVerts: m.triVerts,
          runIndex: m.runIndex,
          runOriginalID: m.runOriginalID,
          faceID: m.faceID,
          volume: last.volume(),
          surfaceArea: last.surfaceArea(),
          boundingBox: _bboxArray(last),
          status: _c4StatusError(last) || 'NoError',
        });
        break;
      }

      case 'getHelperList': {
        // Return list of available helper functions
        self.postMessage({
          type: 'helperList',
          id,
          payload: Object.keys(HELPER_FUNCTIONS)
        });
        break;
      }

      // Move Face preview. Clone the cached solid and offset with moveFace.
      // The clone is deleted before this returns. cachedManifold is not
      // assigned, so leaving without Confirm writes nothing and the model
      // stays put.
      case 'previewMoveFace': {
        if (!isInitialized) throw new Error('Worker not initialized');
        if (!cachedManifold) throw new Error('No cached manifold - execute a script first');
        const created = [];
        const track = (m) => {
          if (!m || m === cachedManifold || m === cachedBaked) return;
          if (created.indexOf(m) >= 0) return;
          created.push(m);
        };
        let mesh;
        try {
          const clone = liveManifold().clone();
          track(clone);
          const out = moveFace(clone, payload && payload.faces, payload && payload.distance, {
            flip: !!(payload && payload.flip),
          });
          track(out);
          mesh = serializeResult(out);
        } finally {
          for (const m of created) _safeDeleteManifold(m);
        }
        _postWorkerResult(self, id, { mesh });
        break;
      }

      // Delete Face preview. Clone the cached solid and heal with deleteFace.
      // The clone is deleted before this returns. cachedManifold is not
      // assigned, so leaving without Confirm writes nothing and the model
      // stays put.
      case 'previewDeleteFace': {
        if (!isInitialized) throw new Error('Worker not initialized');
        if (!cachedManifold) throw new Error('No cached manifold - execute a script first');
        const created = [];
        const track = (m) => {
          if (!m || m === cachedManifold || m === cachedBaked) return;
          if (created.indexOf(m) >= 0) return;
          created.push(m);
        };
        let mesh;
        try {
          const clone = liveManifold().clone();
          track(clone);
          const out = deleteFace(clone, payload && payload.faces);
          track(out);
          mesh = serializeResult(out);
        } finally {
          for (const m of created) _safeDeleteManifold(m);
        }
        _postWorkerResult(self, id, { mesh });
        break;
      }

      // Block pop preview. Builds the new solid only — cube, rounded box,
      // cylinder, sphere, tube, hex prism — with the same pose the sheet
      // would write. cachedManifold is not read or assigned, so Cancel
      // leaves the part and the editor untouched.
      case 'previewBlock': {
        if (!isInitialized) throw new Error('Worker not initialized');
        const { Manifold } = manifoldModule;
        const spec = blockSpec(payload && payload.id, payload && payload.params);
        const created = [];
        const track = (m) => {
          if (!m || m === cachedManifold || m === cachedBaked) return;
          if (created.indexOf(m) >= 0) return;
          created.push(m);
        };
        let mesh;
        let volume;
        let boundingBox;
        try {
          const solid = buildBlockManifold(spec, {
            Manifold, roundedBox, tube, hexPrism, track,
          });
          volume = solid.volume();
          boundingBox = _bboxArray(solid);
          mesh = serializeResult(solid);
        } finally {
          for (const m of created) _safeDeleteManifold(m);
        }
        _postWorkerResult(self, id, { mesh, volume, boundingBox, combine: spec.combine });
        break;
      }

      // Pieces preview. Clone the cached solid and split it with the same
      // helpers cut() uses. The clone and every temporary are deleted before
      // this returns. cachedManifold is not assigned, so leaving Pieces
      // without Confirm leaves the model whole and the editor gains no cut().
      case 'previewCut': {
        if (!isInitialized) throw new Error('Worker not initialized');
        if (!cachedManifold && !(typeof payload?.targetScript === 'string' && payload.targetScript.trim())) {
          throw new Error('No cached manifold - execute a script first');
        }
        const created = [];
        const track = (m) => {
          if (!m || m === cachedManifold || m === cachedBaked) return;
          if (created.indexOf(m) >= 0) return;
          created.push(m);
        };
        let pieces;
        try {
          const pl = _cutResolvePlane(payload && payload.plane);
          const clone = liveManifold().clone();
          track(clone);
          const bodies = _cutBodiesOf(clone);
          for (const body of bodies) track(body);
          const selected = _cutSelected(bodies, payload && payload.bodies);
          pieces = [];
          for (let i = 0; i < bodies.length; i++) {
            const body = bodies[i];
            const at = _cutCentroid(body);
            if (!selected.has(i)) {
              pieces.push({ at, side: 'whole', selected: false, mesh: serializeResult(body) });
              continue;
            }
            const split = _cutSplitOrOriginal(body, pl);
            for (const piece of split.pieces) {
              track(piece.manifold);
              pieces.push({
                at,
                side: piece.side,
                selected: true,
                mesh: serializeResult(piece.manifold),
              });
            }
            for (const extra of split.discard) track(extra);
          }
        } finally {
          for (const m of created) _safeDeleteManifold(m);
        }
        _postWorkerResult(self, id, { pieces });
        break;
      }

      // Boolean preview. Clone the cached solid and run the same combine
      // booleanBodies() uses, without drop, so every leftover piece is listed.
      // The clone and every temporary are deleted before this returns.
      // cachedManifold is not assigned, so leaving without Confirm writes nothing.
      case 'previewBoolean': {
        if (!isInitialized) throw new Error('Worker not initialized');
        if (!cachedManifold) throw new Error('No cached manifold - execute a script first');
        const created = [];
        const track = (m) => {
          if (!m || m === cachedManifold || m === cachedBaked) return;
          if (created.indexOf(m) >= 0) return;
          created.push(m);
        };
        let pieces;
        try {
          const options = (payload && typeof payload === 'object') ? payload : {};
          const op = _booleanOp(options.op);
          // Cross-part: the target part's script runs here (not cached) and
          // each external tool is that part's script, frozen and posed into
          // the target frame, exactly as Accept will write it.
          const ownRun = typeof options.targetScript === 'string' && options.targetScript.trim();
          const clone = ownRun
            ? executeScript(options.targetScript, {})
            : liveManifold().clone();
          if (!clone || typeof clone.decompose !== 'function') {
            throw new Error('previewBoolean: target script must return a Manifold');
          }
          track(clone);
          const external = [];
          for (const tool of Array.isArray(options.tools) ? options.tools : []) {
            const src = executeScript(String(tool?.script || ''), {});
            const posed = _externalPick(src, tool?.bodies, tool?.offset, 'previewBoolean');
            if (posed !== src) track(src);
            track(posed);
            external.push(posed);
          }
          const bodies = _cutBodiesOf(clone);
          for (const body of bodies) track(body);
          const spec = (external.length && (!Array.isArray(options.bodies) || !options.bodies.length))
            ? [{ at: _cutCentroid(bodies[0]) }]
            : options.bodies;
          const selected = _booleanSelected(bodies, spec);
          const sel = new Set(selected);
          pieces = [];
          for (let i = 0; i < bodies.length; i++) {
            if (sel.has(i)) continue;
            pieces.push({
              at: _cutCentroid(bodies[i]),
              selected: false,
              kind: 'body',
              mesh: serializeResult(bodies[i]),
            });
          }
          if (selected.length + external.length >= 2) {
            const picked = [...selected.map((i) => bodies[i]), ...external];
            const combined = _booleanCombine(op, picked);
            track(combined.result);
            for (const extra of combined.temps) track(extra);
            const parts = _cutBodiesOf(combined.result);
            for (const part of parts) track(part);
            for (const part of parts) {
              pieces.push({
                at: _cutCentroid(part),
                selected: true,
                kind: 'piece',
                mesh: serializeResult(part),
              });
            }
          }
        } finally {
          for (const m of created) _safeDeleteManifold(m);
        }
        _postWorkerResult(self, id, { pieces });
        break;
      }

      // Which parts a subtract cutter actually overlaps. The cutter script
      // runs here (frozen text, not cached) and each part is rebuilt from its
      // last mesh. cachedManifold is not read or assigned.
      case 'probeOverlap': {
        if (!isInitialized) throw new Error('Worker not initialized');
        const options = (payload && typeof payload === 'object') ? payload : {};
        const created = [];
        const overlaps = [];
        try {
          const cutter = executeScript(String(options.cutterScript || ''), {});
          if (!cutter || typeof cutter.intersect !== 'function') {
            throw new Error('probeOverlap: cutter script must return a Manifold');
          }
          created.push(cutter);
          for (const part of Array.isArray(options.parts) ? options.parts : []) {
            if (!part?.mesh?.vertProperties || !part?.mesh?.triVerts) continue;
            let solid = null;
            let posed = null;
            let both = null;
            try {
              const overlapMesh = part.featureRigid || part.mesh?.featureRigid
                ? bakeRigidMesh(part.mesh, part.featureRigid || part.mesh.featureRigid)
                : part.mesh;
              solid = reconstructManifold(overlapMesh);
              const off = Array.isArray(part.offset) ? part.offset.map(Number) : [0, 0, 0];
              posed = (off[0] || off[1] || off[2]) ? cutter.translate(off) : cutter;
              both = manifoldModule.Manifold.intersection(posed, solid);
              const vol = _cutVol(both);
              if (vol > 1e-6) overlaps.push({ id: part.id, volume: vol });
            } catch (_) {
              // A part whose mesh will not rebuild is not cut.
            } finally {
              _safeDeleteManifold(both);
              if (posed && posed !== cutter) _safeDeleteManifold(posed);
              _safeDeleteManifold(solid);
            }
          }
        } finally {
          for (const m of created) _safeDeleteManifold(m);
        }
        self.postMessage({ type: 'result', id, payload: { overlaps } });
        break;
      }

      case 'trimByPlane': {
        if (!isInitialized) {
          throw new Error('Worker not initialized');
        }
        
        if (!cachedManifold) {
          throw new Error('No cached manifold - execute a script first');
        }
        
        const { normal, originOffset } = payload;
        
        // Apply trimByPlane to cached manifold
        const trimmed = liveManifold().trimByPlane(normal, originOffset);
        
        // Serialize result
        const meshData = serializeResult(trimmed);
        if (trimmed !== cachedManifold && trimmed !== cachedBaked) _safeDeleteManifold(trimmed);
        
        _postWorkerResult(self, id, { mesh: meshData });
        break;
      }

      case 'trimMeshByPlane': {
        if (!isInitialized) {
          throw new Error('Worker not initialized');
        }
        const { mesh, normal, originOffset } = payload || {};
        if (!mesh?.vertProperties || !mesh?.triVerts) {
          throw new Error('trimMeshByPlane needs mesh data');
        }
        let solid = null;
        let trimmed = null;
        try {
          solid = reconstructManifold(mesh);
          trimmed = solid.trimByPlane(normal, originOffset);
          const meshData = serializeResult(trimmed);
          if (typeof trimmed.volume === 'function') meshData.volume = trimmed.volume();
          _postWorkerResult(self, id, { mesh: meshData });
        } finally {
          _safeDeleteManifold(trimmed);
          _safeDeleteManifold(solid);
        }
        break;
      }
      
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    const heapMB = _kernelHeapMB();
    const verdict = classifyKernelFailure({ error, heapMB });
    const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
    if (verdict.fatal && !kernelDead) kernelDead = { reason: verdict.reason, message };
    self.postMessage({
      type: 'error',
      id,
      payload: {
        message,
        name: error && typeof error === 'object' && typeof error.name === 'string' ? error.name : '',
        stack: error?.stack,
        scriptLine: Number.isFinite(error?.scriptLine) ? error.scriptLine : null,
        featureId: typeof error?.featureId === 'string' ? error.featureId : null,
        featureBlock: typeof error?.featureBlock === 'string' ? error.featureBlock : null,
        featureSkip: error?.featureSkip && typeof error.featureSkip === 'object' ? error.featureSkip : null,
        ...(error?.code === FEATURE_TIMEOUT_CODE ? { code: FEATURE_TIMEOUT_CODE, timeout: error.timeout ?? null, hint: error.hint ?? FEATURE_TIMEOUT_HINT } : {}),
        ...(verdict.fatal ? { fatal: true, reason: verdict.reason, wasmHeapMB: heapMB } : {}),
      }
    });
  }
};

// Signal that the worker is loaded
self.postMessage({ type: 'loaded' });
}

export {
  HELPER_FUNCTIONS,
  initializeManifold,
  executeScript,
};

/** The Manifold module bound for helper closures (null until init / bind). */
export function getManifoldModule() {
  return manifoldModule;
}

/** True after initializeManifold or bindManifoldModule. */
export function manifoldReady() {
  return isInitialized && !!manifoldModule;
}

/**
 * Load the shipped built/manifold.js factory. `wasmPath` / `locateFile`
 * override WASM resolution. Does not call setup(); bindManifoldModule does.
 */
export async function loadBundledManifold(opts = {}) {
  const args = {};
  if (typeof opts.locateFile === 'function') args.locateFile = opts.locateFile;
  else if (opts.wasmPath) args.locateFile = () => opts.wasmPath;
  return Module(args);
}

/**
 * Install `mod` as the module helper closures read. setup() and
 * installSeparateBodies are idempotent. Pass `setup: false` only when the
 * caller already did both.
 */
export function bindManifoldModule(mod, { setup = true } = {}) {
  if (!mod || typeof mod !== 'object') {
    throw new Error('bindManifoldModule: Manifold module required');
  }
  manifoldModule = mod;
  if (setup) {
    if (typeof mod.setup === 'function') mod.setup();
    installSeparateBodies(mod);
  }
  installKernelArena(mod);
  isInitialized = true;
  return mod;
}

/**
 * Bindings executeScript spreads into the user script: the Manifold API
 * plus HELPER_FUNCTIONS. Per-run `window` and feature-trace hooks are
 * added inside executeScript / runPreparedScript, not here.
 */
export function helperScope(mod) {
  if (mod) manifoldModule = mod;
  if (!manifoldModule) throw new Error('helperScope: Manifold module required');
  return {
    ...manifoldModule,
    ...HELPER_FUNCTIONS,
  };
}

function summarizeManifold(result) {
  const solid = manifoldFromScriptResult(result);
  const mesh = serializeResult(solid);
  const bbox = solid.boundingBox();
  const bodyCentroids = _kernelBodyCentroids(solid);
  return {
    manifold: solid,
    mesh,
    volume: solid.volume(),
    surfaceArea: typeof solid.surfaceArea === 'function' ? solid.surfaceArea() : null,
    status: _c4StatusError(solid) || 'NoError',
    tris: mesh.triVerts.length / 3,
    boundingBox: { min: [...bbox.min], max: [...bbox.max] },
    bodyCentroids,
    bodyCount: bodyCentroids.length,
    parts: bodyCentroids.map((at, index) => ({ index, at })),
  };
}

/**
 * Execute a user script the way the worker's `execute` message does:
 * feature-op reset, `"use strict"` + new Function(...helperNames, script),
 * same shadowing rules. The module must already be bound.
 */
export function runPreparedScript(source, opts = {}) {
  if (!manifoldModule || !isInitialized) throw new Error('Manifold not initialized');
  if (typeof globalThis !== 'undefined') {
    globalThis.__filletSweepRingLog = [];
    globalThis.__filletSweepRingCall = null;
  }
  _featureOps = [];
  _sourceTess = [];
  _blockRanges = [];
  _resetFaceStamps();
  _memoContext = { partId: typeof opts.partId === 'string' && opts.partId ? opts.partId : null };
  _lastMemoReport = null;
  let ran;
  let kernelFreed;
  try {
    ({ ran, kernelFreed } = _runInKernelArena(() => executeSkippingFailedFeatures(
      String(source ?? ''),
      opts.importedModels || {},
      opts.rollbackAnchor,
      { timedOut: opts.timedOut },
    )));
  } finally {
    _memoContext = null;
  }
  const summary = summarizeManifold(ran.result);
  if (_lastMemoReport) summary.featureCache = _lastMemoReport;
  if (ran.featureSkip) summary.featureSkip = ran.featureSkip;
  if (ran.rolledBack?.length) summary.rolledBack = ran.rolledBack;
  if (ran.featureTimings?.length) summary.featureTimings = ran.featureTimings;
  markSheetMesh(summary.mesh, source);
  summary.kernelFreed = kernelFreed;
  summary.wasmHeapMB = wasmHeapMB(manifoldModule);
  // The caller owns the returned `manifold` (goldens and the external
  // runner delete it themselves), so the previous one is not freed here;
  // the worker's execute path, where nobody else holds it, frees it.
  cachedManifold = summary.manifold;
  cachedExecuteNonce = (opts.nonce !== undefined && opts.nonce !== null) ? opts.nonce : null;
  return summary;
}
