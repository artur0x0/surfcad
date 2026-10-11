// Screen-space sketch strokes. WebGL drops LineBasicMaterial widths above 1px,
// which is what made contour wires and dots disappear on a phone.
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/** CSS pixels. A bit above the old 1px stroke. */
export const SKETCH_LINE_PX = 3;
/** CSS-pixel diameter of a sketch point. The mesh radius stays in world units. */
export const SKETCH_POINT_PX = 8;
export const SKETCH_POINT_RADIUS = 0.45;

/**
 * Mesh scale that makes a sphere of `SKETCH_POINT_RADIUS` read as
 * `SKETCH_POINT_PX` across on screen.
 */
export function sketchPointScaleFromDistance(distance, fovDeg, viewHeight, zoom = 1) {
  const dist = Math.max(1e-3, Number(distance) || 0);
  const height = Math.max(1, Number(viewHeight) || 0);
  const z = Number(zoom) > 0 ? Number(zoom) : 1;
  const fov = (Number(fovDeg) || 45) * Math.PI / 180;
  const worldPerPx = (2 * Math.tan(fov / 2) * dist) / (height * z);
  return (worldPerPx * (SKETCH_POINT_PX / 2)) / SKETCH_POINT_RADIUS;
}

/**
 * One screen-space polyline. `flat` is xyz triples. The caller closes a loop
 * by repeating the first point.
 */
export function makeSketchLine(flat, {
  color = 0xffffff,
  opacity = 0.95,
  linewidth = SKETCH_LINE_PX,
  resolution = null,
  dashed = false,
  dashSize = 1.6,
  gapSize = 1.1,
  renderOrder = 15,
} = {}) {
  const geom = new LineGeometry();
  geom.setPositions(flat);
  const mat = new LineMaterial({
    color,
    linewidth,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    dashed,
    dashSize,
    gapSize,
  });
  if (resolution?.x && resolution?.y) mat.resolution.set(resolution.x, resolution.y);
  const line = new Line2(geom, mat);
  if (dashed) line.computeLineDistances();
  line.renderOrder = renderOrder;
  line.frustumCulled = false;
  line.raycast = () => {};
  line.userData.sketchLinePx = linewidth;
  line.userData.sketchDashed = !!dashed;
  return line;
}
