/**
 * Rigid pose of one assembly part.
 *
 * `t` is millimetres. `q` is a unit quaternion [x, y, z, w]. Scale is 1.
 * The assembly-parts group stays at identity, so a mesh's matrixWorld is
 * this pose and a bonded study can read it after updateMatrixWorld(true).
 */
import { Euler, Quaternion, Vector3 } from 'three';

/** Intrinsic XYZ Euler angles in degrees (same order as three.js `Euler('XYZ')`). */
export const AGENT_EULER_ORDER = 'XYZ';

export const IDENTITY_QUATERNION = Object.freeze([0, 0, 0, 1]);
export const IDENTITY_PLACEMENT = Object.freeze({
  t: Object.freeze([0, 0, 0]),
  q: IDENTITY_QUATERNION,
});

export function quaternionIsIdentity(q, eps = 1e-8) {
  if (!Array.isArray(q) || q.length < 4) return true;
  const x = Number(q[0]);
  const y = Number(q[1]);
  const z = Number(q[2]);
  const w = Number(q[3]);
  if (![x, y, z, w].every(Number.isFinite)) return true;
  return Math.hypot(x, y, z) <= eps && Math.abs(Math.abs(w) - 1) <= eps;
}

/** `{ t, q }` from a placement, or from a translation with identity rotation. */
export function placementFrom(position, placement = null) {
  if (placement && Array.isArray(placement.t) && Array.isArray(placement.q)) {
    return {
      t: [Number(placement.t[0]) || 0, Number(placement.t[1]) || 0, Number(placement.t[2]) || 0],
      q: placement.q.map(Number),
    };
  }
  const p = Array.isArray(position) ? position : [0, 0, 0];
  return {
    t: [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0],
    q: IDENTITY_QUATERNION.slice(),
  };
}

/** Local point into the assembly frame. */
export function worldPoint(local, placement) {
  if (!local) return local;
  const pose = placementFrom(placement?.t, placement);
  const q = new Quaternion(pose.q[0] || 0, pose.q[1] || 0, pose.q[2] || 0, pose.q[3] ?? 1);
  const v = new Vector3(local[0], local[1], local[2]).applyQuaternion(q);
  return [v.x + pose.t[0], v.y + pose.t[1], v.z + pose.t[2]];
}

/** Assembly point back into the part frame. Direction vectors pass `t` of zero. */
export function localPoint(world, placement) {
  if (!world) return world;
  const pose = placementFrom(placement?.t, placement);
  const q = new Quaternion(pose.q[0] || 0, pose.q[1] || 0, pose.q[2] || 0, pose.q[3] ?? 1).invert();
  const v = new Vector3(world[0] - pose.t[0], world[1] - pose.t[1], world[2] - pose.t[2]).applyQuaternion(q);
  return [v.x, v.y, v.z];
}

/**
 * Write the pose onto a three.js object. Scale stays 1.
 * updateMatrixWorld(true) so matrixWorld is current in this turn.
 */
export function applyPartPose(object, placement) {
  if (!object?.position?.set) return object;
  const pose = placementFrom(placement?.t, placement);
  object.position.set(pose.t[0], pose.t[1], pose.t[2]);
  if (object.quaternion?.set) {
    object.quaternion.set(pose.q[0] || 0, pose.q[1] || 0, pose.q[2] || 0, pose.q[3] ?? 1);
  }
  if (object.scale?.set) object.scale.set(1, 1, 1);
  if (typeof object.updateMatrix === 'function') object.updateMatrix();
  if (typeof object.updateMatrixWorld === 'function') object.updateMatrixWorld(true);
  return object;
}

/**
 * Column-major matrixWorld, the same copy a bonded study takes from
 * feaPartFrame when the matrix is present.
 */
/** Unit quaternion [x, y, z, w] to intrinsic XYZ Euler degrees for agent tools. */
export function quaternionToEulerDegrees(q) {
  const quat = new Quaternion(
    Number(q?.[0]) || 0,
    Number(q?.[1]) || 0,
    Number(q?.[2]) || 0,
    Number(q?.[3]) ?? 1,
  );
  const euler = new Euler().setFromQuaternion(quat, AGENT_EULER_ORDER);
  const radToDeg = 180 / Math.PI;
  return [euler.x * radToDeg, euler.y * radToDeg, euler.z * radToDeg];
}

/** Intrinsic XYZ Euler degrees to a unit quaternion [x, y, z, w]. */
export function eulerDegreesToQuaternion(degrees) {
  if (!Array.isArray(degrees) || degrees.length < 3) return null;
  const x = Number(degrees[0]);
  const y = Number(degrees[1]);
  const z = Number(degrees[2]);
  if (![x, y, z].every(Number.isFinite)) return null;
  const degToRad = Math.PI / 180;
  const euler = new Euler(x * degToRad, y * degToRad, z * degToRad, AGENT_EULER_ORDER);
  const quat = new Quaternion().setFromEuler(euler);
  return [quat.x, quat.y, quat.z, quat.w];
}

export function frameElements(mesh) {
  if (typeof mesh?.updateMatrixWorld === 'function') mesh.updateMatrixWorld(true);
  const elements = mesh?.matrixWorld?.elements;
  if (!elements || elements.length < 16) return null;
  const matrix = new Array(16);
  for (let i = 0; i < 16; i += 1) matrix[i] = Number(elements[i]) || 0;
  return matrix;
}
