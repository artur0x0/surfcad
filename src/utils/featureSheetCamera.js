// Camera slide for the bottom feature card.
//
// On open, snapshot the full pose (position, target, up, quaternion, fov,
// near, far, zoom). Pan position and target together, the same way
// panViewByNdcY already does, just far enough that the selection or the
// part sits in the band above the card. Orbit and pinch stay enabled and
// are discarded on close: the camera tweens back to that snapshot, then
// TrackballControls is remounted so leftover damping cannot walk the pose
// off the snapshot along the new up vector.
//
// While the card is open, the orbit target moves to the world point at the
// current target's depth on the ray through the center of the pane above
// the card. A view offset keeps that point on that screen pixel, so
// Trackball's lookAt still rotates around the middle of the visible area.
// Close clears the offset with the snapshot.
import { Quaternion, Vector3 } from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { easeInOutCubic, panViewByNdcY } from './viewCamera.js';
import { applyTrackballFeel } from './trackballFeel.js';

export const FEATURE_SHEET_BAND_PAD = 0.06;
export const FEATURE_SHEET_SLIDE_MAX = 0.6;
export const FEATURE_SHEET_TWEEN_MS = 280;

const _v = new Vector3();
const _qa = new Quaternion();
const _qb = new Quaternion();
const _up = new Vector3();

/**
 * NDC delta for panViewByNdcY. Positive pan moves content DOWN.
 * A point under the card needs to go UP, so the result is ≤ 0.
 * Already in the clear band, or above it: 0. Magnitude is clamped.
 *
 * @param {number} pointNdcY  NDC y of the point that must clear the card (+1 top)
 * @param {number} cardFraction  pane fraction from the bottom edge up to the card top, 0..1
 */
export function featureSheetSlideNdc(pointNdcY, cardFraction) {
  const y = Number(pointNdcY);
  const f = Number(cardFraction);
  if (!Number.isFinite(y) || !Number.isFinite(f)) return 0;
  const frac = Math.min(0.95, Math.max(0, f));
  const bandBottom = -1 + 2 * frac + FEATURE_SHEET_BAND_PAD;
  const bandTop = 1 - FEATURE_SHEET_BAND_PAD;
  if (y >= bandBottom && y <= bandTop) return 0;
  if (y > bandTop) return 0;
  const delta = -(bandBottom - y);
  return Math.max(-FEATURE_SHEET_SLIDE_MAX, delta);
}

/** Lowest finite NDC y drives one slide, so a box clears, not only its center. */
export function featureSheetSlideForYs(ys, cardFraction) {
  let low = Infinity;
  for (const y of ys || []) {
    if (Number.isFinite(y) && y < low) low = y;
  }
  if (!Number.isFinite(low)) return 0;
  return featureSheetSlideNdc(low, cardFraction);
}

/**
 * Pan amount that puts the lowest projected point on the clear band.
 * A 1:1 NDC estimate is short when the point is farther than the target,
 * so this searches a cloned camera. Still clamped to 0.6. Does not mutate
 * the live camera.
 */
export function featureSheetClearanceNdc({
  camera,
  controls,
  points,
  cardFraction,
  max = FEATURE_SHEET_SLIDE_MAX,
} = {}) {
  if (!camera || !controls?.target || !points?.length) return 0;
  const frac = Number(cardFraction);
  if (!Number.isFinite(frac)) return 0;
  const limit = Math.min(FEATURE_SHEET_SLIDE_MAX, Math.max(0, Number(max) || 0));
  const band = -1 + 2 * Math.min(0.95, Math.max(0, frac)) + FEATURE_SHEET_BAND_PAD;
  const live = Math.min(...selectionNdcYs(camera, points));
  if (!Number.isFinite(live) || live >= band) return 0;

  const probe = camera.clone();
  const fake = {
    target: controls.target.clone(),
    update() {},
  };
  const lowAfter = (ndc) => {
    probe.copy(camera);
    fake.target.copy(controls.target);
    if (Math.abs(ndc) > 1e-8) panViewByNdcY({ camera: probe, controls: fake, ndcY: ndc });
    probe.lookAt(fake.target);
    probe.updateMatrixWorld(true);
    const ys = selectionNdcYs(probe, points);
    let low = Infinity;
    for (const y of ys) if (y < low) low = y;
    return low;
  };

  if (!(lowAfter(-limit) >= band)) return -limit;
  let lo = 0;
  let hi = limit;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (lowAfter(-mid) >= band) hi = mid;
    else lo = mid;
  }
  return -hi;
}

