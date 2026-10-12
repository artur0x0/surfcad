// Camera aim after a face is picked as the contour sketch plane.
//
// The pose looks along the face's outward normal and frames that face, not
// the whole part. The highlight stays up during the tween and the caller
// clears it when the tween ends. Trackball is remounted at the end so
// damping cannot walk the pose back.
import { Box3, Vector3 } from 'three';
import { easeInOutCubic, fitView, meshWorldBox } from './viewCamera.js';
import {
  applyViewPose,
  captureViewPose,
  lerpPose,
  remountTrackball,
} from './featureSheetCamera.js';

export const FACE_SKETCH_TWEEN_MS = 320;
export const FACE_SKETCH_MARGIN = 1.15;

const _size = new Vector3();

/**
 * World box of the face highlight meshes. Empty when none qualify.
 * @param {Iterable<import('three').Object3D>} meshes
 * @returns {import('three').Box3|null}
 */
export function faceSketchBox(meshes) {
  const box = new Box3();
  let any = false;
  for (const mesh of meshes || []) {
    if (!mesh || (typeof mesh.updateWorldMatrix !== 'function')) continue;
    mesh.updateWorldMatrix(true, true);
    const next = new Box3().setFromObject(mesh);
    if (!next || next.isEmpty() || !Number.isFinite(next.min.x) || !Number.isFinite(next.max.z)) continue;
    if (!any) box.copy(next);
    else box.union(next);
    any = true;
  }
  if (!any) return null;
  box.getSize(_size);
  if (!(_size.lengthSq() > 1e-12)) return null;
  return box;
}

/**
 * World box of a part bounds record (`min` / `max` arrays). Empty when
 * the record is missing. Used when the sketch plane is not a highlighted face.
 * @param {{ min?: number[], max?: number[] }|null} bounds
 * @returns {import('three').Box3|null}
 */
export function boundsSketchBox(bounds) {
  const min = bounds?.min;
  const max = bounds?.max;
  if (!min || !max || min.length < 3 || max.length < 3) return null;
  const box = new Box3(
    new Vector3(Number(min[0]), Number(min[1]), Number(min[2])),
    new Vector3(Number(max[0]), Number(max[1]), Number(max[2])),
  );
  if (box.isEmpty() || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.z)) return null;
  box.getSize(_size);
  if (!(_size.lengthSq() > 1e-12)) return null;
  return box;
}

/**
 * Box the face-sketch aim frames.
 *
 * Select plane frames a highlighted face when one is up. Any other plane,
 * and Normal (`force`), frames the part. The part box is the mesh in world
 * space. Model bounds are local vertex limits: a placed part would be aimed
 * at the origin while the solid sits off to one side. In the top view that
 * +X placement lands on the left of the screen.
 *
 * @param {object} o
 * @param {boolean} [o.force] Normal to sketch: frame the part, not a face
 * @param {Iterable<import('three').Object3D>|import('three').Object3D|null} [o.highlightMeshes]
 * @param {import('three').Object3D|null} [o.partMesh]
 * @param {{ min?: number[], max?: number[] }|null} [o.bounds]
 * @returns {import('three').Box3|null}
 */
export function sketchAimBox({ force = false, highlightMeshes, partMesh, bounds } = {}) {
  const list = Array.isArray(highlightMeshes)
    ? highlightMeshes.filter(Boolean)
    : (highlightMeshes ? [highlightMeshes] : []);
  const faceMeshes = list.filter((mesh) => mesh.name === 'highlight');
  const highlighted = faceSketchBox(faceMeshes.length ? faceMeshes : list);
  const partBox = meshWorldBox(partMesh);
  if (force && partBox) return partBox;
  return highlighted || partBox || boundsSketchBox(bounds);
}

/**
 * Up hint for a camera that looks along `normal`.
 * A +Z face cannot use world +Z: that hint is parallel to the view, and
 * fitView then picks +X, rolling the sketch 90°. Screen right becomes
 * world −Y, so an in-plane Y error lands to the left of the finger.
 * Top and bottom match VIEW_PRESETS.
 * @param {number[]|null} normal unit view direction (target → camera)
 * @returns {number[]}
 */
