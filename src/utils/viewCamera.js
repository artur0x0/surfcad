// utils/viewCamera.js — camera framing shared by the UI (Zoom to Fit, view snaps) and
// the headless review harness, so a manual snap and an automated capture agree exactly.
//
// The app models parts in a Z-up world (sketches in XY, extruded along +Z), so the
// canonical view directions below are stated in that frame.
import { Vector3 } from 'three';

const DEG2RAD = Math.PI / 180;

/**
 * Canonical orthographic-style view directions.
 * dir = unit vector from the look-at target toward the camera.
 * up  = the camera's up hint; for TOP the view axis IS +Z, so up must not be +Z.
 */
export const VIEW_PRESETS = {
  iso: { dir: [1, 1, 1], up: [0, 0, 1], label: 'Isometric' },
  front: { dir: [0, -1, 0], up: [0, 0, 1], label: 'Front' },
  right: { dir: [1, 0, 0], up: [0, 0, 1], label: 'Right' },
  top: { dir: [0, 0, 1], up: [0, -1, 0], label: 'Top' },
  // Opposite faces, for reviewing the sides a part usually hides.
  back: { dir: [0, 1, 0], up: [0, 0, 1], label: 'Back' },
  left: { dir: [-1, 0, 0], up: [0, 0, 1], label: 'Left' },
  bottom: { dir: [0, 0, -1], up: [0, 1, 0], label: 'Bottom' },
};

/**
 * Mobile B.1 — default margin for view-snap presets (top / right / front / iso / …).
 * Larger than fitView's Zoom-to-Fit default (1.15) so the part has more breathing
 * room. Game puzzle enter/switch keeps its own explicit 1.55 framing.
 */
export const VIEW_SNAP_MARGIN = 1.35;

const EPS = 1e-9;

/**
 * World-space box of one part mesh. Hidden meshes are skipped. A sheet-metal
 * edit hides the solid while the overlay is the draft; that solid still counts.
 * @param {import('three').Object3D|null|undefined} mesh
 * @returns {import('three').Box3|null}
 */
export function meshWorldBox(mesh) {
  const geometry = mesh?.geometry;
  const count = geometry?.attributes?.position?.count || 0;
  if (!mesh || !count) return null;
  if (mesh.visible === false && mesh.userData?.sheetMetalHidden !== true) return null;
  mesh.updateWorldMatrix(true, false);
  geometry.computeBoundingBox();
  const local = geometry.boundingBox;
  if (!local || local.isEmpty() || !Number.isFinite(local.min.x) || !Number.isFinite(local.max.z)) return null;
  return local.clone().applyMatrix4(mesh.matrixWorld);
}

/**
 * Union of meshWorldBox() over the given meshes. Null when none qualify.
 * @param {Iterable<import('three').Object3D>} meshes
 * @returns {import('three').Box3|null}
 */
export function unionWorldBox(meshes) {
  let box = null;
  for (const mesh of meshes || []) {
    const next = meshWorldBox(mesh);
    if (!next) continue;
    if (!box) box = next;
    else box.union(next);
  }
  return box;
}

/**
 * Frame a geometry, or a world-space box, so it fills the viewport.
 *
 * Distance is solved exactly for the bounding box (not the bounding sphere), per
 * camera-space axis, so tall-thin and flat-wide parts both come out properly filled
 * instead of shrunken to their diagonal. Safe on empty/degenerate geometry: it
 * declines to fit and reports false rather than moving the camera to a NaN.
 * Pass `box` to frame several parts at once. Omit it to frame `geometry`.
 *
 * @param {Object} o
 * @param {import('three').PerspectiveCamera} o.camera
 * @param {import('three').TrackballControls} [o.controls]
 * @param {import('three').BufferGeometry} [o.geometry]
 * @param {import('three').Box3} [o.box]
 * @param {number[]} [o.dir]  view direction; omit to keep the current orientation
 * @param {number[]} [o.up]   camera up hint; omit to keep the current up
 * @param {number}   [o.margin=1.15] >1 leaves breathing room around the part
 * @returns {boolean} true when the camera was moved
 */
