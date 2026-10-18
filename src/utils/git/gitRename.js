/**
 * Atomic rename: one commit moves the file or folder and rewrites every
 * `.surf.json` that references that part id (or the old path, for repos
 * that have not been backfilled yet).
 */
import { isBinaryContent, toUint8Array } from './binaryContent.js';
import { fileDelete, fileWrite } from './githubAdapterInterface.js';
import { assemblyDir, assemblyFilePath, assemblyPartPath, assetPathForScript, isAssemblyFile, parseVaultPath, sharedPartPath, vaultSegment } from './vaultLayout.js';
import { isSurfId, isSurfJsonPath, partSurfId, readSurfId, withSurfId } from './surfId.js';
import { findAssemblyPart, partKeepsStableId, partRepoPath, partScriptText } from './partIdentity.js';

/**
 * New repo path for a renamed part. The file stays in its current folder
 * (this assembly, another assembly, or loose `parts/`). Null when the path
 * cannot move (local row, empty name, unchanged).
 */
export function planPartPath(fromPath, newName) {
  const info = parseVaultPath(fromPath);
  const name = vaultSegment(String(newName || '').replace(/\.js$/i, ''));
  if (!info || !name) return null;
  if (info.kind === 'shared-part') return sharedPartPath(name);
  if (info.kind === 'assembly-part') return assemblyPartPath(info.assembly, name);
  return null;
}

/**
 * Rewrite paths (and an assembly display name) inside one `.surf.json`.
 * `pathMap` is old path → new path. A part rename can also pass surfId +
 * from/to so a reference is updated even when the stored path drifted.
 * `name` updates that part's display name; other rows are left alone.
 */
export function rewriteSurfText(text, {
  pathMap = null,
  surfId = null,
  from = null,
  to = null,
  name = null,
  renameAssembly = null,
} = {}) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return text;
  }
  if (!raw || typeof raw !== 'object') return text;
  const mapPath = (value) => {
    if (pathMap && pathMap.has(value)) return pathMap.get(value);
    if (from && to && value === from) return to;
    return value;
  };
  let changed = false;
  if (Array.isArray(raw.parts)) {
    for (const part of raw.parts) {
      const byId = !!(surfId && part?.id === surfId);
      const isTarget = byId || !!(from && part?.path === from);
      const mapped = mapPath(part?.path);
      const next = (isTarget && to) ? to : mapped;
      if (next && next !== part.path) {
        part.path = next;
        changed = true;
      }
      if (isTarget && name && part.name !== name) {
        part.name = name;
        changed = true;
      }
    }
  }
  if (typeof raw.activeId === 'string') {
    const next = mapPath(raw.activeId);
    if (next !== raw.activeId) {
      raw.activeId = next;
      changed = true;
    }
  }
  if (renameAssembly && raw.name === renameAssembly.from && renameAssembly.to) {
    raw.name = renameAssembly.to;
    changed = true;
  }
  if (!changed) return text;
  return `${JSON.stringify(raw, null, 2)}\n`;
}

/**
 * Assembly-local copies move with the folder. Stamp the surf id from the
 * new `.surf.json` (else the header already on the script) so the new path
 * is still the same part.
 */
function stampMovedAssemblyParts(writes, toName) {
  const meta = assemblyFilePath(toName);
  let raw = null;
  try {
    raw = JSON.parse(writes.get(meta) || '');
  } catch {
    raw = null;
  }
  const byPath = new Map();
  for (const part of raw?.parts || []) {
    if (part?.path && isSurfId(part?.id)) byPath.set(part.path, part.id);
  }
  for (const [path, content] of [...writes.entries()]) {
    const info = parseVaultPath(path);
    if (info?.kind !== 'assembly-part' || typeof content !== 'string') continue;
    const surfId = byPath.get(path) || readSurfId(content);
    if (!isSurfId(surfId) || readSurfId(content) === surfId) continue;
    writes.set(path, withSurfId(content, surfId));
  }
}

/**
 * Files for one atomic rename commit.
 * entries: [{ path, content }] of part scripts and `.surf.json` files.
 * plan.kind 'part': { surfId, from, to, content }
 * plan.kind 'assembly': { fromName, toName, assemblyPath, assemblyText, localFiles }
 * -> { files: [{ path, content } | { path, delete: true }] }
 */
