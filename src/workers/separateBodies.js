/**
 * Separate bodies (Merge bodies toggle).
 *
 * `part.add(solid, { merge: false })` keeps `solid` as its own body in the
 * part: Manifold.compose, no boolean. decompose() splits it back out, the
 * viewer's meshBodyComponents sees two components, and booleanBodies() can
 * still fuse them later. Bare `part.add(solid)` (and `{ merge: true }`) is
 * the plain union it always was.
 *
 * Composed bodies may overlap. Manifold's own boolean on such a solid fuses
 * the overlapping bodies wherever the other operand reaches their overlap
 * (a Subtract through the overlap returned one body). So when the receiver
 * has bodies whose boxes overlap, add / subtract / intersect run per body:
 *   - subtract / intersect: each body the tool's box reaches is cut alone;
 *     the rest are kept as they are; the pieces are composed again.
 *   - add (merge on): the tool unions with every body it actually joins
 *     (raw union of that body + tool collapses to fewer components). Bodies
 *     it does not touch stay separate. No touched body → the tool becomes a
 *     body of its own, the same as a disjoint union does today.
 * A receiver that is one body, or whose bodies do not overlap, takes the
 * original method untouched, so every single-body script is bit-identical.
 *
 * Installed once on the embind prototype (Manifold.prototype is a wrapper).
 *
 * Run table. The kernel's decompose() hands every component the parent's
 * whole run table (one run per original mesh id, most of them empty for
 * that component), and compose() concatenates the tables of its inputs. So
 * decompose → compose multiplies the run count by the body count, every
 * time: three cubes go 3, 9, 27, 81 runs while the triangle count stays 36,
 * and the Clamps part of the fastened bike (16 bodies, 15 adds) reached the
 * 4 GB wasm heap cap and aborted inside the 13th add.
 *
 * Two defences, in order:
 * 1. An add whose tool touches no body (the common case: hardware, rings,
 *    plates dropped next to each other) composes the tool with the receiver
 *    as it is. No decompose copy reaches the result, the table grows by the
 *    tool's runs, and the mesh is bit-identical to the plain path.
 * 2. When a decomposed body is reused (a touched add, a per-body cut, a
 *    per-body face op) and its table has bloated past `RUN_BLOAT_MIN` runs
 *    with at most a quarter of them used, `compactRuns` rebuilds it from its
 *    own mesh with only its non-empty runs (same originalIDs, same
 *    triangles). The verts go through the float32 mesh, so the body is not
 *    bit-identical and a later union may triangulate differently; that is
 *    why it is a guard against the abort, not the default.
 *
 * The guard must not read a mesh to decide. The kernel's triangulation
 * depends on allocation order, and a getMesh() on every decomposed body
 * (even one that is then left alone) moved the Frame of the bike from 5938
 * to 6360 triangles and made it vary between runs. So the run count is
 * tracked in a WeakMap as an upper-bound estimate: the sum over compose and
 * boolean inputs, inherited through transforms, the parent's count for a
 * decomposed body. Only once the estimate reaches `RUN_BLOAT_MIN` is the
 * mesh read, and compactRuns then checks the true counts.
 */

const runEstimate = new WeakMap();

/** Estimated run-table size of `handle` (1 when unknown). An upper bound. */
export function runEstimateOf(handle) {
  const n = handle && typeof handle === 'object' ? runEstimate.get(handle) : 0;
  return n > 0 ? n : 1;
}

/** Record the estimate for `handle`; returns it. */
export function noteRunEstimate(handle, n) {
  if (handle && typeof handle === 'object' && Number.isFinite(n)) {
    runEstimate.set(handle, Math.max(1, Math.round(n)));
  }
  return handle;
}

function sumEstimates(list) {
  let n = 0;
  for (const h of list) n += runEstimateOf(h);
  return n;
}

