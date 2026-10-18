/**
 * @param {{
 *   assemblyId?: string | null,
 *   activeId?: string | null,
 *   assemblyName?: string,
 *   vaultLayout?: 'v2' | 'legacy',
 *   parts?: Array<{ id: string, name?: string, visible?: boolean, group?: string, missing?: boolean }>,
 * }} input
 */
export function buildPartsState(input = {}) {
  const parts = Array.isArray(input.parts)
    ? input.parts.map((row) => {
      const part = {
        id: String(row.id),
        name: typeof row.name === 'string' ? row.name : '',
        visible: row.visible !== false,
      };
      if (typeof row.group === 'string') part.group = row.group;
      if (row.missing === true) part.missing = true;
      return part;
    })
    : [];
  const out = {
    activeId: input.activeId ?? null,
    assemblyName: typeof input.assemblyName === 'string' ? input.assemblyName : '',
    parts,
  };
  if (typeof input.assemblyId === 'string' && input.assemblyId) {
    out.assemblyId = input.assemblyId;
  }
  if (input.vaultLayout === 'v2' || input.vaultLayout === 'legacy') {
    out.vaultLayout = input.vaultLayout;
  }
  return out;
}
