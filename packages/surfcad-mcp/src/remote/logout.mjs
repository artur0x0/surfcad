/**
 * Revoke the saved bearer token, then delete the local file.
 * The token is never logged or printed. A server that cannot be reached
 * still loses the local file; the caller says the login may stay valid.
 */

import { agentUrls } from './config.mjs';
import { deleteSavedLogin, readSavedLogin } from './tokenStore.mjs';

const REVOKE_TIMEOUT_MS = 8000;

/**
 * @param {{ token: string, server: string }} saved
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<boolean>}
 */
async function revokeSelf(saved, fetchImpl) {
  /** @type {string} */
  let origin;
  try {
    origin = agentUrls(saved.server).origin;
  } catch {
    return false;
  }
  try {
    const res = await fetchImpl(`${origin}/agent/tokens/self`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${saved.token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
    try {
      await res.arrayBuffer();
    } catch {
      /* the status is enough; a body we cannot read is not a reason to keep the file */
    }
    return res.status === 200 || res.status === 401 || res.status === 404;
  } catch {
    return false;
  }
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, fetch?: typeof fetch }} [options]
 * @returns {Promise<{ hadLogin: boolean, confirmed: boolean }>}
 */
export async function logoutDevice(options = {}) {
  const env = options.env;
  const fetchImpl = options.fetch || fetch;
  /** @type {{ token: string, server: string } | null} */
  let saved = null;
  try {
    saved = await readSavedLogin(env);
  } catch (err) {
    await deleteSavedLogin(env);
    throw err;
  }
  let confirmed = !saved?.token;
  try {
    if (saved?.token) confirmed = await revokeSelf(saved, fetchImpl);
  } finally {
    await deleteSavedLogin(env);
  }
  return { hadLogin: Boolean(saved?.token), confirmed };
}
