/**
 * Run the pull-direction fit on a viewport solid.
 *
 * `warmFaceGraph` (`src/utils/selectFace.js`) is the PartGraph the viewport
 * picks with. `stampedFaceTable` (`src/utils/faceIdentity.js`) supplies
 * stamped face normals. Triangles with no stamp, or a stamp whose normal
 * cancelled, keep the triangle normal inside `analyzePullDirection`.
 */

import { warmFaceGraph } from '../utils/selectFace.js';
import { stampedFaceTable } from '../utils/faceIdentity.js';
import { analyzePullDirection, analyzeWallOnly } from './pullDirection.js';

export function moldFitFromGeometry(geometry, faceIDs = null, { pull = null, wall = null, wallOnly = false } = {}) {
  const positions = geometry?.attributes?.position?.array;
  const indices = geometry?.index?.array;
  if (!positions || !indices || indices.length < 3) {
    return { error: { code: 'no_mesh', message: 'No mesh for that part' } };
  }
  const graph = warmFaceGraph(geometry, faceIDs);
  const table = stampedFaceTable(geometry, faceIDs);
  const stamped = table?.triFace && table.faces?.length
    ? {
      triFace: table.triFace,
      normals: table.faces.map((face) => face.normal),
      names: table.faces.map((face) => face.name),
    }
    : null;
  const input = {
    positions,
    indices,
    patches: graph?.patches || null,
    stamped,
    pull,
    wall,
  };
  return wallOnly ? analyzeWallOnly(input) : analyzePullDirection(input);
}
