/**
 * Short pairing codes for M1 local WebSocket bridge (no silent auto-pair).
 */

const ALPHABET = '23456789BCDFGHJKLMNPQRSTVWXYZ';

/** @param {number} [length] */
export function createPairingToken(length = 6) {
  const n = Math.max(4, Math.min(12, length | 0));
  const bytes = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    throw new Error('createPairingToken requires crypto.getRandomValues');
  }
  let out = '';
  for (let i = 0; i < n; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
