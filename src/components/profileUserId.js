import { cartUserId } from '../utils/cart.js';

export const PROFILE_USER_ID_COPIED_MS = 1500;

/** Mongo User `_id` string — matches `ADMIN_USER_IDS` / adminAllowlist (`String(user._id)`). */
export function profileMongoUserId(user) {
  return cartUserId(user);
}

/**
 * @param {boolean} signedIn — profile panel signed-in mode (not the sign-in button view)
 * @param {boolean} reauth — grey reconnect mode still has a SurfCAD user
 */
export function profileUserIdRowVisible(signedIn, reauth, user) {
  if (!signedIn && !reauth) return false;
  return !!profileMongoUserId(user);
}

/**
 * @param {string} userId
 * @param {(text: string) => Promise<void>} [writeText]
 * @returns {Promise<boolean>}
 */
export async function copyProfileMongoUserId(userId, writeText) {
  if (!userId) return false;
  const write = writeText
    ?? (typeof navigator !== 'undefined' && navigator.clipboard?.writeText?.bind(navigator.clipboard));
  if (!write) return false;
  try {
    await write(userId);
    return true;
  } catch {
    return false;
  }
}
