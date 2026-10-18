/**
 * @param {{
 *   workspaceDirty?: boolean,
 *   partIds?: Iterable<string>,
 *   assemblyDirty?: boolean,
 *   renamePending?: boolean,
 *   legacyCleanup?: boolean,
 *   undoStackDirty?: boolean,
 *   editedSinceLoad?: Iterable<string>,
 *   upgradeRequired?: boolean,
 *   pendingSave?: boolean,
 *   unsaved?: boolean,
 * }} input
 */
export function buildDirtyState(input = {}) {
  const partIds = [...(input.partIds || [])].map((id) => String(id));
  const editedSinceLoad = [...(input.editedSinceLoad || [])].map((id) => String(id));
  const undoStackDirty = input.undoStackDirty === true;
  const pendingSave = input.pendingSave === true;
  const unsaved = input.unsaved === true
    || pendingSave
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
    pendingSave,
  };
  if (input.upgradeRequired === true) out.upgradeRequired = true;
  if (undoStackDirty) out.undoStackDirty = true;
  return out;
}
