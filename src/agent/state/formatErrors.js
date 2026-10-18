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
 * Short kernel/stack text that is not already the viewport popup message.
 * @param {unknown} error
 * @param {string} [message]
 * @returns {string|null}
 */
export function kernelExceptionDetail(error, message) {
  if (!error || typeof error !== 'object') return null;
  const shown = typeof message === 'string' ? message.trim() : '';
  const explicit = typeof error.detail === 'string' ? error.detail.trim() : '';
  if (explicit && explicit !== shown) return explicit.slice(0, 500);
  const stack = typeof error.stack === 'string' ? error.stack : '';
  const lines = stack.split('\n').map((line) => line.trim()).filter(Boolean);
  const rest = lines.filter((line) => line !== shown && line !== `Error: ${shown}`);
  if (!rest.length) return null;
  const detail = rest.slice(0, 3).join('\n').slice(0, 500);
  return detail && detail !== shown ? detail : null;
}

/**
 * Build rows for the agent `errors` command.
 * `message` is the same human-readable text the viewport shows.
 * Reused from the parked error-description shape in PR #588.
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
    const featureType = feature?.kind || failure.kind;
    const featureLabel = feature?.chipLabel || feature?.label || failure.label;
    const named = featureLabel || featureType;
    const fromFailure = typeof failure.message === 'string' && failure.message
      ? failure.message
      : '';
    // The generic placeholder is not a viewport message. Name the feature.
    const fromMessages = messages.find((row) => row && row !== 'Feature failed') || '';
    const message = fromFailure || fromMessages || (named ? `${named} failed` : 'Script failed');
    const row = { code: 'feature_failed', message };
    const featureIndex = featureIndexForId(script, failure.id);
    if (featureIndex !== undefined) row.featureIndex = featureIndex;
    if (failure.id) row.featureId = failure.id;
    if (featureType) row.featureType = featureType;
    if (featureLabel) row.featureLabel = featureLabel;
    const explicit = typeof failure.detail === 'string' && failure.detail && failure.detail !== message
      ? failure.detail
      : '';
    const extra = messages.find((row) => row && row !== message && row !== 'Feature failed') || '';
    const detail = explicit || extra;
    if (detail) row.detail = detail;
    return [row];
  }

  if (messages.length === 0) return [];
  return messages.map((message) => ({ code: 'build_failed', message }));
}
