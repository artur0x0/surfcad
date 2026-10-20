/**
 * Joint residuals in the world frame, and their analytic Jacobian.
 *
 * Counts below are the independent rows. A cross product is stored as the
 * two components that are not the seed direction's largest one, so the
 * row choice does not move when the pose does.
 *
 *   coincident   (nₐ ± n_b) twice, and (p_b − pₐ) · nₐ
 *   concentric   dₐ × d_b twice, and (p_b − pₐ) × dₐ twice
 *   distance     nₐ × n_b twice, and (p_b − pₐ) · nₐ − sense · value
 *   angle        sense · (uₐ · u_b) − cos(value in radians); at 0° and
 *                180° the rows are (uₐ ∓ u_b) twice instead, like
 *                coincident, since the dot product is flat there and
 *                left a "parallel" joint 2° off within tolerance
 *   symmetric    midplane(a, a2) coincident with midplane(b, b2)
 *   fixed        no row; the part is not a variable
 *
 * The two kept rows of nₐ ± n_b are zero whenever the directions are
 * parallel, either way round. The sign (`opposed`, or `sense` at 0° / 180°)
 * is settled before the solve: `solveJoints` flips the seed of the free
 * part when it starts the wrong way round (`orientSeeds`), and the rows
 * then hold the orientation the joint asks for.
 *
 * Concentric on an edge reads `key.circle` (center, axis). It does not
 * use the edge tangent. A missing circle leaves the joint with no frame.
 */
import {
  add3,
  addMat,
  cross3,
  dot3,
  dropIndex,
  mulMat,
  scale3,
  scaleMat,
  skew,
  sub3,
  unit3,
  vecTMat,
  worldGeom,
} from './rigid.js';

const ZERO = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

/**
 * The direction sign a joint asks for, or 0 when it has no preference:
 * `wanted · (dirₐ · dir_b)` must be positive. Coincident: −1 when
 * opposed (the default), else 1. Angle at 0°: `sense`; at 180°: −`sense`.
 */
export function wantedAlignment(joint) {
  if (!joint) return 0;
  if (joint.type === 'coincident') return joint.opposed === false ? 1 : -1;
  if (joint.type === 'angle') {
    const turn = alignedAngle(joint);
    if (turn === null) return 0;
    const sense = joint.sense === -1 ? -1 : 1;
    return turn === 0 ? sense : -sense;
  }
  return 0;
}

/** 0 or 180 when an angle joint is a parallel one, else null. */
export function alignedAngle(joint) {
  const value = Number(joint?.value);
  if (!Number.isFinite(value)) return null;
  const turn = ((value % 360) + 360) % 360;
  if (Math.abs(turn) < 1e-9 || Math.abs(turn - 360) < 1e-9) return 0;
  if (Math.abs(turn - 180) < 1e-9) return 180;
  return null;
}

/** Local point and direction a joint equation actually constrains. */
export function localFrame(ref, type) {
  if (!ref || type === 'fixed') return null;
  if ((ref.kind === 'face' || ref.kind === 'plane') && ref.key?.at && ref.key?.n) {
    return { at: ref.key.at.slice(), dir: unit3(ref.key.n) };
  }
  if (ref.kind === 'axis' && ref.key?.at && ref.key?.dir) {
    return { at: ref.key.at.slice(), dir: unit3(ref.key.dir) };
  }
  if (ref.kind === 'edge' && ref.key?.at && ref.key?.dir) {
    if (type === 'concentric') {
      const circle = ref.key.circle;
      if (!circle?.at || !circle?.dir) return null;
      return { at: circle.at.slice(), dir: unit3(circle.dir) };
    }
    return { at: ref.key.at.slice(), dir: unit3(ref.key.dir) };
  }
  return null;
}

function geom(poses, ref, type) {
  const local = localFrame(ref, type);
  if (!local || !poses.has(ref.part)) return null;
  return { part: ref.part, ...worldGeom(poses.get(ref.part), local) };
}

