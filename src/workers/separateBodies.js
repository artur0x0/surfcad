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
 *     A tool that only touches (a frame split into boxes along an edge, or a
 *     solid up to 0.001 mm off the face) does not boolean-join and used to
 *     stay a 12-triangle body. When the boxes meet but do not
 *     overlap, merge-on nudges that tool into the host by at most WELD_EPS
 *     and unions again. `{ merge: false }` is not nudged.
 * A receiver that is one body, or whose bodies do not overlap, takes the
 * original method. A boolean that already joins, and a tool that does not
 * meet the host, stay bit-identical.
 *
 * A closed shell decomposes into the filled outer hull plus a negative-volume
 * cavity. That cavity is the inner shell of the void, not a second body.
 * `logicalBodies` keeps it with the solid that encloses the void shell: a
 * winding-number test of points on that shell, and the smallest enclosing
 * solid wins. A bounding box that merely covers the cavity center is not
 * enough — two solids can overlap in box without one nesting inside the
 * other. Union of the filled hull alone would fill the cavity.
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

/**
 * A tool this close, whose boxes meet but do not overlap, is nudged into the
 * host so a frame's leftover box does not stay its own body. A real gap
 * larger than this stays separate. 0.001 mm is below modeling tolerance and
 * above the float gap that leaves a cube sitting on a face unmerged.
 */
const WELD_EPS = 1e-3;

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

function volumeOf(m) {
  try {
    const v = m.volume();
    return Number.isFinite(v) ? v : 0;
  } catch (_) {
    return 0;
  }
}

/** Below this, a component is the inner shell of a void, not a solid. */
const CAVITY_VOLUME = -1e-6;

function boxCenter(box) {
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
}

function pointInBox(point, box, eps = 1e-4) {
  for (let k = 0; k < 3; k++) {
    if (point[k] < box.min[k] - eps || point[k] > box.max[k] + eps) return false;
  }
  return true;
}

/**
 * Points just inside the void, one at each extreme of its shell. The bbox
 * center is not used: concentric shells share it, so the outer void would
 * look contained by the inner solid.
 */
function cavityShellPoints(cavity) {
  let mesh = null;
  try { mesh = cavity.getMesh(); } catch (_) { mesh = null; }
  const props = mesh && mesh.vertProperties;
  const stride = (mesh && mesh.numProp) || 3;
  const n = props ? Math.floor(props.length / stride) : 0;
  let center = [0, 0, 0];
  try { center = boxCenter(boxOf(cavity)); } catch (_) { /* origin */ }
  if (n < 1) return [center];
  const picked = new Set();
  const coord = (i, axis) => props[i * stride + axis];
  for (let axis = 0; axis < 3; axis++) {
    let lo = 0;
    let hi = 0;
    for (let i = 1; i < n; i++) {
      if (coord(i, axis) < coord(lo, axis)) lo = i;
      if (coord(i, axis) > coord(hi, axis)) hi = i;
    }
    picked.add(lo);
    picked.add(hi);
  }
  const points = [];
  for (const i of picked) {
    const v = [coord(i, 0), coord(i, 1), coord(i, 2)];
    const d = [center[0] - v[0], center[1] - v[1], center[2] - v[2]];
    const dist = Math.hypot(d[0], d[1], d[2]) || 1;
    // Stay on the shell. A long step toward the center falls inside a solid
    // that only overlaps the middle of the void.
    const nudge = Math.min(0.25, dist * 0.05);
    points.push([
      v[0] + (d[0] / dist) * nudge,
      v[1] + (d[1] / dist) * nudge,
      v[2] + (d[2] / dist) * nudge,
    ]);
  }
  return points.length ? points : [center];
}

