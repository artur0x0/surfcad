export const RECONNECT_HINT = 'Open SurfCAD in Chrome and keep the tab open; it will reconnect.';

/**
 * @param {{ code?: string, message?: string, details?: unknown, hint?: string, retryable?: boolean }} err
 */
export function formatBridgeError(err) {
  const code = err?.code || 'bridge_error';
  const message = err?.message || 'Bridge call failed';
  const payload = { code, message };
  if (err?.hint) payload.hint = err.hint;
  if (err?.retryable !== undefined) payload.retryable = err.retryable;
  if (err?.details !== undefined) payload.details = err.details;
  return payload;
}

export function notPairedError() {
  return {
    code: 'not_paired',
    message: 'Not paired to a SurfCAD tab. Set SURFCAD_PAIRING_CODE or call the pair tool, then click Allow in the app.',
    hint: pairingEnvHint(),
  };
}

/**
 * @param {string} [reason]
 */
export function pairingLostError(reason) {
  const why = reason ? ` (${reason})` : '';
  return Object.assign(
    new Error(`Lost the connection to the SurfCAD tab${why}. Reconnecting in the background; retry in a few seconds.`),
    { code: 'pairing_lost', hint: RECONNECT_HINT, retryable: true },
  );
}

export function pairPendingError() {
  return Object.assign(
    new Error('Waiting for Allow in SurfCAD. Click Allow in the app, then retry.'),
    { code: 'pair_pending', hint: 'The pairing request is still open in the SurfCAD tab.', retryable: true },
  );
}

export function pairingEnvHint() {
  return 'Copy the 6-character code from SurfCAD → Local agent → Show pairing code.';
}
