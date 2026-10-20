import { parseFeatureMarkers } from '../../utils/featureMarkers.js';
import { explainReservedHelperError } from './reservedHelpers.js';
import { KERNEL_CRASH_CODE, KERNEL_CRASH_DETAIL } from '../../workers/kernelCrash.js';

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

const FRAME_LINE = /^\s*at\s+/;
const FILE_LINE = /\b[\w$./-]+\.(?:js|mjs|cjs|wasm):\d+/;
const ANON_FRAME = /<anonymous>/;
const MANIFOLD_STATUS = /^(?:NoError|NonFiniteVertex|NotManifold|VertexOutOfBounds|PropertiesWrongLength|MissingPositionProperties|MergeVectorsDifferentLengths|MergeIndexOutOfBounds|TransformWrongLength|RunIndexWrongLength|FaceIDWrongLength|InvalidConstruction)$/;

function isFrameLine(line) {
  return FRAME_LINE.test(line)
    || FILE_LINE.test(line)
    || ANON_FRAME.test(line)
    || /^\s*https?:\/\//i.test(line);
}

function redundantLine(line, shown) {
  if (!shown) return false;
  return line === shown || line === `Error: ${shown}` || shown.includes(line);
}

/**
 * Drop stack frames and URLs. Keep a kernel sentence, status, or class name.
 * @param {unknown} text
 * @param {string} [message]
 * @returns {string}
 */
export function scrubKernelDetail(text, message) {
  const shown = typeof message === 'string' ? message.trim() : '';
  if (typeof text !== 'string') return '';
  const kept = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/https?:\/\/\S+/gi, '').replace(/[ \t]{2,}/g, ' ').trim();
    if (!line || line === 'Feature failed' || isFrameLine(line) || redundantLine(line, shown)) continue;
    kept.push(line);
  }
  let detail = kept.join('\n').slice(0, 500).trim();
  if (!detail || redundantLine(detail, shown) || isFrameLine(detail)) return '';
  return detail;
}

/**
 * Popup text with stack frames and URLs removed. A clean message is unchanged.
 * @param {unknown} text
 * @returns {string}
 */
export function scrubPublishedError(text) {
  if (typeof text !== 'string') return '';
  const kept = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/https?:\/\/\S+/gi, '').replace(/[ \t]{2,}/g, ' ').trim();
    if (!line || isFrameLine(line)) continue;
    kept.push(line);
  }
  const out = kept.join('\n').trim();
  if (!out || isFrameLine(out)) return '';
  return out;
}

function pushDetail(bits, shown, text) {
  const cleaned = scrubKernelDetail(text, shown);
  if (!cleaned) return;
  if (bits.some((row) => row === cleaned || row.includes(cleaned))) return;
  for (let i = bits.length - 1; i >= 0; i -= 1) {
    if (cleaned.includes(bits[i])) bits.splice(i, 1);
  }
  bits.push(cleaned);
}

function manifoldStatus(error) {
  const candidates = [error.status, error.code, error.manifoldStatus];
  for (const value of candidates) {
    if (typeof value === 'string' && MANIFOLD_STATUS.test(value.trim())) return value.trim();
  }
  return '';
}

/**
 * Kernel or exception text that is not already the viewport popup message.
 * Stack frames and URLs are never included. Returns null when the message
 * already says everything an agent can use.
 * @param {unknown} error
 * @param {string} [message]
 * @returns {string|null}
 */
