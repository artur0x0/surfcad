import { describeJointPickFromExplicit } from './jointPickDescribeExplicit.js';
import { describeExpandedFaceJointPick } from './jointFaceExpand.js';

/**
 * Classify an agent joint pick the same way viewport face/edge taps do.
 */
export function describeJointPick({ key, kind, geometry, faceIDs }) {
  const explicit = describeJointPickFromExplicit({ key, kind });
  if (explicit) {
    return explicit.error ? explicit : explicit;
  }
  if (!geometry?.attributes?.position) {
    return { error: { code: 'no_mesh', message: 'No mesh for that part' } };
  }
  return describeExpandedFaceJointPick({ geometry, faceIDs, key });
}
