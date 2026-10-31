/**
 * Shared pull reference for core/cavity, side actions, and mold draft.
 * Auto searches. Plane uses an origin-plane normal. Face uses a picked
 * face normal. The sign is kept.
 */

export const MOLD_PULL_PLANES = Object.freeze({
  top: Object.freeze({ id: 'top', label: 'Top', normal: Object.freeze([0, 0, 1]) }),
  front: Object.freeze({ id: 'front', label: 'Front', normal: Object.freeze([0, 1, 0]) }),
  right: Object.freeze({ id: 'right', label: 'Right', normal: Object.freeze([1, 0, 0]) }),
});

export function unitPull(pull) {
  if (!Array.isArray(pull) || pull.length < 3) return null;
  const xyz = [Number(pull[0]), Number(pull[1]), Number(pull[2])];
  if (xyz.some((n) => !Number.isFinite(n))) return null;
  const length = Math.hypot(xyz[0], xyz[1], xyz[2]);
  if (!(length > 0)) return null;
  return [xyz[0] / length, xyz[1] / length, xyz[2] / length];
}

/** The override vector, or null when Auto should search. */
export function sharedPullVector(ref) {
  if (!ref || ref.mode === 'auto') return null;
  return unitPull(ref.pull);
}
