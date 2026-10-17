import { describeJointPickFromExplicit } from './jointPickDescribeExplicit.js';
import { agentFaceCatalog, findAgentFace, jointPickForFace } from './faceCatalog.js';

/**
 * Classify an agent joint pick the same way viewport face/edge taps do.
 * A `faceId` or a face key resolves on the same catalog `list_faces` returns.
 */
export function describeJointPick({ key, kind, faceId, geometry, faceIDs }) {
  const hasFaceId = faceId != null && faceId !== '';
  if (!hasFaceId) {
    const explicit = describeJointPickFromExplicit({ key, kind });
    if (explicit) return explicit;
  }
  if (!geometry?.attributes?.position) {
    return { error: { code: 'no_mesh', message: 'No mesh for that part' } };
  }
  const found = findAgentFace(agentFaceCatalog(geometry, faceIDs), { faceId, key });
  if (found.error) return found;
  return jointPickForFace(found.face);
}
