/**
 * Cache-first sync worker.
 *
 * FIFO per repo and branch. Ops for another branch stay queued and are not
 * pushed onto this tip. Pushes immediately when online. On reconnect: look at
 * the remote commit SHA first. If it differs from lastSyncedSha for this
 * branch, do not push and do not overwrite. A user Save shows the yellow
 * warning toast. An open, reload, or background flush shows the G13 popup.
 * Overwrite main passes `force` and commits the queued files on the current
 * tip; those paths take the local bytes and every other remote file stays.
 * Those two UIs are not both shown for the same result.
 * Otherwise push the queue. Part ids are not rewritten on push.
 */
import { normalizeOutboxFiles } from './binaryContent.js';
import { materializeRename, renameFailureToast } from './gitRename.js';
import { deleteAssemblyFailureToast } from './gitDeleteAssembly.js';
import { isImplicitVaultWriteOp } from './vaultImplicitWrite.js';
import { GitAdapterError } from './githubAdapterInterface.js';
import { isVaultWriteRefusal, repoHasVaultMarker, vaultWriteRefusalMessage } from './vault.js';
import { writeVaultCommit } from './writeVaultCommit.js';

/**
 * Push queued ops for one repo.
 * -> { status: 'idle'|'offline'|'conflict'|'failed'|'synced', ... }
 * conflict: remote commit SHA !== lastSyncedSha, and `force` was not set.
 * Nothing was written. `force` commits the queue on the current tip.
 * failed: the rename (or other) op failed; `toast` is set for renames.
 */