/** Project world points. Points behind the camera are skipped. */
export function selectionNdcYs(camera, points) {
  const ys = [];
  if (!camera || !points) return ys;
  for (const p of points) {
    if (!p) continue;
    _v.set(p.x, p.y, p.z).project(camera);
    if (_v.z <= 1 && Number.isFinite(_v.y)) ys.push(_v.y);
  }
  return ys;
}

/**
 * Eight corners of an axis-aligned box, in world units.
 * @param {{ min: number[], max: number[] }} box
 * @param {{ x: number, y: number, z: number }|null} offset
 */
export function boxCornerPoints(box, offset = null) {
  if (!box?.min || !box?.max) return [];
  const ox = offset?.x || 0;
  const oy = offset?.y || 0;
  const oz = offset?.z || 0;
  const pts = [];
  for (let i = 0; i < 8; i++) {
    pts.push(new Vector3(
      (i & 1 ? box.max[0] : box.min[0]) + ox,
      (i & 2 ? box.max[1] : box.min[1]) + oy,
      (i & 4 ? box.max[2] : box.min[2]) + oz,
    ));
  }
  return pts;
}

/**
 * Fraction of the pane from its bottom edge up to the card's top.
 * Includes whatever gap sits under the card. On a phone that gap is 0.
 */
export function featureSheetCoveredFraction(paneRect, cardRect) {
  const height = Number(paneRect?.height);
  const bottom = Number(paneRect?.bottom);
  const top = Number(cardRect?.top);
  if (!(height > 0) || !Number.isFinite(bottom) || !Number.isFinite(top)) return 0;
  return Math.min(0.95, Math.max(0, (bottom - top) / height));
}

/** NDC y of the card's top edge. The card covers [-1, cardTopNdc]. */
export function featureSheetCardTopNdc(cardFraction) {
  const f = Number(cardFraction);
  const frac = Number.isFinite(f) ? Math.min(0.95, Math.max(0, f)) : 0;
  return -1 + 2 * frac;
}

const _ndc = new Vector3();
const _point = new Vector3();
const _shift = new Vector3();

/**
 * NDC of the center of the pane region above the card.
 * x is the pane center. y is halfway from the pane top to the card top.
 * +y is up, matching `Vector3.project`.
 */
export function visibleCenterNdc(paneRect, cardRect) {
  const width = Number(paneRect?.width);
  const height = Number(paneRect?.height);
  const top = Number(paneRect?.top);
  if (!(width > 0) || !(height > 0) || !Number.isFinite(top)) return null;
  const paneBottom = Number.isFinite(Number(paneRect.bottom))
    ? Number(paneRect.bottom)
    : top + height;
  const cardTop = Number(cardRect?.top);
  const cover = Number.isFinite(cardTop)
    ? Math.min(Math.max(cardTop, top), paneBottom)
    : paneBottom;
  const sy = Math.max(0, cover - top) / 2;
  return {
    x: 0,
    y: 1 - (sy / height) * 2,
  };
}

function readViewOffset(camera) {
  const view = camera?.view;
  if (!view?.enabled) return null;
  return {
    fullWidth: view.fullWidth,
    fullHeight: view.fullHeight,
    offsetX: view.offsetX,
    offsetY: view.offsetY,
    width: view.width,
    height: view.height,
  };
}

function applyPoseViewOffset(camera, offset) {
  if (!offset) {
    if (camera.view?.enabled && typeof camera.clearViewOffset === 'function') {
      camera.clearViewOffset();
    }
    return;
  }
  camera.setViewOffset(
    offset.fullWidth,
    offset.fullHeight,
    offset.offsetX,
    offset.offsetY,
    offset.width,
    offset.height,
  );
}