function pushScalar(rows, jac, freeIndex, value, partials) {
  const n = freeIndex.size * 6;
  const row = new Array(n).fill(0);
  for (const part of partials) {
    const col = freeIndex.get(part.part);
    if (col == null) continue;
    const base = col * 6;
    row[base] += part.w[0];
    row[base + 1] += part.w[1];
    row[base + 2] += part.w[2];
    row[base + 3] += part.t[0];
    row[base + 4] += part.t[1];
    row[base + 5] += part.t[2];
  }
  rows.push(value);
  jac.push(row);
}

function pushKept(rows, jac, freeIndex, vec, derivs, drop) {
  for (let k = 0; k < 3; k++) {
    if (k === drop) continue;
    const partials = [];
    for (const [part, d] of derivs) {
      partials.push({
        part,
        w: [d.w[k][0], d.w[k][1], d.w[k][2]],
        t: [d.t[k][0], d.t[k][1], d.t[k][2]],
      });
    }
    pushScalar(rows, jac, freeIndex, vec[k], partials);
  }
}

function planePartials(A, B, delta) {
  return [
    {
      part: A.part,
      w: add3(vecTMat(A.dir, scaleMat(A.dAt, -1)), vecTMat(delta, A.dDir)),
      t: scale3(A.dir, -1),
    },
    {
      part: B.part,
      w: vecTMat(A.dir, B.dAt),
      t: A.dir.slice(),
    },
  ];
}

/**
 * Center plane of two faces on one part.
 * The normal is the angle bisector (the second normal is flipped when the
 * faces look opposite ways). The point is the midpoint of the two centers.
 */
function centerPlane(g1, g2) {
  const s = dot3(g1.dir, g2.dir) >= 0 ? 1 : -1;
  const raw = add3(g1.dir, scale3(g2.dir, s));
  const len = Math.hypot(raw[0], raw[1], raw[2]);
  const dir = len > 1e-12 ? scale3(raw, 1 / len) : g1.dir.slice();
  const dRaw = addMat(g1.dDir, scaleMat(g2.dDir, s));
  const along = vecTMat(dir, dRaw);
  const outer = [
    [dir[0] * along[0], dir[0] * along[1], dir[0] * along[2]],
    [dir[1] * along[0], dir[1] * along[1], dir[1] * along[2]],
    [dir[2] * along[0], dir[2] * along[1], dir[2] * along[2]],
  ];
  const dDir = len > 1e-12
    ? scaleMat(addMat(dRaw, scaleMat(outer, -1)), 1 / len)
    : g1.dDir;
  return {
    part: g1.part,
    at: scale3(add3(g1.at, g2.at), 0.5),
    dir,
    dAt: scaleMat(addMat(g1.dAt, g2.dAt), 0.5),
    dDir,
  };
}

function directionCross(A, B, scale) {
  const vec = scale3(cross3(A.dir, B.dir), scale);
  const dA = scaleMat(mulMat(scaleMat(skew(B.dir), -1), A.dDir), scale);
  const dB = scaleMat(mulMat(skew(A.dir), B.dDir), scale);
  return {
    vec,
    derivs: [
      [A.part, { w: dA, t: ZERO }],
      [B.part, { w: dB, t: ZERO }],
    ],
  };
}

/**
 * Residual rows and Jacobian for one pack of joints.
 * `drops[i]` is the frozen component index for that joint, or null.
 */
