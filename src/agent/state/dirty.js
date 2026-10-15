/**
 * @param {{
 *   workspaceDirty?: boolean,
 *   partIds?: Iterable<string>,
 *   assemblyDirty?: boolean,
 *   renamePending?: boolean,
 *   legacyCleanup?: boolean,
 *   undoStackDirty?: boolean,
 *   editedSinceLoad?: Iterable<string>,
 * }} input
 */
export function buildDirtyState(input = {}) {
  const partIds = [...(input.partIds || [])].map((id) => String(id));
  const editedSinceLoad = [...(input.editedSinceLoad || [])].map((id) => String(id));
  const undoStackDirty = input.undoStackDirty === true;
  const unsaved = input.unsaved === true
    || editedSinceLoad.length > 0
    || undoStackDirty;
  const out = {
    workspaceDirty: input.workspaceDirty === true || undoStackDirty,
    assemblyDirty: input.assemblyDirty === true,
    renamePending: input.renamePending === true,
    legacyCleanup: input.legacyCleanup === true,
    partIds,
    unsaved,
    editedSinceLoad,
  };
  if (undoStackDirty) out.undoStackDirty = true;
  return out;
}