/** Generalized winding number of `point` against a closed triangle mesh. */
function windingNumber(mesh, point) {
  const props = mesh.vertProperties;
  const tris = mesh.triVerts;
  if (!props || !tris) return 0;
  const stride = mesh.numProp || 3;
  const vert = (i) => {
    const o = i * stride;
    return [props[o] - point[0], props[o + 1] - point[1], props[o + 2] - point[2]];
  };
  let sum = 0;
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const a = vert(tris[t]);
    const b = vert(tris[t + 1]);
    const c = vert(tris[t + 2]);
    const la = Math.hypot(a[0], a[1], a[2]);
    const lb = Math.hypot(b[0], b[1], b[2]);
    const lc = Math.hypot(c[0], c[1], c[2]);
    const cross = [
      b[1] * c[2] - b[2] * c[1],
      b[2] * c[0] - b[0] * c[2],
      b[0] * c[1] - b[1] * c[0],
    ];
    const num = a[0] * cross[0] + a[1] * cross[1] + a[2] * cross[2];
    const den = la * lb * lc
      + (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * lc
      + (b[0] * c[0] + b[1] * c[1] + b[2] * c[2]) * la
      + (c[0] * a[0] + c[1] * a[1] + c[2] * a[2]) * lb;
    sum += 2 * Math.atan2(num, den);
  }
  return Number.isFinite(sum) ? sum / (4 * Math.PI) : 0;
}

/** True when every void-shell sample sits inside `mesh` (winding about ±1). */
function meshEncloses(mesh, points) {
  for (const point of points) {
    if (Math.abs(windingNumber(mesh, point)) <= 0.5) return false;
  }
  return true;
}

function boxHoldsPoints(box, points) {
  for (const point of points) if (!pointInBox(point, box)) return false;
  return true;
}

/**
 * Logical solids of `m`. A negative-volume component is the inner shell of a
 * void and stays with the smallest positive solid that encloses it (a
 * winding test of points on the void shell; the box only rejects solids that
 * cannot). Otherwise the largest solid. Returns null when `m` is already one
 * logical body — one solid, or one solid plus its cavities — and frees the
 * decompose copies so the caller keeps `m` unchanged. Otherwise one manifold
 * per solid.
 */
export function logicalBodies(m, module) {
  if (!m || typeof m.decompose !== 'function') return null;
  let parts = null;
  try { parts = rawDecomposeOf(m).call(m); } catch (_) { return null; }
  if (!Array.isArray(parts) || parts.length < 2) {
    if (Array.isArray(parts)) for (const p of parts) if (p !== m) del(p);
    return null;
  }
  const positives = [];
  const cavities = [];
  for (const p of parts) {
    if (volumeOf(p) < CAVITY_VOLUME) cavities.push(p);
    else positives.push(p);
  }
  if (positives.length <= 1) {
    for (const p of parts) if (p !== m) del(p);
    return null;
  }
  const Manifold = module && module.Manifold;
  const boxes = positives.map(boxOf);
  const vols = positives.map(volumeOf);
  const groups = positives.map((solid) => [solid]);
  const shellPoints = cavities.map(cavityShellPoints);
  const meshes = new Map();
  for (let c = 0; c < cavities.length; c++) {
    const points = shellPoints[c];
    let owner = -1;
    for (let i = 0; i < positives.length; i++) {
      if (!boxHoldsPoints(boxes[i], points)) continue;
      let mesh = meshes.get(i);
      if (mesh === undefined) {
        try { mesh = positives[i].getMesh(); } catch (_) { mesh = null; }
        meshes.set(i, mesh);
      }
      if (!mesh || !meshEncloses(mesh, points)) continue;
      if (owner < 0 || vols[i] < vols[owner]) owner = i;
    }
    if (owner < 0) {
      owner = 0;
      for (let i = 1; i < vols.length; i++) if (vols[i] > vols[owner]) owner = i;
    }
    groups[owner].push(cavities[c]);
  }
  const bodies = [];
  for (const group of groups) {
    let body = group[0];
    if (group.length > 1 && Manifold && typeof Manifold.compose === 'function') {
      body = Manifold.compose(group);
      for (const g of group) del(g);
    }
    bodies.push(module ? adoptDecomposed(module, m, body) : body);
  }
  return bodies;
}

function componentCount(m, module) {
  let bodies = null;
  try { bodies = logicalBodies(m, module); } catch (_) { return 1; }
  if (!bodies) return 1;
  const n = bodies.length || 1;
  for (const b of bodies) if (b !== m) del(b);
  return n;
}