export function sketchCameraUp(normal) {
  const z = Number(normal?.[2]) || 0;
  if (Math.abs(z) > 1 - 1e-6) return z > 0 ? [0, -1, 0] : [0, 1, 0];
  return [0, 0, 1];
}

/**
 * Pose that looks along `normal` (target → camera) and frames `box`.
 * The clone drops any feature-card view offset so the face is centered.
 * @returns {object|null}
 */
export function faceSketchPose({ camera, controls, box, normal, margin = FACE_SKETCH_MARGIN }) {
  if (!camera || !box || box.isEmpty()) return null;
  const n = Array.isArray(normal) ? normal : null;
  if (!n || n.length < 3) return null;
  const dir = new Vector3(Number(n[0]), Number(n[1]), Number(n[2]));
  if (!(dir.lengthSq() > 1e-12)) return null;
  dir.normalize();
  const clone = camera.clone();
  if (clone.view?.enabled && typeof clone.clearViewOffset === 'function') {
    const aspect = clone.aspect;
    clone.clearViewOffset();
    clone.aspect = aspect;
    clone.updateProjectionMatrix();
  }
  const fake = {
    target: controls?.target?.clone?.() || new Vector3(),
    update() { clone.lookAt(this.target); },
  };
  const ok = fitView({
    camera: clone,
    controls: fake,
    box,
    dir: [dir.x, dir.y, dir.z],
    up: sketchCameraUp([dir.x, dir.y, dir.z]),
    margin,
  });
  if (!ok) return null;
  return captureViewPose(clone, fake);
}

/**
 * Tween the live camera onto a face-sketch pose. A later aim cancels the
 * earlier finish. `prefers-reduced-motion` jumps, then finishes.
 */
export function createFaceSketchAim({
  getCamera,
  getControls,
  setControls,
  remountControls = remountTrackball,
  reducedMotion = () => false,
  now = () => performance.now(),
  requestFrame = (fn) => requestAnimationFrame(fn),
  cancelFrame = (id) => cancelAnimationFrame(id),
  tweenMs = FACE_SKETCH_TWEEN_MS,
  onDone = () => {},
} = {}) {
  let generation = 0;
  let animating = false;
  let frame = 0;

  function cancel() {
    generation += 1;
    animating = false;
    if (frame) {
      cancelFrame(frame);
      frame = 0;
    }
  }

  function aim({ box, normal, margin } = {}) {
    const camera = getCamera?.();
    const controls = getControls?.();
    if (!camera || !controls?.target) return false;
    const pose = faceSketchPose({ camera, controls, box, normal, margin });
    if (!pose) return false;
    generation += 1;
    const gen = generation;
    if (frame) {
      cancelFrame(frame);
      frame = 0;
    }
    animating = true;
    const from = captureViewPose(camera, controls);
    const started = now();
    const ms = Math.max(0, Number(tweenMs) || FACE_SKETCH_TWEEN_MS);
    const reduced = reducedMotion() === true;

    const step = (tNow) => {
      if (gen !== generation) return;
      const cam = getCamera?.();
      const ctl = getControls?.();
      if (!cam || !ctl?.target) {
        animating = false;
        frame = 0;
        return;
      }
      const raw = reduced || ms <= 0 ? 1 : Math.min(1, (tNow - started) / ms);
      const t = raw >= 1 ? 1 : easeInOutCubic(raw);
      if (t >= 1) applyViewPose(cam, ctl, pose);
      else lerpPose(cam, ctl, from, pose, t);
      if (t < 1) {
        frame = requestFrame(step);
        return;
      }
      frame = 0;
      const next = remountControls(cam, ctl);
      if (next && next !== ctl) {
        applyViewPose(cam, next, pose);
        setControls?.(next);
      }
      animating = false;
      if (gen === generation) onDone();
    };

    if (reduced) {
      step(started);
      return true;
    }
    frame = requestFrame(step);
    return true;
  }

  return {
    aim,
    cancel,
    isAnimating: () => animating,
  };
}