function lerpViewOffset(from, to, t) {
  if (!from && !to) return null;
  if (t >= 1) return to || null;
  if (t <= 0) return from || null;
  const base = to || from;
  const a = from || { offsetX: 0, offsetY: 0 };
  const b = to || { offsetX: 0, offsetY: 0 };
  return {
    fullWidth: base.fullWidth,
    fullHeight: base.fullHeight,
    width: base.width,
    height: base.height,
    offsetX: a.offsetX + (b.offsetX - a.offsetX) * t,
    offsetY: a.offsetY + (b.offsetY - a.offsetY) * t,
  };
}

/**
 * Point the orbit at the world point under the visible-area center, at the
 * current target's view depth. The camera shifts with the target so the
 * view direction stays, and a view offset puts that look axis on the
 * visible center. TrackballControls.update() can lookAt without jumping.
 * Idempotent. Does nothing when the rects are missing.
 */
export function aimOrbitAtVisibleCenter(camera, controls, paneRect, cardRect) {
  if (!camera?.isPerspectiveCamera || !controls?.target || !paneRect) return false;
  const ndc = visibleCenterNdc(paneRect, cardRect);
  if (!ndc) return false;
  const width = Number(paneRect.width);
  const height = Number(paneRect.height);
  if (!(width > 0) || !(height > 0)) return false;

  camera.updateMatrixWorld(true);
  _v.copy(controls.target).project(camera);
  if (!Number.isFinite(_v.z) || !Number.isFinite(_v.x) || !Number.isFinite(_v.y)) return false;

  _ndc.set(ndc.x, ndc.y, _v.z);
  _point.copy(_ndc).unproject(camera);
  if (!Number.isFinite(_point.x) || !Number.isFinite(_point.y) || !Number.isFinite(_point.z)) return false;

  _shift.copy(_point).sub(controls.target);
  camera.position.add(_shift);
  controls.target.copy(_point);
  camera.lookAt(controls.target);
  camera.updateMatrixWorld(true);

  const aspect = camera.aspect;
  if (Math.abs(ndc.x) > 1e-4 || Math.abs(ndc.y) > 1e-4) {
    camera.setViewOffset(width, height, -ndc.x * width / 2, ndc.y * height / 2, width, height);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  } else if (camera.view?.enabled) {
    camera.clearViewOffset();
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  return true;
}

export function captureViewPose(camera, controls) {
  return {
    position: camera.position.toArray(),
    up: camera.up.toArray(),
    quaternion: camera.quaternion.toArray(),
    target: controls.target.toArray(),
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
    zoom: camera.zoom,
    aspect: camera.aspect,
    viewOffset: readViewOffset(camera),
  };
}

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** True when two captured poses agree within epsilon (position, target, up, fov, zoom). */
export function posesMatch(a, b, eps = 1e-4) {
  if (!a || !b) return false;
  _qa.fromArray(a.quaternion);
  _qb.fromArray(b.quaternion);
  return dist3(a.position, b.position) <= eps
    && dist3(a.target, b.target) <= eps
    && dist3(a.up, b.up) <= eps
    && Math.abs(a.fov - b.fov) <= eps
    && Math.abs(a.near - b.near) <= eps
    && Math.abs(a.far - b.far) <= eps
    && Math.abs((a.zoom ?? 1) - (b.zoom ?? 1)) <= eps
    && Math.abs(_qa.angleTo(_qb)) <= 1e-3;
}

export function applyViewPose(camera, controls, pose) {
  camera.position.fromArray(pose.position);
  camera.up.fromArray(pose.up);
  camera.quaternion.fromArray(pose.quaternion);
  camera.fov = pose.fov;
  camera.near = pose.near;
  camera.far = pose.far;
  if (Number.isFinite(pose.zoom)) camera.zoom = pose.zoom;
  if (Number.isFinite(pose.aspect)) camera.aspect = pose.aspect;
  applyPoseViewOffset(camera, pose.viewOffset);
  camera.updateProjectionMatrix();
  if (controls?.target) controls.target.fromArray(pose.target);
  camera.lookAt(controls.target);
  camera.quaternion.fromArray(pose.quaternion);
  camera.updateMatrixWorld();
}

export function lerpPose(camera, controls, from, to, t) {
  const u = Math.min(1, Math.max(0, t));
  camera.position.set(
    from.position[0] + (to.position[0] - from.position[0]) * u,
    from.position[1] + (to.position[1] - from.position[1]) * u,
    from.position[2] + (to.position[2] - from.position[2]) * u,
  );
  _up.set(
    from.up[0] + (to.up[0] - from.up[0]) * u,
    from.up[1] + (to.up[1] - from.up[1]) * u,
    from.up[2] + (to.up[2] - from.up[2]) * u,
  );
  if (_up.lengthSq() > 1e-12) _up.normalize();
  camera.up.copy(_up);
  _qa.fromArray(from.quaternion);
  _qb.fromArray(to.quaternion);
  camera.quaternion.slerpQuaternions(_qa, _qb, u);
  if (controls?.target) {
    controls.target.set(
      from.target[0] + (to.target[0] - from.target[0]) * u,
      from.target[1] + (to.target[1] - from.target[1]) * u,
      from.target[2] + (to.target[2] - from.target[2]) * u,
    );
  }
  camera.fov = from.fov + (to.fov - from.fov) * u;
  camera.near = from.near + (to.near - from.near) * u;
  camera.far = from.far + (to.far - from.far) * u;
  if (Number.isFinite(from.zoom) && Number.isFinite(to.zoom)) {
    camera.zoom = from.zoom + (to.zoom - from.zoom) * u;
  }
  if (Number.isFinite(from.aspect) && Number.isFinite(to.aspect)) {
    camera.aspect = from.aspect + (to.aspect - from.aspect) * u;
  }
  applyPoseViewOffset(camera, lerpViewOffset(from.viewOffset, to.viewOffset, u));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/**
 * Fresh TrackballControls so a coasting drag cannot apply on the next update.
 * Public locks (noRotate / noPan / …) are copied. The camera and target are
 * already at the restored pose; the new controls adopt them.
 */
export function remountTrackball(camera, prev) {
  if (!camera || !prev?.domElement) return prev || null;
  const dom = prev.domElement;
  const target = prev.target.clone();
  const keep = {
    enabled: prev.enabled !== false,
    noRotate: !!prev.noRotate,
    noZoom: !!prev.noZoom,
    noPan: !!prev.noPan,
    noRoll: !!prev.noRoll,
    staticMoving: !!prev.staticMoving,
  };
  prev.dispose();
  const next = new TrackballControls(camera, dom);
  applyTrackballFeel(next);
  next.enabled = keep.enabled;
  next.noRotate = keep.noRotate;
  next.noZoom = keep.noZoom;
  next.noPan = keep.noPan;
  next.noRoll = keep.noRoll;
  next.staticMoving = keep.staticMoving;
  next.enableRotate = !keep.noRotate;
  next.target.copy(target);
  next.update();
  return next;
}

/**
 * One open sheet's camera. `slideBy` pans from the live pose (snapshot is
 * taken once). `restore` tweens back to that snapshot and remounts Trackball.
 * `abandon` drops the snapshot and leaves the live pose, so a later aim is
 * not pulled back when the card unmounts.
 *
 * `enabled` is read on every `slideBy`. While it returns false the session
 * takes no snapshot, pans nothing, and sets no view offset, so `restore` is
 * a no-op: the camera is left exactly where the user had it. Viewport passes
 * the mobile-layout flag here, because the slide exists only for the phone
 * bottom sheet, where the card covers the part and its faces and edges. On
 * desktop the card sits in the pane with room above it and the model must
 * stay put when a card opens or closes.
 */
export function createSheetCameraSession({
  getCamera,
  getControls,
  setControls,
  remountControls = remountTrackball,
  reducedMotion = () => false,
  enabled = () => true,
  flattenLift = () => {},
  now = () => performance.now(),
  requestFrame = (fn) => requestAnimationFrame(fn),
  cancelFrame = (id) => cancelAnimationFrame(id),
  tweenMs = FEATURE_SHEET_TWEEN_MS,
  getVisibleFrame = null,
} = {}) {
  let snapshot = null;
  let generation = 0;
  let restoring = false;
  let frame = 0;

  function cancelTween() {
    generation += 1;
    if (frame) {
      cancelFrame(frame);
      frame = 0;
    }
  }

  function aimIfOpen() {
    if (restoring || !snapshot) return;
    const frame = getVisibleFrame?.();
    if (!frame?.paneRect) return;
    const camera = getCamera?.();
    const controls = getControls?.();
    if (!camera || !controls?.target) return;
    aimOrbitAtVisibleCenter(camera, controls, frame.paneRect, frame.cardRect);
  }

  function runTween(step, done) {
    const gen = generation;
    const reduced = reducedMotion() === true;
    if (reduced) {
      step(1);
      if (gen === generation) done();
      return;
    }
    const t0 = now();
    const ms = Math.max(0, Number(tweenMs) || FEATURE_SHEET_TWEEN_MS);
    const tick = (tNow) => {
      if (gen !== generation) return;
      const t = ms <= 0 ? 1 : Math.min(1, (tNow - t0) / ms);
      step(easeInOutCubic(t));
      if (t < 1) frame = requestFrame(tick);
      else {
        frame = 0;
        if (gen === generation) done();
      }
    };
    frame = requestFrame(tick);
  }

  return {
    isRestoring: () => restoring,
    /** True when a slide would move the camera (the mobile bottom-sheet layout). */
    isEnabled: () => enabled() === true,
    hasSnapshot: () => snapshot != null,
    snapshotPose: () => (snapshot ? { ...snapshot, position: snapshot.position.slice() } : null),
    /**
     * Pan by `ndcDelta` from the current pose. The first call snapshots
     * after flattening any legacy under-title NDC lift.
     */
    slideBy(ndcDelta) {
      // Desktop: the card never owns the camera. No snapshot, no pan, no offset.
      if (enabled() !== true) return false;
      const camera = getCamera?.();
      const controls = getControls?.();
      if (!camera || !controls?.target) return false;
      cancelTween();
      restoring = false;
      if (!snapshot) {
        flattenLift();
        snapshot = captureViewPose(getCamera(), getControls());
      }
      const delta = Number(ndcDelta) || 0;
      if (Math.abs(delta) < 1e-6) {
        aimIfOpen();
        return true;
      }
      let applied = 0;
      runTween((t) => {
        const cam = getCamera();
        const ctl = getControls();
        if (!cam || !ctl) return;
        const want = delta * t;
        const slice = want - applied;
        if (Math.abs(slice) > 1e-8) {
          panViewByNdcY({ camera: cam, controls: ctl, ndcY: slice });
          applied = want;
        }
      }, () => { aimIfOpen(); });
      return true;
    },
    /** Tween to the pre-open pose. Orbit during the sheet is discarded. */
    restore() {
      const shot = snapshot;
      const camera = getCamera?.();
      const controls = getControls?.();
      if (!shot || !camera || !controls?.target) {
        snapshot = null;
        restoring = false;
        return false;
      }
      cancelTween();
      const from = captureViewPose(camera, controls);
      restoring = true;
      runTween((t) => {
        const cam = getCamera();
        const ctl = getControls();
        if (!cam || !ctl) return;
        if (t >= 1) applyViewPose(cam, ctl, shot);
        else lerpPose(cam, ctl, from, shot, t);
      }, () => {
        const cam = getCamera();
        const ctl = getControls();
        if (cam && ctl) {
          applyViewPose(cam, ctl, shot);
          const next = remountControls(cam, ctl);
          if (next && next !== ctl) {
            applyViewPose(cam, next, shot);
            setControls?.(next);
          }
        }
        snapshot = null;
        restoring = false;
      });
      return true;
    },
    /** Drop the snapshot. The live pose stays. A later restore is a no-op. */
    abandon() {
      cancelTween();
      snapshot = null;
      restoring = false;
      return true;
    },
  };
}