export function kernelExceptionDetail(error, message) {
  if (!error || typeof error !== 'object') return null;
  const shown = typeof message === 'string' ? message.trim() : '';
  const bits = [];
  const name = typeof error.name === 'string' ? error.name.trim() : '';
  if (name && name !== 'Error') pushDetail(bits, shown, name);
  const status = manifoldStatus(error);
  if (status && status !== 'NoError') pushDetail(bits, shown, status);
  if (typeof error.detail === 'string') pushDetail(bits, shown, error.detail);
  const cause = error.cause && typeof error.cause === 'object' ? error.cause : null;
  if (cause) {
    const causeName = typeof cause.name === 'string' ? cause.name.trim() : '';
    if (causeName && causeName !== 'Error') pushDetail(bits, shown, causeName);
    if (typeof cause.message === 'string') pushDetail(bits, shown, cause.message);
  }
  if (typeof error.message === 'string') pushDetail(bits, shown, error.message);
  const detail = bits.join('\n').slice(0, 500).trim();
  return detail || null;
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
const MOVE_BODY_HINT = 'move names a body by its centroid: call list_bodies and pass at, body_index, face, or face_id to insert_move (or edit_feature at on the move).';

/** `detail` when the kernel message already says everything: the helper that threw. */
export function defaultFeatureDetail(message, featureType) {
  const text = typeof message === 'string' ? message.trim() : '';
  const helper = /^([A-Za-z_$][\w$]*):\s/.exec(text)?.[1] || null;
  if (helper === 'move' || featureType === 'move') return `move threw an Error. ${MOVE_BODY_HINT}`;
  if (helper) return `${helper} threw an Error`;
  return featureType ? `${featureType} threw an Error` : 'Error';
}

export function formatAgentErrors(input = {}) {
  const messages = Array.isArray(input.messages)
    ? input.messages.filter((row) => typeof row === 'string' && row)
    : [];
  const script = typeof input.script === 'string' ? input.script : '';
  const failure = input.runFailure && typeof input.runFailure === 'object' ? input.runFailure : null;
  const crash = (input.crash && typeof input.crash === 'object' ? input.crash : null)
    || (failure?.crash && typeof failure.crash === 'object' ? failure.crash : null);

  if (crash) {
    // The kernel died under this part: one row, its own code, and the same
    // sentence the viewport shows. The worker was already replaced.
    const message = scrubPublishedError(
      (typeof failure?.message === 'string' && failure.message)
      || (typeof crash.message === 'string' && crash.message)
      || messages[0]
      || 'The geometry engine crashed building this part.',
    );
    const row = {
      code: KERNEL_CRASH_CODE,
      message,
      reason: typeof crash.reason === 'string' && crash.reason ? crash.reason : 'wasm_abort',
      workerRestarted: crash.workerRestarted !== false,
      detail: KERNEL_CRASH_DETAIL,
    };
    if (failure?.id) {
      const featureIndex = featureIndexForId(script, failure.id);
      if (featureIndex !== undefined) row.featureIndex = featureIndex;
      row.featureId = failure.id;
    }
    return [row];
  }

  if (failure?.id || (typeof failure?.message === 'string' && failure.message)) {
    const features = parseFeatureMarkers(script);
    const feature = failure.id ? features.find((row) => row.id === failure.id) : null;
    const featureType = feature?.kind || failure.kind;
    const featureLabel = feature?.chipLabel || feature?.label || failure.label;
    const named = featureLabel || featureType;
    const fromFailure = scrubPublishedError(failure.message);
    // The generic placeholder is not a viewport message. Name the feature.
    const fromMessages = messages
      .map((row) => scrubPublishedError(row))
      .find((row) => row && row !== 'Feature failed') || '';
    const message = fromFailure || fromMessages || (named ? `${named} failed` : 'Script failed');
    const row = { code: 'feature_failed', message };
    const featureIndex = featureIndexForId(script, failure.id);
    if (featureIndex !== undefined) row.featureIndex = featureIndex;
    if (failure.id) row.featureId = failure.id;
    if (featureType) row.featureType = featureType;
    if (featureLabel) row.featureLabel = featureLabel;
    const explicit = scrubKernelDetail(failure.detail, message);
    const extra = messages
      .filter((row) => row && row !== 'Feature failed')
      .map((row) => scrubKernelDetail(row, message))
      .find(Boolean) || '';
    // Always present on feature_failed: the kernel's own line when it adds
    // something, else which helper threw and, for move, how to name the body.
    row.detail = explicit || extra || defaultFeatureDetail(message, featureType);
    return [publishErrorRow(row)];
  }

  if (messages.length === 0) return [];
  return messages
    .map((message) => scrubPublishedError(message))
    .filter(Boolean)
    .map((message) => publishErrorRow({ code: 'build_failed', message }));
}

/** Rewrite a reserved-helper redeclaration. Drop detail that only repeats it. */
function publishErrorRow(row) {
  const message = explainReservedHelperError(row.message);
  let detail = row.detail;
  if (typeof detail === 'string') {
    detail = explainReservedHelperError(detail);
    if (!detail || detail === message) detail = undefined;
  }
  if (message === row.message && detail === row.detail) return row;
  const next = { ...row, message };
  if (detail) next.detail = detail;
  else delete next.detail;
  return next;
}
