/**
 * Direction arrows for a Force or Pressure load.
 *
 * Normal and −N draw nothing. ±X/Y/Z and a custom vector draw a few arrows
 * on the loaded face, heads on the surface and tails offset back along the
 * load so the head is what touches. Length is a fraction of the part's
 * bounding box. The meshes are children of the face highlight, so the
 * highlight reconcile removes and disposes them.
 */

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { boundsFromGeometry } from '../utils/characteristicLength.js';

export const FEA_LOAD_ARROWS_NAME = 'fea-load-arrows';
export const FEA_LOAD_ARROW_NAME = 'fea-load-arrow';
/** Fraction of the part's longest side. */
export const LOAD_ARROW_LENGTH_SCALE = 0.2;
const HEAD_LENGTH_SCALE = 0.34;
const HEAD_RADIUS_SCALE = 0.16;
const SHAFT_RADIUS_SCALE = 0.055;
const PARALLEL = 0.999;

const AXIS = Object.freeze({
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
});

function unit(vector) {
  if (!vector || vector.length < 3) return null;
  const len = Math.hypot(vector[0], vector[1], vector[2]);
  if (!(len > 0)) return null;
  return [vector[0] / len, vector[1] / len, vector[2] / len];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function parallel(a, b) {
  const ua = unit(a);
  const ub = unit(b);
  if (!ua || !ub) return false;
  return Math.abs(dot(ua, ub)) >= PARALLEL;
}

/**
 * Unit direction to draw, or null when this load is Normal / −N.
 * An explicit `direction` wins. A legacy force with no label is Normal
 * when its vector lies on the face normal, and a custom direction otherwise.
 * Pressure is Normal unless it carries a non-normal direction.
 */
export function loadArrowDirection(load, face) {
  if (!load || (load.kind !== 'force' && load.kind !== 'pressure')) return null;
  const label = load.direction;
  if (label === 'normal' || label === '-normal') return null;
  if (label && AXIS[label]) return AXIS[label].slice();
  if (load.kind === 'pressure') return null;
  const along = unit(load.vector);
  if (!along) return null;
  if (!label && face && parallel(along, face.n)) return null;
  if (label === 'custom' && face && parallel(along, face.n)) return null;
  return along;
}

export function arrowLengthForBounds(bounds) {
  const size = bounds?.size;
  if (!size) return 0;
  let longest = 0;
  for (let i = 0; i < size.length; i += 1) {
    const value = Number(size[i]);
    if (value > longest) longest = value;
  }
  if (!(longest > 0)) return 0;
  return longest * LOAD_ARROW_LENGTH_SCALE;
}

/** 3 on a small face, up to 9 when the face spans the part. */
export function arrowCountForFace(faceArea, longest) {
  if (!(faceArea > 0) || !(longest > 0)) return 3;
  const span = Math.sqrt(faceArea) / longest;
  const count = Math.round(3 + span * 4);
  if (count < 3) return 3;
  if (count > 9) return 9;
  return count;
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function triangleArea(verts) {
  const ab = [
    verts[1][0] - verts[0][0],
    verts[1][1] - verts[0][1],
    verts[1][2] - verts[0][2],
  ];
  const ac = [
    verts[2][0] - verts[0][0],
    verts[2][1] - verts[0][1],
    verts[2][2] - verts[0][2],
  ];
  const n = cross(ab, ac);
  return 0.5 * Math.hypot(n[0], n[1], n[2]);
}

function bary(verts, w0, w1, w2) {
  return [
    verts[0][0] * w0 + verts[1][0] * w1 + verts[2][0] * w2,
    verts[0][1] * w0 + verts[1][1] * w1 + verts[2][1] * w2,
    verts[0][2] * w0 + verts[1][2] * w1 + verts[2][2] * w2,
  ];
}

const INTERIOR = Object.freeze([
  [1 / 3, 1 / 3, 1 / 3],
  [0.7, 0.15, 0.15],
  [0.15, 0.7, 0.15],
  [0.15, 0.15, 0.7],
]);

function readTriangles(geometry, triangleIndices) {
  const index = geometry?.index?.array;
  const positions = geometry?.attributes?.position?.array;
  if (!index?.length || !positions?.length || !triangleIndices?.length) return [];
  const triangles = [];
  for (let t = 0; t < triangleIndices.length; t += 1) {
    const base = triangleIndices[t] * 3;
    if (base < 0 || base + 2 >= index.length) continue;
    const verts = [];
    let ok = true;
    for (let k = 0; k < 3; k += 1) {
      const vertex = index[base + k] * 3;
      if (vertex < 0 || vertex + 2 >= positions.length) {
        ok = false;
        break;
      }
      verts.push([positions[vertex], positions[vertex + 1], positions[vertex + 2]]);
    }
    if (!ok) continue;
    const area = triangleArea(verts);
    if (!(area > 0)) continue;
    triangles.push({ verts, area });
  }
  return triangles;
}

function dist2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function pickSpread(samples, count) {
  if (!samples.length) return [];
  const wanted = Math.min(count, samples.length);
  let first = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i].area > samples[first].area) first = i;
  }
  const chosen = [first];
  const used = new Set([first]);
  while (chosen.length < wanted) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < samples.length; i += 1) {
      if (used.has(i)) continue;
      let nearest = Infinity;
      for (let c = 0; c < chosen.length; c += 1) {
        const distance = dist2(samples[i].point, samples[chosen[c]].point);
        if (distance < nearest) nearest = distance;
      }
      const score = nearest * (0.25 + samples[i].area);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    used.add(best);
    chosen.push(best);
  }
  return chosen.map((index) => samples[index]);
}

