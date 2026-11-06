// STEP text for tests and goldens, written by the app's own exporters so no
// third-party sample file is committed. Not imported by the app.

import { brepToStep, meshToStep } from '../utils/sheetMetal/stepExport.js';

const TIMESTAMP = '2026-01-01T00:00:00';

/** A faceted box, min corner at the origin. Six planar faces. */
export function boxStepText(size = [20, 20, 40]) {
  const [x, y, z] = size;
  const vertProperties = new Float32Array([
    0, 0, 0, x, 0, 0, x, y, 0, 0, y, 0,
    0, 0, z, x, 0, z, x, y, z, 0, y, z,
  ]);
  const triVerts = new Uint32Array([
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ]);
  return meshToStep({ numProp: 3, vertProperties, triVerts }, { name: 'box', timestamp: TIMESTAMP }).text;
}

/**
 * An exact cylinder along +Z with its base at the origin: two planar caps and
 * one cylindrical face with a seam. The curved face is what the tessellator
 * has to mesh, so the volume depends on the deflection.
 */
export function cylinderStepText(radius = 10, height = 20) {
  const brep = {
    vertices: [[radius, 0, 0], [radius, 0, height]],
    edges: [
      { v1: 0, v2: 0, curve: { type: 'circle', center: [0, 0, 0], axis: [0, 0, 1], ref: [1, 0, 0], radius } },
      { v1: 1, v2: 1, curve: { type: 'circle', center: [0, 0, height], axis: [0, 0, 1], ref: [1, 0, 0], radius } },
      { v1: 0, v2: 1, curve: { type: 'line' } },
    ],
    faces: [
      {
        surface: { type: 'plane', origin: [0, 0, 0], axis: [0, 0, -1], ref: [1, 0, 0] },
        sameSense: true,
        loops: [[{ edge: 0, forward: false }]],
      },
      {
        surface: { type: 'plane', origin: [0, 0, height], axis: [0, 0, 1], ref: [1, 0, 0] },
        sameSense: true,
        loops: [[{ edge: 1, forward: true }]],
      },
      {
        surface: { type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], ref: [1, 0, 0], radius },
        sameSense: true,
        loops: [[
          { edge: 0, forward: true },
          { edge: 2, forward: true },
          { edge: 1, forward: false },
          { edge: 2, forward: false },
        ]],
      },
    ],
  };
  return brepToStep(brep, { name: 'cylinder', timestamp: TIMESTAMP }).text;
}

/** Signed volume of a closed triangle soup. Welding is not needed for this. */
export function soupVolume(vertProperties, triVerts) {
  let six = 0;
  for (let i = 0; i < triVerts.length; i += 3) {
    const a = triVerts[i] * 3;
    const b = triVerts[i + 1] * 3;
    const c = triVerts[i + 2] * 3;
    const ax = vertProperties[a], ay = vertProperties[a + 1], az = vertProperties[a + 2];
    const bx = vertProperties[b], by = vertProperties[b + 1], bz = vertProperties[b + 2];
    const cx = vertProperties[c], cy = vertProperties[c + 1], cz = vertProperties[c + 2];
    six += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return six / 6;
}

export function soupBounds(vertProperties) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertProperties.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      const v = vertProperties[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}