export function buildRenameCommitFiles({ entries, plan } = {}) {
  const byPath = new Map();
  for (const entry of entries || []) {
    if (entry?.path) byPath.set(entry.path, entry.content ?? '');
  }
  const writes = new Map();
  const deletes = new Set();

  if (plan?.kind === 'part') {
    // Tip bytes win. Live buffer in `plan.content` is only a fallback when
    // the tree has not seen this file yet (retry after the move already landed).
    const body = byPath.has(plan.from)
      ? (byPath.get(plan.from) ?? '')
      : (byPath.has(plan.to)
        ? (byPath.get(plan.to) ?? '')
        : (plan.content != null ? plan.content : ''));
    if (plan.missing === true && !(typeof body === 'string' && body.length > 0)) {
      throw new Error(`Refusing empty write for missing part ${plan.from || plan.to || ''}`);
    }
    if (plan.to) writes.set(plan.to, body);
    if (plan.from && plan.from !== plan.to) deletes.add(plan.from);
    const fromMesh = assetPathForScript(plan.from);
    const toMesh = assetPathForScript(plan.to);
    if (fromMesh && toMesh && fromMesh !== toMesh) {
      const raw = isBinaryContent(plan.asset) ? plan.asset : byPath.get(fromMesh);
      if (isBinaryContent(raw)) {
        writes.set(toMesh, toUint8Array(raw));
        deletes.add(fromMesh);
      } else if (raw != null && byPath.has(fromMesh)) {
        writes.set(toMesh, raw);
        deletes.add(fromMesh);
      }
    }
    for (const extra of plan.extraFiles || []) {
      if (!extra?.path) continue;
      if (extra.delete) deletes.add(extra.path);
      else writes.set(extra.path, extra.content ?? '');
    }
    if (plan.assemblyPath && typeof plan.assemblyText === 'string') {
      writes.set(plan.assemblyPath, plan.assemblyText);
    }
    for (const [path, text] of byPath) {
      if (!isAssemblyFile(path) && !isSurfJsonPath(path)) continue;
      if (plan.assemblyPath && path === plan.assemblyPath && typeof plan.assemblyText === 'string') continue;
      const next = rewriteSurfText(text, {
        surfId: plan.surfId,
        from: plan.from,
        to: plan.to,
        name: plan.name,
      });
      if (next !== text) writes.set(path, next);
    }
  } else if (plan?.kind === 'assembly') {
    const fromName = vaultSegment(plan.fromName);
    const toName = vaultSegment(plan.toName);
    const fromDir = `${assemblyDir(fromName)}/`;
    const toDir = `${assemblyDir(toName)}/`;
    const pathMap = new Map();
    for (const [path, text] of byPath) {
      if (!path.startsWith(fromDir)) continue;
      const dest = `${toDir}${path.slice(fromDir.length)}`;
      pathMap.set(path, dest);
      writes.set(dest, text);
      deletes.add(path);
    }
    for (const local of plan.localFiles || []) {
      if (!local?.path) continue;
      const info = parseVaultPath(local.path);
      if (info?.kind === 'asset' && isBinaryContent(local.content)) {
        if (!info.assembly || info.assembly === toName) writes.set(local.path, toUint8Array(local.content));
        continue;
      }
      if (typeof local.content !== 'string') continue;
      // Shared parts/ files do not move with the folder. Only an
      // assembly-local copy in the destination folder is overwritten.
      if (info?.kind !== 'assembly-part' || info.assembly !== toName) continue;
      writes.set(local.path, local.content);
    }
    if (plan.assemblyPath && typeof plan.assemblyText === 'string') {
      writes.set(plan.assemblyPath, plan.assemblyText);
    } else if (toName) {
      const meta = assemblyFilePath(toName);
      if (writes.has(meta)) {
        writes.set(meta, rewriteSurfText(writes.get(meta), {
          pathMap,
          renameAssembly: { from: fromName, to: toName },
        }));
      }
    }
    for (const path of writes.keys()) {
      if (!isAssemblyFile(path) || path === plan.assemblyPath) continue;
      if ([...pathMap.keys()].includes(path)) continue;
      const next = rewriteSurfText(writes.get(path), {
        pathMap,
        renameAssembly: path === assemblyFilePath(toName) ? { from: fromName, to: toName } : null,
      });
      if (next !== writes.get(path)) writes.set(path, next);
    }
    for (const [path, text] of byPath) {
      if (!isAssemblyFile(path) || pathMap.has(path)) continue;
      const next = rewriteSurfText(text, { pathMap });
      if (next !== text) writes.set(path, next);
    }
    stampMovedAssemblyParts(writes, toName);
  }

  for (const path of [...deletes]) {
    if (writes.has(path)) deletes.delete(path);
  }
  const files = [
    ...[...writes.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([path, content]) => fileWrite(path, content)),
    ...[...deletes].sort().map((path) => fileDelete(path)),
  ];
  return { files };
}

