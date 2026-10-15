/**
 * hole_commit: one undo step via App prepareHoleMutate + bridge mutate.
 */
export async function runHoleMutate(ctx, { prepare, label = 'Hole' }) {
  const prepared = prepare();
  if (prepared?.error) return { error: prepared.error };
  if (prepared.empty || !prepared.payload) {
    ctx.finishHoleCommit?.();
    return {
      result: {
        ok: true,
        written: false,
        unchanged: true,
        empty: true,
        errors: [],
        status: ctx.readStatus?.(),
      },
    };
  }
  const prep = ctx.prepareHoleMutate?.(prepared.payload);
  if (!prep || prep.error) {
    return { error: prep?.error || { code: 'internal', message: 'prepareHoleMutate failed' } };
  }
  let outcome = { ok: true, errors: [], status: ctx.readStatus?.() };
  if (prep.changed) {
    outcome = await ctx.mutate(prep.source, prep.message || label);
    ctx.applyHoleMutateExtras?.(prep);
  }
  ctx.finishHoleCommit?.();
  return {
    result: {
      ok: outcome.ok === true,
      written: prep.changed,
      unchanged: !prep.changed,
      empty: !!prepared.empty,
      featureId: prepared.featureId ?? prep.featureId ?? null,
      errors: outcome.errors || [],
      status: outcome.status,
    },
  };
}
