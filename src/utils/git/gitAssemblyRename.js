/**
 * Assembly rename commits on its own.
 *
 * Confirming a new name enqueues one outbox op. The sync worker is the
 * only writer, and it re-checks the vault marker before commitFiles.
 * The commit moves assemblies/<Old>/ to assemblies/<New>/ and rewrites
 * that .surf.json. An unsynced or local-only assembly renames in the
 * working copy and does not enqueue.
 */
import { assemblyName, serializeAssembly } from '../assembly.js';
import { prepareAssemblySurfWrite, remapAssemblyPaths } from './gitCommit.js';
import { captureBaseline, resolveAssemblyFolderName } from './gitWorkspace.js';
import { readSurfId, withSurfId } from './surfId.js';
import { assemblyDir, assemblyFilePath, parseVaultPath, vaultSegment } from './vaultLayout.js';

/**
 * A synced assembly has a tip baseline. Local mode, a missing repo, a
 * first-commit working copy, and a document whose every part is still
 * unsynced rename in place and do not commit.
 */
export function assemblyRenameNeedsCommit({ doc, repo, baseline } = {}) {
  if (!doc || doc.source !== 'git') return false;
  if (!repo?.owner || !repo?.name) return false;
  if (!baseline?.assemblyPath || !baseline?.headSha) return false;
  const parts = doc.parts || [];
  if (parts.length > 0 && parts.every((part) => part.isSynced === false)) return false;
  return true;
}

/**
 * Row Save chrome. In flight (create-style pending ids, or sending) is the
 * spinner. A queued or held rename is the yellow unsynced dot.
 */
export function partRowGitChrome({
  inflight = false,
  sync = null,
  contentDirty = false,
  renameHeld = false,
} = {}) {
  const pending = !!(inflight || sync === 'sending');
  const syncFailed = sync === 'failed';
  const dirty = !pending && !syncFailed && !!(contentDirty || renameHeld || sync === 'queued');
  return { pending, dirty, syncFailed };
}

/**
 * Baseline after the folder move. Assembly text matches the renamed
 * document, so the rename itself is not a manual Save. Scripts that this
 * commit did not write keep their previous baseline, so an unrelated edit
 * stays dirty. `renamePending` is not copied; the caller sets it while the
 * op is still queued.
 */
export function baselineAfterAssemblyRename(baseline, doc, scripts, { headSha = null, branch = null } = {}) {
  const captured = captureBaseline({
    assemblyPath: assemblyFilePath(vaultSegment(doc?.name) || doc?.name),
    assemblyName: doc?.name,
    doc,
    scripts,
    branch: branch || baseline?.branch || 'main',
    headSha: headSha || baseline?.headSha || null,
  });
  const name = captured.assemblyName;
  const scriptMap = {};
  for (const id of captured.partIds) {
    const info = parseVaultPath(id);
    const inFolder = info?.kind === 'assembly-part' && info.assembly === name;
    const had = !!(baseline?.scripts && Object.prototype.hasOwnProperty.call(baseline.scripts, id));
    if (inFolder && !had) {
      scriptMap[id] = typeof scripts?.[id] === 'string' ? scripts[id] : '';
    } else if (had) {
      scriptMap[id] = baseline.scripts[id];
    }
  }
  captured.scripts = scriptMap;
  return captured;
}

/**
 * Working copy + outbox payload for one assembly rename.
 * partIds are only paths that moved with the folder. parts/ stays put.
 * Path-less rows go through prepareAssemblySurfWrite first so .surf.json
 * is valid and the caller can refuse before mutating the working copy.
 */
export async function planAssemblyRename({
  doc, scripts = {}, nextName, baseline = null,
  adapter = null, repo = null, branch = 'main',
} = {}) {
  const oldName = vaultSegment(doc?.name) || assemblyName(doc);
  const newName = vaultSegment(nextName);
  const remapped = remapAssemblyPaths({ ...doc, name: newName }, scripts, oldName, newName);
  const nextDoc = serializeAssembly({ ...remapped.doc, name: newName, source: 'git' });
  if (!adapter || !repo) {
    throw new Error('Git adapter required to plan an assembly rename');
  }
  const prepared = await prepareAssemblySurfWrite(adapter, repo, {
    doc: nextDoc,
    scripts: remapped.scripts,
    branch: branch || baseline?.branch || 'main',
  });
  const workDoc = prepared.doc;
  const workScripts = prepared.scripts;
  const moved = [...(remapped.moved || []), ...(prepared.moved || [])];
  const localByPath = new Map();
  for (const { to } of remapped.moved || []) {
    const part = workDoc.parts.find((row) => row.id === to);
    let content = workScripts[to] ?? '';
    if (part?.surfId && readSurfId(content) !== part.surfId) {
      content = withSurfId(content, part.surfId);
    }
    localByPath.set(to, { path: to, content });
  }
  for (const { to } of prepared.moved || []) {
    if (!to || localByPath.has(to)) continue;
    localByPath.set(to, { path: to, content: workScripts[to] ?? '' });
  }
  const localFiles = [...localByPath.values()];
  const assemblyPath = prepared.assemblyPath || assemblyFilePath(newName);
  const assemblyText = prepared.assemblyText;
  const moves = localFiles.map((file) => {
    const from = moved.find((pair) => pair.to === file.path)?.from || '';
    const part = workDoc.parts.find((row) => row.id === file.path);
    return { from, to: file.path, surfId: part?.surfId || null, content: file.content };
  });
  return {
    oldName,
    newName,
    doc: workDoc,
    scripts: workScripts,
    moved,
    message: `Rename assembly ${oldName} to ${newName}`,
    partIds: moved.map((pair) => pair.to),
    assemblyText,
    fromName: oldName,
    toName: newName,
    moves,
    payload: {
      kind: 'assembly',
      fromName: oldName,
      toName: newName,
      label: newName,
      partId: workDoc.activeId,
      assemblyPath,
      assemblyText,
      localFiles,
      before: { doc, scripts, baseline },
    },
  };
}

