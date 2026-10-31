// routes/auth.js - Authentication routes with email verification
import { Router } from 'express';
import passport from 'passport';
import crypto from 'crypto';
import User from '../db/models/User.js';
import email from '../services/email.js';
import config from '../config/index.js';
import { fetchGithubUserProfile } from '../services/githubUser.js';
import { deleteResolvedGithubVault } from '../services/githubVaultDelete.js';
import { confirmAndRememberVaultName, storedVaultNameFromUser } from '../services/vaultName.js';
import { loginAndTrack } from '../services/loginTracking.js';
import { requireAuth } from '../auth/session.js';
import { isInternalUser } from '../services/internalUsers.js';
import {
  parseRequestedAnalyticsConsent,
  seedUserConsent,
  stashRequestedAnalyticsConsent,
} from '../services/posthog.js';
import Order from '../db/models/Order.js';
import {
  EXISTING_ACCOUNT_MESSAGE,
  convertCodeResendWait,
  convertCooldownSentAt,
  createGuestConvertProof,
  evaluateGuestConvertProof,
  newGuestConvertCode,
  paidOrderQuery,
  recordConvertCodeSent,
} from '../auth/guestConvert.js';
import { recordRegisterIp, registerIpWait } from '../auth/registerCooldown.js';
import { persistAfterAgentRevoke } from '../agent/credentialRevoke.js';
import { closeUserTabSockets, revokeUserAgentAccess } from '../agent/install.js';
import { appleOAuthUnavailable } from '../auth/appleIdentity.js';
import { isAdmin } from '../middleware/requireAdmin.js';

const router = Router();

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function registerCodeCooldownResponse(wait) {
  return {
    error: `Please wait ${wait} seconds before requesting a new code`,
    retryAfter: wait,
  };
}

function publicAuthUser(user) {
  const json = typeof user?.toJSON === 'function' ? user.toJSON() : { ...user };
  json.isAdmin = isAdmin(user);
  json.isInternal = isInternalUser(user, config.internalUsers);
  return json;
}

function plainConsent(consent) {
  if (!consent || typeof consent.analytics !== 'boolean') return null;
  const updatedAt = consent.updatedAt ? new Date(consent.updatedAt) : null;
  if (updatedAt && !Number.isFinite(updatedAt.getTime())) return null;
  return {
    analytics: consent.analytics,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  };
}

/**
 * Helper to build redirect URL with proper query param handling
 */
