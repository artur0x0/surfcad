import { Vector3 } from 'three';
import { buildPartGraphPatches } from './partGraphPatches.js';
import { wallTriFace } from './faceIdentity.js';
import { meshBodyComponents } from './meshBodyComponents.js';

// Configuration constants
const NORMAL_THRESHOLD = 0.001; // Element-wise tolerance for normal comparison (coplanar)
const DEFAULT_ANGLE_TOLERANCE_DEGREES = 3; // Default angular tolerance for double-click selection

/**
 * Check if two normals are the same (element-wise) - used for exact coplanar matching
 */
function normalsMatch(n1, n2) {
  return Math.abs(n1.x - n2.x) < NORMAL_THRESHOLD &&
         Math.abs(n1.y - n2.y) < NORMAL_THRESHOLD &&
         Math.abs(n1.z - n2.z) < NORMAL_THRESHOLD;
}

/**
 * Check if two normals are within an angular tolerance
 * @param {Vector3} n1 - First normal (normalized)
 * @param {Vector3} n2 - Second normal (normalized)
 * @param {number} toleranceDegrees - Maximum angle difference in degrees
 * @returns {boolean} True if angle between normals is within tolerance
 */
function normalsWithinAngle(n1, n2, toleranceDegrees) {
  // Dot product gives cos(angle) between normalized vectors
  const dot = n1.dot(n2);
  // Clamp to [-1, 1] to handle floating point errors
  const clampedDot = Math.max(-1, Math.min(1, dot));
  const angleRadians = Math.acos(clampedDot);
  const toleranceRadians = toleranceDegrees * Math.PI / 180;
  return angleRadians <= toleranceRadians;
}

/**
 * Get normal for a triangle (compute from vertices, same as raycaster)
 */
function getFaceNormal(geometry, faceIdx) {
  const positions = geometry.attributes.position;
  const index = geometry.index.array;
  
  const i0 = index[faceIdx * 3];
  const i1 = index[faceIdx * 3 + 1];
  const i2 = index[faceIdx * 3 + 2];
  
  const v0 = new Vector3().fromBufferAttribute(positions, i0);
  const v1 = new Vector3().fromBufferAttribute(positions, i1);
  const v2 = new Vector3().fromBufferAttribute(positions, i2);
  
  // Calculate face normal from cross product (same as raycaster does)
  const edge1 = new Vector3().subVectors(v1, v0);
  const edge2 = new Vector3().subVectors(v2, v0);
  const normal = new Vector3().crossVectors(edge1, edge2).normalize();
  
  return normal;
}

/**
 * Build edge-to-triangle map for a geometry group
 */
function buildEdgeMap(geometry, targetGroup) {
  const edgeToTriangles = new Map();
  const numTriangles = geometry.index.count / 3;
  const index = geometry.index.array;
  
  for (let triIdx = 0; triIdx < numTriangles; triIdx++) {
    const triIndexInBuffer = triIdx * 3;
    if (targetGroup) {
      if (triIndexInBuffer < targetGroup.start || 
          triIndexInBuffer >= targetGroup.start + targetGroup.count) {
        continue;
      }
    }
    
    const i0 = index[triIdx * 3];
    const i1 = index[triIdx * 3 + 1];
    const i2 = index[triIdx * 3 + 2];
    
    const edges = [
      [Math.min(i0, i1), Math.max(i0, i1)],
      [Math.min(i1, i2), Math.max(i1, i2)],
      [Math.min(i2, i0), Math.max(i2, i0)]
    ];
    
    edges.forEach(([v1, v2]) => {
      const key = `${v1}-${v2}`;
      if (!edgeToTriangles.has(key)) {
        edgeToTriangles.set(key, []);
      }
      edgeToTriangles.get(key).push(triIdx);
    });
  }
  
  return edgeToTriangles;
}

/**
 * Helper to get edges for a triangle
 */
function getTriangleEdges(geometry, triIdx) {
  const index = geometry.index.array;
  const i0 = index[triIdx * 3];
  const i1 = index[triIdx * 3 + 1];
  const i2 = index[triIdx * 3 + 2];
  
  return [
    [Math.min(i0, i1), Math.max(i0, i1)],
    [Math.min(i1, i2), Math.max(i1, i2)],
    [Math.min(i2, i0), Math.max(i2, i0)]
  ];
}