/** Apply a commit file list onto a path→content snapshot (cache or a test tree). */
export function projectFiles(entries, files) {
  const map = new Map((entries || []).map((entry) => [entry.path, entry.content ?? '']));
  for (const file of files || []) {
    if (!file?.path) continue;
    if (file.delete) map.delete(file.path);
    else map.set(file.path, file.content ?? '');
  }
  return [...map.entries()].map(([path, content]) => ({ path, content }));
}

/**
 * Working copy after a part path change. Script bytes move with the path.
 * surfId is left alone (serialize keeps it).
 */
export function applyPartPathChange(doc, scripts, from, to, name) {
  const nextScripts = { ...(scripts || {}) };
  const hit = findAssemblyPart(doc, from);
  if (hit && partKeepsStableId(hit)) {
    const text = partScriptText(hit, nextScripts);
    if (typeof text === 'string') nextScripts[hit.id] = text;
    const oldPath = partRepoPath(hit);
    if (oldPath && oldPath !== hit.id) delete nextScripts[oldPath];
    const parts = (doc?.parts || []).map((part) => (
      part.id === hit.id ? { ...part, path: to, name: name || part.name } : part
    ));
    return { doc: { ...doc, parts, activeId: doc?.activeId }, scripts: nextScripts };
  }
  if (from !== to) {
    nextScripts[to] = nextScripts[from] ?? nextScripts[to] ?? '';
    delete nextScripts[from];
  }
  const parts = (doc?.parts || []).map((part) => (
    part.id === from ? { ...part, id: to, path: to, name: name || part.name } : part
  ));
  const activeId = doc?.activeId === from ? to : doc?.activeId;
  return { doc: { ...doc, parts, activeId }, scripts: nextScripts };
}

/**
 * A reload that still sees the old path (git not pushed yet, or a stale
 * cache row) must follow the pending rename instead of forking a new part.
 * A part rename carries `{ kind:'part', from, to, surfId }`. An assembly
 * rename carries `{ kind:'assembly', fromName, toName }` and only moves
 * assembly-local copies. `groups[].source` is left as stored.
 */
function applyPendingAssemblyRename(doc, scripts, payload) {
  const fromName = vaultSegment(payload?.fromName);
  const toName = vaultSegment(payload?.toName);
  if (!fromName || !toName || fromName === toName) return { doc, scripts };
  const nextScripts = { ...(scripts || {}) };
  const parts = (doc?.parts || []).map((part) => {
    const info = parseVaultPath(part.id);
    if (info?.kind !== 'assembly-part' || info.assembly !== fromName) return part;
    const to = assemblyPartPath(toName, info.part);
    if (to === part.id) return part;
    if (Object.prototype.hasOwnProperty.call(nextScripts, part.id) && nextScripts[to] == null) {
      nextScripts[to] = nextScripts[part.id];
    }
    delete nextScripts[part.id];
    return { ...part, id: to };
  });
  let activeId = doc?.activeId;
  const activeInfo = parseVaultPath(activeId);
  if (activeInfo?.kind === 'assembly-part' && activeInfo.assembly === fromName) {
    activeId = assemblyPartPath(toName, activeInfo.part);
  }
  const name = vaultSegment(doc?.name) === fromName ? toName : doc?.name;
  return { doc: { ...doc, name, parts, activeId }, scripts: nextScripts };
}

