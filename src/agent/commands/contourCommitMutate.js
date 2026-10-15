/**
 * sketch_commit / slot_commit: compose + bridge mutate (same status refresh as confirm_feature).
 */
export async function runContourCommitMutate(ctx, { prepare, fromSlot = false }) {
  const prepared = prepare();
  if (prepared?.error) return { error: prepared.error };
  const payload = prepared.payload;
  if (!payload) {
    return { error: { code: 'internal', message: 'Contour commit payload missing' } };
  }
  const prep = ctx.prepareContourMutate?.(payload, { fromSlot });
  if (!prep || prep.error) {
    return { error: prep?.error || { code: 'internal', message: 'prepareContourMutate failed' } };
  }
  let outcome = { ok: true, errors: [], status: ctx.readStatus?.() };
  if (prep.changed) {
    outcome = await ctx.mutate(prep.source, prep.message);
    ctx.applyContourMutateExtras?.(prep);
  }
  const finish = ctx.finishContourCommit;
  if (typeof finish === 'function') {
    finish({ payload: prep.finish?.payload ?? payload, fromSlot: prep.finish?.fromSlot === true });
  }
  return {
    result: {
      ok: outcome.ok === true,
      written: prep.changed,
      unchanged: !prep.changed,
      errors: outcome.errors || [],
      status: outcome.status,
    },
  };
}