/** Methods whose result keeps the receiver's run table. */
const INHERIT_RUNS = [
  'translate', 'rotate', 'scale', 'mirror', 'transform', 'warp',
  'refine', 'refineToLength', 'refineToTolerance', 'smoothOut', 'smoothByNormals',
  'setProperties', 'calculateNormals', 'calculateCurvature', 'setTolerance',
  'trimByPlane', 'split', 'splitByPlane', 'hull',
];

const OVERLAP_EPS = 1e-6;

/** Run count of a mesh, and how many of those runs own at least one triangle. */
export function meshRunCounts(mesh) {
  const runs = Number(mesh?.numRun) || 0;
  const idx = mesh?.runIndex;
  let used = 0;
  if (idx && idx.length >= runs + 1) {
    for (let r = 0; r < runs; r++) if (idx[r + 1] > idx[r]) used += 1;
  } else {
    used = runs;
  }
  return { runs, used };
}

/**
 * A run table this big, this empty, is compacted when the body is reused.
 * Ordinary parts stay far below it (the bike Frame, one body built from 40
 * sources with touched adds, ends at 805 runs and must keep its exact
 * mesh); the runaway case multiplies past it within a few adds.
 */
export const RUN_BLOAT_MIN = 8192;

/** True when a reused body's run table should be rebuilt (see compactRuns). */
export function runTableBloated({ runs, used }) {
  return runs >= RUN_BLOAT_MIN && used * 4 <= runs;
}

/**
 * The same body with only the runs that own triangles. Returns `m` itself
 * when the table is not bloated (or `force` is off and every run is used),
 * else a new handle; `m` is deleted in that case. originalIDs and the run
 * transforms are kept. Pass `{ force: true }` to compact any table with an
 * empty run.
 */
export function compactRuns(module, m, { force = false } = {}) {
  if (!m || typeof m.getMesh !== 'function') return m;
  let mesh;
  try { mesh = m.getMesh(); } catch (_) { return m; }
  const counts = meshRunCounts(mesh);
  const { runs, used } = counts;
  noteRunEstimate(m, runs);
  if (runs <= 1 || used === runs) return m;
  if (!force && !runTableBloated(counts)) return m;
  const idx = mesh.runIndex;
  const keep = [];
  for (let r = 0; r < runs; r++) if (idx[r + 1] > idx[r]) keep.push(r);
  const runIndex = new Uint32Array(keep.length + 1);
  const runOriginalID = new Uint32Array(keep.length);
  const hasTransform = mesh.runTransform && mesh.runTransform.length === runs * 12;
  const runTransform = hasTransform ? new Float32Array(keep.length * 12) : null;
  let at = 0;
  keep.forEach((r, i) => {
    runIndex[i] = at;
    at += idx[r + 1] - idx[r];
    runOriginalID[i] = mesh.runOriginalID[r];
    if (hasTransform) runTransform.set(mesh.runTransform.subarray(r * 12, r * 12 + 12), i * 12);
  });
  runIndex[keep.length] = at;
  const opts = {
    numProp: mesh.numProp,
    vertProperties: mesh.vertProperties,
    triVerts: mesh.triVerts,
    runIndex,
    runOriginalID,
  };
  if (hasTransform) opts.runTransform = runTransform;
  if (mesh.mergeFromVert && mesh.mergeFromVert.length) {
    opts.mergeFromVert = mesh.mergeFromVert;
    opts.mergeToVert = mesh.mergeToVert;
  }
  if (mesh.faceID && mesh.faceID.length) opts.faceID = mesh.faceID;
  if (mesh.halfedgeTangent && mesh.halfedgeTangent.length) opts.halfedgeTangent = mesh.halfedgeTangent;
  let out;
  try {
    out = new module.Manifold(new module.Mesh(opts));
  } catch (_) {
    return m;
  }
  del(m);
  return noteRunEstimate(out, used);
}

/**
 * A decomposed body carries its parent's run table. Note that, and rebuild
 * the body only when the estimate says the table is bloated.
 */
