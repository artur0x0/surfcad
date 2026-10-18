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
 * The `message` is the same human-readable text the viewport shows.
 *
 * @param {{
 *   messages?: string[],
 *   script?: string,
 *   runFailure?: {
 *     id?: string,
 *     message?: string,
 *     kind?: string,
 *     label?: string,
 *     detail?: string,
 *   } | null,
 * }} input
 * @returns {Array<{
 *   code: string,
 *   message: string,
 *   featureIndex?: number,
 *   featureId?: string,
 *   featureType?: string,
 *   featureLabel?: string,
 *   detail?: string,
 * }>}
 */
export function formatAgentErrors(input = {}) {
  const messages = Array.isArray(input.messages)
    ? input.messages.filter((row) => typeof row === 'string' && row)
    : [];
  const script = typeof input.script === 'string' ? input.script : '';
  const failure = input.runFailure && typeof input.runFailure === 'object' ? input.runFailure : null;

  if (failure?.id || (typeof failure?.message === 'string' && failure.message)) {
    const features = parseFeatureMarkers(script);
    const feature = failure.id ? features.find((row) => row.id === failure.id) : null;
    const message = typeof failure.message === 'string' && failure.message
      ? failure.message
      : (messages[0] || 'Feature failed');
    const row = { code: 'feature_failed', message };
    const featureIndex = featureIndexForId(script, failure.id);
    if (featureIndex !== undefined) row.featureIndex = featureIndex;
    if (failure.id) row.featureId = failure.id;
    const featureType = feature?.kind || failure.kind;
    if (featureType) row.featureType = featureType;
    const featureLabel = feature?.chipLabel || feature?.label || failure.label;
    if (featureLabel) row.featureLabel = featureLabel;
    const detail = typeof failure.detail === 'string' && failure.detail
      ? failure.detail
      : (messages[0] && messages[0] !== message ? messages[0] : null);
    if (detail) row.detail = detail;
    return [row];
  }

  if (messages.length === 0) return [];
  return messages.map((message) => ({ code: 'build_failed', message }));
}
