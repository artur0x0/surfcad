/**
 * Git vault writes that must never run on their own.
 *
 * Load, reload, open, auto-save, and layout/id migrations do not commit,
 * push, or move files. Only an explicit user Save or an agent git_save
 * (after consent) writes the remote.
 */
export const IMPLICIT_VAULT_WRITE_OPS = Object.freeze(['migrate-layout', 'migrate-ids']);

export function isImplicitVaultWriteOp(op) {
  return IMPLICIT_VAULT_WRITE_OPS.includes(op?.op);
}

/** Drop auto-migration ops from an outbox snapshot. Does not write git. */
export function dropImplicitVaultWriteOps(ops) {
  return (ops || []).filter((op) => !isImplicitVaultWriteOp(op));
}

/**
 * Mark leftover auto-migration outbox rows done so a later flush cannot
 * move files. Memory-only; no git write.
 */
export async function retireImplicitVaultWriteOps(store, repo, branch = 'main') {
  if (!store || !repo) return [];
  const queued = [
    ...(typeof store.pending === 'function' ? store.pending(repo, branch) : []),
    ...(typeof store.failed === 'function' ? store.failed(repo, branch) : []),
  ];
  const retired = [];
  for (const op of queued) {
    if (!isImplicitVaultWriteOp(op) || op.status === 'done') continue;
    if (typeof store.setOpStatus === 'function') {
      await store.setOpStatus(op.id, 'done');
    }
    retired.push(op.id);
  }
  return retired;
}
