/**
 * Saved wake actions: how this machine starts an agent turn when the user
 * sends a chat message from SurfCAD and no agent process is reading.
 *
 * Two forms, either or both:
 *   post  POST the wake JSON to a URL the agent's host listens on.
 *   exec  run a local command with the wake JSON on stdin.
 *
 * The file sits next to the saved login, mode 0600 in a 0700 directory. It
 * is written only by `surfcad-mcp wake set` on this machine. Nothing a
 * server, a tab, or a chat message sends can change it, and no part of a
 * message is ever put into the command line.
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configDir } from '../remote/config.mjs';

export const WAKE_EXEC_MAX_CHARS = 4000;
export const WAKE_BEARER_MAX_CHARS = 512;

/**
 * @typedef {{ url: string, bearer?: string }} WakePost
 * @typedef {{ post?: WakePost, exec?: string, savedAt?: string }} WakeConfig
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function wakePath(env = process.env) {
  return join(configDir(env), 'wake.json');
}

/**
 * @param {string} hostname
 */
export function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}

function bad(message) {
  return Object.assign(new Error(message), { code: 'bad_args' });
}

/**
 * A wake URL is https, or cleartext http to this machine only. The listener
 * runs beside the agent's host, so localhost is the common case; that is
 * the difference from register_webhook, which refuses it.
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeWakeUrl(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) throw bad('--post needs a URL.');
  /** @type {URL} */
  let url;
  try {
    url = new URL(text);
  } catch {
    throw bad('--post needs a full URL, for example http://127.0.0.1:8644/wake.');
  }
  if (url.username || url.password) {
    throw bad('Do not put a user name or password in the wake URL. Use --bearer.');
  }
  if (url.protocol === 'https:') return url.toString();
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return url.toString();
  throw bad('The wake URL must be https, or http to localhost, 127.0.0.1 or ::1.');
}

/**
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeWakeBearer(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return '';
  if (text.length > WAKE_BEARER_MAX_CHARS || /[\r\n]/.test(text)) {
    throw bad(`--bearer must be one line of at most ${WAKE_BEARER_MAX_CHARS} characters.`);
  }
  return text;
}

/**
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeWakeExec(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) throw bad('--exec needs a command.');
  if (text.length > WAKE_EXEC_MAX_CHARS || text.includes('\0')) {
    throw bad(`--exec must be at most ${WAKE_EXEC_MAX_CHARS} characters.`);
  }
  return text;
}

/**
 * @param {unknown} raw
 * @returns {WakeConfig | null} null when no usable form is in it
 */
export function normalizeWake(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const record = /** @type {Record<string, any>} */ (raw);
  /** @type {WakeConfig} */
  const out = {};
  if (record.post && typeof record.post === 'object' && typeof record.post.url === 'string') {
    try {
      const url = normalizeWakeUrl(record.post.url);
      const bearer = normalizeWakeBearer(record.post.bearer);
      out.post = bearer ? { url, bearer } : { url };
    } catch {
      /* a hand-edited bad URL is no wake, not a crash */
    }
  }
  if (typeof record.exec === 'string') {
    try {
      out.exec = normalizeWakeExec(record.exec);
    } catch {
      /* same */
    }
  }
  if (!out.post && !out.exec) return null;
  if (typeof record.savedAt === 'string') out.savedAt = record.savedAt;
  return out;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<WakeConfig | null>}
 */
export async function readWake(env = process.env) {
  /** @type {string} */
  let text;
  try {
    text = await readFile(wakePath(env), 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') return null;
    throw Object.assign(new Error('The saved wake setup could not be read.'), { code: 'bad_wake_file' });
  }
  try {
    return normalizeWake(JSON.parse(text));
  } catch {
    throw Object.assign(new Error('The saved wake setup could not be read.'), { code: 'bad_wake_file' });
  }
}

/**
 * @param {WakeConfig} config
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<WakeConfig>}
 */
export async function saveWake(config, env = process.env) {
  const clean = normalizeWake(config);
  if (!clean) throw bad('Pass --post URL, --exec COMMAND, or both.');
  clean.savedAt = new Date().toISOString();
  const dir = configDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const path = wakePath(env);
  const tmp = join(dir, `.wake-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(clean)}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(tmp, 0o600);
    await rename(tmp, path);
    await chmod(path, 0o600);
  } catch {
    await rm(tmp, { force: true });
    throw Object.assign(new Error('Could not save the wake setup.'), { code: 'save_failed' });
  }
  return clean;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function clearWake(env = process.env) {
  await rm(wakePath(env), { force: true });
}

/** Which forms are set, in the order they are tried. */
export function wakeForms(config) {
  const forms = [];
  if (config?.post) forms.push('post');
  if (config?.exec) forms.push('exec');
  return forms;
}

/**
 * A wake URL as it may be shown: the origin only. A routine webhook (Grok
 * Bot, Cursor) carries its secret in the path, so the path is never printed.
 * @param {string} url
 */
export function wakeUrlForDisplay(url) {
  try {
    const parsed = new URL(url);
    const rest = `${parsed.pathname}${parsed.search}`;
    return rest && rest !== '/' ? `${parsed.origin}/…` : parsed.origin;
  } catch {
    return '(a URL)';
  }
}

/**
 * Status text. Never includes the bearer, nor the path of the URL.
 * @param {WakeConfig | null} config
 */
export function formatWake(config) {
  if (!config) return 'wake: not set\n';
  const lines = [];
  if (config.post) lines.push(`wake post: ${wakeUrlForDisplay(config.post.url)}${config.post.bearer ? ' (with a bearer key)' : ''}`);
  if (config.exec) lines.push(`wake exec: ${config.exec}`);
  return `${lines.join('\n')}\n`;
}