/**
 * Resolve the folder (including Name (2)) and either stage a commit or
 * rename locally. Does not touch the store or the network.
 */
export async function stageAssemblyRename({
  doc,
  scripts = {},
  nextName,
  taken = [],
  repo = null,
  adapter = null,
  baseline = null,
} = {}) {
  if (!doc) return { status: 'blocked', reason: 'empty' };
  const current = assemblyName(doc);
  const resolved = resolveAssemblyFolderName(nextName, taken, { except: current });
  if (!resolved.ok) return { status: 'blocked', reason: resolved.reason, name: resolved.name || '' };
  if (resolved.unchanged || resolved.name === current) {
    return { status: 'unchanged', name: current, doc, scripts, commit: false };
  }
  if (!assemblyRenameNeedsCommit({ doc, repo, baseline })) {
    const localDoc = serializeAssembly({ ...doc, name: resolved.name });
    return { status: 'local', name: localDoc.name, doc: localDoc, scripts, commit: false };
  }
  try {
    const plan = await planAssemblyRename({
      doc,
      scripts,
      nextName: resolved.name,
      baseline,
      adapter,
      repo,
      branch: baseline?.branch || 'main',
    });
    const held = baselineAfterAssemblyRename(baseline, plan.doc, plan.scripts, {
      headSha: baseline?.headSha || null,
      branch: baseline?.branch || 'main',
    });
    held.renamePending = true;
    return {
      status: 'staged',
      commit: true,
      name: plan.newName,
      doc: plan.doc,
      scripts: plan.scripts,
      plan,
      baseline: held,
      enqueue: {
        op: 'rename',
        message: plan.message,
        partIds: plan.partIds,
        payload: plan.payload,
      },
    };
  } catch (err) {
    return {
      status: 'error',
      error: err?.message || 'Could not rename assembly',
      code: err?.code || 'rename_failed',
    };
  }
}

/**
 * Move cache rows so a reload reads the new folder.
 * asm: the new .surf.json, old key dropped.
 * part: surf id now points at the new path.
 * alias: the old path still resolves to that surf id.
 * path: the old path is dropped so it is not a live file.
 * A cached tree snapshot moves with the folder.
 */
export async function applyAssemblyRenameCache(store, repo, branch, plan) {
  if (!store || !repo || !plan?.fromName || !plan?.toName) return;
  const fromName = vaultSegment(plan.fromName);
  const toName = vaultSegment(plan.toName);
  const fromDir = `${assemblyDir(fromName)}/`;
  const toDir = `${assemblyDir(toName)}/`;
  const fromPath = assemblyFilePath(fromName);
  const toPath = assemblyFilePath(toName);
  const assemblyText = plan.assemblyText || plan.payload?.assemblyText || '';
  const tree = store.getTree(repo, branch);
  if (tree) {
    const next = [];
    for (const entry of tree) {
      const path = String(entry?.path || '');
      if (path.startsWith(fromDir)) {
        const dest = `${toDir}${path.slice(fromDir.length)}`;
        next.push({
          path: dest,
          content: dest === toPath ? assemblyText : (entry.content ?? ''),
        });
      } else {
        next.push({ path, content: entry.content ?? '' });
      }
    }
    for (const move of plan.moves || []) {
      if (!move?.to || typeof move.content !== 'string') continue;
      const hit = next.find((entry) => entry.path === move.to);
      if (hit) hit.content = move.content;
    }
    if (!next.some((entry) => entry.path === toPath)) {
      next.push({ path: toPath, content: assemblyText });
    }
    await store.putTree(repo, branch, next);
  }
  if (fromPath !== toPath) {
    await store.dropAssembly(repo, fromPath);
    await store.dropPathId(repo, fromPath);
  }
  await store.putAssembly(repo, toPath, assemblyText);
  for (const move of plan.moves || []) {
    if (!move?.to) continue;
    if (move.surfId) {
      await store.putPart(repo, {
        surfId: move.surfId,
        path: move.to,
        previousPath: move.from || null,
        content: move.content ?? '',
      });
      await store.rememberPathId(repo, move.to, move.surfId);
    }
    if (move.from && move.from !== move.to) await store.dropPathId(repo, move.from);
  }
}
