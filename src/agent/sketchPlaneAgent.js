/**
 * Plane card edits for agent plane_set / workplane_select.
 */

import { applyContourPlaneEdit, axisPresetFrame } from '../utils/contourMode.js';

export function planePatchFromArgs(state, args = {}, hostCenter) {
  if (!state) {
    return { error: { code: 'no_sketch', message: 'Contour sketch is not open' } };
  }
  const center = state.planeBase?.center
    || state.planeFace?.center
    || hostCenter
    || [0, 0, 0];
  const base = state.planeBase || axisPresetFrame(state.planePreset || 'z', center);
  const patch = {};
  if (args.preset === 'x' || args.preset === 'y' || args.preset === 'z') {
    patch.preset = args.preset;
    patch.base = axisPresetFrame(args.preset, center);
    patch.angles = { x: 0, y: 0, z: 0 };
  }
  if (args.angles && typeof args.angles === 'object') {
    patch.angles = args.angles;
    patch.base = base;
    patch.keepAngles = true;
  }
  if (args.offset != null) {
    patch.offset = Number(args.offset);
    patch.base = base;
    patch.angles = state.planeAngles || { x: 0, y: 0, z: 0 };
    patch.preset = state.planePreset;
    patch.keepAngles = true;
  }
  if (!Object.keys(patch).length) {
    return { error: { code: 'bad_args', message: 'plane_set needs preset, angles, or offset' } };
  }
  const next = applyContourPlaneEdit(state, patch);
  return { state: next };
}
