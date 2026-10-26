import { withJointBrokenWarning } from '../state/jointHealth.js';

function jointHealth(ctx) {
  const read = ctx?.readJointHealth;
  if (typeof read !== 'function') return null;
  const health = read();
  return health && typeof health === 'object' ? health : null;
}

/**
 * joint_commit: one assembly-history undo step via App prepareJointCommit.
 * The result carries `warning { code: "joint_broken" }` when the commit
 * left a joint failing that was not failing before (the solve re-runs
 * every joint, so a new joint can break an old one).
 */
export async function runJointCommit(ctx) {
  const prepare = ctx.prepareJointCommit;
  if (typeof prepare !== 'function') {
    return { error: { code: 'internal', message: 'prepareJointCommit handler is missing' } };
  }
  const before = jointHealth(ctx);
  const prepared = prepare();
  if (prepared?.error) return { error: prepared.error };
  if (!prepared?.ok) {
    const candidates = prepared.candidates;
    return {
      error: {
        code: 'commit_failed',
        message: prepared.message || 'Joint commit refused',
        ...(Array.isArray(candidates) && candidates.length ? { details: { candidates } } : {}),
      },
    };
  }
  ctx.finishJointCommit?.();
  return withJointBrokenWarning({
    result: {
      ok: true,
      jointId: prepared.jointId ?? null,
      jointCount: prepared.jointCount ?? null,
      unchanged: !!prepared.unchanged,
    },
  }, before, jointHealth(ctx));
}