function adoptDecomposed(module, parent, part) {
  const est = runEstimateOf(parent);
  if (module && est >= RUN_BLOAT_MIN) return compactRuns(module, part);
  return noteRunEstimate(part, est);
}

function del(m) {
  if (!m) return;
  try { if (typeof m.delete === 'function') m.delete(); } catch (_) { /* freed */ }
}

function boxOf(m) {
  const b = m.boundingBox();
  return { min: [...b.min], max: [...b.max] };
}

/** Boxes share a positive volume (a touching cut plane is not an overlap). */
export function boxesOverlap(a, b, eps = OVERLAP_EPS) {
  for (let k = 0; k < 3; k++) {
    const lo = Math.max(a.min[k], b.min[k]);
    const hi = Math.min(a.max[k], b.max[k]);
    if (!(hi - lo > eps)) return false;
  }
  return true;
}

/** Boxes meet (contact counts: an Extrude sitting on a face must merge). */
function boxesMeet(a, b, eps = 1e-5) {
  for (let k = 0; k < 3; k++) {
    if (a.min[k] > b.max[k] + eps || b.min[k] > a.max[k] + eps) return false;
  }
  return true;
}

/** The kernel's own decompose (no run compaction) when the patch is installed. */
function rawDecomposeOf(m) {
  const proto = Object.getPrototypeOf(m);
  return (proto && typeof proto.__rawDecompose === 'function') ? proto.__rawDecompose : m.decompose;
}

function componentCount(m) {
  let parts = null;
  try { parts = rawDecomposeOf(m).call(m); } catch (_) { return 1; }
  const n = Array.isArray(parts) ? parts.length : 1;
  if (Array.isArray(parts)) for (const p of parts) if (p !== m) del(p);
  return n;
}

/**
 * Bodies of `m` when at least two of them overlap; otherwise null (and the
 * decompose copies are freed).
 */
export function overlappingBodies(m, module) {
  if (!m || typeof m.decompose !== 'function') return null;
  let parts = null;
  try { parts = rawDecomposeOf(m).call(m); } catch (_) { return null; }
  if (!Array.isArray(parts) || parts.length < 2) {
    if (Array.isArray(parts)) for (const p of parts) if (p !== m) del(p);
    return null;
  }
  const boxes = parts.map(boxOf);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesOverlap(boxes[i], boxes[j])) {
        // Only bodies that are reused are checked (the copies carry the
        // parent's whole run table); a bloated one is rebuilt.
        const bodies = parts.map((p) => adoptDecomposed(module, m, p));
        return { bodies, boxes };
      }
    }
  }
  for (const p of parts) del(p);
  return null;
}

