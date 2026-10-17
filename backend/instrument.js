/**
 * Early Sentry bootstrap — must load before express (first import in server.js or node --import).
 */

import { loadBackendDotenv } from './config/loadEnv.js';
import { initializeSentryOnce } from './monitoring/sentryInit.js';

loadBackendDotenv();
initializeSentryOnce();