export function fitView({ camera, controls, geometry, box: boxArg, dir, up, margin = 1.15 }) {
  let box = boxArg || null;
  if (!box) {
    if (!camera || !geometry?.attributes?.position) return false;
    // Recompute every time: the mesh may have been replaced or edited since the last fit,
    // and a stale box silently frames the wrong volume.
    geometry.computeBoundingBox();
    box = geometry.boundingBox;
  }
  if (!camera || !box || box.isEmpty() || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.z)) return false;

  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  if (!(size.lengthSq() > EPS)) return false; // a single point has no frame

  // --- view direction: explicit preset, else the direction we are already looking ---
  let d = null;
  if (dir) {
    d = new Vector3(dir[0], dir[1], dir[2]);
  } else if (controls?.target) {
    d = camera.position.clone().sub(controls.target);
  }
  if (!d || d.lengthSq() < EPS) d = new Vector3(1, 1, 1);
  d.normalize();

  // --- up hint: explicit, else the camera's, re-squared against the view axis ---
  let u = up ? new Vector3(up[0], up[1], up[2]) : camera.up.clone();
  if (u.lengthSq() < EPS) u.set(0, 0, 1);
  if (Math.abs(u.dot(d)) > 1 - 1e-6) {
    // up parallel to the view axis is unusable; fall back to the world axis least aligned with it
    const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
    u = axes.reduce((best, a) => (Math.abs(a.dot(d)) < Math.abs(best.dot(d)) ? a : best), axes[0]).clone();
  }
  u.sub(d.clone().multiplyScalar(u.dot(d))).normalize();

  // --- camera basis (same construction as lookAt: z points at the eye) ---
  const zAxis = d.clone();
  const xAxis = new Vector3().crossVectors(u, zAxis).normalize();
  const yAxis = new Vector3().crossVectors(zAxis, xAxis);

  // --- half-angles of the frustum, including the horizontal one via aspect ---
  const fovY = (camera.fov || 45) * DEG2RAD;
  const tanY = Math.tan(fovY / 2) || 1e-6;
  const aspect = camera.aspect > 0 ? camera.aspect : 1;
  const tanX = tanY * aspect;

  // Two distances. `distOld` is the perpendicular size, as if every corner sat
  // on the plane through the box center. That is what a compact part has
  // always used, and the margin on it is unchanged. A corner closer to the
  // camera than the center projects wider than that plane predicts, so a
  // long assembly (two parts far apart) sticks out of the frame. `distExact`
  // is the eye distance that puts that corner on the frustum edge.
  let distOld = 0;
  let distExact = 0;
  const corner = new Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z
    ).sub(center);
    const px = Math.abs(corner.dot(xAxis)) / tanX;
    const py = Math.abs(corner.dot(yAxis)) / tanY;
    const pz = corner.dot(zAxis);
    distOld = Math.max(distOld, px, py);
    distExact = Math.max(distExact, pz + px, pz + py);
  }
  const marginFactor = Number.isFinite(margin) && margin > 0 ? margin : 1.15;
  let dist = (distOld || 1) * marginFactor;
  if (distExact > dist) dist = distExact * 1.02;
  if (!Number.isFinite(dist) || dist <= 0) return false;

  // --- commit. near/far bracket the part so it is never clipped or depth-starved ---
  camera.near = Math.max(dist / 1000, 1e-4);
  camera.far = Math.max(dist * 10, camera.far || 2000);
  camera.up.copy(u);
  camera.position.copy(center).addScaledVector(d, dist);
  camera.updateProjectionMatrix();
  camera.lookAt(center);

  if (controls) {
    controls.target.copy(center);
    controls.update(); // re-applies lookAt(target) using the up we just set
  }
  return true;
}

/**
 * Mobile C.2 — vertical pan of camera + OrbitControls target by an NDC-Y delta
 * (full viewport height = 2 in NDC). Same world delta on both keeps look direction.
 * Positive ndcY moves the view content DOWN on screen (camera/target pan UP along
 * the camera's up) — used when an under-title feature sheet covers the top.
 *
 * @param {Object} o
 * @param {import('three').PerspectiveCamera} o.camera
 * @param {{ target: import('three').Vector3, update?: Function }} o.controls
 * @param {number} o.ndcY  delta in NDC-Y units (0 = no move; ~0.2–0.5 typical)
 * @returns {boolean}
 */
