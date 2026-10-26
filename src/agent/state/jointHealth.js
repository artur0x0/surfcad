/**
 * Joint health for the agent: every assembly joint with its solve state.
 *
 * The rows come from the assembly document's `joints` array and the live
 * statuses `refreshAssemblyJoints` / `solveJoints` publish after every part
 * run (`ok`, `broken`, `conflict`) with the reason sentence the strip chip
 * shows in its tooltip. The strip has shown red chips since joints landed;
 * until this module nothing on the bridge said so (Bike v3: 4 red chips,
 * `status` and `parts` clean).
 *
 * Parts are reported by the row id the agent already uses (`parts[].id`).
 * A joint names a part by surf id; `partIdOf` maps that back to the row.
 */

export const JOINT_BROKEN_CODE = 'joint_broken';

/** One sentence on the warning. The MCP hint table repeats it. */
export const JOINT_BROKEN_HINT = 'A joint this call named, or a face it referenced, no longer resolves. list_joints shows each joint with its status and reason; edit the part so the face comes back, joint_edit the joint to new picks, or joint_delete it.';

const FAILED = new Set(['broken', 'conflict']);

export function isFailedJointStatus(status) {
  return FAILED.has(status);
}

function copyKey(key) {
  if (!key || typeof key !== 'object') return undefined;
  try {
    return JSON.parse(JSON.stringify(key));
  } catch {
    return undefined;
  }
}

function pickRow(ref, partIdOf) {
  if (!ref || typeof ref !== 'object') return null;
  const surf = ref.part != null ? String(ref.part) : '';
  const row = { part_id: partIdOf(surf) };
  if (typeof ref.kind === 'string' && ref.kind) row.kind = ref.kind;
  const key = copyKey(ref.key);
  if (key) row.key = key;
  return row;
}

function refsOf(joint) {
  if (!joint || typeof joint !== 'object') return [];
  if (joint.type === 'symmetric') return [joint.a, joint.a2, joint.b, joint.b2].filter(Boolean);
  if (joint.type === 'fixed') return joint.a ? [joint.a] : [];
  return [joint.a, joint.b].filter(Boolean);
}

/**
 * @param {{
 *   joints?: object[] | null,
 *   statuses?: Record<string, string> | null,
 *   messages?: Record<string, string> | null,
 *   partIdOf?: (surfId: string) => string,
 * }} input
 * @returns {{ joints: object[], total: number, failed: { count: number, ids: string[] } }}
 */
export function buildJointHealth(input = {}) {
  const joints = Array.isArray(input.joints) ? input.joints : [];
  const statuses = input.statuses && typeof input.statuses === 'object' ? input.statuses : {};
  const messages = input.messages && typeof input.messages === 'object' ? input.messages : {};
  const partIdOf = typeof input.partIdOf === 'function' ? input.partIdOf : (id) => id;
  const rows = [];
  const failedIds = [];
  for (const joint of joints) {
    if (!joint || typeof joint !== 'object' || joint.id == null) continue;
    const id = String(joint.id);
    const raw = statuses[id];
    const status = raw === 'broken' || raw === 'conflict' ? raw : 'ok';
    const picks = refsOf(joint).map((ref) => pickRow(ref, partIdOf)).filter(Boolean);
    const parts = [];
    for (const pick of picks) if (pick.part_id && !parts.includes(pick.part_id)) parts.push(pick.part_id);
    const row = {
      id,
      name: typeof joint.name === 'string' ? joint.name : '',
      type: typeof joint.type === 'string' ? joint.type : '',
      status,
      parts,
      picks,
    };
    if (status !== 'ok') {
      const reason = typeof messages[id] === 'string' && messages[id] ? messages[id] : null;
      row.reason = reason || (status === 'conflict' ? 'Conflicts with another joint' : 'Reference not found');
      failedIds.push(id);
    }
    if (Number.isFinite(joint.value)) {
      if (joint.type === 'angle') row.value_deg = joint.value;
      else row.value_mm = joint.value;
    }
    if (joint.sense === 1 || joint.sense === -1) row.sense = joint.sense;
    if (typeof joint.opposed === 'boolean') row.opposed = joint.opposed;
    rows.push(row);
  }
  return { joints: rows, total: rows.length, failed: { count: failedIds.length, ids: failedIds } };
}

/** `{ count, ids }` for `status.jointFailures`. */
export function jointFailuresOf(health) {
  const ids = Array.isArray(health?.failed?.ids) ? health.failed.ids.map(String) : [];
  return { count: ids.length, ids };
}

/**
 * Joints that fail now and did not fail in `before` (absent there counts as
 * not failed, so a joint this call created and could not solve is listed).
 * `before` null means no snapshot was taken: nothing is reported.
 */
export function newlyBrokenJoints(before, after) {
  if (!before || !after) return [];
  const wasFailed = new Set(Array.isArray(before.failed?.ids) ? before.failed.ids.map(String) : []);
  return (after.joints || []).filter((row) => isFailedJointStatus(row.status) && !wasFailed.has(String(row.id)));
}

/** The `warning` a result carries when `after` has joints `before` did not have failing, else null. */
export function jointBrokenWarning(before, after) {
  const rows = newlyBrokenJoints(before, after);
  if (!rows.length) return null;
  return {
    code: JOINT_BROKEN_CODE,
    joints: rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      status: row.status,
      reason: row.reason,
      parts: row.parts.slice(),
    })),
    hint: JOINT_BROKEN_HINT,
  };
}

/** Attach the warning to a successful `{ result }`; errors and a result that already warns pass through. */
export function withJointBrokenWarning(hosted, before, after) {
  if (!hosted || hosted.error || !hosted.result || typeof hosted.result !== 'object') return hosted;
  const warning = jointBrokenWarning(before, after);
  if (!warning) return hosted;
  if (hosted.result.warning) return hosted;
  return { ...hosted, result: { ...hosted.result, warning } };
}
