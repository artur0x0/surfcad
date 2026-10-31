/**
 * Device-code login against the server relay.
 * The device secret and the token are never logged or printed.
 */

import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { agentUrls } from './config.mjs';
import { saveLogin } from './tokenStore.mjs';

/**
 * 32 random bytes. Pairing start sends only the SHA-256. Poll sends the
 * secret itself. Neither value is logged.
 */
function createDeviceSecret() {
  const bytes = randomBytes(32);
  return {
    deviceSecret: bytes.toString('base64url'),
    deviceSecretHash: createHash('sha256').update(bytes).digest('hex'),
  };
}

/**
 * @param {string} status
 */
export function loginStatusError(status) {
  if (status === 'denied') return 'SurfCAD denied this login.';
  if (status === 'expired') return 'That login code expired. Run npx surfcad-mcp login again.';
  if (status === 'dead') return 'Too many wrong tries. Run npx surfcad-mcp login again.';
  if (status === 'consumed') return 'That login code was already used. Run npx surfcad-mcp login again.';
  return 'Login ended before approval. Run npx surfcad-mcp login again.';
}

/**
 * @param {string} url
 * @param {object} body
 * @param {typeof fetch} fetchImpl
 */
async function postJson(url, body, fetchImpl) {
  /** @type {Response} */
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error('Could not reach the SurfCAD agent server.'), { code: 'unreachable' });
  }
  /** @type {any} */
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/**
 * @param {{
 *   serverUrl: string,
 *   name?: string,
 *   machine?: string,
 *   env?: NodeJS.ProcessEnv,
 *   fetch?: typeof fetch,
 *   sleep?: (ms: number) => Promise<void>,
 *   timeoutMs?: number,
 *   now?: () => number,
 *   onCode?: (info: { userCode: string, approvalUrl: string, interval: number }) => Promise<void> | void,
 * }} options
 * @returns {Promise<{ server: string, name: string, machine: string }>}
 */
export async function loginDevice(options) {
  const urls = agentUrls(options.serverUrl);
  const fetchImpl = options.fetch || fetch;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
  }));
  const now = options.now || Date.now;
  const name = typeof options.name === 'string' ? options.name.trim() : '';
  const machine = (options.machine || hostname() || '').trim() || 'an unknown machine';
  const { deviceSecret, deviceSecretHash } = createDeviceSecret();
  const started = await postJson(urls.pairUrl, {
    ...(name ? { name } : {}),
    machine,
    deviceSecretHash,
  }, fetchImpl);
  if (started.status !== 201 || !started.json?.userCode) {
    const code = started.json?.error === 'rate_limited' ? 'rate_limited' : 'pair_failed';
    const message = code === 'rate_limited'
      ? 'Too many login attempts. Wait and run npx surfcad-mcp login again.'
      : 'Could not start login.';
    throw Object.assign(new Error(message), { code });
  }
  const userCode = String(started.json.userCode);
  const intervalSec = Number(started.json.interval);
  const pollMs = Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec * 1000 : 5000;
  if (options.onCode) {
    await options.onCode({
      userCode,
      approvalUrl: urls.approvalUrl,
      interval: Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec : 5,
    });
  }
  const deadline = now() + (options.timeoutMs ?? 10 * 60 * 1000);
  let first = true;
  while (now() < deadline) {
    if (!first) await sleep(pollMs);
    first = false;
    const polled = await postJson(urls.pollUrl, { deviceSecret, userCode }, fetchImpl);
    if (polled.status !== 200 || !polled.json?.status) {
      throw Object.assign(new Error('Could not check the login code.'), { code: 'poll_failed' });
    }
    const status = String(polled.json.status);
    if (status === 'pending') continue;
    if (status === 'approved') {
      const token = polled.json.token;
      if (typeof token !== 'string' || !token) {
        throw Object.assign(
          new Error('Login was approved but no token came back. Run npx surfcad-mcp login again.'),
          { code: 'bad_login' },
        );
      }
      await saveLogin({
        token,
        server: urls.origin,
        name,
        machine,
      }, options.env);
      return { server: urls.origin, name, machine };
    }
    throw Object.assign(new Error(loginStatusError(status)), { code: status });
  }
  throw Object.assign(
    new Error('Timed out waiting for approval. Run npx surfcad-mcp login again.'),
    { code: 'expired' },
  );
}