function buildRedirectUrl(baseUrl, returnPath, additionalParams = {}) {
  const path = returnPath.startsWith('/') ? returnPath : `/${returnPath}`;
  const url = new URL(path, baseUrl);
  
  Object.entries(additionalParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  
  return url.toString();
}

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
function presentAuthedUser(reqUser) {
  const user = reqUser.toJSON();
  // Null when the Mongo document never stored a name. Do not substitute the
  // schema default here — resolution must still be free to adopt a legacy vault.
  user.vaultName = storedVaultNameFromUser(reqUser);
  user.isAdmin = isAdmin(reqUser);
  user.isInternal = isInternalUser(reqUser, config.internalUsers);
  return user;
}

router.get('/me', (req, res) => {
  if (req.isAuthenticated()) {
    const user = presentAuthedUser(req.user);
    return res.json({
      authenticated: true,
      user,
      isAdmin: user.isAdmin,
      isInternal: user.isInternal,
    });
  }
  
  // Return guest session info if exists
  if (req.session.guestId) {
    return res.json({
      authenticated: false,
      isAdmin: false,
      isInternal: false,
      guest: {
        id: req.session.guestId,
        email: req.session.guestEmail,
        address: req.session.guestAddress,
      },
    });
  }
  
  return res.json({ authenticated: false, isAdmin: false, isInternal: false });
});

/**
 * PUT /api/auth/consent
 * Persist signed-in user's usage-analytics preference.
 */
router.put('/consent', requireAuth, async (req, res) => {
  try {
    const { analytics } = req.body ?? {};
    if (typeof analytics !== 'boolean') {
      return res.status(400).json({ error: 'analytics must be a boolean' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    user.consent = {
      analytics,
      updatedAt: new Date(),
    };
    await user.save();

    return res.json({ consent: plainConsent(user.consent) });
  } catch (error) {
    console.error('[Auth] Consent update error:', error);
    return res.status(500).json({ error: 'Failed to save consent' });
  }
});

/**
 * POST /api/auth/register
 * Register new user with email/password
 * Returns pendingVerification: true if email verification is required
 */
router.post('/register', async (req, res) => {
  try {
    const { email: userEmail, password, firstName, lastName, name, address } = req.body;
    
    // Validation
    if (!userEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    const normalizedEmail = normalizeEmail(userEmail);
    
    // Check if user exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      // If user exists but is not verified, allow re-registration (resend code).
      // Never store a register-time password on an unverified row.
      if (!existingUser.emailVerified && existingUser.authProvider === 'local') {
        const emailWait = existingUser.canResendCode();
        if (!emailWait.allowed) {
          return res.status(429).json(registerCodeCooldownResponse(emailWait.secondsRemaining));
        }
        const ipWait = registerIpWait(req.ip);
        if (ipWait > 0) {
          return res.status(429).json(registerCodeCooldownResponse(ipWait));
        }
        existingUser.passwordHash = null;
        const code = existingUser.generateVerificationCode();
        await existingUser.save();
        recordRegisterIp(req.ip);
        
        // Get display name for email
        const displayName = existingUser.firstName || existingUser.name || '';
        
        // Send verification email
        email.sendVerificationEmail(normalizedEmail, code, displayName).catch(console.error);
        
        return res.status(200).json({
          success: true,
          pendingVerification: true,
          email: normalizedEmail,
          message: 'Verification code sent to your email',
        });
      }
      
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    
    // Build full name from parts if provided, or use name field as fallback
    const fullName = (firstName && lastName) 
      ? `${firstName} ${lastName}`.trim()
      : name || null;
    
    // Create user with separate name fields
    const ipWait = registerIpWait(req.ip);
    if (ipWait > 0) {
      return res.status(429).json(registerCodeCooldownResponse(ipWait));
    }

    const user = new User({
      email: normalizedEmail,
      firstName: firstName || null,
      lastName: lastName || null,
      name: fullName,
      authProvider: 'local',
      emailVerified: false,
    });
    seedUserConsent(user, parseRequestedAnalyticsConsent(req.body?.analyticsConsent));

    // Password is set at /verify, after the inbox owner proves the code.
    
    // Add address if provided
    if (address) {
      user.upsertAddress(address, true);
    }
    
    // Generate verification code
    const code = user.generateVerificationCode();
    
    await user.save();
    recordRegisterIp(req.ip);
    
    // Send verification email (don't await, fire and forget)
    const displayName = firstName || fullName || '';
    email.sendVerificationEmail(normalizedEmail, code, displayName).catch(console.error);
    
    console.log(`[Auth] User registered, verification pending: ${normalizedEmail}`);
    
    // Return pending verification status (don't log in yet)
    return res.status(201).json({
      success: true,
      pendingVerification: true,
      email: normalizedEmail,
      message: 'Please check your email for the verification code',
    });
    
  } catch (error) {
    console.error('[Auth] Registration error:', error);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * POST /api/auth/verify
 * Verify email with 6-digit code
 */
router.post('/verify', async (req, res) => {
  try {
    const { email: userEmail, code, password } = req.body;
    
    if (!userEmail || !code) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    const normalizedEmail = normalizeEmail(userEmail);
    const user = await User.findOne({ email: normalizedEmail });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email is already verified' });
    }
    
    // Verify the code, then set the password the inbox owner just sent.
    const result = user.verifyCode(code);
    if (!result.valid) {
      await user.save();
      return res.status(400).json({ error: result.error });
    }

    await user.setPassword(password);
    await user.save();
    
    console.log(`[Auth] Email verified: ${normalizedEmail}`);
    
    // Send admin notification for new verified user (don't await)
    email.sendAdminNewUserNotification(user).catch(console.error);
    
    try {
      await loginAndTrack(req, user, 'verify');
      delete req.session.guestId;
      delete req.session.guestEmail;
      delete req.session.guestAddress;
      return res.json({
        success: true,
        verified: true,
        user: publicAuthUser(user),
      });
    } catch (err) {
      console.error('[Auth] Login after verification failed:', err);
      return res.status(500).json({ error: 'Verification successful but login failed' });
    }
    
  } catch (error) {
    console.error('[Auth] Verification error:', error);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * POST /api/auth/resend-verification
 * Resend verification code
 */
router.post('/resend-verification', async (req, res) => {
  try {
    const { email: userEmail } = req.body;
    
    if (!userEmail) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const normalizedEmail = normalizeEmail(userEmail);
    const user = await User.findOne({ email: normalizedEmail });
    
    if (!user) {
      // Don't reveal if user exists or not
      return res.json({ 
        success: true, 
        message: 'If an account exists, a verification code has been sent' 
      });
    }
    
    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email is already verified' });
    }
    
    // Check rate limiting
    const canResend = user.canResendCode();
    if (!canResend.allowed) {
      return res.status(429).json({ 
        error: `Please wait ${canResend.secondsRemaining} seconds before requesting a new code`,
        retryAfter: canResend.secondsRemaining,
      });
    }
    
    // Generate new code
    const code = user.generateVerificationCode();
    await user.save();
    
    // Get display name for email
    const displayName = user.firstName || user.name || '';
    
    // Send email
    email.sendVerificationEmail(normalizedEmail, code, displayName).catch(console.error);
    
    console.log(`[Auth] Verification code resent to: ${normalizedEmail}`);
    
    return res.json({
      success: true,
      message: 'Verification code sent',
    });
    
  } catch (error) {
    console.error('[Auth] Resend verification error:', error);
    return res.status(500).json({ error: 'Failed to resend verification code' });
  }
});

/**
 * POST /api/auth/login
 * Login with email/password
 * Returns pendingVerification: true if email is not verified
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email: userEmail, password } = req.body;
    
    if (!userEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const normalizedEmail = normalizeEmail(userEmail);
    const user = await User.findOne({ email: normalizedEmail });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.authProvider === 'local' && !user.emailVerified) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check password
    const isValid = await user.verifyPassword(password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    try {
      await loginAndTrack(req, user, 'password');
      delete req.session.guestId;
      delete req.session.guestEmail;
      delete req.session.guestAddress;
      console.log(`[Auth] User logged in: ${normalizedEmail}`);
      return res.json({
        success: true,
        user: publicAuthUser(user),
      });
    } catch (err) {
      console.error('[Auth] Login failed:', err);
      return res.status(500).json({ error: 'Login failed' });
    }
    
  } catch (error) {
    console.error('[Auth] Login error:', error);
    return res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/auth/logout
 * Logout current user
 */
router.post('/logout', (req, res) => {
  const userId = req.user?._id ?? req.user?.id;
  req.logout((err) => {
    if (err) {
      console.error('[Auth] Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    
    req.session.destroy((destroyErr) => {
      if (destroyErr) {
        console.error('[Auth] Session destroy error:', destroyErr);
      }
      res.clearCookie('surfcad.sid');
      // Agent tokens are separate devices. Connected agents, surfcad-mcp
      // logout, a password change, account delete, or credentialsRevokedAt
      // revoke them. Signing out of the site does not.
      if (userId != null) closeUserTabSockets(userId);
      return res.json({ success: true });
    });
  });
});

/**
 * POST /api/auth/guest
 * Create or update guest session
 */
router.post('/guest', (req, res) => {
  const { email: guestEmail, address } = req.body;
  
  if (!guestEmail) {
    return res.status(400).json({ error: 'Email is required for guest checkout' });
  }

  const normalizedEmail = normalizeEmail(guestEmail);
  
  // Create guest session
  if (!req.session.guestId) {
    req.session.guestId = crypto.randomUUID();
  }

  if (req.session.guestEmail && req.session.guestEmail !== normalizedEmail) {
    delete req.session.guestConvert;
  }
  
  req.session.guestEmail = normalizedEmail;
  
  if (address) {
    req.session.guestAddress = address;
  }
  
  return res.json({
    success: true,
    guest: {
      id: req.session.guestId,
      email: req.session.guestEmail,
      address: req.session.guestAddress,
    },
  });
});

async function guestHasPaidOrder(req) {
  if (!req.session?.guestEmail || !req.session?.guestId) return false;
  const hit = await Order.exists(paidOrderQuery(req.session.guestEmail, req.session.guestId));
  return !!hit;
}

/**
 * POST /api/auth/guest/convert/code
 * Email a one-time conversion code. Requires a paid order in this session.
 * Never sent when the email already belongs to an account.
 */
router.post('/guest/convert/code', async (req, res) => {
  try {
    if (!req.session.guestEmail || !req.session.guestId) {
      return res.status(400).json({ error: 'No guest session found' });
    }

    if (!(await guestHasPaidOrder(req))) {
      return res.status(403).json({ error: 'Pay for an order first, then create an account.' });
    }

    const existing = await User.findOne({ email: req.session.guestEmail });
    if (existing) {
      return res.status(409).json({ error: EXISTING_ACCOUNT_MESSAGE });
    }

    const wait = convertCodeResendWait(
      convertCooldownSentAt(req.session, req.session.guestEmail, req.session.guestId),
    );
    if (wait > 0) {
      return res.status(429).json({
        error: `Please wait ${wait} seconds before requesting a new code`,
        retryAfter: wait,
      });
    }

    const code = newGuestConvertCode();
    req.session.guestConvert = createGuestConvertProof({
      email: req.session.guestEmail,
      guestId: req.session.guestId,
      code,
    });
    recordConvertCodeSent(req.session, req.session.guestEmail, req.session.guestId);

    const displayName = req.session.guestAddress?.name || '';
    email.sendVerificationEmail(req.session.guestEmail, code, displayName).catch(console.error);

    return res.json({
      success: true,
      message: 'Verification code sent',
    });
  } catch (error) {
    console.error('[Auth] Guest convert code error:', error);
    return res.status(500).json({ error: 'Failed to send verification code' });
  }
});

/**
 * POST /api/auth/guest/convert
 * Convert guest to registered user (after order)
 */
router.post('/guest/convert', async (req, res) => {
  try {
    const { password, code } = req.body;
    
    if (!req.session.guestEmail || !req.session.guestId) {
      return res.status(400).json({ error: 'No guest session found' });
    }
    
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (!(await guestHasPaidOrder(req))) {
      return res.status(403).json({ error: 'Pay for an order first, then create an account.' });
    }

    const existing = await User.findOne({ email: req.session.guestEmail });
    if (existing) {
      return res.status(409).json({ error: EXISTING_ACCOUNT_MESSAGE });
    }

    const proof = evaluateGuestConvertProof(req.session.guestConvert, {
      email: req.session.guestEmail,
      guestId: req.session.guestId,
      code,
    });
    if (!proof.ok) {
      return res.status(proof.status).json({ error: proof.error });
    }

    const user = new User({
      email: req.session.guestEmail,
      authProvider: 'local',
      emailVerified: true,
    });
    await user.setPassword(password);
    
    if (req.session.guestAddress) {
      user.upsertAddress(req.session.guestAddress, true);
    }
    
    await user.save();
    
    email.sendAdminNewUserNotification(user).catch(console.error);
    
    try {
      await loginAndTrack(req, user, 'guest_convert');
      delete req.session.guestId;
      delete req.session.guestEmail;
      delete req.session.guestAddress;
      delete req.session.guestConvert;
      return res.json({
        success: true,
        user: publicAuthUser(user),
      });
    } catch (err) {
      return res.status(500).json({ error: 'Account created but login failed' });
    }
  } catch (error) {
    if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('[Auth] Guest conversion error:', error);
    return res.status(500).json({ error: 'Failed to create account' });
  }
});

/**
 * POST /api/auth/github
 * Upsert app user from a GitHub user-to-server access token (G8).
 * Mirrors Apple/Google findOrCreateOAuth — sets githubId + session.
 * Does NOT store the token (browser keeps it in sessionStorage for git).
 */
router.post('/github', async (req, res) => {
  try {
    const accessToken = typeof req.body?.access_token === 'string'
      ? req.body.access_token
      : '';
    const looked = await fetchGithubUserProfile({ accessToken });
    if (!looked.ok) {
      return res.status(looked.status || 400).json({ error: looked.error || 'GitHub lookup failed' });
    }

    const { profile } = looked;
    const { user, isNew } = await User.findOrCreateOAuth(profile, 'github');
    stashRequestedAnalyticsConsent(req);

    // Ensure githubId / githubLogin are set (older linked accounts)
    let githubDirty = false;
    if (user.githubId !== profile.id) {
      user.githubId = profile.id;
      githubDirty = true;
    }
    const login = String(profile.login || '').trim().toLowerCase();
    if (login && user.githubLogin !== login) {
      user.githubLogin = login;
      githubDirty = true;
    }
    if (githubDirty) await user.save();

    await loginAndTrack(req, user, 'github', { isNew: !!isNew });

    delete req.session.guestId;
    delete req.session.guestEmail;
    delete req.session.guestAddress;

    return res.json({
      success: true,
      isNew: !!isNew,
      user: publicAuthUser(user),
    });
  } catch (error) {
    if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('[Auth] GitHub session upsert error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to sign in with GitHub' });
  }
});

// ============ OAuth Routes ============

/**
 * GET /api/auth/google
 * Initiate Google OAuth
 */
router.get('/google', (req, res, next) => {
  req.session.returnTo = req.query.returnTo || '/';
  stashRequestedAnalyticsConsent(req);
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

/**
 * GET /api/auth/google/callback
 * Google OAuth callback
 */
router.get('/google/callback',
  (req, res, next) => {
    passport.authenticate('google', {
      failureRedirect: '/login?error=google_failed',
    }, (err, user, info) => {
      if (err || !user) {
        return res.redirect('/login?error=google_failed');
      }
      loginAndTrack(req, user, 'google', { isNew: !!info?.isNew })
        .then(() => {
          const returnTo = req.session.returnTo || '/';
          delete req.session.returnTo;
          delete req.session.guestId;
          delete req.session.guestEmail;
          delete req.session.guestAddress;
          const redirectUrl = buildRedirectUrl(config.frontendUrl, returnTo, { auth: 'success' });
          return res.redirect(redirectUrl);
        })
        .catch((loginErr) => {
          console.error('[Auth] req.login failed after Google auth:', loginErr);
          return res.redirect('/login?error=google_failed');
        });
    })(req, res, next);
  }
);

/**
 * GET /api/auth/apple
 * Initiate Apple OAuth
 */
router.get('/apple', (req, res, next) => {
  if (!passport._strategy('apple')) {
    return res.status(404).json(appleOAuthUnavailable());
  }
  const returnTo = req.query.returnTo || '/';
  req.session.returnTo = returnTo;
  stashRequestedAnalyticsConsent(req);

  passport.authenticate('apple', {
  })(req, res, next);
});

/**
 * POST /api/auth/apple/callback
 * Apple OAuth callback (Apple uses POST)
 */
router.post('/apple/callback',
  (req, res, next) => {
    if (!passport._strategy('apple')) {
      return res.status(404).json(appleOAuthUnavailable());
    }
    passport.authenticate('apple', { 
      failureRedirect: '/login?error=apple_failed',
      failureMessage: true 
    }, (err, user, info) => {
      if (err) {
        console.error('[Auth] Passport Apple error during authentication:', err);
        return res.redirect(`/login?error=apple_failed&reason=${encodeURIComponent(err.message || 'internal_error')}`);
      }

      if (!user) {
        console.error('[Auth] Apple authentication failed - no user:', info);
        const reason = info?.message || 'authentication_failed';
        return res.redirect(`/login?error=apple_failed&reason=${encodeURIComponent(reason)}`);
      }

      loginAndTrack(req, user, 'apple', { isNew: !!info?.isNew })
        .then(() => {
          let returnTo = req.session.returnTo || '/';
          delete req.session.returnTo;
          delete req.session.guestId;
          delete req.session.guestEmail;
          delete req.session.guestAddress;
          const redirectUrl = buildRedirectUrl(config.frontendUrl, returnTo, { auth: 'success' });
          return res.redirect(redirectUrl);
        })
        .catch((loginErr) => {
          console.error('[Auth] req.login failed after Apple auth:', loginErr);
          return res.redirect('/login?error=apple_failed');
        });
    })(req, res, next);
  }
);

function sendAddressRouteError(res, error, logLabel, fallback) {
  if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  if (error?.name === 'ValidationError') {
    return res.status(400).json({ error: 'Address is invalid' });
  }
  console.error(logLabel, error);
  return res.status(500).json({ error: fallback });
}

/**
 * PUT /api/auth/address
 * Add or update an address. Signed-in users write the address book.
 * Body: { address, makeDefault }. `address._id` updates that entry so a
 * picker can edit or set the default without appending. Omit `_id` to
 * dedupe on street / street2 / zip or append. Guests still store one
 * session.guestAddress, not the book.
 */
router.put('/address', async (req, res) => {
  try {
    const { address, makeDefault } = req.body;
    
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }
    
    // For authenticated users
    if (req.isAuthenticated()) {
      const user = await User.findById(req.user._id);
      if (!user) return res.status(401).json({ error: 'Not authenticated' });
      const saved = user.upsertAddress(address, makeDefault);
      await user.save();
      
      return res.json({
        success: true,
        addresses: user.addresses,
        address: saved,
      });
    }
    
    // For guests
    req.session.guestAddress = address;
    return res.json({
      success: true,
      address: req.session.guestAddress,
    });
  } catch (error) {
    return sendAddressRouteError(res, error, '[Auth] Address update error:', 'Failed to update address');
  }
});

/**
 * DELETE /api/auth/address/:id
 * Remove one saved address. If it was the default, the newest remaining
 * address becomes the default. Guests have no book.
 */
router.delete('/address/:id', async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const user = await User.findById(req.user._id);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    user.deleteAddress(req.params.id);
    await user.save();
    return res.json({
      success: true,
      addresses: user.addresses,
    });
  } catch (error) {
    return sendAddressRouteError(res, error, '[Auth] Address delete error:', 'Failed to delete address');
  }
});

/**
 * POST /api/auth/change-password
 * Change password for authenticated user
 */
router.post('/change-password', async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    
    const user = await User.findById(req.user._id);
    
    if (!user.passwordHash) {
      return res.status(400).json({ error: 'This account uses social login' });
    }
    
    const isValid = await user.verifyPassword(currentPassword);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    await user.setPassword(newPassword);
    // Revoke first. A failed revoke must not leave the new password in
    // the database with the old agent tokens still valid.
    await persistAfterAgentRevoke(user, (id) => revokeUserAgentAccess(id));
    
    console.log(`[Auth] Password changed for: ${user.email}`);
    
    return res.json({ success: true });
  } catch (error) {
    console.error('[Auth] Change password error:', error);
    return res.status(500).json({ error: 'Failed to change password' });
  }
});


/**
 * PUT /api/auth/vault-name
 * Store the repo name the client resolved. The server re-reads surfcad.json
 * and saves GitHub's name only when the marker matches.
 * Body: { vaultName: string, access_token: string }
 */
router.put('/vault-name', async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const accessToken = typeof req.body?.access_token === 'string'
      ? req.body.access_token.trim()
      : '';
    if (!accessToken) {
      return res.status(400).json({
        error: 'GitHub token required to confirm the vault.',
        code: 'missing_token',
      });
    }
    const looked = await fetchGithubUserProfile({ accessToken });
    if (!looked.ok) {
      return res.status(looked.status || 400).json({
        error: looked.error || 'Could not verify GitHub token',
        code: looked.status === 401 ? 'invalid_token' : 'github_lookup_failed',
      });
    }
    const owner = looked.profile.login;
    if (!owner) {
      return res.status(400).json({ error: 'GitHub login missing', code: 'missing_login' });
    }
    const saved = await confirmAndRememberVaultName(user, {
      accessToken,
      owner,
      vaultName: req.body?.vaultName,
    });
    if (!saved.ok) {
      return res.status(saved.status || 409).json({
        error: saved.error,
        code: saved.code || 'not_a_vault',
      });
    }
    if (saved.changed) await user.save();
    return res.json({
      vaultName: saved.vaultName,
      repo: saved.repo ? `${saved.repo.owner}/${saved.repo.name}` : null,
    });
  } catch (error) {
    console.error('[Auth] Vault name error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to store vault name' });
  }
});

/**
 * DELETE /api/auth/account
 * Delete the SurfCAD user record and, when a GitHub token is provided, the
 * vault repo. Confirmed from the profile Danger zone.
 * Body: { access_token?: string, vault_name?: string }
 * vault_name is ignored. The server resolves stored user.vaultName, then
 * surfcad-vault, then a marked legacy surfcad, and deletes only a match.
 *
 * An unmarked repo is not deleted. The SurfCAD account is still deleted:
 * the GitHub repo may be the app itself or an unrelated project, and blocking
 * account deletion on that would trap the user. The response reports
 * vault.skipped so the client can say the repo was left in place.
 * A GitHub error (permissions, network) does not delete the user.
 */
router.delete('/account', async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const accessToken = typeof req.body?.access_token === 'string'
      ? req.body.access_token.trim()
      : '';
    const storedName = storedVaultNameFromUser(user);

    let vault = null;
    if (user.githubId || accessToken) {
      if (!accessToken) {
        return res.status(400).json({
          error: 'GitHub token required to delete the vault repo. Sign in with GitHub again, then retry.',
          code: 'missing_token',
        });
      }
      // Resolve login for owner — prefer live GitHub profile, fall back to email local-part.
      const looked = await fetchGithubUserProfile({ accessToken });
      if (!looked.ok) {
        return res.status(looked.status || 400).json({
          error: looked.error || 'Could not verify GitHub token',
          code: looked.status === 401 ? 'invalid_token' : 'github_lookup_failed',
        });
      }
      const owner = looked.profile.login;
      if (!owner) {
        return res.status(400).json({ error: 'GitHub login missing', code: 'missing_login' });
      }
      const del = await deleteResolvedGithubVault({
        accessToken,
        owner,
        storedName,
      });
      if (!del.ok) {
        return res.status(del.status || 403).json({
          error: del.error,
          code: del.code || 'vault_delete_failed',
        });
      }
      vault = {
        repo: del.repo,
        deleted: !!del.deleted,
        skipped: !!del.skipped,
        reason: del.reason || null,
        gone: !!del.gone,
      };
    }

    const email = user.email;
    await revokeUserAgentAccess(user._id);
    closeUserTabSockets(user._id);
    await User.deleteOne({ _id: user._id });

    await new Promise((resolve) => {
      req.logout((err) => {
        if (err) console.warn('[Auth] logout after account delete:', err);
        resolve();
      });
    });
    if (req.session) {
      delete req.session.guestId;
      delete req.session.guestEmail;
      delete req.session.guestAddress;
    }

    console.log(`[Auth] Account deleted: ${email}${vault ? ` vault=${vault.repo} deleted=${vault.deleted}` : ''}`);
    return res.json({ success: true, vault });
  } catch (error) {
    console.error('[Auth] Account delete error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to delete account' });
  }
});

export default router;
