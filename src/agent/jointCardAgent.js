import { draftFromPicks } from '../joints/jointUi.js';

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
