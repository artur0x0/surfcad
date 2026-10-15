/**
 * @param {{
 *   activeId?: string | null,
 *   assemblyName?: string,
 *   parts?: Array<{ id: string, name?: string, visible?: boolean, path?: string, group?: string }>,
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
      if (typeof row.path === 'string') part.path = row.path;
      if (typeof row.group === 'string') part.group = row.group;
      return part;
    })
    : [];
  return {
    activeId: input.activeId ?? null,
    assemblyName: typeof input.assemblyName === 'string' ? input.assemblyName : '',
    parts,
  };
}