export async function flushSyncQueue({
  store,
  adapter,
  repo,
  branch = 'main',
  online = true,
  force = false,
} = {}) {
  if (!store || !adapter || !repo) return { status: 'idle' };
  await store.ready();
  const queued = store.pending(repo, branch);
  if (!online) return { status: 'offline', pending: queued.length, branch };
  if (!queued.length) return { status: 'idle', sha: store.getLastSyncedSha(repo, branch), branch };

  // Re-check the marker on every flush. A cached handle can outlive a rename
  // that points this name at a different repo. Refusal leaves the outbox queued.
  let marked;
  try {
    marked = await repoHasVaultMarker(adapter, repo, branch);
  } catch (err) {
    return {
      status: 'failed',
      error: err?.message || vaultWriteRefusalMessage(repo),
      code: 'not_a_vault',
      branch,
      pending: queued.length,
    };
  }
  if (!marked.ok) {
    return {
      status: 'failed',
      error: vaultWriteRefusalMessage(marked.repo || repo),
      code: 'not_a_vault',
      branch,
      pending: queued.length,
    };
  }
  const writeRepo = marked.repo || repo;

  const remote = (await adapter.getBranch(writeRepo, branch))?.sha || null;
  const synced = store.getLastSyncedSha(repo, branch);
  // This is the guard that blocks a force-write. A moved tip stays put
  // until the user chooses Overwrite main (`force`). That commit uses the
  // current tip as baseSha, so the queued paths take the local bytes.
  if (!force && synced && remote && remote !== synced) {
    return {
      status: 'conflict',
      remoteSha: remote,
      lastSyncedSha: synced,
      branch,
      baseSha: synced,
      syncHold: true,
      warning: 'The repo moved since the last sync. Nothing was overwritten.',
    };
  }

  let head = remote;
  const promoted = {};
  const syncedPartIds = [];
  const layoutMoves = [];
  const assemblyRenames = [];
  const partRenames = [];
  const meshes = [];
  const writtenFiles = [];
  let otherWrites = false;
  let implicitSkipped = 0;
  for (const item of queued) {
    await store.setOpStatus(item.id, 'sending');
    await store.setPartsState(repo, item.partIds, 'sending', item.branch || branch);
    try {
      if (isImplicitVaultWriteOp(item)) {
        implicitSkipped += 1;
        await store.setOpStatus(item.id, 'done');
        await store.setPartsState(repo, item.partIds, 'clean', item.branch || branch);
        continue;
      }
      let files = item.files || [];
      if (item.op === 'rename') {
        const built = await materializeRename(adapter, writeRepo, branch, item.payload);
        files = built.files;
      }
      if (!files.length) {
        await store.setOpStatus(item.id, 'done');
        await store.setPartsState(repo, item.partIds, 'clean', item.branch || branch);
        continue;
      }
      let plannedMoves = null;
      const committedFiles = await normalizeOutboxFiles(files);
      const res = await writeVaultCommit({
        adapter,
        repo: writeRepo,
        branch,
        message: item.message || 'Sync',
        files: committedFiles,
        baseSha: head,
      });
      head = res.sha;
      writtenFiles.push(...committedFiles);
      if (plannedMoves) layoutMoves.push(...plannedMoves);
      syncedPartIds.push(...(item.partIds || []));
      if (Array.isArray(item.payload?.meshes)) meshes.push(...item.payload.meshes);
      if (item.op === 'rename' && item.payload?.kind === 'assembly') {
        assemblyRenames.push({
          fromName: item.payload.fromName,
          toName: item.payload.toName,
        });
      } else if (item.op === 'rename' && item.payload?.kind === 'part') {
        partRenames.push({
          from: item.payload.from,
          to: item.payload.to,
          name: item.payload.name || item.payload.label || null,
          surfId: item.payload.surfId || null,
          partId: item.payload.partId || null,
        });
      } else {
        otherWrites = true;
      }
      await store.setLastSyncedSha(repo, head, branch);
      await store.setOpStatus(item.id, 'done');
      await store.setPartsState(repo, item.partIds, 'clean', item.branch || branch);
    } catch (err) {
      if (err instanceof GitAdapterError && err.code === 'non_fast_forward') {
        await store.setOpStatus(item.id, 'queued', '');
        await store.setPartsState(repo, item.partIds, 'queued', item.branch || branch);
        return {
          status: 'conflict',
          code: 'non_fast_forward',
          remoteSha: head,
          lastSyncedSha: synced,
          branch,
          baseSha: synced || head,
          syncHold: true,
          warning: 'The repo moved since the last sync. Nothing was overwritten.',
          pending: store.pending(repo, branch).length,
        };
      }
      if (isVaultWriteRefusal(err)) {
        await store.setOpStatus(item.id, 'queued', '');
        await store.setPartsState(repo, item.partIds, 'queued', item.branch || branch);
        return {
          status: 'failed',
          op: item,
          error: err.message || vaultWriteRefusalMessage(writeRepo),
          code: 'not_a_vault',
          sha: head,
          branch,
          promoted,
          partIds: syncedPartIds,
          layoutMoves,
          pending: store.pending(repo, branch).length,
        };
      }
      // A failed assembly rename stays queued so the next flush retries it.
      // The row shows the yellow unsynced dot, not a dropped op.
      if (item.op === 'rename' && item.payload?.kind === 'assembly') {
        await store.setOpStatus(item.id, 'queued', err?.message || 'Sync failed');
        await store.setPartsState(repo, item.partIds, 'queued', item.branch || branch);
        return {
          status: 'failed',
          op: item,
          error: err?.message || 'Sync failed',
          code: 'rename-held',
          sha: head,
          branch,
          promoted,
          partIds: syncedPartIds,
          layoutMoves,
          pending: store.pending(repo, branch).length,
        };
      }
      await store.setOpStatus(item.id, 'failed', err?.message || 'Sync failed');
      await store.setPartsState(repo, item.partIds, 'failed', item.branch || branch);
      return {
        status: 'failed',
        op: item,
        error: err?.message || 'Sync failed',
        toast: item.op === 'rename'
          ? renameFailureToast(item, err)
          : (item.op === 'delete-assembly' ? deleteAssemblyFailureToast(item, err) : null),
        sha: head,
        branch,
        promoted,
        partIds: syncedPartIds,
        layoutMoves,
      };
    }
  }
  if (!writtenFiles.length && implicitSkipped > 0 && !otherWrites
    && !assemblyRenames.length && !partRenames.length) {
    return {
      status: 'idle',
      sha: head,
      branch,
      implicitSkipped,
    };
  }
  return {
    status: 'synced',
    sha: head,
    branch,
    promoted,
    partIds: syncedPartIds,
    layoutMoves,
    assemblyRenames,
    partRenames,
    meshes,
    files: writtenFiles,
    assemblyRenameOnly: assemblyRenames.length > 0 && !otherWrites,
    partRenameOnly: partRenames.length > 0 && assemblyRenames.length === 0 && !otherWrites,
  };
}
