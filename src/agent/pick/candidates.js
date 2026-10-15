import { matchFaceKeys } from '../../utils/faceColorMatch.js';
import { serializeFaceKey } from '../state/listPickables.js';

export const MAX_FACE_CANDIDATES = 8;

/**
 * Face patches one key matches, as `list_faces` keys. An ambiguous key has
 * two or more; the agent retries with one of them (each carries `src` /
 * `ord` when the kernel tagged the patch).
 */
export function faceKeyCandidates(fingerprints, key, limit = MAX_FACE_CANDIDATES) {
  const out = [];
  for (const face of Array.isArray(fingerprints) ? fingerprints : []) {
    const { matched } = matchFaceKeys([face], [{ key }]);
    if (matched.length !== 1) continue;
    const serialized = serializeFaceKey(face);
    if (serialized) out.push(serialized);
    if (out.length >= limit) break;
  }
  return out;
}

/** `ambiguous_face` with the candidates for the key at `index`. */
export function ambiguousFaceError(fingerprints, key, index) {
  const candidates = faceKeyCandidates(fingerprints, key);
  return {
    code: 'ambiguous_face',
    message: `Face key at index ${index} matches ${candidates.length > 1 ? candidates.length : 'more than one'} patches; pick one of details.candidates`,
    details: { index, candidates },
  };
}
