import { cardFromJoint, draftFromPicks, nextJointName } from '../joints/jointUi.js';

/**
 * Card state agents can commit immediately — merges live picks with open card fields.
 */
export function buildEffectiveJointCard(card, picks, doc) {
  if (!card) return null;
  const list = Array.isArray(picks) ? picks : (card.picks || []);
  const base = card.mode === 'create' || card.mode === 'edit' ? card : null;
  const drafted = draftFromPicks(base, list, { joints: doc?.joints || [] });
  return {
    ...drafted,
    mode: card.mode === 'edit' ? 'edit' : 'create',
    id: card.id ?? drafted.id,
    name: card.userNamed ? card.name : (card.name || drafted.name),
    type: card.userPickedType ? card.type : (card.type || drafted.type),
    valueMm: card.valueMm ?? drafted.valueMm,
    sense: card.sense === -1 ? -1 : 1,
    opposed: card.opposed !== false,
    userPickedType: !!card.userPickedType,
    userNamed: !!card.userNamed,
    note: card.note || '',
    partChange: card.partChange || null,
    picks: list,
  };
}

/**
 * joint_edit: the edit card after `patch`, without touching any state.
 * `jointId` opens that joint itself (what a chip tap does), so no
 * joint_select is needed. A refusal returns `error` and changes nothing, so
 * a following joint_commit has nothing new to write.
 *
 * @returns {{ card: object, selected: boolean } | { error: { code: string, message: string } }}
 */
export function jointEditCard({ doc, card = null, jointId = null, patch = null } = {}) {
  if (!doc) return { error: { code: 'no_assembly', message: 'No assembly loaded' } };
  let base = card;
  let selected = false;
  if (jointId != null && jointId !== '') {
    const id = String(jointId);
    const joint = (doc.joints || []).find((row) => row.id === id);
    if (!joint) {
      return { error: { code: 'unknown_joint', message: `Unknown joint id: ${id}` } };
    }
    if (!(base?.mode === 'edit' && base.id === id)) {
      base = cardFromJoint(joint, doc);
      selected = true;
    }
  }
  if (!base || base.mode !== 'edit') {
    return {
      error: {
        code: 'no_joint_edit',
        message: 'Pass joint_id (from the assembly strip) to joint_edit',
      },
    };
  }
  const bag = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  let next = { ...base, ...bag };
  if (next.userPickedType && next.type && !next.userNamed) {
    next = { ...next, name: nextJointName(next.type, doc.joints || []) };
  }
  return { card: next, selected };
}
