/**
 * Edge picks that span more than one part (Fillet / Chamfer).
 *
 * A pick on another part retargets the edit target and rebinds the graphs,
 * but an open Fillet or Chamfer session keeps the edges already picked on
 * the previous part. Each edge carries the part it was picked on; its
 * points and face / boundary ids are in that part's local frame and mesh.
 * Accept writes one marked block per part: the editor part through the
 * editor, every other part in the background (one feature step on that
 * part's own stack). No external copy is involved, and nothing is linked.
 */

/** Part id of a picked edge. Untagged edges belong to `fallback`. */
export function edgePartId(edge, fallback = null) {
  const id = edge?.partId;
  if (id != null && id !== '') return String(id);
  return fallback == null || fallback === '' ? null : String(fallback);
}

/**
 * Picks grouped by part, in first-pick order. Untagged edges go to the
 * active part.
 * @returns {{ partId: string|null, edges: object[] }[]}
 */
export function groupEdgesByPart(edges, activeId = null) {
  const out = [];
  const byId = new Map();
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edge) continue;
    const id = edgePartId(edge, activeId);
    const k = id ?? '';
    let group = byId.get(k);
    if (!group) {
      group = { partId: id, edges: [] };
      byId.set(k, group);
      out.push(group);
    }
    group.edges.push(edge);
  }
  return out;
}

/** Picks that belong to the active part (untagged included). */
export function activePartEdges(edges, activeId = null) {
  const active = activeId == null || activeId === '' ? null : String(activeId);
  return (Array.isArray(edges) ? edges : []).filter((edge) => {
    if (!edge) return false;
    const id = edgePartId(edge, null);
    return !active || !id || id === active;
  });
}

/** Picks on parts other than the active one, grouped by part. */
export function foreignPartEdgeGroups(edges, activeId = null) {
  const active = activeId == null || activeId === '' ? null : String(activeId);
  if (!active) return [];
  return groupEdgesByPart(edges, active).filter((group) => group.partId && group.partId !== active);
}

/**
 * Does a part switch keep the current edge picks? Fillet and Chamfer do:
 * picks accumulate across parts. Everything else still clears on retarget.
 */
export function retargetKeepsEdgePicks({ filletMode = null } = {}) {
  return !!filletMode;
}

/**
 * Params one part's picks are validated and written with.
 *
 * A radius the user set applies to every part. A radius the user never
 * touched is the fixed 2 mm seed, the same on every part.
 *
 * @param {object} params    session params (Fillet mode state.params)
 * @param {object[]} edges   picks of one part
 * @param {{ touched?: boolean, seed?: (edges: object[]) => number }} [opts]
 * @returns {object}
 */
export function partEdgeParams(params, edges, { touched = false, seed = null } = {}) {
  const base = params || {};
  if (touched || typeof seed !== 'function') return base;
  if (!Array.isArray(edges) || !edges.length) return base;
  const radius = Number(seed(edges));
  if (!(Number.isFinite(radius) && radius > 0)) return base;
  return { ...base, radius };
}

/**
 * Validate a multi-part Fillet / Chamfer Accept before anything is written.
 * One failing part fails the whole Accept, so a part is never half done.
 *
 * @param {{ edges: object[], activeId?: string|null, validate: (edges: object[]) => object, partName?: (id: string) => string }} args
 * @returns {{ ok: true, groups: { partId: string|null, edges: object[], gate: object }[] } | { ok: false, message: string, partId?: string|null }}
 */
export function planMultiPartEdgeAccept({ edges, activeId = null, validate, partName = null } = {}) {
  const groups = groupEdgesByPart(edges, activeId);
  if (!groups.length) {
    const gate = validate([]);
    return { ok: false, message: gate?.message || 'Pick edges first.' };
  }
  const out = [];
  for (const group of groups) {
    const gate = validate(group.edges);
    if (!gate?.ok) {
      const name = groups.length > 1 && group.partId
        ? (typeof partName === 'function' ? partName(group.partId) : group.partId)
        : null;
      const message = name ? `${name}: ${gate?.message || 'cannot fillet those edges.'}` : (gate?.message || 'Cannot fillet those edges.');
      return { ok: false, message, partId: group.partId };
    }
    out.push({ partId: group.partId, edges: group.edges, gate });
  }
  return { ok: true, groups: out };
}

/**
 * Compose one marked Fillet / Chamfer block per part, before anything is
 * written. The editor part is composed on the live buffer; every other part
 * on its saved script. A part already holding that kind's block gets an
 * append (same rule as a second Accept on one part). A part with no script,
 * or whose last run failed, refuses the whole Accept.
 *
 * @param {{
 *   chamfer?: boolean,
 *   groups: { partId: string|null, edges: object[], params?: object, filletClass?: string|null, geometry?: object|null }[],
 *   editorId?: string|null,
 *   editorBuffer?: string,
 *   parts?: Record<string, { script: string|null, name?: string, ok?: boolean }>,
 *   compose: (buffer: string, opts: object) => { ok: boolean, buffer?: string, message?: string },
 *   hasBlock: (buffer: string) => boolean,
 * }} args
 * @returns {{ ok: true, editor: { buffer: string }|null, writes: { id: string, buffer: string, message: string, name: string }[] } | { ok: false, message: string }}
 */
export function composeMultiPartEdgeCommit({
  chamfer = false,
  groups = [],
  editorId = null,
  editorBuffer = '',
  parts = {},
  compose,
  hasBlock,
} = {}) {
  const label = chamfer ? 'Chamfer' : 'Fillet';
  const editor = editorId == null || editorId === '' ? null : String(editorId);
  // Merge groups that land on the same part (defensive: one block per part).
  const merged = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group?.edges?.length) continue;
    const id = group.partId == null || group.partId === '' ? editor : String(group.partId);
    const k = id ?? '';
    const prev = merged.get(k);
    if (prev) prev.edges = prev.edges.concat(group.edges);
    else merged.set(k, { ...group, partId: id, edges: group.edges.slice() });
  }
  if (!merged.size) return { ok: false, message: `Pick edges in ${label} mode, then Accept.` };
  let editorOut = null;
  const writes = [];
  for (const group of merged.values()) {
    const onEditor = !group.partId || group.partId === editor;
    const info = onEditor ? null : parts?.[group.partId];
    const name = (info?.name || group.partId || 'part');
    let buffer;
    if (onEditor) {
      buffer = String(editorBuffer || '');
    } else {
      if (!info) return { ok: false, message: `${label}: that part is no longer in the assembly.` };
      if (typeof info.script !== 'string') return { ok: false, message: `${label}: "${name}" has no script yet.` };
      if (info.ok === false) return { ok: false, message: `${label}: "${name}" failed its last run — fix it first.` };
      buffer = info.script;
    }
    const result = compose(buffer, {
      ...(chamfer ? { entry: 'chamferEdges' } : {}),
      edges: group.edges,
      params: group.params || {},
      filletClass: group.filletClass ?? null,
      geometry: group.geometry ?? null,
      commitMode: hasBlock(buffer) ? 'append' : 'replace',
    });
    if (!result?.ok || typeof result.buffer !== 'string') {
      const why = result?.message || `could not write ${label}.`;
      return { ok: false, message: merged.size > 1 ? `${name}: ${why}` : why };
    }
    if (onEditor) editorOut = { buffer: result.buffer };
    else writes.push({ id: group.partId, buffer: result.buffer, message: `${label} mode`, name });
  }
  return { ok: true, editor: editorOut, writes };
}