export function overlayPendingPartRenames(doc, scripts, ops) {
  let nextDoc = doc;
  let nextScripts = { ...(scripts || {}) };
  for (const op of ops || []) {
    if (op?.op !== 'rename' || op.status === 'done') continue;
    if (op.payload?.kind === 'assembly') {
      const applied = applyPendingAssemblyRename(nextDoc, nextScripts, op.payload);
      nextDoc = applied.doc;
      nextScripts = applied.scripts;
      continue;
    }
    if (op.payload?.kind !== 'part') continue;
    const { from, to, surfId } = op.payload;
    if (!from || !to || from === to) continue;
    const parts = nextDoc?.parts || [];
    const hasTo = parts.some((part) => part.id === to);
    const hit = parts.find((part) => part.id === from || (surfId && partSurfId(part) === surfId && part.id !== to));
    if (!hit) continue;
    if (hasTo && hit.id !== to) {
      const dropped = parts.filter((part) => part.id !== hit.id);
      nextDoc = {
        ...nextDoc,
        parts: dropped,
        activeId: nextDoc.activeId === hit.id ? to : nextDoc.activeId,
      };
      if (nextScripts[hit.id] != null && nextScripts[to] == null) nextScripts[to] = nextScripts[hit.id];
      delete nextScripts[hit.id];
      continue;
    }
    if (hit.id === to) continue;
    const applied = applyPartPathChange(nextDoc, nextScripts, hit.id, to, op.payload.label || hit.name);
    nextDoc = applied.doc;
    nextScripts = applied.scripts;
  }
  return { doc: nextDoc, scripts: nextScripts };
}

/** Read part scripts and assembly metadata the rename commit has to rewrite. */
export async function readRenameEntries(adapter, repo, branch) {
  const tree = await adapter.listTree(repo, branch);
  const entries = [];
  for (const entry of tree || []) {
    const path = entry?.path ?? entry;
    const info = parseVaultPath(path);
    if (info?.kind === 'asset') {
      if (typeof adapter.readBlob !== 'function' || !entry?.sha) continue;
      const bytes = await adapter.readBlob(repo, entry.sha);
      if (bytes instanceof Uint8Array) entries.push({ path, content: bytes, sha: entry.sha });
      continue;
    }
    if (!isAssemblyFile(path) && !isPartScriptPath(path)) continue;
    const file = await adapter.readFile(repo, path, branch);
    if (file) entries.push({ path, content: file.content, sha: file.sha || entry.sha || null });
  }
  return entries;
}

function isPartScriptPath(path) {
  const info = parseVaultPath(path);
  return info?.kind === 'assembly-part' || info?.kind === 'shared-part';
}

/** Outbox rename payload -> buildRenameCommitFiles plan (includes extraFiles). */
export function renamePlanFromPayload(payload) {
  if (payload?.kind === 'assembly') {
    return {
      kind: 'assembly',
      fromName: payload.fromName,
      toName: payload.toName,
      assemblyPath: payload.assemblyPath,
      assemblyText: payload.assemblyText,
      localFiles: payload.localFiles || [],
      extraFiles: payload.extraFiles || [],
    };
  }
  return {
    kind: 'part',
    surfId: payload?.surfId || readSurfId(payload?.content || '') || null,
    from: payload?.from,
    to: payload?.to,
    name: payload?.name || payload?.label || null,
    content: payload?.content,
    asset: payload?.asset,
    assemblyPath: payload?.assemblyPath,
    assemblyText: payload?.assemblyText,
    extraFiles: payload?.extraFiles || [],
  };
}

/**
 * Build the rename commit from the remote tree. A part rename uses the
 * committed tip bytes of the moved file (not the live buffer) and rewrites
 * every `.surf.json` that references that id: path and display name only.
 * Used by the sync worker at flush time so an offline rename still rewrites
 * every assembly that references the id.
 */
export async function materializeRename(adapter, repo, branch, payload) {
  const entries = await readRenameEntries(adapter, repo, branch);
  return buildRenameCommitFiles({ entries, plan: renamePlanFromPayload(payload) });
}

export function renameFailureToast(item, err) {
  const label = item?.payload?.label || item?.payload?.to || 'item';
  return {
    kind: 'rename-failed',
    message: `Could not rename ${label}: ${err?.message || 'failed'}`,
    actions: ['retry', 'revert'],
    opId: item?.id ?? null,
    partId: item?.payload?.partId || item?.payload?.to || null,
  };
}
