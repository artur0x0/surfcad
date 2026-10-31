/**
 * Saved remote login. The file mode is 0600 and the directory is 0700.
 * Callers must not log the returned token.
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configDir, tokenPath } from './config.mjs';

/**
 * @typedef {{
 *   token: string,
 *   server: string,
 *   name: string,
 *   machine: string,
 *   savedAt: string,
 * }} SavedLogin
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<SavedLogin | null>}
 */
export async function readSavedLogin(env = process.env) {
  const path = tokenPath(env);
  /** @type {string} */
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') return null;
    throw Object.assign(new Error('Saved login could not be read.'), { code: 'bad_login_file' });
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Saved login could not be read.'), { code: 'bad_login_file' });
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (parsed);
  if (typeof record.token !== 'string' || !record.token) return null;
  return {
    token: record.token,
    server: typeof record.server === 'string' ? record.server : '',
    name: typeof record.name === 'string' ? record.name : '',
    machine: typeof record.machine === 'string' ? record.machine : '',
    savedAt: typeof record.savedAt === 'string' ? record.savedAt : '',
  };
}

/**
 * @param {{ token: string, server: string, name?: string, machine?: string, savedAt?: string }} record
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<string>} path written
 */
export async function saveLogin(record, env = process.env) {
  if (typeof record.token !== 'string' || !record.token) {
    throw Object.assign(new Error('Login did not return a token.'), { code: 'bad_login' });
  }
  const dir = configDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const path = tokenPath(env);
  const tmp = join(dir, `.token-${process.pid}-${Date.now()}.tmp`);
  const body = `${JSON.stringify({
    token: record.token,
    server: record.server,
    name: record.name || '',
    machine: record.machine || '',
    savedAt: record.savedAt || new Date().toISOString(),
  })}\n`;
  try {
    await writeFile(tmp, body, { mode: 0o600, flag: 'wx' });
    await chmod(tmp, 0o600);
    await rename(tmp, path);
    await chmod(path, 0o600);
  } catch (err) {
    await rm(tmp, { force: true });
    if (err && typeof err === 'object' && err.code === 'bad_login') throw err;
    throw Object.assign(new Error('Could not save the login.'), { code: 'save_failed' });
  }
  return path;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function deleteSavedLogin(env = process.env) {
  await rm(tokenPath(env), { force: true });
}

/**
 * Status text. Never includes the token.
 * @param {SavedLogin | null} saved
 * @param {string} serverUrl effective server (flag or env may override the saved one)
 */
export function formatLoginStatus(saved, serverUrl) {
  if (!saved) return 'not logged in\n';
  const lines = [
    'logged in',
    `server: ${serverUrl}`,
    `name: ${saved.name || '(none)'}`,
    `machine: ${saved.machine || '(none)'}`,
    `saved: ${saved.savedAt || '(unknown)'}`,
  ];
  return `${lines.join('\n')}\n`;
}