/**
 * Select all coplanar triangles adjacent to the seed triangle (exact match)
 * Used for single-click selection
 * @param {BufferGeometry} geometry - The geometry to select from
 * @param {number} seedFaceIndex - Index of the initially clicked triangle
 * @param {Object} faceData - Face data containing normal information
 * @returns {Array<number>} Array of selected triangle indices
 */
export function selectFaceByID(geometry, seedFaceIndex, faceData) {
  console.log('[Face Selection] Selecting coplanar face from triangle', seedFaceIndex);
  
  const targetNormal = new Vector3(faceData.normal[0], faceData.normal[1], faceData.normal[2]);
  console.log("[Face Selection] Target Normal is:", targetNormal);
  
  // Build edge-to-triangle map
  const edgeToTriangles = buildEdgeMap(geometry, null);
  
  // BFS/DFS to find all coplanar adjacent triangles
  const selected = new Set();
  const toVisit = [seedFaceIndex];
  
  while (toVisit.length > 0) {
    const currentIdx = toVisit.pop();
    
    // Skip if already visited
    if (selected.has(currentIdx)) continue;
    
    // Check if this triangle is coplanar with seed
    const currentNormal = getFaceNormal(geometry, currentIdx);
    if (!normalsMatch(targetNormal, currentNormal)) continue;
    
    // Add to selected set
    selected.add(currentIdx);
    
    // Get adjacent triangles through shared edges
    const edges = getTriangleEdges(geometry, currentIdx);
    
    // For each edge, find adjacent triangles
    edges.forEach(([v1, v2]) => {
      const key = `${v1}-${v2}`;
      const adjacentTris = edgeToTriangles.get(key) || [];
      
      adjacentTris.forEach(adjIdx => {
        // Skip if already selected or in visit queue
        if (!selected.has(adjIdx)) {
          toVisit.push(adjIdx);
        }
      });
    });
  }
  
  console.log(`[Face Selection] Selected ${selected.size} coplanar triangles`);
  return Array.from(selected);
}

/**
 * Select all adjacent triangles within an angular tolerance of their neighbors
 * Used for double-click selection - includes slightly curved surfaces
 * Each triangle is compared against its adjacent neighbor (not the seed), allowing
 * the selection to flow along gradually curving surfaces.
 * @param {BufferGeometry} geometry - The geometry to select from
 * @param {number} seedFaceIndex - Index of the initially clicked triangle
 * @param {Object} faceData - Face data containing normal information (used for seed)
 * @param {number} [angleTolerance=3] - Maximum angle difference in degrees between adjacent triangles
 * @returns {Array<number>} Array of selected triangle indices
 */
export function selectFaceWithTolerance(geometry, seedFaceIndex, faceData, angleTolerance = DEFAULT_ANGLE_TOLERANCE_DEGREES) {
  console.log(`[Face Selection] Selecting faces within ${angleTolerance}° tolerance (neighbor-based) from triangle`, seedFaceIndex);
  
  // Build edge-to-triangle map
  const edgeToTriangles = buildEdgeMap(geometry, null);
  
  // Cache normals to avoid recalculating
  const normalCache = new Map();
  const getNormal = (triIdx) => {
    if (!normalCache.has(triIdx)) {
      normalCache.set(triIdx, getFaceNormal(geometry, triIdx));
    }
    return normalCache.get(triIdx);
  };
  
  // BFS to find all adjacent triangles within angular tolerance of their neighbors
  const selected = new Set();
  // Queue entries: { index: triangleIndex, fromIndex: the triangle we came from (for angle check) }
  const toVisit = [{ index: seedFaceIndex, fromIndex: null }];
  
  while (toVisit.length > 0) {
    const { index: currentIdx, fromIndex } = toVisit.pop();
    
    // Skip if already visited
    if (selected.has(currentIdx)) continue;
    
    const currentNormal = getNormal(currentIdx);
    
    // For non-seed triangles, check if within angular tolerance of the triangle we came from
    if (fromIndex !== null) {
      const fromNormal = getNormal(fromIndex);
      if (!normalsWithinAngle(fromNormal, currentNormal, angleTolerance)) {
        continue; // Skip this triangle - too different from its neighbor
      }
    }
    
    // Add to selected set
    selected.add(currentIdx);
    
    // Get adjacent triangles through shared edges
    const edges = getTriangleEdges(geometry, currentIdx);
    
    // For each edge, find adjacent triangles
    edges.forEach(([v1, v2]) => {
      const key = `${v1}-${v2}`;
      const adjacentTris = edgeToTriangles.get(key) || [];
      
      adjacentTris.forEach(adjIdx => {
        if (!selected.has(adjIdx)) {
          // Pass current triangle as the "from" triangle for angle comparison
          toVisit.push({ index: adjIdx, fromIndex: currentIdx });
        }
      });
    });
  }
  
  console.log(`[Face Selection] Selected ${selected.size} triangles within ${angleTolerance}° neighbor tolerance`);
  return Array.from(selected);
}