/**
 * Bodies of `m` when at least two logical solids overlap; otherwise null
 * (and the decompose copies are freed). A void's inner shell is not a body.
 */
export function overlappingBodies(m, module) {
  if (!m || typeof m.decompose !== 'function') return null;
  let bodies = null;
  try { bodies = logicalBodies(m, module); } catch (_) { return null; }
  if (!bodies || bodies.length < 2) {
    if (bodies) for (const b of bodies) if (b !== m) del(b);
    return null;
  }
  const boxes = bodies.map(boxOf);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesOverlap(boxes[i], boxes[j])) return { bodies, boxes };
    }
  }
  for (const b of bodies) del(b);
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

  // Nudge `tool` toward `targetBox` on axes where the two only meet, so a
  // later boolean overlaps. Axes that already overlap by more than eps are
  // left alone, and the far faces stay put (hull against one translated copy).
  const fattenToward = (tool, targetBox, eps) => {
    const box = boxOf(tool);
    const delta = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const overlap = Math.min(box.max[k], targetBox.max[k]) - Math.max(box.min[k], targetBox.min[k]);
      if (overlap > eps) continue;
      const toolMid = (box.min[k] + box.max[k]) / 2;
      const tgtMid = (targetBox.min[k] + targetBox.max[k]) / 2;
      delta[k] = toolMid >= tgtMid ? -eps : eps;
    }
    if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return tool;
    const moved = tool.translate(delta);
    let hull = null;
    try { hull = Manifold.hull([tool, moved]); } catch (_) { hull = null; }
    del(moved);
    return hull || tool;
  };

  // Tool components that merely touch `selfBox` become overlapping copies.
  // Returns `other` itself when nothing needed a nudge.
  const sealTool = (selfBox, other) => {
    const parts = logicalBodies(other, module);
    if (!parts) {
      const box = boxOf(other);
      if (!boxesMeet(selfBox, box, WELD_EPS) || boxesOverlap(selfBox, box)) return other;
      return fattenToward(other, selfBox, WELD_EPS);
    }
    let changed = false;
    const out = [];
    for (const part of parts) {
      const box = boxOf(part);
      if (boxesMeet(selfBox, box, WELD_EPS) && !boxesOverlap(selfBox, box)) {
        const fat = fattenToward(part, selfBox, WELD_EPS);
        if (fat !== part) {
          changed = true;
          del(part);
          out.push(fat);
          continue;
        }
      }
      out.push(part);
    }
    if (!changed) {
      for (const part of out) if (part !== other) del(part);
      return other;
    }
    const composed = Manifold.compose(out);
    for (const part of out) del(part);
    return composed;
  };

  const mergeAdd = (self, other) => {
    const split = overlappingBodies(self, module);
    if (!split) return rawAdd.call(self, other);
    const toolBox = boxOf(other);
    const toolParts = componentCount(other, module);
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
      if (componentCount(u, module) < 1 + toolParts) {
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

  // Face contact already boolean-joins and must stay bit-identical. A tool
  // that only meets the host (an edge, or a gap within WELD_EPS) and comes
  // back still separate is sealed and unioned once more.
  const weldMerge = (self, other) => {
    const selfBox = boxOf(self);
    const otherBox = boxOf(other);
    if (!boxesMeet(selfBox, otherBox, WELD_EPS) || boxesOverlap(selfBox, otherBox)) {
      return mergeAdd(self, other);
    }
    const plain = mergeAdd(self, other);
    const before = componentCount(self, module) + componentCount(other, module);
    if (componentCount(plain, module) < before) return plain;
    const sealed = sealTool(selfBox, other);
    if (sealed === other) return plain;
    del(plain);
    const welded = mergeAdd(self, sealed);
    del(sealed);
    return welded;
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
    return noteBoth(this, other, weldMerge(this, other));
  };
  proto.subtract = function subtract(other) {
    return noteBoth(this, other, perBodyCut(this, other, rawSubtract));
  };
  proto.intersect = function intersect(other) {
    return noteBoth(this, other, perBodyCut(this, other, rawIntersect));
  };
  Object.defineProperty(proto, '__separateBodies', { value: true });
}
