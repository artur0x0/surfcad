/**
 * joint_commit: one assembly-history undo step via App prepareJointCommit.
 */
export async function runJointCommit(ctx) {
  const prepare = ctx.prepareJointCommit;
  if (typeof prepare !== 'function') {
    return { error: { code: 'internal', message: 'prepareJointCommit handler is missing' } };
  }
  const prepared = prepare();
  if (prepared?.error) return { error: prepared.error };
  if (!prepared?.ok) {
    return {
      error: {
        code: 'commit_failed',
        message: prepared.message || 'Joint commit refused',
      },
    };
  }
  ctx.finishJointCommit?.();
  return {
    result: {
      ok: true,
      jointId: prepared.jointId ?? null,
      jointCount: prepared.jointCount ?? null,
      unchanged: !!prepared.unchanged,
    },
  };
}
