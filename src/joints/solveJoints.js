/**
 * Solve assembly joints from the current placements.
 *
 * A broken joint is not in the system. Success is every residual under
 * 1e-3 (millimetres on a gap, radians on a direction). A conflict names
 * the newest joint whose removal makes the rest succeed, and every
 * placement stays at the seed. Nothing here deletes a joint or edits a script.
 */
import { solveResiduals } from '../solver/residual.js';
import { partSurfId } from '../utils/git/surfId.js';
import { jointRefs } from '../utils/jointSchema.js';
import { evaluateJoints, localFrame, seedDrops, wantedAlignment } from './equations.js';
import {
  add3,
  cross3,
  dot3,
  mulQuat,
  normalizeQuat,
  quatFromOmega,
  rotateByQuat,
  scale3,
  sub3,
  unit3,
} from './rigid.js';

export const JOINT_TOL = 1e-3;

function partId(part) {
  return partSurfId(part) || part?.surfId || part?.id || null;
}

function seedPose(part) {
  const raw = part?.placement;
  const t = Array.isArray(raw?.t) && raw.t.length >= 3
    ? [Number(raw.t[0]), Number(raw.t[1]), Number(raw.t[2])]
    : [0, 0, 0];
  const q = Array.isArray(raw?.q) && raw.q.length === 4
    ? normalizeQuat(raw.q.map(Number))
    : [0, 0, 0, 1];
  return { t, q };
}

function isBroken(joint) {
  return joint?.broken === true || joint?.status === 'broken';
}

function hasFrame(joint) {
  const refs = jointRefs(joint);
  if (joint.type === 'fixed') return !!refs[0]?.part;
  if (joint.type === 'symmetric') return refs.length === 4 && refs.every((ref) => localFrame(ref, joint.type));
  return refs.length === 2 && refs.every((ref) => localFrame(ref, joint.type));
}

function posesAt(seeds, freeIds, x) {
  const poses = new Map();
  for (const [id, seed] of seeds) {
    poses.set(id, { t: seed.t.slice(), q: seed.q.slice(), omega: [0, 0, 0] });
  }
  freeIds.forEach((id, index) => {
    const base = index * 6;
    const omega = [x[base], x[base + 1], x[base + 2]];
    const dt = [x[base + 3], x[base + 4], x[base + 5]];
    const seed = seeds.get(id);
    poses.set(id, {
      omega,
      t: add3(seed.t, dt),
      q: normalizeQuat(mulQuat(quatFromOmega(omega), seed.q)),
    });
  });
  return poses;
}

function placementMap(poses) {
  const out = {};
  for (const [id, pose] of poses) {
    out[id] = { t: pose.t.slice(), q: normalizeQuat(pose.q) };
  }
  return out;
}

function freeIdsOf(joints, seeds) {
  const fixed = new Set();
  const named = new Set();
  for (const joint of joints) {
    for (const ref of jointRefs(joint)) {
      if (ref?.part) named.add(ref.part);
    }
    if (joint.type === 'fixed' && joint.a?.part) fixed.add(joint.a.part);
  }
  return [...named].filter((id) => seeds.has(id) && !fixed.has(id)).sort();
}

function worldDir(pose, local) {
  return rotateByQuat(pose.q, local.dir);
}

function worldAt(pose, local) {
  return add3(rotateByQuat(pose.q, local.at), pose.t);
}

/**
 * Turn `pose` half a turn about an axis across `dir` through `pivot`, so
 * the face at the pivot stays where it is and faces the other way.
 */
function flipPose(pose, dir, pivot) {
  const helper = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const axis = unit3(cross3(dir, helper));
  const q = quatFromOmega(scale3(axis, Math.PI));
  const t = add3(pivot, rotateByQuat(q, sub3(pose.t, pivot)));
  return { t, q: normalizeQuat(mulQuat(q, pose.q)) };
}

/**
 * Settle the direction sign before the solve. The parallel rows of
 * coincident and of angle 0° / 180° are satisfied either way round, so a
 * part that starts the wrong way round would otherwise be reported as
 * solved as it is (`opposed` ignored), or, off parallel, be pulled to the
 * nearer, wrong side. Flip the free part's seed half a turn about its own
 * reference, then the rows pull it to the orientation the joint asks for.
 * A seed is flipped at most once; a later joint on that part sees the
 * flipped seed.
 */
export function orientSeeds(seeds, freeIds, joints) {
  const free = new Set(freeIds);
  const flipped = new Set();
  for (const joint of joints || []) {
    const wanted = wantedAlignment(joint);
    if (wanted === 0) continue;
    const localA = localFrame(joint.a, joint.type);
    const localB = localFrame(joint.b, joint.type);
    const poseA = seeds.get(joint.a?.part);
    const poseB = seeds.get(joint.b?.part);
    if (!localA || !localB || !poseA || !poseB) continue;
    const dirA = worldDir(poseA, localA);
    const dirB = worldDir(poseB, localB);
    if (dot3(dirA, dirB) * wanted >= 0) continue;
    if (free.has(joint.b.part) && !flipped.has(joint.b.part)) {
      seeds.set(joint.b.part, flipPose(poseB, dirB, worldAt(poseB, localB)));
      flipped.add(joint.b.part);
    } else if (free.has(joint.a.part) && !flipped.has(joint.a.part)) {
      seeds.set(joint.a.part, flipPose(poseA, dirA, worldAt(poseA, localA)));
      flipped.add(joint.a.part);
    }
  }
  return seeds;
}