export function panViewByNdcY({ camera, controls, ndcY }) {
  if (!camera || !controls?.target || !Number.isFinite(ndcY) || ndcY === 0) return false;
  const dist = camera.position.distanceTo(controls.target);
  if (!(dist > EPS)) return false;
  const fovY = ((camera.fov || 45) * DEG2RAD);
  const tanY = Math.tan(fovY / 2) || 1e-6;
  // NDC Y spans [-1, 1] = full height → world units per NDC = dist * tanY
  const world = ndcY * dist * tanY;
  if (!Number.isFinite(world) || world === 0) return false;

  // Camera up, re-squared against the view axis (same as fitView).
  const d = camera.position.clone().sub(controls.target);
  if (d.lengthSq() < EPS) return false;
  d.normalize();
  let u = camera.up.clone();
  if (u.lengthSq() < EPS) u.set(0, 0, 1);
  if (Math.abs(u.dot(d)) > 1 - 1e-6) {
    const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
    u = axes.reduce((best, a) => (Math.abs(a.dot(d)) < Math.abs(best.dot(d)) ? a : best), axes[0]).clone();
  }
  u.sub(d.clone().multiplyScalar(u.dot(d))).normalize();

  camera.position.addScaledVector(u, world);
  controls.target.addScaledVector(u, world);
  if (typeof controls.update === 'function') controls.update();
  return true;
}

/**
 * Ease in-out cubic for sheet lift tweens.
 * @param {number} t 0..1
 */
export function easeInOutCubic(t) {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2;
}

/**
 * Set camera pose explicitly (agent harness). At least one of position,
 * target, or fov must be provided. Returns false when nothing changed.
 */
export function applyCameraPose({ camera, controls, position, target, fov }) {
  if (!camera) return false;
  let changed = false;
  const fovNum = Number(fov);
  if (Number.isFinite(fovNum) && fovNum > 0 && fovNum < 180) {
    camera.fov = fovNum;
    camera.updateProjectionMatrix();
    changed = true;
  }
  if (Array.isArray(position) && position.length === 3
    && position.every((n) => Number.isFinite(Number(n)))) {
    camera.position.set(Number(position[0]), Number(position[1]), Number(position[2]));
    changed = true;
  }
  if (controls?.target && Array.isArray(target) && target.length === 3
    && target.every((n) => Number.isFinite(Number(n)))) {
    controls.target.set(Number(target[0]), Number(target[1]), Number(target[2]));
    camera.lookAt(controls.target);
    if (typeof controls.update === 'function') controls.update();
    changed = true;
  }
  return changed;
}

/**
 * Smooth camera pose for agent visible mode. Resolves when the tween finishes.
 * @param {{ camera: object, controls?: object, position?: number[], target?: number[], fov?: number, durationMs?: number, onFrame?: () => void }} opts
 */
export function animateCameraPose(opts) {
  const {
    camera,
    controls,
    position,
    target,
    fov,
    durationMs = 420,
    onFrame,
  } = opts || {};
  if (!camera) return Promise.resolve(false);
  const startPos = camera.position.clone();
  const endPos = Array.isArray(position) && position.length === 3
    && position.every((n) => Number.isFinite(Number(n)))
    ? { x: Number(position[0]), y: Number(position[1]), z: Number(position[2]) }
    : null;
  const hasTarget = controls?.target && Array.isArray(target) && target.length === 3
    && target.every((n) => Number.isFinite(Number(n)));
  const startTarget = hasTarget ? controls.target.clone() : null;
  const endTarget = hasTarget
    ? { x: Number(target[0]), y: Number(target[1]), z: Number(target[2]) }
    : null;
  const startFov = Number.isFinite(Number(camera.fov)) ? Number(camera.fov) : null;
  const endFov = Number.isFinite(Number(fov)) && Number(fov) > 0 && Number(fov) < 180
    ? Number(fov)
    : null;
  if (!endPos && !endTarget && endFov == null) return Promise.resolve(false);
  if (durationMs <= 0) {
    return Promise.resolve(applyCameraPose({ camera, controls, position, target, fov }));
  }
  const t0 = performance.now();
  return new Promise((resolve) => {
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / durationMs);
      const e = easeInOutCubic(t);
      if (endPos) {
        camera.position.set(
          startPos.x + (endPos.x - startPos.x) * e,
          startPos.y + (endPos.y - startPos.y) * e,
          startPos.z + (endPos.z - startPos.z) * e,
        );
      }
      if (endTarget && startTarget) {
        controls.target.set(
          startTarget.x + (endTarget.x - startTarget.x) * e,
          startTarget.y + (endTarget.y - startTarget.y) * e,
          startTarget.z + (endTarget.z - startTarget.z) * e,
        );
        camera.lookAt(controls.target);
      }
      if (endFov != null && startFov != null) {
        camera.fov = startFov + (endFov - startFov) * e;
        camera.updateProjectionMatrix();
      }
      if (typeof controls?.update === 'function') controls.update();
      if (typeof onFrame === 'function') onFrame();
      if (t < 1) requestAnimationFrame(tick);
      else resolve(true);
    };
    requestAnimationFrame(tick);
  });
}
