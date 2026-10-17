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
import { loginAndTrack, recordSuccessfulLogin } from '../services/loginTracking.js';
import { requireAuth } from '../auth/session.js';

const router = Router();

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
router.get('/me', (req, res) => {
  if (req.isAuthenticated()) {
    const user = req.user.toJSON();
    // Null when the Mongo document never stored a name. Do not substitute the
    // schema default here — resolution must still be free to adopt a legacy vault.
    user.vaultName = storedVaultNameFromUser(req.user);
    return res.json({
      authenticated: true,
      user,
    });
  }
  
  // Return guest session info if exists
  if (req.session.guestId) {
    return res.json({
      authenticated: false,
      guest: {
        id: req.session.guestId,
        email: req.session.guestEmail,
        address: req.session.guestAddress,
      },
    });
  }
  
  return res.json({ authenticated: false });
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
    
    const normalizedEmail = userEmail.toLowerCase();
    
    // Check if user exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      // If user exists but is not verified, allow re-registration (resend code)
      if (!existingUser.emailVerified && existingUser.authProvider === 'local') {
        // Generate new verification code
        const code = existingUser.generateVerificationCode();
        await existingUser.save();
        
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
    const user = new User({
      email: normalizedEmail,
      firstName: firstName || null,
      lastName: lastName || null,
      name: fullName,
      authProvider: 'local',
      emailVerified: false,
    });
    
    await user.setPassword(password);
    
    // Add address if provided
    if (address) {
      user.upsertAddress(address, true);
    }
    
    // Generate verification code
    const code = user.generateVerificationCode();
    
    await user.save();
    
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
    const { email: userEmail, code } = req.body;
    
    if (!userEmail || !code) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }
    
    const normalizedEmail = userEmail.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email is already verified' });
    }
    
    // Verify the code
    const result = user.verifyCode(code);
    await user.save();
    
    if (!result.valid) {
      return res.status(400).json({ error: result.error });
    }
    
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
        user,
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
    
    const normalizedEmail = userEmail.toLowerCase();
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
    
    const normalizedEmail = userEmail.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check password
    const isValid = await user.verifyPassword(password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check if email is verified (only for local auth)
    if (user.authProvider === 'local' && !user.emailVerified) {
      // Generate and send new verification code
      const code = user.generateVerificationCode();
      await user.save();
      
      const displayName = user.firstName || user.name || '';
      email.sendVerificationEmail(normalizedEmail, code, displayName).catch(console.error);
      
      return res.status(200).json({
        success: true,
        pendingVerification: true,
        email: normalizedEmail,
        message: 'Please verify your email. A new code has been sent.',
      });
    }
    
    try {
      await loginAndTrack(req, user, 'password');
      delete req.session.guestId;
      delete req.session.guestEmail;
      delete req.session.guestAddress;
      console.log(`[Auth] User logged in: ${normalizedEmail}`);
      return res.json({
        success: true,
        user,
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
  
  // Create guest session
  if (!req.session.guestId) {
    req.session.guestId = crypto.randomUUID();
  }
  
  req.session.guestEmail = guestEmail.toLowerCase();
  
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

/**
 * POST /api/auth/guest/convert
 * Convert guest to registered user (after order)
 */
router.post('/guest/convert', async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!req.session.guestEmail) {
      return res.status(400).json({ error: 'No guest session found' });
    }
    
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    // Check if user already exists
    let user = await User.findOne({ email: req.session.guestEmail });
    
    if (user) {
      // User exists - could be from a previous order
      if (user.passwordHash) {
        return res.status(409).json({ error: 'Account already exists. Please log in.' });
      }
      // User exists without password (e.g., from guest order), set password
      await user.setPassword(password);
      user.emailVerified = true; // Guest conversion after order - email is implicitly verified
    } else {
      // Create new user
      user = new User({
        email: req.session.guestEmail,
        authProvider: 'local',
        emailVerified: true, // Guest conversion - email verified through order process
      });
      await user.setPassword(password);
    }
    
    // Add guest address if available
    if (req.session.guestAddress) {
      user.upsertAddress(req.session.guestAddress, true);
    }
    
    await user.save();
    
    // Send admin notification for new user
    email.sendAdminNewUserNotification(user).catch(console.error);
    
    try {
      await loginAndTrack(req, user, 'guest_convert');
      delete req.session.guestId;
      delete req.session.guestEmail;
      delete req.session.guestAddress;
      return res.json({
        success: true,
        user,
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

    // Ensure githubId is always set (older linked accounts)
    if (user.githubId !== profile.id) {
      user.githubId = profile.id;
      await user.save();
    }

    await loginAndTrack(req, user, 'github');

    delete req.session.guestId;
    delete req.session.guestEmail;
    delete req.session.guestAddress;

    return res.json({
      success: true,
      isNew: !!isNew,
      user,
    });
  } catch (error) {
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
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

/**
 * GET /api/auth/google/callback
 * Google OAuth callback
 */
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=google_failed' }),
  async (req, res) => {
    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;

    if (req.user) {
      await recordSuccessfulLogin(req.user, 'google');
    }

    delete req.session.guestId;
    delete req.session.guestEmail;
    delete req.session.guestAddress;

    const redirectUrl = buildRedirectUrl(config.frontendUrl, returnTo, { auth: 'success' });
    res.redirect(redirectUrl);
  }
);

/**
 * GET /api/auth/apple
 * Initiate Apple OAuth
 */
router.get('/apple', (req, res, next) => {
  // Store returnTo in session
  const returnTo = req.query.returnTo || '/';
  req.session.returnTo = returnTo;

  passport.authenticate('apple', {
  })(req, res, next);
});

/**
 * POST /api/auth/apple/callback
 * Apple OAuth callback (Apple uses POST)
 */
router.post('/apple/callback',
  (req, res, next) => {
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

      loginAndTrack(req, user, 'apple')
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
    await user.save();
    
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