/**
 * Residual and analytic Jacobian for `joints` on `parts`.
 * The unknown is six numbers per free part, packed [ωx, ωy, ωz, Δtx, Δty, Δtz],
 * in surf-id order. x = 0 is the seed placement.
 */
export function jointSystem(parts, joints) {
  const seeds = new Map();
  for (const part of parts || []) seeds.set(partId(part), seedPose(part));
  const freeIds = freeIdsOf(joints, seeds);
  orientSeeds(seeds, freeIds, joints);
  const freeIndex = new Map(freeIds.map((id, i) => [id, i]));
  const drops = seedDrops(joints, seeds);
  const n = freeIds.length * 6;
  const residual = (x) => evaluateJoints(joints, posesAt(seeds, freeIds, x), freeIndex, drops).residual;
  const jacobian = (x) => evaluateJoints(joints, posesAt(seeds, freeIds, x), freeIndex, drops).jacobian;
  return { n, residual, jacobian, freeIds, seeds };
}

// A radian is weighted like this many millimetres. The lever arm of two
// parts sitting tens or hundreds of millimetres apart would otherwise
// tilt both midplanes onto a diagonal instead of sliding the gap closed.
// An angle joint still rotates: no translation can satisfy it.
const ROTATION_WEIGHT_MM = 1000;

function solveOnce(parts, joints) {
  const system = jointSystem(parts, joints);
  const nFree = system.freeIds.length;
  const unweight = (x) => {
    const out = x.slice();
    for (let i = 0; i < nFree; i++) {
      out[i * 6] /= ROTATION_WEIGHT_MM;
      out[i * 6 + 1] /= ROTATION_WEIGHT_MM;
      out[i * 6 + 2] /= ROTATION_WEIGHT_MM;
    }
    return out;
  };
  const solvedWeighted = solveResiduals({
    n: system.n,
    residual: (x) => system.residual(unweight(x)),
    jacobian: (x) => system.jacobian(unweight(x)).map((row) => row.map((value, col) => (
      col % 6 < 3 ? value / ROTATION_WEIGHT_MM : value
    ))),
    x0: new Array(system.n).fill(0),
    tol: JOINT_TOL,
    maxIter: 80,
  });
  const solved = { ...solvedWeighted, x: unweight(solvedWeighted.x) };
  const poses = posesAt(system.seeds, system.freeIds, solved.x);
  return {
    solved,
    placements: placementMap(poses),
    maxResidual: solved.residual.reduce((m, v) => Math.max(m, Math.abs(v)), 0),
  };
}

function seedPlacements(parts) {
  const out = {};
  for (const part of parts || []) {
    const pose = seedPose(part);
    out[partId(part)] = pose;
  }
  return out;
}

/**
 * @returns {{
 *   ok: boolean,
 *   placements: Record<string, { t: number[], q: number[] }>,
 *   statuses: Record<string, 'ok' | 'broken' | 'conflict'>,
 *   message: string | null,
 *   residual: number,
 * }}
 */
export function solveJoints({ parts, joints }) {
  const statuses = {};
  const active = [];
  for (const joint of joints || []) {
    if (isBroken(joint) || !hasFrame(joint)) {
      statuses[joint.id] = 'broken';
      continue;
    }
    active.push(joint);
  }
  const seeds = seedPlacements(parts);
  const first = solveOnce(parts, active);
  if (first.solved.ok) {
    for (const joint of active) statuses[joint.id] = 'ok';
    return {
      ok: true,
      placements: first.placements,
      statuses,
      message: null,
      residual: first.maxResidual,
    };
  }
  for (let i = active.length - 1; i >= 0; i--) {
    const subset = active.filter((_, index) => index !== i);
    const trial = solveOnce(parts, subset);
    if (!trial.solved.ok) continue;
    const offender = active[i];
    for (const joint of active) statuses[joint.id] = joint === offender ? 'conflict' : 'ok';
    return {
      ok: false,
      placements: seeds,
      statuses,
      message: `Joint "${offender.name}" conflicts`,
      residual: first.maxResidual,
    };
  }
  const newest = active[active.length - 1];
  for (const joint of active) statuses[joint.id] = joint === newest ? 'conflict' : 'ok';
  const message = newest ? `Joint "${newest.name}" conflicts with more than one joint` : null;
  return {
    ok: false,
    placements: seeds,
    statuses,
    message,
    residual: first.maxResidual,
  };
}
