// auth/passport.js - Passport authentication strategies
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as AppleStrategy } from 'passport-apple';
import fs from 'fs';
import User from '../db/models/User.js';
import config from '../config/index.js';
import { resolveAppleIdentity } from './appleIdentity.js';

/**
 * Initialize Passport with all authentication strategies
 */
export function initializePassport() {
  // Serialize user to session
  passport.serializeUser((user, done) => {
    done(null, user._id);
  });

  // Deserialize user from session
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });

  // Local Strategy (email + password)
  passport.use(new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
    },
    async (email, password, done) => {
      try {
        const user = await User.findOne({ email: email.toLowerCase() });
        
        if (!user) {
          return done(null, false, { message: 'Invalid email or password' });
        }
        
        // Check if user has a password (might be OAuth-only)
        if (!user.passwordHash) {
          return done(null, false, { 
            message: 'This account uses social login. Please sign in with GitHub, Google, or Apple.' 
          });
        }
        
        const isValid = await user.verifyPassword(password);
        
        if (!isValid) {
          return done(null, false, { message: 'Invalid email or password' });
        }
        
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  ));

  // Google OAuth Strategy
  if (config.google.clientId && config.google.clientSecret) {
    passport.use(new GoogleStrategy(
      {
        clientID: config.google.clientId,
        clientSecret: config.google.clientSecret,
        callbackURL: config.google.callbackUrl,
        scope: ['profile', 'email'],
        passReqToCallback: true
      },
      async (req, accessToken, refreshToken, profile, done) => {
        // Preserve returnTo before any session changes
        const returnTo = req.session.returnTo;
        
        try {
          const { user, isNew } = await User.findOrCreateOAuth(profile, 'google');
          // Restore returnTo after auth
          req.session.returnTo = returnTo;
          return done(null, user, { isNew });
        } catch (error) {
          return done(error);
        }
      }
    ));
  } else {
    console.warn('[Auth] Google OAuth not configured - skipping');
  }

  // Apple OAuth Strategy
  if (config.apple.clientId && config.apple.teamId && config.apple.keyId) {
    try {
      // Read the private key file
      let privateKey;
      if (config.apple.privateKeyPath && fs.existsSync(config.apple.privateKeyPath)) {
        privateKey = fs.readFileSync(config.apple.privateKeyPath, 'utf8');
      }
      
      if (privateKey) {
        passport.use(new AppleStrategy(
          {
            clientID: config.apple.clientId,
            teamID: config.apple.teamId,
            keyID: config.apple.keyId,
            privateKeyString: privateKey,
            callbackURL: config.apple.callbackUrl,
            scope: ['name', 'email'],
            passReqToCallback: true
          },
          async (req, accessToken, refreshToken, idToken, profile, done) => {
            try {
              // idToken is results.id_token from Apple's token endpoint
              // (passport-apple getOAuthAccessToken). Not the form-post body.
              const identity = resolveAppleIdentity({
                idToken,
                bodyUser: req.body?.user,
                profile,
              });

              if (!identity.appleId && !identity.email) {
                return done(new Error('Invalid idToken'));
              }

              const { appleId, email, emailVerified, firstName, lastName, displayName } = identity;

              if (!email) {
                const existingUser = await User.findOne({
                  authProvider: 'apple',
                  providerId: appleId
                });

                if (existingUser) {
                  return done(null, existingUser, { isNew: false });
                }

                return done(new Error(
                  'Email is required for Apple Sign In. ' +
                  'Please share your email with the app during sign in.'
                ));
              }

              const existingByEmail = await User.findOne({ email: email.toLowerCase() });
              if (existingByEmail) {
                const sameApple = existingByEmail.authProvider === 'apple'
                  && existingByEmail.providerId === appleId;
                if (!sameApple && (!emailVerified || !existingByEmail.emailVerified)) {
                  return done(new Error('This email is already used. Sign in instead.'));
                }
              }

              const normalizedProfile = {
                id: appleId,
                emails: [{ value: email, verified: emailVerified }],
                displayName,
                name: {
                  givenName: firstName || null,
                  familyName: lastName || null,
                },
              };

              const { user, isNew } = await User.findOrCreateOAuth(normalizedProfile, 'apple');
              return done(null, user, { isNew });
            } catch (error) {
              console.error('[Auth] Apple OAuth error:', error);
              return done(error);
            }
          }
        ))
      } else {
        console.warn('[Auth] Apple private key not found - skipping');
      }
    } catch (error) {
      console.error('[Auth] Error initializing Apple strategy:', error);
    }
  } else {
    console.warn('[Auth] Apple OAuth not configured - skipping');
  }

  return passport;
}

export default passport;
