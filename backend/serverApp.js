// serverApp.js — loaded after instrument.js so express/http patch before import.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { isSentryEnabled, installSentryErrorHandler } from './monitoring/sentry.js';

// Config and DB
import config from './config/index.js';
import { connectDB } from './db/connection.js';

// Auth
import { initializePassport } from './auth/passport.js';
import { createSessionMiddleware, enforceCredentialRevocation, requireAuth } from './auth/session.js';
import passport from 'passport';

// Routes
import authRoutes from './routes/auth.js';
import shippingRoutes from './routes/shipping.js';
import orderRoutes from './routes/orders.js';
import quoteRoutes from './routes/quotes.js';
import cartRoutes from './routes/cart.js';
import webhookRoutes from './routes/webhooks.js';
import convertRoutes from './routes/convert.js';
import winsRoutes from './routes/wins.js';
import githubRoutes from './routes/github.js';
import partnersRoutes from './routes/partners.js';
import adminRoutes from './routes/admin.js';

// CAD and AI
import { createGenerateHandler } from './services/generateProxy.js';
import { createRateLimiter, rateLimitMiddleware, userKey } from './services/rateLimiter.js';

let SYSTEM_PROMPT = 'You are a CAD assistant.';
try {
  const mod = await import('./systemPrompt.js');
  if (mod?.SYSTEM_PROMPT) SYSTEM_PROMPT = mod.SYSTEM_PROMPT;
} catch {
  console.warn('[Server] systemPrompt.js missing — using stub');
}

export const app = express();
const sentryEnabled = isSentryEnabled();

// ============ Trust Proxy for Auth Redirects ===============
app.set('trust proxy', config.trustProxyHops);

// ============ Security Middleware ============
app.use(helmet({
  contentSecurityPolicy: config.env === 'production' ? undefined : false,
  // Helmet 8 default is same-origin, which severs Safari's loopback popup opener.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

// ============ CORS ============
app.use(cors({
  origin: config.frontendUrl,
  credentials: true, // Required for sessions
}));

// ============ Webhooks ============
// Stripe webhooks need raw body
app.use('/api/webhooks', webhookRoutes);

// ============ Body Parsing ============
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ============ Sessions ============
app.use(createSessionMiddleware());

// ============ Passport Auth ============
initializePassport();
app.use(passport.initialize());
app.use(passport.session());
app.use(enforceCredentialRevocation);

// ============ API Routes ============
app.use('/api/auth', authRoutes);
app.use('/api/shipping', shippingRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/convert', convertRoutes);
app.use('/api/wins', winsRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/partners', partnersRoutes);
app.use('/api/admin', adminRoutes);

const generateLimiter = createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 });
app.post(
  '/api/generate',
  requireAuth,
  rateLimitMiddleware(generateLimiter, userKey, 'Too many AI requests. Try again in a few minutes.'),
  createGenerateHandler({ systemPrompt: SYSTEM_PROMPT, apiKey: process.env.GROQ_API_KEY }),
);

// ============ Config endpoint for frontend ============
app.get('/api/config', (req, res) => {
  res.json({
    stripePublishableKey: config.stripe.publishableKey,
    googleClientId: config.google.clientId,
    appleClientId: config.apple.clientId,
    // Public Client ID only — secret stays server-side for /api/github/oauth/token.
    githubAppClientId: config.githubApp.clientId || '',
  });
});

// ============ Health Check ============
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    env: config.env,
  });
});

// ============ Error Handler ============
if (sentryEnabled) {
  installSentryErrorHandler(app);
}

app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ 
    error: 'Internal server error',
    ...(config.env === 'development' && { details: err.message }),
  });
});

// ============ Start Server ============
const PORT = config.port;

export async function startServer() {
  try {
    // Connect to MongoDB
    await connectDB();
    
    app.listen(PORT, () => {
      console.log(`[Server] Running on port ${PORT}`);
      console.log(`[Server] Environment: ${config.env}`);
      console.log(`[Server] Frontend URL: ${config.frontendUrl}`);
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  startServer();
}