export function installSeparateBodies(module) {
  const { Manifold } = module;
  const probe = Manifold.cube([1, 1, 1]);
  const proto = Object.getPrototypeOf(probe);
  del(probe);
  if (!proto || proto.__separateBodies) return;
  const rawAdd = proto.add;
  const rawSubtract = proto.subtract;
  const rawIntersect = proto.intersect;
  const rawDecompose = proto.decompose;
  if (typeof rawDecompose === 'function') {
    Object.defineProperty(proto, '__rawDecompose', { value: rawDecompose });
    proto.decompose = function decompose(...args) {
      const parts = rawDecompose.apply(this, args);
      if (!Array.isArray(parts) || parts.length < 2) return parts;
      return parts.map((p) => adoptDecomposed(module, this, p));
    };
  }
  for (const name of INHERIT_RUNS) {
    const raw = proto[name];
    if (typeof raw !== 'function') continue;
    proto[name] = function inheritRuns(...args) {
      const out = raw.apply(this, args);
      const est = runEstimateOf(this);
      if (Array.isArray(out)) for (const o of out) noteRunEstimate(o, est);
      else noteRunEstimate(out, est);
      return out;
    };
  }
  const rawCompose = Manifold.compose;
  if (typeof rawCompose === 'function') {
    Manifold.compose = function compose(list, ...rest) {
      return noteRunEstimate(rawCompose.call(this, list, ...rest), Array.isArray(list) ? sumEstimates(list) : 1);
    };
  }
  for (const name of ['union', 'difference', 'intersection']) {
    const raw = Manifold[name];
    if (typeof raw !== 'function') continue;
    Manifold[name] = function batch(...args) {
      const inputs = Array.isArray(args[0]) ? args[0] : args;
      return noteRunEstimate(raw.apply(this, args), sumEstimates(inputs));
    };
  }
  const isSolid = (o) => o && typeof o === 'object' && typeof o.decompose === 'function';

  const perBodyCut = (self, other, raw) => {
    if (!isSolid(other)) return raw.call(self, other);
    const split = overlappingBodies(self, module);
    if (!split) return raw.call(self, other);
    const toolBox = boxOf(other);
    const kept = [];
    const intersect = raw === rawIntersect;
    for (let i = 0; i < split.bodies.length; i++) {
      const body = split.bodies[i];
      if (!boxesMeet(split.boxes[i], toolBox)) {
        if (intersect) del(body);
        else kept.push(body);
        continue;
      }
      const out = raw.call(body, other);
      noteRunEstimate(out, runEstimateOf(body) + runEstimateOf(other));
      del(body);
      if (out.isEmpty()) del(out);
      else kept.push(out);
    }
    if (!kept.length) return raw.call(self, other);
    if (kept.length === 1) return kept[0];
    const res = Manifold.compose(kept);
    for (const k of kept) del(k);
    return res;
  };

  const mergeAdd = (self, other) => {
    const split = overlappingBodies(self, module);
    if (!split) return rawAdd.call(self, other);
    const toolBox = boxOf(other);
    const toolParts = componentCount(other);
    const touched = [];
    const untouched = [];
    let single = null;
    for (let i = 0; i < split.bodies.length; i++) {
      const body = split.bodies[i];
      if (!boxesMeet(split.boxes[i], toolBox)) {
        untouched.push(body);
        continue;
      }
      const u = rawAdd.call(body, other);
      noteRunEstimate(u, runEstimateOf(body) + runEstimateOf(other));
      if (componentCount(u) < 1 + toolParts) {
        touched.push(body);
        if (touched.length === 1) single = u;
        else del(u);
      } else {
        del(u);
        untouched.push(body);
      }
    }
    let joined;
    if (!touched.length) {
      // Nothing joins: the tool becomes a body of its own. Compose it with
      // the receiver as it is, so no decompose copy reaches the result.
      for (const b of untouched) del(b);
      return Manifold.compose([other, self]);
    }
    if (touched.length === 1) {
      joined = single;
      del(touched[0]);
    } else {
      del(single);
      joined = Manifold.union([...touched, other]);
      for (const t of touched) del(t);
    }
    const res = Manifold.compose([joined, ...untouched]);
    for (const b of untouched) del(b);
    if (joined !== other) del(joined);
    return res;
  };

  // The per-body paths already noted a composed result (the sum over the
  // decomposed copies, which is the multiplication the guard watches);
  // keep the larger of that and the plain two-input sum.
  const noteBoth = (self, other, out) => noteRunEstimate(
    out,
    Math.max(runEstimateOf(out), runEstimateOf(self) + runEstimateOf(other)),
  );
  proto.add = function add(other, opts) {
    if (opts && typeof opts === 'object' && opts.merge === false) {
      if (!isSolid(other)) throw new Error('add: { merge: false } needs a solid');
      return Manifold.compose([this, other]);
    }
    if (!isSolid(other)) return rawAdd.call(this, other);
    return noteBoth(this, other, mergeAdd(this, other));
  };
  proto.subtract = function subtract(other) {
    return noteBoth(this, other, perBodyCut(this, other, rawSubtract));
  };
  proto.intersect = function intersect(other) {
    return noteBoth(this, other, perBodyCut(this, other, rawIntersect));
  };
  Object.defineProperty(proto, '__separateBodies', { value: true });
}
