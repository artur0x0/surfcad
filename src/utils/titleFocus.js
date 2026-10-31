/**
 * Which part the assembly title chip focuses when the user taps it.
 *
 * The chip shows the whole assembly and re-frames the part that was selected
 * (or the active part). The remembered selection can outlive its document:
 * after New assembly the previous document's selected part id is still in
 * `cadPartIdRef`, its mesh is still in the run cache, and focusing it swapped
 * a ghost of that part into the new, otherwise empty, assembly. A part that is
 * not in the document is never a focus target.
 *
 * @param {{ parts?: Array<{ id: unknown }>, activeId?: unknown } | null} doc
 * @param {unknown} selectedId the remembered selected part id, if any
 * @returns {unknown} a part id of `doc`, or null
 */
export function titleFocusPartId(doc, selectedId) {
  if (!doc || !Array.isArray(doc.parts)) return null;
  const has = (id) => id != null && doc.parts.some((row) => row && row.id === id);
  if (has(selectedId)) return selectedId;
  if (has(doc.activeId)) return doc.activeId;
  return null;
}