/**
 * Select all connected triangles regardless of angle
 * Used for triple-click selection - selects entire connected mesh region
 * @param {BufferGeometry} geometry - The geometry to select from
 * @param {number} seedFaceIndex - Index of the initially clicked triangle
 * @returns {Array<number>} Array of selected triangle indices
 */
export function selectAllConnected(geometry, seedFaceIndex) {
  console.log('[Face Selection] Selecting all connected triangles from triangle', seedFaceIndex);
  
  // Build edge-to-triangle map
  const edgeToTriangles = buildEdgeMap(geometry, null);
  
  // BFS to find all connected triangles (no normal checking)
  const selected = new Set();
  const toVisit = [seedFaceIndex];
  
  while (toVisit.length > 0) {
    const currentIdx = toVisit.pop();
    
    // Skip if already visited
    if (selected.has(currentIdx)) continue;
    
    // Add to selected set (no normal check - accept all connected triangles)
    selected.add(currentIdx);
    
    // Get adjacent triangles through shared edges
    const edges = getTriangleEdges(geometry, currentIdx);
    
    // For each edge, find adjacent triangles
    edges.forEach(([v1, v2]) => {
      const key = `${v1}-${v2}`;
      const adjacentTris = edgeToTriangles.get(key) || [];
      
      adjacentTris.forEach(adjIdx => {
        if (!selected.has(adjIdx)) {
          toVisit.push(adjIdx);
        }
      });
    });
  }
  
  console.log(`[Face Selection] Selected ${selected.size} connected triangles`);
  return Array.from(selected);
}

/**
 * Get all edges from a set of selected triangles
 * Returns unique edges (each edge appears once)
 * @param {Array<number>} triangleIndices - Array of triangle indices
 * @param {BufferGeometry} geometry - The geometry
 * @returns {Array<Array<number>>} Array of edges, each edge is [v1Index, v2Index]
 */
export function getEdgesFromTriangles(triangleIndices, geometry) {
  const edgeSet = new Set();
  const index = geometry.index.array;
  
  triangleIndices.forEach(triIdx => {
    const i0 = index[triIdx * 3];
    const i1 = index[triIdx * 3 + 1];
    const i2 = index[triIdx * 3 + 2];
    
    const edges = [
      [Math.min(i0, i1), Math.max(i0, i1)],
      [Math.min(i1, i2), Math.max(i1, i2)],
      [Math.min(i2, i0), Math.max(i2, i0)]
    ];
    
    edges.forEach(([v1, v2]) => {
      edgeSet.add(`${v1}-${v2}`);
    });
  });
  
  return Array.from(edgeSet).map(key => {
    const [v1, v2] = key.split('-').map(Number);
    return [v1, v2];
  });
}

/**
 * Selection mode enum for clarity
 */
export const SelectionMode = {
  COPLANAR: 'coplanar',           // Flat face — coplanar region
  ANGULAR_TOLERANCE: 'tolerance', // Curved face — neighbour angle walk (shell/draft/cut taps)
  ALL_CONNECTED: 'connected'      // Whole connected body
};

/** One PartGraph per geometry. Rebuilt when the mesh or its faceID buffer changes. */
const faceGraphCache = new WeakMap();