export function evaluateJoints(joints, poses, freeIndex, drops) {
  const rows = [];
  const jac = [];
  joints.forEach((joint, i) => {
    if (joint.type === 'fixed') return;
    const drop = drops[i];
    if (joint.type === 'symmetric') {
      const A1 = geom(poses, joint.a, joint.type);
      const A2 = geom(poses, joint.a2, joint.type);
      const B1 = geom(poses, joint.b, joint.type);
      const B2 = geom(poses, joint.b2, joint.type);
      if (!A1 || !A2 || !B1 || !B2) return;
      const A = centerPlane(A1, A2);
      const B = centerPlane(B1, B2);
      const align = dot3(A.dir, B.dir) >= 0 ? 1 : -1;
      const crossed = directionCross(A, B, align);
      pushKept(rows, jac, freeIndex, crossed.vec, crossed.derivs, drop);
      const delta = sub3(B.at, A.at);
      pushScalar(rows, jac, freeIndex, dot3(delta, A.dir), planePartials(A, B, delta));
      return;
    }
    const A = geom(poses, joint.a, joint.type);
    const B = geom(poses, joint.b, joint.type);
    if (!A || !B) return;
    if (joint.type === 'coincident') {
      const plus = joint.opposed === false ? -1 : 1;
      const s = add3(A.dir, scale3(B.dir, plus));
      pushKept(rows, jac, freeIndex, s, [
        [A.part, { w: A.dDir, t: ZERO }],
        [B.part, { w: scaleMat(B.dDir, plus), t: ZERO }],
      ], drop);
      const delta = sub3(B.at, A.at);
      pushScalar(rows, jac, freeIndex, dot3(delta, A.dir), planePartials(A, B, delta));
      return;
    }
    if (joint.type === 'concentric') {
      const align = dot3(A.dir, B.dir) >= 0 ? 1 : -1;
      const crossed = directionCross(A, B, align);
      pushKept(rows, jac, freeIndex, crossed.vec, crossed.derivs, drop);
      const delta = sub3(B.at, A.at);
      const radial = cross3(delta, A.dir);
      const dA = addMat(mulMat(skew(A.dir), A.dAt), mulMat(skew(delta), A.dDir));
      const dB = mulMat(scaleMat(skew(A.dir), -1), B.dAt);
      pushKept(rows, jac, freeIndex, radial, [
        [A.part, { w: dA, t: skew(A.dir) }],
        [B.part, { w: dB, t: scaleMat(skew(A.dir), -1) }],
      ], drop);
      return;
    }
    if (joint.type === 'distance') {
      const crossed = directionCross(A, B, 1);
      pushKept(rows, jac, freeIndex, crossed.vec, crossed.derivs, drop);
      const delta = sub3(B.at, A.at);
      const gap = dot3(delta, A.dir) - joint.sense * joint.value;
      pushScalar(rows, jac, freeIndex, gap, planePartials(A, B, delta));
      return;
    }
    if (joint.type === 'angle') {
      const wanted = wantedAlignment(joint);
      if (wanted !== 0) {
        // Parallel: dir_b = wanted · dirₐ. Linear rows, like coincident.
        const plus = -wanted;
        const s = add3(A.dir, scale3(B.dir, plus));
        pushKept(rows, jac, freeIndex, s, [
          [A.part, { w: A.dDir, t: ZERO }],
          [B.part, { w: scaleMat(B.dDir, plus), t: ZERO }],
        ], drop);
        return;
      }
      const theta = joint.value * Math.PI / 180;
      const value = joint.sense * dot3(A.dir, B.dir) - Math.cos(theta);
      pushScalar(rows, jac, freeIndex, value, [
        { part: A.part, w: scale3(vecTMat(B.dir, A.dDir), joint.sense), t: [0, 0, 0] },
        { part: B.part, w: scale3(vecTMat(A.dir, B.dDir), joint.sense), t: [0, 0, 0] },
      ]);
    }
  });
  return { residual: rows, jacobian: jac };
}

/** Frozen row choice from the seed pose, so finite differences see the same rows. */
export function seedDrops(joints, seedPoses) {
  return joints.map((joint) => {
    if (joint.type === 'fixed') return null;
    if (joint.type === 'angle' && wantedAlignment(joint) === 0) return null;
    if (joint.type === 'symmetric') {
      const pose = seedPoses.get(joint.a?.part);
      const first = localFrame(joint.a, joint.type);
      const second = localFrame(joint.a2, joint.type);
      if (!pose || !first || !second) return 0;
      const seed = { ...pose, omega: [0, 0, 0] };
      const plane = centerPlane(
        { part: joint.a.part, ...worldGeom(seed, first) },
        { part: joint.a.part, ...worldGeom(seed, second) },
      );
      return dropIndex(plane.dir);
    }
    const local = localFrame(joint.a, joint.type);
    const pose = seedPoses.get(joint.a?.part);
    if (!local || !pose) return 0;
    return dropIndex(worldGeom({ ...pose, omega: [0, 0, 0] }, local).dir);
  });
}
