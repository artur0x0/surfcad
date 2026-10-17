// utils/crossSection.js

/**
 * Plane presets for common orientations
 */
export const PLANE_PRESETS = {
  XY: {
    name: 'XY Plane (Top)',
    normal: [0, 0, 1],
    defaultOffset: 0
  },
  XZ: {
    name: 'XZ Plane (Front)',
    normal: [0, 1, 0],
    defaultOffset: 0
  },
  YZ: {
    name: 'YZ Plane (Side)',
    normal: [1, 0, 0],
    defaultOffset: 0
  }
};

/**
 * Get the cut edges from comparing original and trimmed manifolds
 * This extracts the boundary edges created by the trim operation
 * @param {Object} original - Original manifold
 * @param {Object} trimmed - Trimmed manifold
 * @returns {Array} Array of edge line segments
 */
export function getCutEdges(original, trimmed) {
  // Get meshes
  const trimmedMesh = trimmed.getMesh();
  
  // The cut edges are the new boundary edges in the trimmed mesh
  // We can identify them by finding edges that only appear in one triangle
  
  const edges = [];
  const edgeCount = new Map();
  
  // Count edge occurrences in trimmed mesh
  for (let i = 0; i < trimmedMesh.triVerts.length; i += 3) {
    const v0 = trimmedMesh.triVerts[i];
    const v1 = trimmedMesh.triVerts[i + 1];
    const v2 = trimmedMesh.triVerts[i + 2];
    
    const edgeKeys = [
      `${Math.min(v0, v1)}-${Math.max(v0, v1)}`,
      `${Math.min(v1, v2)}-${Math.max(v1, v2)}`,
      `${Math.min(v2, v0)}-${Math.max(v2, v0)}`
    ];
    
    edgeKeys.forEach(key => {
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
    });
  }
  
  // Boundary edges (cut edges) appear only once
  const positions = trimmedMesh.vertProperties;
  edgeCount.forEach((count, key) => {
    if (count === 1) {
      const [v1, v2] = key.split('-').map(Number);
      
      // Get vertex positions
      const p1 = [
        positions[v1 * 3],
        positions[v1 * 3 + 1],
        positions[v1 * 3 + 2]
      ];
      const p2 = [
        positions[v2 * 3],
        positions[v2 * 3 + 1],
        positions[v2 * 3 + 2]
      ];
      
      edges.push({ p1, p2 });
    }
  });
  
  return edges;
}