/**
 * Drop triangles that are not in the seed body's vertex component.
 * Same rule as selectGraphFace. One body is a no-op.
 */
function clipIndicesToSeedBody(geometry, seedFaceIndex, indices) {
  const list = Array.isArray(indices) ? indices : [];
  const bodies = meshBodyComponents(geometry?.attributes?.position, geometry?.index);
  if (!bodies || bodies.length < 2) return list;
  const seed = Number(seedFaceIndex);
  const owner = bodies.find((b) => b.triangles.includes(seed));
  if (!owner) return list;
  const allow = new Set(owner.triangles);
  const filtered = list.filter((t) => allow.has(t));
  return filtered.length ? filtered : (Number.isFinite(seed) ? [seed] : []);
}

/**
 * Build the face graph for this geometry now. `renderMeshData` calls this
 * when a new mesh is shown, including after fillet, so the next pick reads
 * the new solid. A click builds the same graph if this paint missed.
 */
export function warmFaceGraph(geometry, faceIDs) {
  return faceGraphFor(geometry, faceIDs);
}

function faceGraphFor(geometry, faceIDs) {
  const positions = geometry?.attributes?.position?.array;
  const indices = geometry?.index?.array;
  if (!positions || !indices || !indices.length) return null;
  const cached = faceGraphCache.get(geometry);
  if (cached && cached.faceIDs === faceIDs) return cached.graph;
  const graph = buildPartGraphPatches({
    positions,
    indices,
    faceIDs: faceIDs && faceIDs.length ? faceIDs : null,
    triSource: geometry.userData?.triSource || null,
    featureTessellation: geometry.userData?.featureTessellation || null,
    triFace: wallTriFace(geometry.userData?.faceIdentity?.pieceOfTri, geometry.userData?.faceIdentity?.pieces),
  });
  faceGraphCache.set(geometry, { faceIDs, graph });
  return graph;
}

/**
 * Every triangle of the face-graph component that owns the seed.
 *
 * A component is one PartGraph patch: coplanar triangles of a flat face, or
 * the curvature-merged band of a curved face (fillet, cylinder wall). The
 * hit triangle alone is not a face, and neither is one coplanar mesh facet
 * when the face continues around a curve.
 *
 * @param {BufferGeometry} geometry
 * @param {number} seedFaceIndex
 * @param {ArrayLike<number>|null} [faceIDs] per-triangle Manifold faceID
 * @returns {{ indices: number[], kind: string }}
 */
export function selectGraphFace(geometry, seedFaceIndex, faceIDs = null) {
  const seed = Number(seedFaceIndex);
  const graph = faceGraphFor(geometry, faceIDs);
  const triPatch = graph?.triPatch;
  if (!graph || !triPatch || seed < 0 || seed >= triPatch.length) {
    return { indices: Number.isFinite(seed) ? [seed] : [], kind: 'planar' };
  }
  const patch = graph.patches[triPatch[seed]];
  if (!patch?.tris?.length) {
    return { indices: [seed], kind: 'planar' };
  }
  let indices = patch.tris.slice();
  const bodies = meshBodyComponents(geometry.attributes?.position, geometry.index);
  if (bodies.length > 1) {
    const owner = bodies.find((b) => b.triangles.includes(seed));
    if (owner) {
      const allow = new Set(owner.triangles);
      indices = indices.filter((t) => allow.has(t));
    }
  }
  return { indices: indices.length ? indices : [seed], kind: patch.kind || 'general' };
}

/**
 * Every triangle of the solid that owns the seed face.
 * Shared vertex indices join one body — the same split Cut uses — so a
 * second solid in the mesh stays unselected.
 * @param {BufferGeometry} geometry
 * @param {number} seedFaceIndex
 * @returns {number[]}
 */
export function selectOwningBody(geometry, seedFaceIndex) {
  const seed = Number(seedFaceIndex);
  const positions = geometry?.attributes?.position;
  const index = geometry?.index;
  const bodies = meshBodyComponents(positions, index);
  for (const body of bodies) {
    if (body.triangles.includes(seed)) return body.triangles.slice();
  }
  return selectAllConnected(geometry, seed);
}

