// services/loginTracking.js — update User login fields + append LoginEvent
import User from '../db/models/User.js';
import LoginEvent from '../db/models/LoginEvent.js';
import config from '../config/index.js';
import { isInternalUser } from './internalUsers.js';
import {
  captureAuthAnalytics,
  readRequestedAnalyticsConsent,
  seedUserConsent,
} from './posthog.js';

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
 * Sets session.authAt so enforceCredentialRevocation keeps this login.
 * Every path that creates a signed-in session must call this (password,
 * verify, guest convert, GitHub, Google, Apple) — not recordSuccessfulLogin
 * alone, which does not stamp authAt.
 * @param {import('express').Request} req
 * @param {import('../db/models/User.js').default} user
 * @param {import('../db/models/LoginEvent.js').LoginMethod} method
 * @param {{ isNew?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export function loginAndTrack(req, user, method, { isNew = false } = {}) {
  return new Promise((resolve, reject) => {
    req.login(user, async (err) => {
      if (err) {
        reject(err);
        return;
      }
      try {
        if (req.session) req.session.authAt = Date.now();
        await recordSuccessfulLogin(user, method);
        const requestedConsent = readRequestedAnalyticsConsent(req);
        if (seedUserConsent(user, requestedConsent)) {
          try {
            await user.save();
          } catch {
            /* consent seed is best-effort */
          }
        }
        const newAccount = isNew === true
          || method === 'verify'
          || method === 'guest_convert';
        await captureAuthAnalytics(user, {
          isNew: newAccount,
          method,
          requestedConsent,
          isInternal: isInternalUser(user, config.internalUsers),
        });
        resolve();
      } catch (trackErr) {
        reject(trackErr);
      }
    });
  });
}
