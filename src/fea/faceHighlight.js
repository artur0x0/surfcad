/**
 * Fix / Force / Pressure face highlights.
 *
 * One overlay per (fixture or load, face), keyed in a map. Reconcile diffs
 * that map against the study: a key that is still selected keeps its mesh,
 * and a key that left is removed. Geometry and materials (the fill and the
 * outline) are disposed on the way out. Painting is therefore a pure
 * function of the selection. Appending a transparent mesh on every tap is
 * what stacked the highlight and left a cleared face lit.
 *
 * Contact skins are a different child (`fea-contact`). This module only
 * disposes meshes it put in the map.
 *
 * A non-normal load also parents direction arrows to that overlay. They
 * leave with the overlay: a direction change rebuilds the key, and a key
 * that leaves is disposed with its arrow geometry.
 */

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { FACE_HIGHLIGHT_RENDER_ORDER } from '../utils/faceColorSkin.js';
import { fingerprintsFromGeometry } from '../utils/facePaint.js';
import { matchFaceKeys } from '../utils/faceColorMatch.js';
import { highlightBoundaryPositions } from '../utils/planarSeam.js';
import { faceBelongsToStudy } from './feaPickGate.js';
import {
  arrowPlacementKey,
  createLoadArrows,
  faceArrowPlacements,
  loadArrowDirection,
} from './loadArrows.js';
import { faceKeyOf } from './studyPanel.js';

export const FEA_FACE_HIGHLIGHT_NAME = 'fea-face-highlight';
/** Paint swatch blue-500. Fixtures stay off the viridis stress ramp. */
export const FEA_FIXTURE_HIGHLIGHT_COLOR = 0x3b82f6;
/** Paint swatch yellow-500. Darker than the viridis end yellow. */
export const FEA_LOAD_HIGHLIGHT_COLOR = 0xeab308;
/** @deprecated Fixtures use FEA_FIXTURE_HIGHLIGHT_COLOR. Loads use yellow. */
export const FEA_FACE_HIGHLIGHT_COLOR = FEA_FIXTURE_HIGHLIGHT_COLOR;

export function feaHighlightColor(role) {
  return role === 'load' ? FEA_LOAD_HIGHLIGHT_COLOR : FEA_FIXTURE_HIGHLIGHT_COLOR;
}

export function faceHighlightKey(role, entryIndex, faceIndex) {
  return `${role}:${entryIndex}:${faceIndex}`;
}

/** Stable selection entries. `partId` is empty on a single-part study. */
export function faceHighlightTargets(study) {
  const targets = [];
  const push = (role, list) => {
    (list || []).forEach((entry, entryIndex) => {
      (entry?.faces || []).forEach((face, faceIndex) => {
        if (!face) return;
        const part = face.part;
        targets.push({
          key: faceHighlightKey(role, entryIndex, faceIndex),
          role,
          entryIndex,
          faceIndex,
          partId: part != null && part !== '' ? String(part) : '',
          face,
          entry,
        });
      });
    });
  };
  push('fixture', study?.fixtures);
  push('load', study?.loads);
  return targets;
}

/**
 * The part mesh that owns this face. A stamped part id wins. A part-scope
 * face (no id) stays on the analyzed part when that id is known, otherwise
 * the active solid, or the only solid on screen.
 */
export function hostForHighlight(hosts, target, analyzedPartId) {
  const list = Array.isArray(hosts) ? hosts : [];
  if (target?.partId) {
    return list.find((host) => String(host?.id) === String(target.partId)) || null;
  }
  if (analyzedPartId != null && analyzedPartId !== '') {
    return list.find((host) => String(host?.id) === String(analyzedPartId)) || null;
  }
  const active = list.find((host) => host?.active);
  if (active) return active;
  return list.length === 1 ? list[0] : null;
}