/**
 * Default viewport: one click is the face-graph component, two clicks are
 * the body that owns it. Shell, Draft, Cut, Move Face, and Delete Face pass `legacy` so a tap still
 * adds or removes the coplanar (or tolerance) region and a double click
 * does not become the body.
 *
 * @param {{
 *   geometry: object,
 *   seedFaceIndex: number,
 *   faceNormal?: number[],
 *   clickCount?: number,
 *   faceIDs?: ArrayLike<number>|null,
 *   angleTolerance?: number,
 *   legacy?: boolean,
 * }} args
 * @returns {{ indices: number[], selectionMode: string, kind: string }}
 */
export function resolveViewportFaceClick({
  geometry,
  seedFaceIndex,
  faceNormal,
  clickCount = 1,
  faceIDs = null,
  angleTolerance = DEFAULT_ANGLE_TOLERANCE_DEGREES,
  legacy = false,
}) {
  const clicks = Number(clickCount) || 1;
  if (legacy) {
    // Shell, Draft, Cut, Move Face, and Delete Face stay on the tapped face,
    // not the whole body. The walk still cannot enter another body.
    if (clicks >= 3) {
      return {
        indices: clipIndicesToSeedBody(geometry, seedFaceIndex, selectAllConnected(geometry, seedFaceIndex)),
        selectionMode: 'all-connected',
        kind: 'body',
      };
    }
    if (clicks === 2) {
      return {
        indices: clipIndicesToSeedBody(
          geometry,
          seedFaceIndex,
          selectFaceWithTolerance(
            geometry,
            seedFaceIndex,
            { normal: faceNormal },
            angleTolerance,
          ),
        ),
        selectionMode: 'angular-tolerance',
        kind: 'tolerance',
      };
    }
    // The coplanar walk stops at a fillet, so a cap split across the old body
    // boundary would miss a half. The planar patch already joined those
    // pieces. A click on the blend stays the coplanar facet.
    const graphFace = selectGraphFace(geometry, seedFaceIndex, faceIDs);
    if (graphFace.kind === 'planar' && graphFace.indices.length) {
      return {
        indices: graphFace.indices,
        selectionMode: 'coplanar',
        kind: 'planar',
      };
    }
    return {
      indices: clipIndicesToSeedBody(
        geometry,
        seedFaceIndex,
        selectFaceByID(geometry, seedFaceIndex, { normal: faceNormal }),
      ),
      selectionMode: 'coplanar',
      kind: 'planar',
    };
  }
  if (clicks >= 2) {
    return {
      indices: selectOwningBody(geometry, seedFaceIndex),
      selectionMode: 'all-connected',
      kind: 'body',
    };
  }
  const face = selectGraphFace(geometry, seedFaceIndex, faceIDs);
  return {
    indices: face.indices,
    selectionMode: face.kind === 'planar' ? 'coplanar' : 'angular-tolerance',
    kind: face.kind,
  };
}

/**
 * Unified selection function that handles all selection modes
 * @param {BufferGeometry} geometry - The geometry to select from
 * @param {number} seedFaceIndex - Index of the initially clicked triangle
 * @param {Object} faceData - Face data containing normal information
 * @param {string} mode - Selection mode (from SelectionMode enum)
 * @param {Object} [options] - Additional options
 * @param {number} [options.angleTolerance=3] - Angular tolerance in degrees (for ANGULAR_TOLERANCE mode)
 * @returns {Array<number>} Array of selected triangle indices
 */
export function selectFace(geometry, seedFaceIndex, faceData, mode = SelectionMode.COPLANAR, options = {}) {
  const { angleTolerance = DEFAULT_ANGLE_TOLERANCE_DEGREES } = options;
  
  switch (mode) {
    case SelectionMode.COPLANAR:
      return selectFaceByID(geometry, seedFaceIndex, faceData);
    
    case SelectionMode.ANGULAR_TOLERANCE:
      return selectFaceWithTolerance(geometry, seedFaceIndex, faceData, angleTolerance);
    
    case SelectionMode.ALL_CONNECTED:
      return selectAllConnected(geometry, seedFaceIndex);
    
    default:
      console.warn(`[Face Selection] Unknown selection mode: ${mode}, falling back to coplanar`);
      return selectFaceByID(geometry, seedFaceIndex, faceData);
  }
}
