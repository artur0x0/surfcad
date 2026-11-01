import { AGENT_HANDSHAKE_UPDATE_MESSAGE } from './commandProtocol.mjs';

export const RECONNECT_HINT = 'Open SurfCAD in Chrome and keep the tab open; it will reconnect.';

export const LOGIN_AGAIN_MESSAGE = 'This agent login is no longer valid. Run npx surfcad-mcp login again.';

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
    message: 'Not paired to a SurfCAD tab. Set SURFCAD_PAIRING_CODE or call the pair tool and click Allow, or run npx surfcad-mcp login --code with the join code.',
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
  return 'Copy the 8-character code from SurfCAD → Local agent → Show pairing code, or run npx surfcad-mcp login --code with the join code.';
}

export function tabAsleepError() {
  return Object.assign(new Error('SurfCAD tab is asleep'), {
    code: 'tab_asleep',
    hint: 'Open SurfCAD in Chrome and keep that tab open, then retry this call.',
    retryable: true,
  });
}

export function tooManyPendingError() {
  return Object.assign(new Error('Too many commands are waiting'), {
    code: 'too_many_pending',
    hint: 'Wait for the SurfCAD tab to finish the commands already in flight, then retry.',
    retryable: true,
  });
}

export function tokenRevokedError() {
  return Object.assign(new Error(LOGIN_AGAIN_MESSAGE), {
    code: 'token_revoked',
    hint: 'Run npx surfcad-mcp login and approve the new code in SurfCAD.',
    retryable: false,
  });
}

/**
 * @param {string} [message]
 */
export function clientUpdateError(message = AGENT_HANDSHAKE_UPDATE_MESSAGE) {
  const text = typeof message === 'string' && message.includes(AGENT_HANDSHAKE_UPDATE_MESSAGE)
    ? AGENT_HANDSHAKE_UPDATE_MESSAGE
    : (message || AGENT_HANDSHAKE_UPDATE_MESSAGE);
  return Object.assign(new Error(text), {
    code: 'client_update_required',
    hint: 'This surfcad-mcp is too old for the agent server. Update the package, then run npx surfcad-mcp login again.',
  });
}

/**
 * Map a server-relay command error onto a clear Error. Leaves other errors alone.
 * @param {unknown} error
 */
export function asRemoteError(error) {
  if (error instanceof Error) {
    const code = /** @type {Error & { code?: string }} */ (error).code;
    if (
      code === 'tab_asleep'
      || code === 'too_many_pending'
      || code === 'token_revoked'
      || code === 'client_update_required'
    ) return error;
  }
  const record = error && typeof error === 'object'
    ? /** @type {{ code?: unknown, message?: unknown }} */ (error)
    : {};
  const code = typeof record.code === 'string' ? record.code : (typeof error === 'string' ? error : '');
  const message = typeof record.message === 'string'
    ? record.message
    : (typeof error === 'string' ? error : '');
  if (code === 'tab_asleep' || message === 'SurfCAD tab is asleep') return tabAsleepError();
  if (code === 'too_many_pending' || message === 'Too many commands are waiting') return tooManyPendingError();
  if (code === 'token_revoked' || code === 'unauthorized' || code === '4001') return tokenRevokedError();
  if (
    code === 'client_update_required'
    || code === AGENT_HANDSHAKE_UPDATE_MESSAGE
    || message === AGENT_HANDSHAKE_UPDATE_MESSAGE
    || message.includes(AGENT_HANDSHAKE_UPDATE_MESSAGE)
  ) {
    return clientUpdateError(message || code);
  }
  if (error instanceof Error) return error;
  return Object.assign(new Error(message || 'Bridge call failed'), {
    code: code || 'bridge_error',
  });
}
