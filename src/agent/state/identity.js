/**
 * Agent identity: ids only. A vault path, filename, or display-name lookup
 * is unknown_part / unknown_assembly. No fallback to the active part.
 */
import { isRepoPath, unknownPartError } from './partVisible.js';

export const UNKNOWN_ASSEMBLY_HINT = 'Call list_assemblies and retry with a listed assembly_id. assembly_id is an opaque id, not a vault path or display name.';

export { isRepoPath, unknownPartError };

export function unknownAssemblyError(assemblyId) {
  return {
    code: 'unknown_assembly',
    message: `Unknown assembly id: ${assemblyId}. ${UNKNOWN_ASSEMBLY_HINT}`,
    details: { hint: UNKNOWN_ASSEMBLY_HINT },
  };
}

export function rejectPartId(partId) {
  if (typeof partId !== 'string' || !partId) {
    return { code: 'bad_args', message: 'part_id must be a non-empty string' };
  }
  if (isRepoPath(partId)) return unknownPartError(partId);
  return null;
}

export function rejectAssemblyId(assemblyId) {
  if (typeof assemblyId !== 'string' || !assemblyId) {
    return { code: 'bad_args', message: 'assembly_id must be a non-empty string' };
  }
  if (isRepoPath(assemblyId)) return unknownAssemblyError(assemblyId);
  return null;
}

/** Exact `row.id` match. Paths and names do not resolve. */
export function findPartById(doc, partId) {
  if (!doc || !Array.isArray(doc.parts)) return null;
  if (typeof partId !== 'string' || !partId || isRepoPath(partId)) return null;
  return doc.parts.find((row) => row && row.id === partId) || null;
}
