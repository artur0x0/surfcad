/**
 * Human-review fee from the environment. Unset or invalid means checkout
 * is off. This module does not read Stripe keys and does not charge a card.
 */

const FEE_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const MIN_USD = 0.5;

export function reviewFeeUsdFromEnv(env = process.env) {
  const raw = env?.MOLDING_REVIEW_FEE_USD;
  if (typeof raw !== 'string' || !FEE_RE.test(raw.trim())) return null;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < MIN_USD) return null;
  return Math.round(n * 100) / 100;
}

export function reviewFeeCents(usd) {
  return Math.round(Number(usd) * 100);
}

/**
 * Test keys work in any environment. Live keys work only when NODE_ENV is
 * production, so a dev or test process cannot charge a live account.
 */
const TEST_SECRET = 'sk_test_';
const TEST_RESTRICTED = 'rk_test_';
const LIVE_SECRET = 'sk_' + 'live_';
const LIVE_RESTRICTED = 'rk_' + 'live_';

export function reviewCheckoutKeyAllowed(key, nodeEnv = process.env.NODE_ENV) {
  if (typeof key !== 'string' || !key) return false;
  if (key.startsWith(TEST_SECRET) || key.startsWith(TEST_RESTRICTED)) return true;
  if (nodeEnv === 'production' && (key.startsWith(LIVE_SECRET) || key.startsWith(LIVE_RESTRICTED))) return true;
  return false;
}
