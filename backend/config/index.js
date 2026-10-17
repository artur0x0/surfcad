// config/index.js - Configuration loader
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { SESSION_MAX_AGE_MS } from '../../src/utils/sessionPolicy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment-specific .env file
const envFile = process.env.NODE_ENV === 'production' 
  ? '.env.production' 
  : '.env.development';

dotenv.config({ path: path.join(__dirname, '..', envFile) });

// Also load default .env as fallback
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/**
 * @param {string | undefined} raw
 * @returns {number}
 */
export function parseTrustProxyHops(raw) {
  if (raw === undefined || raw === '') return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`Invalid TRUST_PROXY_HOPS: ${JSON.stringify(raw)} (expected a non-negative integer)`);
    process.exit(1);
  }
  return n;
}

const trustProxyHops = parseTrustProxyHops(process.env.TRUST_PROXY_HOPS);

const config = {
  env: process.env.NODE_ENV,
  trustProxyHops,
  port: parseInt(process.env.PORT, 10),
  frontendUrl: process.env.FRONTEND_URL,
  backendUrl: process.env.BACKEND_URL,
  
  // MongoDB
  mongodb: {
    uri: process.env.MONGODB_URI,
  },
  
  // Session
  session: {
    secret: process.env.SESSION_SECRET,
    maxAge: SESSION_MAX_AGE_MS,
  },
  
  // OAuth - Google
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: `${process.env.BACKEND_URL}${process.env.GOOGLE_CALLBACK_URL}`,
  },
  
  // OAuth - Apple
  apple: {
    clientId: process.env.APPLE_CLIENT_ID,
    teamId: process.env.APPLE_TEAM_ID,
    keyId: process.env.APPLE_KEY_ID,
    privateKeyPath: process.env.APPLE_PRIVATE_KEY_PATH,
    callbackUrl: `${process.env.BACKEND_URL}${process.env.APPLE_CALLBACK_URL}`,
  },
  
  // Stripe
  stripe: {
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  
  // UPS
  ups: {
    clientId: process.env.UPS_CLIENT_ID,
    clientSecret: process.env.UPS_CLIENT_SECRET,
    accountNumber: process.env.UPS_ACCOUNT_NUMBER,
    apiUrl: process.env.UPS_API_URL,
  },
  
  // Shipping origin
  shipFrom: {
    name: process.env.SHIP_FROM_NAME,
    street: process.env.SHIP_FROM_STREET,
    city: process.env.SHIP_FROM_CITY,
    state: process.env.SHIP_FROM_STATE,
    zip: process.env.SHIP_FROM_ZIP,
    country: process.env.SHIP_FROM_COUNTRY,
    phone: process.env.SHIP_FROM_PHONE,
  },
  
  // Azure Email
  azure: {
    commConnectionString: process.env.AZURE_COMM_CONNECTION_STRING,
    emailSender: process.env.AZURE_EMAIL_SENDER,
  },
  
  // GitHub App (user-to-server OAuth — no private key / App ID needed)
  githubApp: {
    clientId: process.env.GITHUB_APP_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET || '',
  },

  // Admin
  adminEmail: process.env.ADMIN_EMAIL,

  // Storage
  workingFolder: process.env.WORKING_FOLDER,
  uploadFolder: process.env.UPLOAD_FOLDER
};

// Validation
const requiredInProd = [
  'mongodb.uri',
  'session.secret',
  'stripe.secretKey',
  'stripe.webhookSecret',
];

if (config.env === 'production') {
  for (const key of requiredInProd) {
    const value = key.split('.').reduce((obj, k) => obj?.[k], config);
    if (!value) {
      console.error(`Missing required config: ${key}`);
      process.exit(1);
    }
  }
}

export default config;
