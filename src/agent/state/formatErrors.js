import { parseFeatureMarkers } from '../../utils/featureMarkers.js';

/**
 * @param {string} script
 * @param {string} featureId
 * @returns {number|undefined}
 */
function featureIndexForId(script, featureId) {
  if (!featureId) return undefined;
  const index = parseFeatureMarkers(script).findIndex((row) => row.id === featureId);
  return index >= 0 ? index : undefined;
}

/**
 * Build `{ code, message, featureIndex? }` rows for the agent `errors` command.
 *
 * @param {{
 *   messages?: string[],
 *   script?: string,
 *   runFailure?: { id?: string, message?: string } | null,
 * }} input
 * @returns {Array<{ code: string, message: string, featureIndex?: number }>}
 */
export function formatAgentErrors(input = {}) {
  const messages = Array.isArray(input.messages)
    ? input.messages.filter((row) => typeof row === 'string' && row)
    : [];
  const script = typeof input.script === 'string' ? input.script : '';
  const failure = input.runFailure && typeof input.runFailure === 'object' ? input.runFailure : null;

  if (failure?.id) {
    const message = typeof failure.message === 'string' && failure.message
      ? failure.message
      : (messages[0] || 'Feature failed');
    const row = { code: 'feature_failed', message };
    const featureIndex = featureIndexForId(script, failure.id);
    if (featureIndex !== undefined) row.featureIndex = featureIndex;
    return [row];
  }

  if (messages.length === 0) return [];
  return messages.map((message) => ({ code: 'build_failed', message }));
}
