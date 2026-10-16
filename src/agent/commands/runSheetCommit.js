/**
 * sheet_commit / sheet_done: one part-history undo via App prepareSheetWrite.
 */
export async function runSheetWrite(ctx, { prepare, label = 'Sheet metal', finish }) {
  const prepared = prepare();
  if (prepared?.error) return { error: prepared.error };
  if (!prepared?.ok) {
    return {
      error: {
        code: 'commit_failed',
        message: prepared.message || 'Sheet metal commit refused',
      },
    };
  }
  if (prepared.write) {
    const prep = ctx.prepareSheetMutate?.(prepared);
    if (!prep || prep.error) {
      return { error: prep?.error || { code: 'internal', message: 'prepareSheetMutate failed' } };
    }
    if (prep.changed) {
      const outcome = await ctx.mutate(prep.source, prep.message || label);
      if (outcome?.ok !== true) {
        return {
          error: {
            code: 'commit_failed',
            message: (outcome?.errors || []).join('; ') || 'Sheet metal write failed',
          },
        };
      }
    }
  }
  finish?.(prepared);
  return {
    result: {
      ok: true,
      written: !!prepared.write && prepared.changed !== false,
      unchanged: !prepared.write || prepared.changed === false,
      step: prepared.step ?? null,
      closed: !!prepared.closed,
      stage: prepared.stage ?? null,
    },
  };
}