/**
 * 3 to 9 points spread over the face. A coarse face (a quad is two
 * triangles) is sampled inside each triangle, weighted by area. The tip
 * is the sample. The tail sits one arrow-length back along `direction`.
 */
export function faceArrowPlacements(geometry, triangleIndices, direction) {
  const dir = unit(direction);
  const bounds = boundsFromGeometry(geometry);
  const length = arrowLengthForBounds(bounds);
  if (!dir || !(length > 0)) return [];
  const triangles = readTriangles(geometry, triangleIndices);
  if (!triangles.length) return [];
  let faceArea = 0;
  for (let i = 0; i < triangles.length; i += 1) faceArea += triangles[i].area;
  const longest = length / LOAD_ARROW_LENGTH_SCALE;
  const count = arrowCountForFace(faceArea, longest);
  const weights = triangles.length >= 9 ? [INTERIOR[0]] : INTERIOR;
  const samples = [];
  for (let t = 0; t < triangles.length; t += 1) {
    const tri = triangles[t];
    for (let w = 0; w < weights.length; w += 1) {
      const weight = weights[w];
      samples.push({
        point: bary(tri.verts, weight[0], weight[1], weight[2]),
        area: tri.area,
      });
    }
  }
  const picked = pickSpread(samples, count);
  const headLength = length * HEAD_LENGTH_SCALE;
  const headRadius = length * HEAD_RADIUS_SCALE;
  const shaftRadius = length * SHAFT_RADIUS_SCALE;
  return picked.map((sample) => {
    const tip = sample.point;
    const tail = [
      tip[0] - dir[0] * length,
      tip[1] - dir[1] * length,
      tip[2] - dir[2] * length,
    ];
    return {
      tip,
      tail,
      dir: dir.slice(),
      length,
      headLength,
      headRadius,
      shaftRadius,
    };
  });
}

export function arrowPlacementKey(placements) {
  if (!placements?.length) return '0';
  const dir = placements[0].dir;
  let hash = placements.length;
  for (let i = 0; i < placements.length; i += 1) {
    const tip = placements[i].tip;
    hash ^= Math.round(tip[0] * 100);
    hash = Math.imul(hash, 16777619);
    hash ^= Math.round(tip[1] * 100);
    hash = Math.imul(hash, 16777619);
    hash ^= Math.round(tip[2] * 100);
    hash = Math.imul(hash, 16777619);
  }
  return `${placements.length}:${dir[0].toFixed(4)},${dir[1].toFixed(4)},${dir[2].toFixed(4)}:${placements[0].length.toFixed(3)}:${hash >>> 0}`;
}

function add(a, b, scale = 1) {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

function basis(dir) {
  const ref = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = unit(cross(dir, ref));
  const v = cross(dir, u);
  return { u, v };
}

function ring(center, radius, u, v, segments) {
  const points = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    points.push(add(add(center, u, radius * c), v, radius * s));
  }
  return points;
}

function pushTri(out, a, b, c) {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

function shaftPositions(placement) {
  const { tail, dir, headLength, shaftRadius } = placement;
  const base = add(placement.tip, dir, -headLength);
  const { u, v } = basis(dir);
  const segments = 8;
  const a = ring(tail, shaftRadius, u, v, segments);
  const b = ring(base, shaftRadius, u, v, segments);
  const out = [];
  for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    pushTri(out, a[i], b[i], b[j]);
    pushTri(out, a[i], b[j], a[j]);
  }
  return out;
}

function headPositions(placement) {
  const { tip, dir, headLength, headRadius } = placement;
  const base = add(tip, dir, -headLength);
  const { u, v } = basis(dir);
  const segments = 8;
  const ringPts = ring(base, headRadius, u, v, segments);
  const out = [];
  for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    pushTri(out, tip, ringPts[i], ringPts[j]);
    pushTri(out, base, ringPts[j], ringPts[i]);
  }
  return out;
}

function solid(positions, color) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  const mesh = new Mesh(geometry, new MeshBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.renderOrder = 8;
  return mesh;
}

function createOneArrow(placement, color) {
  const group = new Group();
  group.name = FEA_LOAD_ARROW_NAME;
  group.frustumCulled = false;
  group.raycast = () => {};
  group.renderOrder = 8;
  group.userData = {
    tip: placement.tip.slice(),
    tail: placement.tail.slice(),
    dir: placement.dir.slice(),
    length: placement.length,
  };
  const shaft = solid(shaftPositions(placement), color);
  shaft.name = `${FEA_LOAD_ARROW_NAME}-shaft`;
  const head = solid(headPositions(placement), color);
  head.name = `${FEA_LOAD_ARROW_NAME}-head`;
  group.add(shaft);
  group.add(head);
  return group;
}

/** One group of arrows. Null when there is nothing to draw. */
export function createLoadArrows(placements, color) {
  if (!placements?.length || color == null) return null;
  const group = new Group();
  group.name = FEA_LOAD_ARROWS_NAME;
  group.frustumCulled = false;
  group.raycast = () => {};
  group.renderOrder = 8;
  for (let i = 0; i < placements.length; i += 1) {
    group.add(createOneArrow(placements[i], color));
  }
  return group;
}
