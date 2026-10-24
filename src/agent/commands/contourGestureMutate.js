/**
 * sketch_dimension / sketch_constrain: one undo step via contourBlock mutate.
 */
export async function runContourGestureMutate(ctx, { prepare, label }) {
  const prepared = prepare();
  if (prepared?.error) return { error: prepared.error };
  if (prepared?.live) {
    // A reopened saved contour: the gesture is applied to the live sketch
    // and written by the commit that closes it (one undo step for the edit).
    return {
      result: {
        ok: true,
        written: false,
        live: true,
        errors: [],
        status: ctx.readStatus?.(),
        ...(prepared.result || {}),
      },
    };
  }
  const payload = prepared.payload;
  if (!payload) {
    return { error: { code: 'internal', message: `${label} payload missing` } };
  }
  const prep = ctx.prepareContourMutate?.(payload, { gesture: true });
  if (!prep || prep.error) {
    return { error: prep?.error || { code: 'internal', message: 'prepareContourMutate failed' } };
  }
  let outcome = { ok: true, errors: [], status: ctx.readStatus?.() };
  if (prep.changed) {
    outcome = await ctx.mutate(prep.source, prep.message || label);
    ctx.applyContourMutateExtras?.(prep);
  }
  ctx.finishSketchGesture?.();
  return {
    result: {
      ok: outcome.ok === true,
      written: prep.changed,
      unchanged: !prep.changed,
      errors: outcome.errors || [],
      status: outcome.status,
      ...(prepared.result || {}),
    },
  };
}
