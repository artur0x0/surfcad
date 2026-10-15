/**
 * Cloudflare Turnstile verification for POST /api/partners.
 * @see https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Documented test secret — always passes when paired with the test site key. */
export const TURNSTILE_TEST_SECRET_ALWAYS_PASS = '1x0000000000000000000000000000000AA';

function resolveSecret() {
  const fromEnv = typeof process.env.TURNSTILE_SECRET_KEY === 'string'
    ? process.env.TURNSTILE_SECRET_KEY.trim()
    : '';
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') return '';
  console.log('[Partners] TURNSTILE_SECRET_KEY unset — using Cloudflare Turnstile test secret (development)');
  return TURNSTILE_TEST_SECRET_ALWAYS_PASS;
}

/**
 * @param {string | undefined} token
 * @param {string} remoteIp
 * @param {{ fetch?: typeof fetch }} [deps]
 * @returns {Promise<{ ok: true } | { ok: false, status: number, error: string }>}
 */
export async function verifyPartnerTurnstile(token, remoteIp, deps = {}) {
  const secret = resolveSecret();
  const isProd = process.env.NODE_ENV === 'production';

  if (!secret) {
    console.error('[Partners] TURNSTILE_SECRET_KEY missing in production — rejecting partner submit');
    return {
      ok: false,
      status: 503,
      error: 'Form verification is unavailable. Please try again later.',
    };
  }

  const skipVerify = !isProd
    && !process.env.TURNSTILE_SECRET_KEY?.trim()
    && (!token || !String(token).trim());

  if (skipVerify) {
    console.log('[Partners] No Turnstile token and TURNSTILE_SECRET_KEY unset — skipping verification (development)');
    return { ok: true };
  }

  const response = typeof token === 'string' ? token.trim() : '';
  if (!response) {
    return {
      ok: false,
      status: 400,
      error: 'Please refresh the page and try again.',
    };
  }

  const fetchFn = deps.fetch ?? globalThis.fetch;
  const body = new URLSearchParams({
    secret,
    response,
  });
  if (remoteIp) body.set('remoteip', remoteIp);

  let data;
  try {
    const res = await fetchFn(SITEVERIFY_URL, { method: 'POST', body });
    data = await res.json();
  } catch (err) {
    console.error('[Partners] Turnstile siteverify request failed:', err);
    return {
      ok: false,
      status: 502,
      error: 'We could not verify your submission. Please try again in a moment.',
    };
  }

  if (data?.success) {
    return { ok: true };
  }

  console.warn('[Partners] Turnstile siteverify rejected token:', data?.['error-codes']);
  return {
    ok: false,
    status: 400,
    error: 'We could not verify your submission. Please refresh the page and try again.',
  };
}
