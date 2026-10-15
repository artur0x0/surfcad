/**
 * @param {{
 *   workspaceDirty?: boolean,
 *   partIds?: Iterable<string>,
 *   assemblyDirty?: boolean,
 *   renamePending?: boolean,
 *   legacyCleanup?: boolean,
 *   undoStackDirty?: boolean,
 * }} input
 */
export function buildDirtyState(input = {}) {
  const partIds = [...(input.partIds || [])].map((id) => String(id));
  const undoStackDirty = input.undoStackDirty === true;
  const out = {
    workspaceDirty: input.workspaceDirty === true || undoStackDirty,
    assemblyDirty: input.assemblyDirty === true,
    renamePending: input.renamePending === true,
    legacyCleanup: input.legacyCleanup === true,
    partIds,
  };
  if (undoStackDirty) out.undoStackDirty = true;
  return out;
}
