/**
 * Optional `part_id` on write tools. When set, the write targets that part
 * and unknown ids are refused. When omitted, the active part is used and
 * the viewer pick (`cadPartId`) is synced to it so a stale highlight cannot
 * retarget the insert.
 */

export const WRITE_PART_ID_PROP = Object.freeze({
  type: 'string',
  description:
    'Part row id from parts. When set, the write targets this part and rejects unknown ids. When omitted, writes the active part.',
});

/**
 * @param {object} ctx
 * @param {{ part_id?: string }|null|undefined} args
 * @returns {{ partId: string|null } | { error: { code: string, message: string } }}
 */
export function activateRequestedWritePart(ctx, args) {
  const requested = typeof args?.part_id === 'string' && args.part_id.trim()
    ? args.part_id.trim()
    : null;
  const activate = ctx.activateWritePart;
  if (typeof activate !== 'function') {
    if (requested) {
      return { error: { code: 'internal', message: 'activateWritePart handler is missing' } };
    }
    return { partId: null };
  }
  const out = activate(requested);
  if (out?.error) return { error: out.error };
  return { partId: out?.partId ?? null };
}
