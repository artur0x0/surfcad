/**
 * POST a prompt to a registered webhook.
 * Times out after 10s and retries once. Does not follow redirects.
 * `insecureTls` is honored only when the caller already decided the test
 * switch applies (loopback target, and not NODE_ENV=production).
 */
import https from 'node:https';
import { isIP } from 'node:net';

export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_ATTEMPTS = 2;

/**
 * Pin the connection to the address we already allowed, so DNS cannot
 * rebind to a private address between the check and the POST.
 * @param {string} address
 */
export function pinLookup(address) {
  const family = isIP(address) === 6 ? 6 : 4;
  return (_hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const all = typeof options === 'object' && options?.all === true;
    if (all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
}

/**
 * @param {string} url
 * @param {Buffer} payload
 * @param {{ timeoutMs: number, insecureTls: boolean, pinAddress?: string }} opts
 */
function defaultHttpsPost(url, payload, opts) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    if (parsed.protocol !== 'https:') {
      reject(new Error('https required'));
      return;
    }
    const requestOptions = {
      protocol: 'https:',
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(payload.length),
        accept: 'application/json',
      },
      rejectUnauthorized: opts.insecureTls !== true,
      servername: parsed.hostname,
      timeout: opts.timeoutMs,
    };
    if (opts.pinAddress) requestOptions.lookup = pinLookup(opts.pinAddress);
    const req = https.request(requestOptions, (res) => {
      res.resume();
      const code = res.statusCode || 0;
      if (code >= 200 && code < 300) resolve({ ok: true });
      else resolve({ ok: false, error: 'webhook_failed' });
    });
    req.on('timeout', () => {
      req.destroy();
      const err = new Error('webhook timeout');
      err.name = 'TimeoutError';
      reject(err);
    });
    req.on('error', reject);
    req.end(payload);
  });
}

/**
 * @param {string} url
 * @param {unknown} body
 * @param {{
 *   timeoutMs?: number,
 *   attempts?: number,
 *   insecureTls?: boolean,
 *   pinAddress?: string,
 *   request?: typeof defaultHttpsPost,
 * }} [options]
 */
export async function postPromptWebhook(url, body, options = {}) {
  const timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  const attempts = options.attempts ?? WEBHOOK_ATTEMPTS;
  const request = options.request || defaultHttpsPost;
  const payload = Buffer.from(JSON.stringify(body));
  const opts = {
    timeoutMs,
    insecureTls: options.insecureTls === true,
    pinAddress: options.pinAddress,
  };
  let lastError = 'webhook_failed';
  for (let i = 0; i < attempts; i += 1) {
    try {
      const out = await request(url, payload, opts);
      if (out?.ok === true) return { ok: true };
      lastError = 'webhook_failed';
    } catch (err) {
      lastError = err?.name === 'TimeoutError' ? 'webhook_timeout' : 'webhook_failed';
    }
  }
  return { ok: false, error: lastError };
}
