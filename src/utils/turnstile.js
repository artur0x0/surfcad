/** Documented Cloudflare Turnstile test site key — always passes. */
export const TURNSTILE_TEST_SITE_KEY_ALWAYS_PASS = '1x00000000000000000000AA';

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise;

/**
 * Site key for the partners form: build env, else test key in dev, else empty (production must set VITE_).
 */
export function resolveTurnstileSiteKey() {
  const fromEnv = typeof import.meta.env.VITE_TURNSTILE_SITE_KEY === 'string'
    ? import.meta.env.VITE_TURNSTILE_SITE_KEY.trim()
    : '';
  if (fromEnv) return fromEnv;
  if (import.meta.env.DEV) return TURNSTILE_TEST_SITE_KEY_ALWAYS_PASS;
  return '';
}

export function loadTurnstileScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src^="${TURNSTILE_SCRIPT_SRC.split('?')[0]}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Turnstile script failed')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Turnstile script failed'));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}
