/**
 * Re-resolve joints after a part run, then solve.
 *
 * A broken joint is left out. A failed run marks every joint that names
 * that part broken and does not read a leftover mesh. Placements change
 * only when the solve succeeds. Confirm and Delete write the assembly
 * document and leave every part script untouched. While an assembly is
 * opening they write nothing and do not preempt the run.
 */
import { serializeAssembly } from '../utils/assembly.js';
import { partSurfId } from '../utils/git/surfId.js';
import { jointRefs, partPlacement } from '../utils/jointSchema.js';
import { referenceFailure, resolveReference } from '../utils/jointResolve.js';
import { solveJoints } from './solveJoints.js';

export const JOINT_OPEN_LOCK_MESSAGE = 'An assembly is opening — confirm the joint again once it finishes.';

function livePartId(part) {
  return partSurfId(part) || part?.surfId || part?.id || null;
}

function partName(doc, surfId) {
  const part = (doc?.parts || []).find((row) => livePartId(row) === surfId);
  return part?.name || surfId;
}

function poseClose(a, b) {
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(a.t[i] - b.t[i]) > 1e-6) return false;
  }
  let dot = 0;
  for (let i = 0; i < 4; i += 1) dot += a.q[i] * b.q[i];
  return Math.abs(Math.abs(dot) - 1) < 1e-8;
}

/** Solve copy. A plane uses the frame that id resolves to now. The file keeps the stored key. */
function withLivePlanes(joint, catalogs) {
  const live = (ref) => {
    if (!ref || ref.kind !== 'plane') return ref;
    const hit = resolveReference(ref, catalogs?.[ref.part]);
    if (hit.status === 'ok' && hit.key) return { ...ref, key: hit.key };
    return ref;
  };
  const next = { ...joint };
  if (next.a) next.a = live(next.a);
  if (next.a2) next.a2 = live(next.a2);
  if (next.b) next.b = live(next.b);
  if (next.b2) next.b2 = live(next.b2);
  return next;
}

function classifyJoint(doc, joint, catalogs) {
  if (joint?.type === 'fixed') {
    const surfId = joint.a?.part;
    const catalog = catalogs?.[surfId];
    if (catalog?.failed) {
      return {
        status: 'broken',
        message: referenceFailure({ kind: 'face', part: surfId }, 'failed', partName(doc, surfId)),
      };
    }
    return { status: 'ok', message: null };
  }
  const sides = jointRefs(joint);
  for (const side of sides) {
    const catalog = catalogs?.[side.part];
    if (catalog?.failed) {
      return {
        status: 'broken',
        message: referenceFailure(side, 'failed', partName(doc, side.part)),
      };
    }
  }
  for (const side of sides) {
    const catalog = catalogs?.[side.part];
    const hit = resolveReference(side, catalog);
    if (hit.status === 'ok' || hit.status === 'unresolved') continue;
    return {
      status: 'broken',
      message: referenceFailure(side, hit.status, partName(doc, side.part)),
    };
  }
  return { status: 'ok', message: null };
}

function withPlacements(doc, placements) {
  let moved = false;
  const parts = (doc.parts || []).map((part) => {
    const next = placements?.[livePartId(part)];
    if (!next) return part;
    const prev = partPlacement(part);
    if (poseClose(prev, next)) return part;
    moved = true;
    return {
      ...part,
      placement: { t: next.t.slice(), q: next.q.slice() },
    };
  });
  if (!moved) return { doc, moved: false };
  return { doc: serializeAssembly({ ...doc, parts }), moved: true };
}

/**
 * Match, then solve. `locked` leaves the document as it is.
 * @returns {{ ok: boolean, doc: object, statuses: Record<string, string>, messages: Record<string, string>, message: string|null, changed: boolean, skipped?: boolean }}
 */
export function refreshAssemblyJoints({ doc, catalogs = {}, locked = false } = {}) {
  if (!doc) {
    return { ok: true, doc, statuses: {}, messages: {}, message: null, changed: false };
  }
  if (locked) {
    return { ok: false, doc, statuses: {}, messages: {}, message: null, changed: false, skipped: true };
  }
  const joints = Array.isArray(doc.joints) ? doc.joints : [];
  const statuses = {};
  const messages = {};
  const active = [];
  for (const joint of joints) {
    const outcome = classifyJoint(doc, joint, catalogs);
    statuses[joint.id] = outcome.status;
    if (outcome.message) messages[joint.id] = outcome.message;
    if (outcome.status === 'ok') active.push(withLivePlanes(joint, catalogs));
  }
  if (!active.length) {
    return { ok: true, doc, statuses, messages, message: null, changed: false };
  }
  const parts = (doc.parts || []).map((part) => ({
    surfId: livePartId(part),
    placement: partPlacement(part),
  }));
  const solved = solveJoints({ parts, joints: active });
  if (!solved.ok) {
    for (const joint of active) {
      if (solved.statuses?.[joint.id]) statuses[joint.id] = solved.statuses[joint.id];
    }
    return {
      ok: false,
      doc,
      statuses,
      messages,
      message: solved.message,
      changed: false,
    };
  }
  const applied = withPlacements(doc, solved.placements);
  for (const joint of active) statuses[joint.id] = 'ok';
  return {
    ok: true,
    doc: applied.doc,
    statuses,
    messages,
    message: null,
    changed: applied.moved,
  };
}

function nextJoints(doc, action, joint) {
  const current = Array.isArray(doc?.joints) ? doc.joints : [];
  if (action === 'delete') return current.filter((row) => row?.id !== joint?.id);
  const rest = current.filter((row) => row?.id !== joint?.id);
  return joint ? [...rest, joint] : rest;
}

/**
 * Confirm or delete one joint. Scripts are returned as the same object.
 * A set lock writes nothing and does not call `preempt`.
 */
export function commitJointEdit({
  doc,
  scripts = null,
  action = 'confirm',
  joint = null,
  locked = false,
  preempt = null,
  catalogs = null,
} = {}) {
  void preempt;
  if (locked) {
    return {
      ok: false,
      locked: true,
      doc,
      scripts,
      message: JOINT_OPEN_LOCK_MESSAGE,
      preempted: false,
    };
  }
  const draft = { ...doc, joints: nextJoints(doc, action, joint) };
  const refreshed = refreshAssemblyJoints({
    doc: draft,
    catalogs: catalogs || {},
    locked: false,
  });
  if (!refreshed.ok) {
    return {
      ok: false,
      locked: false,
      doc,
      scripts,
      message: refreshed.message,
      statuses: refreshed.statuses,
      messages: refreshed.messages,
      preempted: false,
    };
  }
  return {
    ok: true,
    locked: false,
    doc: refreshed.doc,
    scripts,
    message: null,
    statuses: refreshed.statuses,
    messages: refreshed.messages,
    preempted: false,
  };
}