/** Changes when the part mesh, its geometry, the color, or the triangles change. */
export function highlightSignature(mesh, triangles, color) {
  const geometry = mesh?.geometry;
  let hash = 2166136261;
  const list = triangles || [];
  for (let i = 0; i < list.length; i += 1) {
    hash ^= list[i] >>> 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${mesh?.uuid || ''}:${geometry?.uuid || ''}:${color ?? ''}:${list.length}:${hash >>> 0}`;
}

export function disposeHighlightObject(object) {
  if (!object) return;
  const parent = object.parent;
  if (parent && typeof parent.remove === 'function') parent.remove(object);
  const stack = [object];
  while (stack.length) {
    const node = stack.pop();
    const children = node.children;
    if (children) {
      for (let i = 0; i < children.length; i += 1) stack.push(children[i]);
    }
    node.geometry?.dispose?.();
    const material = node.material;
    if (Array.isArray(material)) {
      for (let i = 0; i < material.length; i += 1) material[i]?.dispose?.();
    } else {
      material?.dispose?.();
    }
  }
}

function defaultResolveTriangles(host, face) {
  const geometry = host?.mesh?.geometry;
  const fingerprints = fingerprintsFromGeometry(geometry, host?.faceIDs);
  if (!fingerprints.length || !face) return [];
  const key = faceKeyOf(face);
  if (!key) return [];
  const { matched } = matchFaceKeys(fingerprints, [{ key }]);
  const indices = [];
  for (const row of matched) {
    const tris = row.face?.tris || [];
    for (let i = 0; i < tris.length; i += 1) indices.push(tris[i]);
  }
  return indices;
}

/**
 * Local-space fill plus the face outline. The caller parents it to the
 * part mesh. It does not raycast, so the solid still receives the tap.
 */
export function createFaceHighlightMesh(geometry, triangleIndices, color = FEA_FIXTURE_HIGHLIGHT_COLOR) {
  const index = geometry?.index?.array;
  const positionAttr = geometry?.attributes?.position;
  const positions = positionAttr?.array;
  if (!index?.length || !positions?.length || !triangleIndices?.length) return null;
  const local = new Float32Array(triangleIndices.length * 9);
  let write = 0;
  for (let t = 0; t < triangleIndices.length; t += 1) {
    const base = triangleIndices[t] * 3;
    if (base < 0 || base + 2 >= index.length) continue;
    for (let k = 0; k < 3; k += 1) {
      const vertex = index[base + k] * 3;
      if (vertex < 0 || vertex + 2 >= positions.length) continue;
      local[write] = positions[vertex];
      local[write + 1] = positions[vertex + 1];
      local[write + 2] = positions[vertex + 2];
      write += 3;
    }
  }
  if (!write) return null;
  const fill = new BufferGeometry();
  fill.setAttribute('position', new BufferAttribute(local.subarray(0, write), 3));
  const mesh = new Mesh(fill, new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.3,
    depthTest: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  }));
  mesh.name = FEA_FACE_HIGHLIGHT_NAME;
  mesh.renderOrder = FACE_HIGHLIGHT_RENDER_ORDER;
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  try {
    const boundary = highlightBoundaryPositions(positionAttr, index, triangleIndices);
    if (boundary?.length) {
      const edgeGeometry = new BufferGeometry();
      edgeGeometry.setAttribute('position', new BufferAttribute(new Float32Array(boundary), 3));
      const edges = new LineSegments(edgeGeometry, new LineBasicMaterial({
        color,
        linewidth: 3,
        depthTest: true,
        depthWrite: false,
      }));
      edges.name = `${FEA_FACE_HIGHLIGHT_NAME}-edge`;
      edges.renderOrder = FACE_HIGHLIGHT_RENDER_ORDER + 1;
      edges.frustumCulled = false;
      edges.raycast = () => {};
      mesh.add(edges);
    }
  } catch {
    // The fill still marks the face when the outline cannot be built.
  }
  return mesh;
}

/**
 * Diff `overlays` (Map key -> { signature, hostMesh, mesh }) against
 * `desired` ({ key, signature, hostMesh, create }). Returns a new map.
 * `create` runs only for a key that is missing or whose signature changed.
 */
export function reconcileFaceHighlights(overlays, desired, { dispose, attach }) {
  const prev = overlays instanceof Map ? overlays : new Map();
  const wanted = new Map();
  for (const spec of desired || []) {
    if (!spec || typeof spec.key !== 'string' || !spec.key || wanted.has(spec.key)) continue;
    wanted.set(spec.key, spec);
  }
  const next = new Map();
  const removed = [];
  for (const [key, record] of prev) {
    const spec = wanted.get(key);
    if (
      spec
      && record
      && spec.signature === record.signature
      && spec.hostMesh === record.hostMesh
    ) {
      next.set(key, record);
      continue;
    }
    dispose(record?.mesh);
    removed.push(key);
  }
  const created = [];
  const kept = [];
  for (const [key, spec] of wanted) {
    if (next.has(key)) {
      kept.push(key);
      continue;
    }
    const hostMesh = spec.hostMesh;
    if (!hostMesh || typeof hostMesh.add !== 'function') continue;
    let mesh = null;
    try {
      mesh = typeof spec.create === 'function' ? spec.create() : null;
    } catch (err) {
      console.error('[FEA] ignored a bad face highlight', err);
      continue;
    }
    if (!mesh || mesh === hostMesh) continue;
    mesh.name = FEA_FACE_HIGHLIGHT_NAME;
    if (!mesh.userData) mesh.userData = {};
    mesh.userData.feaHighlightKey = key;
    if (spec.role) mesh.userData.feaRole = spec.role;
    mesh.raycast = () => {};
    mesh.frustumCulled = false;
    try {
      attach(mesh, spec);
    } catch (err) {
      console.error('[FEA] ignored a bad face highlight', err);
      dispose(mesh);
      continue;
    }
    next.set(key, {
      key,
      signature: spec.signature,
      hostMesh,
      mesh,
    });
    created.push(key);
  }
  return { overlays: next, created, removed, kept };
}

function idList(value) {
  if (!value) return null;
  if (value.array && value.array.length) return value.array;
  if (typeof value.length === 'number' && value.length > 0) return value;
  return null;
}

function hostHasFaceMap(host) {
  if (idList(host?.faceIDs)) return true;
  return !!idList(host?.mesh?.geometry?.attributes?.faceID);
}

/** A removed extra is the wrong parent. The active pick mesh may not be parented yet. */
function hostAttached(host) {
  if (!host?.mesh || typeof host.mesh.add !== 'function') return false;
  if (host.mesh.parent == null && !host.active) return false;
  return true;
}

/**
 * Install the study's overlays on `hosts` (`{ id, mesh, faceIDs, active }`).
 * An empty study or a null study removes every overlay this map owns.
 */
export function syncFeaFaceHighlights(overlays, study, hosts, options = {}) {
  const resolveTriangles = options.resolveTriangles || defaultResolveTriangles;
  const createMesh = options.createMesh
    || ((host, triangles, target) => createFaceHighlightMesh(
      host?.mesh?.geometry,
      triangles,
      feaHighlightColor(target?.role),
    ));
  const dispose = options.dispose || disposeHighlightObject;
  const attach = options.attach || ((mesh, spec) => {
    if (spec.hostMesh && spec.hostMesh !== mesh && typeof spec.hostMesh.add === 'function') {
      spec.hostMesh.add(mesh);
    }
  });
  const list = Array.isArray(hosts) ? hosts : [];
  const memberIds = options.memberIds;
  const analyzedPartId = options.analyzedPartId;
  const desired = [];
  for (const target of faceHighlightTargets(study)) {
    if (Array.isArray(memberIds) && !faceBelongsToStudy(target.face, memberIds, analyzedPartId)) {
      continue;
    }
    const host = hostForHighlight(list, target, analyzedPartId);
    if (!hostAttached(host)) continue;
    if (!options.resolveTriangles && !hostHasFaceMap(host)) continue;
    let triangles = [];
    try {
      triangles = resolveTriangles(host, target.face) || [];
    } catch (err) {
      console.error('[FEA] ignored a bad face highlight', err);
      continue;
    }
    if (!triangles.length) continue;
    const frozen = Array.from(triangles);
    const color = feaHighlightColor(target.role);
    const placements = loadArrowPlacementsFor(target, host, frozen, options);
    desired.push({
      key: target.key,
      role: target.role,
      signature: `${highlightSignature(host.mesh, frozen, color)}|${arrowPlacementKey(placements)}`,
      hostMesh: host.mesh,
      create: () => {
        const mesh = createMesh(host, frozen, target);
        if (!options.createMesh && mesh && placements.length && typeof mesh.add === 'function') {
          const arrows = createLoadArrows(placements, FEA_LOAD_HIGHLIGHT_COLOR);
          if (arrows) mesh.add(arrows);
        }
        return mesh;
      },
    });
  }
  return reconcileFaceHighlights(overlays, desired, { dispose, attach });
}

/** Arrows only in setup, and only for a load that is not Normal. */
function loadArrowPlacementsFor(target, host, triangles, options) {
  if (target?.role !== 'load') return [];
  if (options?.screen != null && options.screen !== 'setup') return [];
  const direction = loadArrowDirection(target.entry, target.face);
  if (!direction) return [];
  return faceArrowPlacements(host?.mesh?.geometry, triangles, direction);
}
