/**
 * Which row `create_part` just added. The host activates this id even when
 * the document's active id did not move, and runs its script (blank starter
 * included) before the call returns, so the new part is never not_run_yet.
 */

/**
 * The single part row present in `after` and absent from `before`.
 * Null when nothing new was added, or when more than one row appeared.
 * @param {{ parts?: Array<{ id?: string }> }|null|undefined} before
 * @param {{ parts?: Array<{ id?: string }> }|null|undefined} after
 */
export function createdPartFromDocs(before, after) {
  const beforeIds = new Set((before?.parts || []).map((row) => String(row?.id)));
  const created = (after?.parts || []).filter((row) => (
    row && row.id != null && row.id !== '' && !beforeIds.has(String(row.id))
  ));
  if (created.length !== 1) return null;
  return created[0];
}
