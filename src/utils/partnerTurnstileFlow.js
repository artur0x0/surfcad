/** Cloudflare Turnstile test site key — always fails verification. */
export const TURNSTILE_TEST_SITE_KEY_ALWAYS_FAIL = '2x00000000000000000000AB';

export const TURNSTILE_RENDER_SIZE = 'flexible';

export const TURNSTILE_TOKEN_TIMEOUT_MS = 25_000;
export const PARTNER_FETCH_TIMEOUT_MS = 20_000;

export const TURNSTILE_VERIFY_ERROR =
  'We could not verify your submission. Please try again.';
export const TURNSTILE_LOAD_ERROR =
  'Could not load form protection. Check your connection and refresh.';
export const PARTNER_SUBMIT_ERROR = 'Could not send your message';

/**
 * Turnstile explicit-render options (managed/invisible behaviour is set in the Cloudflare dashboard).
 * @param {string} sitekey
 * @param {{ onToken?: (token: string) => void, onError?: () => void, onExpired?: () => void, onTimeout?: () => void }} handlers
 */
export function buildTurnstileRenderConfig(sitekey, handlers = {}) {
  const noop = () => {};
  return {
    sitekey,
    size: TURNSTILE_RENDER_SIZE,
    callback: handlers.onToken ?? noop,
    'error-callback': handlers.onError ?? noop,
    'expired-callback': handlers.onExpired ?? noop,
    'timeout-callback': handlers.onTimeout ?? noop,
  };
}

/**
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {string} message
 * @returns {Promise<T>}
 */
export function promiseWithTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * @param {{ getResponse?: (widgetId: string) => string | undefined }} turnstile
 * @param {string} widgetId
 */
export function readTurnstileToken(turnstile, widgetId) {
  if (typeof turnstile.getResponse !== 'function') return null;
  const token = turnstile.getResponse(widgetId);
  return token ? String(token) : null;
}

/**
 * @param {{ getResponse?: (widgetId: string) => string | undefined, execute: (widgetId: string, options: Record<string, unknown>) => void }} turnstile
 * @param {string} widgetId
 * @param {{ timeoutMs?: number, errorMessage?: string }} [options]
 */
export async function acquireTurnstileToken(turnstile, widgetId, options = {}) {
  const cached = readTurnstileToken(turnstile, widgetId);
  if (cached) return cached;
  return waitForTurnstileExecute(turnstile, widgetId, options);
}

/**
 * @param {{ execute: (widgetId: string, options: Record<string, unknown>) => void }} turnstile
 * @param {string} widgetId
 * @param {{ timeoutMs?: number, errorMessage?: string }} [options]
 */
export function waitForTurnstileExecute(turnstile, widgetId, options = {}) {
  const timeoutMs = options.timeoutMs ?? TURNSTILE_TOKEN_TIMEOUT_MS;
  const errorMessage = options.errorMessage ?? TURNSTILE_VERIFY_ERROR;

  const executePromise = new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const executeOpts = {
      callback: (token) => {
        if (!token) settle(reject, new Error(errorMessage));
        else settle(resolve, token);
      },
      'error-callback': () => settle(reject, new Error(errorMessage)),
      'expired-callback': () => settle(reject, new Error(errorMessage)),
    };

    try {
      turnstile.execute(widgetId, executeOpts);
    } catch (err) {
      settle(reject, err instanceof Error ? err : new Error(errorMessage));
    }
  });

  return promiseWithTimeout(executePromise, timeoutMs, errorMessage);
}

/**
 * @param {Record<string, unknown>} payload
 * @param {{
 *   requestTurnstileToken: () => Promise<string>,
 *   fetch?: typeof fetch,
 *   apiPath?: string,
 *   fetchTimeoutMs?: number,
 * }} deps
 */
export async function postPartnerLead(payload, deps) {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const apiPath = deps.apiPath ?? '/api/partners';
  const fetchTimeoutMs = deps.fetchTimeoutMs ?? PARTNER_FETCH_TIMEOUT_MS;

  const turnstileToken = await deps.requestTurnstileToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);

  try {
    const res = await fetchFn(apiPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, turnstileToken }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        typeof body.error === 'string' && body.error ? body.error : PARTNER_SUBMIT_ERROR,
      );
    }
    return body;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(PARTNER_SUBMIT_ERROR);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Partner form submit orchestration — always clears submitting in `finally`.
 * @param {{
 *   payload: Record<string, unknown>,
 *   requestTurnstileToken: () => Promise<string>,
 *   postLead?: typeof postPartnerLead,
 *   fetch?: typeof fetch,
 *   setSubmitting?: (value: boolean) => void,
 * }} args
 */
export async function runPartnerFormSubmit(args) {
  const postLead = args.postLead ?? postPartnerLead;
  args.setSubmitting?.(true);
  try {
    await postLead(args.payload, {
      requestTurnstileToken: args.requestTurnstileToken,
      fetch: args.fetch,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : PARTNER_SUBMIT_ERROR;
    return { ok: false, error: message || PARTNER_SUBMIT_ERROR };
  } finally {
    args.setSubmitting?.(false);
  }
}
