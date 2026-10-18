/**
 * Entry for `node --test test/` on Node builds that execute a directory
 * argument as a package instead of walking it. Importing the suite runs it.
 *
 * Run: cd backend && npm install && node --test test/
 */
import './cart-order.test.js';
import './address-book.test.js';
import './measure-part.test.js';
import './multi-line-order.test.js';
import './partner-rate-limit.test.js';
import './auth-account-linking.test.js';
import './auth-apple.test.js';
import './auth-apple-unconfigured.test.js';
import './order-access.test.js';
import './auth-s1b-followups.test.js';
import './generate-route.test.js';
import './convert-route.test.js';
import './admin-stats.test.js';
import '../../test/backend-monitoring-stats.test.js';
import './email-html-escape.test.js';
import './prune-uploads.test.js';
