/**
 * list_assemblies rows: the same set the Parts / Open picker shows.
 *
 * - saved v2 assemblies: `{ id, name }` (opaque surf id, no path)
 * - the open working copy, when it is not saved yet: the same shape; every
 *   row carries `open` so the caller can tell which one is loaded
 * - legacy (name-only) assemblies on a v1 tree: `{ id: null, name, legacy: true }`;
 *   they have no opaque id until git_upgrade_vault, so open_assembly cannot
 *   take them, but the picker lists them and so does this
 *
 * The layout detector calls a vault with no version marker "legacy", which a
 * fresh repo is before its first Save. The old handler returned [] for every
 * non-v2 layout, so an open unsaved assembly was invisible (Pi 5 B1).
 */
export function assemblyRows({ v2 = [], legacyNames = [], open = null } = {}) {
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
  const names = new Set();
  for (const raw of Array.isArray(legacyNames) ? legacyNames : []) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    const key = name.toLowerCase();
    if (!name || names.has(key)) continue;
    names.add(key);
    rows.push({ id: null, name, legacy: true, open: false });
  }
  return rows;
}
