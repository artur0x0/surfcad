// TrackballControls feel for the viewport orbit.
//
// three.js r161 defaults, read off TrackballControls: rotateSpeed 1, zoomSpeed 1.2,
// panSpeed 0.3, dynamicDampingFactor 0.2, staticMoving false. There is no
// enableDamping on TrackballControls. That flag belongs to OrbitControls, and
// assigning it does not change update().
//
// Vite dev mounts the app under React.StrictMode. The viewport init effect used
// to start a requestAnimationFrame loop and never cancel it, and it never called
// controls.dispose(). StrictMode runs the effect, runs cleanup, then runs the
// effect again, so development kept two loops. Both called update() on the
// controls instance that survived, because the loop read controlsRef.current.
// Production mounts once, so it ran the real single-update settings and felt
// slower: less rotation per pixel of drag, and a longer coast.
//
// update() applies the pointer delta and the damping step once per call.
// Rotation coasts with `_lastAngle *= Math.sqrt(1 - dynamicDampingFactor)`.
// Two default steps leave sqrt(0.8) * sqrt(0.8) = 0.8, which is sqrt(1 - 0.36).
// Zoom and pan consume `dynamicDampingFactor` of the leftover pointer delta on
// each call, so two 0.2 steps leave (1 - 0.2) ** 2 = 0.64 of the delta, and
// 1 - 0.64 is the same 0.36. Speeds are 2× the three.js defaults so one update
// is in the same ballpark as those two calls. Measured against the old dev
// double-update (see docs/performance.md).

const DEFAULT_ROTATE_SPEED = 1;
const DEFAULT_ZOOM_SPEED = 1.2;
const DEFAULT_PAN_SPEED = 0.3;

/** 2× TrackballControls' default rotateSpeed — touch drags on phones/tablets. */
export const TRACKBALL_TOUCH_ROTATE_SPEED = DEFAULT_ROTATE_SPEED * 2;

/** @deprecated alias for touch rotate speed */
export const TRACKBALL_ROTATE_SPEED = TRACKBALL_TOUCH_ROTATE_SPEED;

/**
 * Desktop mouse / pen / trackpad drag orbit. 1.5× touch so a short drag covers
 * more of the part without changing phone one-finger rotate.
 */
export const TRACKBALL_DESKTOP_ROTATE_SPEED = TRACKBALL_TOUCH_ROTATE_SPEED * 1.5;

/** 2× TrackballControls' default zoomSpeed. */
export const TRACKBALL_ZOOM_SPEED = DEFAULT_ZOOM_SPEED * 2;

/** 2× TrackballControls' default panSpeed. */
export const TRACKBALL_PAN_SPEED = DEFAULT_PAN_SPEED * 2;

/**
 * One damping step with the same per-frame decay as two default 0.2 steps.
 * 1 - (1 - 0.2) ** 2 = 0.36, and sqrt(1 - 0.36) = 0.8 = sqrt(0.8) ** 2.
 */
export const TRACKBALL_DYNAMIC_DAMPING_FACTOR = 0.36;

export function trackballRotateSpeedForPointer(pointerType) {
  if (pointerType === 'touch') return TRACKBALL_TOUCH_ROTATE_SPEED;
  return TRACKBALL_DESKTOP_ROTATE_SPEED;
}

export function applyTrackballFeel(controls) {
  controls.rotateSpeed = TRACKBALL_DESKTOP_ROTATE_SPEED;
  controls.zoomSpeed = TRACKBALL_ZOOM_SPEED;
  controls.panSpeed = TRACKBALL_PAN_SPEED;
  controls.dynamicDampingFactor = TRACKBALL_DYNAMIC_DAMPING_FACTOR;
}
