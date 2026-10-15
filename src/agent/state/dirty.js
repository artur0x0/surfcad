/**
 * @param {{
 *   workspaceDirty?: boolean,
 *   partIds?: Iterable<string>,
 *   assemblyDirty?: boolean,
 *   renamePending?: boolean,
 *   legacyCleanup?: boolean,
 * }} input
 */
export function buildDirtyState(input = {}) {
  const partIds = [...(input.partIds || [])].map((id) => String(id));
  return {
    workspaceDirty: input.workspaceDirty === true,
    assemblyDirty: input.assemblyDirty === true,
    renamePending: input.renamePending === true,
    legacyCleanup: input.legacyCleanup === true,
    partIds,
  };
}
