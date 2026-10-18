/**
 * Part groups: a Parts-list folder for parts inserted from another assembly.
 *
 * Not a multi-body solid and not a joint. Each member stays its own part.
 * `partIds` are surf ids. A part belongs to at most one group. Collapse is
 * not stored here.
 */
import { normalizeRepoPath, sanitizeAssemblyName, serializeAssembly } from './assembly.js';
import { isExternalPartPath, parseVaultPath, vaultSegment } from './git/vaultLayout.js';
import { planCopyToAssembly } from './git/gitWorkspace.js';
import { partRepoPath, partScriptText } from './git/partIdentity.js';
import { isSurfId, mintSurfId } from './git/surfId.js';

/** Group ids use the surf-id shape so they are stable and unique. They are not part ids. */
export function mintGroupId(opts = {}) {
  return mintSurfId({ ...opts, local: false });
}

/**
 * Visible Parts list. A group block is emitted where its first member sits;
 * that group's members follow in document order. Ungrouped rows stay put.
 * -> [{ kind: 'part', row, index } | { kind: 'group', group, parts: [{ row, index }] }]
 */
export function layoutPartFeed(rows, groups) {
  const list = Array.isArray(rows) ? rows : [];
  const membership = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const id of group?.partIds || []) {
      if (id && !membership.has(id)) membership.set(id, group);
    }
  }
  const emitted = new Set();
  const items = [];
  list.forEach((row, index) => {
    const group = row?.surfId ? membership.get(row.surfId) : null;
    if (!group) {
      items.push({ kind: 'part', row, index });
      return;
    }
    if (emitted.has(group.id)) return;
    emitted.add(group.id);
    const parts = [];
    list.forEach((member, memberIndex) => {
      if (member?.surfId && (group.partIds || []).includes(member.surfId)) {
        parts.push({ row: member, index: memberIndex });
      }
    });
    items.push({ kind: 'group', group, parts });
  });
  return items;
}

/**
 * Group newly inserted parts under the source assembly. Same `source` path
 * appends to the existing group (and keeps its name). Parts already grouped
 * are left where they are.
 */
export function withInsertedGroup(doc, {
  name,
  source,
  partIds,
  id,
  now,
  rand,
} = {}) {
  const sourcePath = normalizeRepoPath(source);
  const label = sanitizeAssemblyName(name);
  const incoming = (Array.isArray(partIds) ? partIds : []).filter((pid) => isSurfId(pid));
  if (!sourcePath || !label || !incoming.length) return serializeAssembly(doc);
  const already = new Set();
  for (const group of doc?.groups || []) {
    for (const pid of group?.partIds || []) already.add(pid);
  }
  const fresh = incoming.filter((pid) => !already.has(pid));
  if (!fresh.length) return serializeAssembly(doc);
  const existing = (doc?.groups || []).find((group) => group.source === sourcePath);
  let groups;
  if (existing) {
    groups = (doc.groups || []).map((group) => (
      group.id === existing.id
        ? { ...group, partIds: [...(group.partIds || []), ...fresh] }
        : group
    ));
  } else {
    const gid = id && isSurfId(id) ? id : mintGroupId({ now, rand });
    groups = [...(doc?.groups || []), {
      id: gid,
      name: label,
      source: sourcePath,
      partIds: fresh,
    }];
  }
  return serializeAssembly({ ...doc, groups });
}

/** Rename one group. Blank or unknown id leaves the document unchanged. */
export function renameGroup(doc, groupId, name) {
  const next = sanitizeAssemblyName(name);
  const groups = doc?.groups || [];
  if (!next || groupId == null || !groups.some((group) => group.id === groupId)) {
    return serializeAssembly(doc);
  }
  const current = groups.find((group) => group.id === groupId);
  if (current.name === next) return serializeAssembly(doc);
  return serializeAssembly({
    ...doc,
    groups: groups.map((group) => (group.id === groupId ? { ...group, name: next } : group)),
  });
}

/** Drop the group. Parts stay, ungrouped. */
export function ungroupParts(doc, groupId) {
  return serializeAssembly({
    ...doc,
    groups: (doc?.groups || []).filter((group) => group.id !== groupId),
  });
}

