/**
 * list_assemblies rows: the same set the Parts / Open picker shows.
 *
 * - saved v2 assemblies: `{ id, name }` (opaque surf id, no path)
 * - the open working copy, when it is not saved yet: the same shape; every
 *   row carries `open` so the caller can tell which one is loaded
 *
 * An older marker is unsupported_vault_version and is not listed.
 * A fresh repo has no marker yet. Listing it is the v2 id list (often empty)
 * plus the open unsaved assembly, which is why an unsaved assembly stays
 * visible (Pi 5 B1).
 */
export function assemblyRows({ v2 = [], open = null } = {}) {
  const rows = [];
  const seen = new Set();
  const openId = open?.id ? String(open.id) : null;
  for (const row of Array.isArray(v2) ? v2 : []) {
    const id = row?.id ? String(row.id) : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id, open: id === openId });
  }
  if (openId && !seen.has(openId)) {
    seen.add(openId);
    rows.push({ id: openId, name: typeof open.name === 'string' && open.name.trim() ? open.name.trim() : openId, open: true });
  }
  return rows;
}
