/**
 * @param {{ code?: string, message?: string, details?: unknown }} err
 */
export function formatBridgeError(err) {
  const code = err?.code || 'bridge_error';
  const message = err?.message || 'Bridge call failed';
  const payload = { code, message };
  if (err?.details !== undefined) payload.details = err.details;
  return payload;
}

export function notPairedError() {
  return {
    code: 'not_paired',
    message: 'Not paired to a SurfCAD tab. Set SURFCAD_PAIRING_CODE or call the pair tool, then click Allow in the app.',
  };
}

export function pairingEnvHint() {
  return 'Copy the 6-character code from SurfCAD → Local agent → Show pairing code.';
}
