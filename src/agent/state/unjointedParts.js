/**
 * Parts that sit in an assembly and belong to no joint.
 *
 * Membership is the assembly document's `joints` array (the same records
 * `src/joints` solves and `jointedSurfIds` reads). This module does not
 * keep a second list.
 */
import { jointedSurfIds } from '../../utils/jointSchema.js';
import { partSurfId } from '../../utils/git/surfId.js';

export const UNJOINTED_PART_CODE = 'unjointed_part';

/** One sentence on the warning. The MCP hint table repeats it. */
export const UNJOINTED_PART_HINT = 'Place it with joint_create (one call creates the joint and solves placement). Fix a base part with type fixed first.';

/**
 * Agent-facing ids of parts in no joint. Empty when the document has fewer
 * than two parts: a single part is not an assembly yet, and the base part
 * is omitted once a fixed joint (or any joint) names it. `parts` may be
 * public rows (`id`) or in-app rows (`id` plus `surfId`); joints name the
 * surf id.
 * @param {Array<{ id?: string, surfId?: string }> | null | undefined} parts
 * @param {Array<{ a?: { part?: string }, b?: { part?: string }, a2?: { part?: string }, b2?: { part?: string } }> | null | undefined} joints
 * @returns {string[]}
 */
export function unjointedPartIds(parts, joints) {
  const rows = Array.isArray(parts) ? parts : [];
  if (rows.length < 2) return [];
  const jointed = jointedSurfIds(joints);
  const ids = [];
  for (const row of rows) {
    const id = row?.id != null ? String(row.id) : '';
    if (!id) continue;
    if (jointed.has(id)) continue;
    const surf = partSurfId(row);
    if (surf && jointed.has(surf)) continue;
    ids.push(id);
  }
  return ids;
}

/** `{ ...state, unjointedParts }` from the open document's part rows and joints. */
export function withUnjointedParts(state, parts, joints) {
  const base = state && typeof state === 'object' ? state : {};
  return { ...base, unjointedParts: unjointedPartIds(parts, joints) };
}

function jointsFrom(ctx) {
  const read = ctx?.readJoints;
  if (typeof read !== 'function') return [];
  const joints = read();
  return Array.isArray(joints) ? joints : [];
}

/**
 * Ids the parts command would report. A host that already computed them
 * from the full part rows (surf ids included) wins; otherwise read the
 * joint array the host exposes.
 * @param {Record<string, unknown>} ctx
 * @returns {string[]}
 */
export function unjointedPartsFor(ctx) {
  const listed = typeof ctx?.readParts === 'function' ? ctx.readParts() : null;
  if (Array.isArray(listed?.unjointedParts)) return listed.unjointedParts.slice();
  return unjointedPartIds(listed?.parts, jointsFrom(ctx));
}

/**
 * Warning for one placed part, or null when it should not fire.
 * @param {Record<string, unknown>} ctx
 * @param {unknown} partId
 * @returns {{ code: string, part_id: string, hint: string } | null}
 */
export function placementWarning(ctx, partId) {
  const id = partId != null ? String(partId) : '';
  if (!id) return null;
  if (!unjointedPartsFor(ctx).includes(id)) return null;
  return { code: UNJOINTED_PART_CODE, part_id: id, hint: UNJOINTED_PART_HINT };
}

/**
 * Attach `warning` to a successful host result. Errors pass through.
 * `placed` is false when the call did not set a position (create_part /
 * insert_part without one). A warning never replaces the result.
 * @param {Record<string, unknown>} ctx
 * @param {{ error?: object, result?: object } | null | undefined} hosted
 * @param {unknown} partId
 * @param {boolean} placed
 */
export function withPlacementWarning(ctx, hosted, partId, placed) {
  if (!placed || !hosted || hosted.error || !hosted.result) return hosted;
  const warning = placementWarning(ctx, partId);
  if (!warning) return hosted;
  return { result: { ...hosted.result, warning } };
}
