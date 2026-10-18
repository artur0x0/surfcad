import { setPartVisible } from '../../utils/assembly.js';

export const UNKNOWN_PART_HINT = 'Call parts and retry with a listed id. part_id is an opaque id, not a vault path, and does not fall back to the active part.';

/** True when `part_id` is a path (or a filename) rather than an opaque id. */
export function isRepoPath(value) {
  const text = String(value ?? '');
  if (!text) return false;
  if (text.includes('/') || text.includes('\\')) return true;
  return /\.(?:js|mjs|cjs|json|mesh)$/i.test(text);
}

export function unknownPartError(partId) {
  return {
    code: 'unknown_part',
    message: `Unknown part id: ${partId}. ${UNKNOWN_PART_HINT}`,
    details: { hint: UNKNOWN_PART_HINT },
  };
}

/**
 * Working-copy visibility decision. Exact `row.id` match only.
 * Does not read or write git.
 *
 * @param {object|null|undefined} doc
 * @param {unknown} partId
 * @param {unknown} visible
 * @returns {{
 *   error?: { code: string, message: string, details?: { hint: string } },
 *   changed?: boolean,
 *   doc?: object,
 *   result?: { partId: string, visible: boolean },
 * }}
 */
export function decidePartVisible(doc, partId, visible) {
  if (!doc || !Array.isArray(doc.parts)) {
    return {
      error: {
        code: 'no_assembly',
        message: 'No assembly loaded. Create or open an assembly first.',
      },
    };
  }
  if (typeof partId !== 'string' || !partId) {
    return {
      error: { code: 'bad_args', message: 'set_part_visible part_id must be a non-empty string' },
    };
  }
  if (typeof visible !== 'boolean') {
    return {
      error: { code: 'bad_args', message: 'set_part_visible visible must be a boolean' },
    };
  }
  if (isRepoPath(partId)) return { error: unknownPartError(partId) };
  const part = doc.parts.find((row) => row && row.id === partId);
  if (!part) return { error: unknownPartError(partId) };
  const currentlyVisible = part.visible !== false;
  if (currentlyVisible === visible) {
    return { changed: false, result: { partId: part.id, visible } };
  }
  return {
    changed: true,
    doc: setPartVisible(doc, part.id, visible),
    result: { partId: part.id, visible },
  };
}
