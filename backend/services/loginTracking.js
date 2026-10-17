// services/loginTracking.js — update User login fields + append LoginEvent
import User from '../db/models/User.js';
import LoginEvent from '../db/models/LoginEvent.js';

/**
 * Record a successful SurfCAD session sign-in.
 *
 * Called only when express-session + passport establish a new signed-in session
 * (req.login). Not called for:
 * - GET /api/auth/me or other authenticated reads
 * - POST /api/github/oauth/refresh (GitHub token renewal; no new app session)
 * - Guest checkout sessions
 *
 * @param {import('../db/models/User.js').default | { _id: import('mongoose').Types.ObjectId }} user
 * @param {import('../db/models/LoginEvent.js').LoginMethod} method
 */
export async function recordSuccessfulLogin(user, method) {
  if (!user?._id) return;

  const now = new Date();

  try {
    await LoginEvent.create({ userId: user._id, at: now, method });
  } catch (error) {
    console.error('[LoginTracking] Failed to write login event:', error);
  }

  try {
    await User.updateOne(
      { _id: user._id },
      { $set: { lastLoginAt: now }, $inc: { loginCount: 1 } },
    );
  } catch (error) {
    console.error('[LoginTracking] Failed to update user login fields:', error);
    return;
  }

  user.lastLoginAt = now;
  user.loginCount = (user.loginCount ?? 0) + 1;
}

/**
 * Wrap req.login to record tracking after passport establishes the session.
 * @param {import('express').Request} req
 * @param {import('../db/models/User.js').default} user
 * @param {import('../db/models/LoginEvent.js').LoginMethod} method
 * @returns {Promise<void>}
 */
export function loginAndTrack(req, user, method) {
  return new Promise((resolve, reject) => {
    req.login(user, async (err) => {
      if (err) {
        reject(err);
        return;
      }
      try {
        await recordSuccessfulLogin(user, method);
        resolve();
      } catch (trackErr) {
        reject(trackErr);
      }
    });
  });
}
