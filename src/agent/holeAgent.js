/**
 * Hole card params for agent hole_set_params.
 */

import { defaultHoleCard, holeSpecFromCard } from '../utils/holeCard.js';

const CARD_FIELDS = new Set([
  'type', 'size', 'fit', 'dia', 'through', 'depth', 'side',
  'nearKind', 'nearDia', 'nearDepth', 'farKind', 'farDia', 'farDepth',
]);

export function holeParamsFromArgs(args = {}) {
  const bag = args.params && typeof args.params === 'object' ? args.params : args;
  const patch = {};
  for (const [key, value] of Object.entries(bag)) {
    if (CARD_FIELDS.has(key)) patch[key] = value;
  }
  if (!Object.keys(patch).length) {
    return { error: { code: 'bad_args', message: 'hole_set_params needs hole card fields' } };
  }
  const merged = { ...defaultHoleCard(), ...patch };
  const parsed = holeSpecFromCard(merged);
  if (!parsed.ok) {
    return { error: { code: 'bad_args', message: parsed.message } };
  }
  return { patch };
}
