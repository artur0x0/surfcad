/**
 * Pairing codes for the local WebSocket bridge. The person copies the code
 * into the agent. Eight characters of an unambiguous alphabet is enough to
 * type or paste, and long enough that a guess is not cheap.
 *
 * Bytes are mapped by rejection sampling. `byte % alphabet` would prefer the
 * first symbols, because 256 is not a multiple of the alphabet size.
 */

export const PAIRING_TOKEN_ALPHABET = '23456789BCDFGHJKLMNPQRSTVWXYZ';
export const PAIRING_TOKEN_LENGTH = 8;

const ALPHABET_SIZE = PAIRING_TOKEN_ALPHABET.length;
/** Largest multiple of the alphabet size that fits in a byte. */
const UNBIASED_BYTE_LIMIT = 256 - (256 % ALPHABET_SIZE);

/**
 * Map random bytes onto the alphabet, skipping values that would bias it.
 * Returns a short string when `bytes` does not contain enough unbiased values.
 * @param {ArrayLike<number>} bytes
 * @param {number} length
 */
export function pairingTokenFromBytes(bytes, length) {
  const n = clampLength(length);
  let out = '';
  for (let i = 0; i < bytes.length && out.length < n; i += 1) {
    const byte = bytes[i] & 0xff;
    if (byte >= UNBIASED_BYTE_LIMIT) continue;
    out += PAIRING_TOKEN_ALPHABET[byte % ALPHABET_SIZE];
  }
  return out;
}

/**
 * @param {number} [length]
 */
export function createPairingToken(length = PAIRING_TOKEN_LENGTH) {
  const n = clampLength(length);
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('createPairingToken requires crypto.getRandomValues');
  }
  // About one byte in eleven is rejected. Sixteen bytes per character
  // still fails closed if the draw comes back biased.
  const bytes = new Uint8Array(n * 16);
  crypto.getRandomValues(bytes);
  const out = pairingTokenFromBytes(bytes, n);
  if (out.length !== n) {
    throw new Error('createPairingToken could not draw an unbiased code');
  }
  return out;
}

/**
 * @param {number} length
 */
function clampLength(length) {
  return Math.max(4, Math.min(12, length | 0));
}