/**
 * Remove the group's parts from this assembly and drop the group.
 * Does not delete vault files; the caller only rewrites `.surf.json`.
 * -> { doc, removed: parts[] }
 */
export function removeGroupParts(doc, groupId) {
  const group = (doc?.groups || []).find((row) => row.id === groupId);
  if (!group) return { doc: serializeAssembly(doc), removed: [] };
  const ids = new Set(group.partIds || []);
  const removed = (doc?.parts || []).filter((part) => part?.surfId && ids.has(part.surfId));
  const drop = new Set(removed.map((part) => part.id));
  const parts = (doc?.parts || []).filter((part) => !drop.has(part.id));
  const groups = (doc?.groups || []).filter((row) => row.id !== groupId);
  let activeId = doc?.activeId;
  if (drop.has(activeId)) activeId = parts[0]?.id || null;
  return {
    doc: serializeAssembly({ ...doc, parts, groups, activeId }),
    removed,
  };
}

/**
 * Linked members live in another assembly's folder (or, before a path is
 * recorded, in a group whose `source` is that folder). Path-less copies
 * (`copiedFrom`) wait for Save to assign a path here and are not external.
 */
export function groupMemberIsExternal(doc, group, part) {
  const path = partRepoPath(part);
  if (path) return isExternalPartPath(doc?.name, path);
  if (part?.copiedFrom) return false;
  const info = parseVaultPath(group?.source);
  return info?.kind === 'assembly' && info.assembly !== vaultSegment(doc?.name);
}

/** Point a grouped surf id at the id of a copy. Other groups are unchanged. */
export function replaceGroupPartId(groups, fromSurfId, toSurfId) {
  if (!Array.isArray(groups) || !fromSurfId || !toSurfId || fromSurfId === toSurfId) return groups;
  return groups.map((group) => ({
    ...group,
    partIds: (group.partIds || []).map((id) => (id === fromSurfId ? toSurfId : id)),
  }));
}

/**
 * Copy every linked external member into this assembly. Same plan as a
 * single-part copy (`planCopyToAssembly`). The group stays; its part ids
 * follow the new surf ids. Parts already in this folder are left alone.
 * -> { doc, scripts, copies }
 */
export function copyGroupToAssembly(doc, scripts, groupId, { now, randFor } = {}) {
  const group = (doc?.groups || []).find((row) => row.id === groupId);
  if (!group) return { doc: serializeAssembly(doc), scripts: { ...(scripts || {}) }, copies: [] };
  let parts = (doc?.parts || []).map((part) => ({ ...part }));
  let groups = (doc?.groups || []).map((row) => ({ ...row, partIds: [...(row.partIds || [])] }));
  let activeId = doc?.activeId;
  const nextScripts = { ...(scripts || {}) };
  const copies = [];
  (group.partIds || []).forEach((surfId, index) => {
    const part = parts.find((row) => row.surfId === surfId);
    if (!part || !groupMemberIsExternal(doc, group, part)) return;
    const plan = planCopyToAssembly(
      { ...doc, parts, groups, activeId },
      part,
      partScriptText(part, nextScripts) || '',
      { now, rand: typeof randFor === 'function' ? randFor(index, part) : undefined },
    );
    nextScripts[plan.id] = plan.content;
    delete nextScripts[part.id];
    const oldPath = partRepoPath(part);
    if (oldPath && oldPath !== plan.id) delete nextScripts[oldPath];
    parts = parts.map((row) => (row.id === part.id ? {
      ...row,
      id: plan.id,
      name: plan.name,
      surfId: plan.surfId,
      path: undefined,
      copiedFrom: plan.copiedFrom || undefined,
      isSynced: false,
    } : row));
    groups = groups.map((row) => ({
      ...row,
      partIds: row.partIds.map((id) => (id === surfId ? plan.surfId : id)),
    }));
    if (activeId === part.id) activeId = plan.id;
    copies.push({ from: part.id, ...plan });
  });
  return {
    doc: serializeAssembly({ ...doc, parts, groups, activeId }),
    scripts: nextScripts,
    copies,
  };
}
