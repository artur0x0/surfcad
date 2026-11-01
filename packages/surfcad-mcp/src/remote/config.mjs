/**
 * Remote relay address, agent name, and local-vs-remote selection.
 * The token never appears in these helpers.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_AGENT_SERVER = 'https://surfcad.com';

/**
 * Per-user directory for the saved login. Override with
 * SURFCAD_MCP_CONFIG_DIR (tests and unusual installs). Otherwise
 * $XDG_CONFIG_HOME/surfcad-mcp, or ~/.config/surfcad-mcp.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function configDir(env = process.env) {
  const override = env.SURFCAD_MCP_CONFIG_DIR;
  if (typeof override === 'string' && override.trim()) return override.trim();
  const xdg = env.XDG_CONFIG_HOME;
  if (typeof xdg === 'string' && xdg.trim()) return join(xdg.trim(), 'surfcad-mcp');
  const home = typeof env.HOME === 'string' && env.HOME.trim() ? env.HOME.trim() : homedir();
  return join(home, '.config', 'surfcad-mcp');
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function tokenPath(env = process.env) {
  return join(configDir(env), 'token.json');
}

/**
 * Cleartext is only for a loopback dev server. Every other host must be https.
 * @param {string} hostname URL.hostname (IPv6 has no brackets)
 */
function isCleartextLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Accept https, http, wss, or ws. Return the origin only (`https://host`).
 * A path such as `/agent` is dropped; callers add it.
 * `http://` and `ws://` are accepted only for localhost, 127.0.0.1, and ::1.
 * @param {unknown} input
 */
export function normalizeServer(input) {
  let text = String(input ?? '').trim();
  if (!text) {
    throw Object.assign(new Error('Server URL is empty.'), { code: 'bad_server' });
  }
  if (text.startsWith('wss://')) text = `https://${text.slice('wss://'.length)}`;
  else if (text.startsWith('ws://')) text = `http://${text.slice('ws://'.length)}`;
  else if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw Object.assign(new Error('Server URL is not a valid http(s) URL.'), { code: 'bad_server' });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw Object.assign(new Error('Server URL must be http or https.'), { code: 'bad_server' });
  }
  if (!url.host) {
    throw Object.assign(new Error('Server URL is missing a host.'), { code: 'bad_server' });
  }
  if (url.protocol === 'http:' && !isCleartextLoopback(url.hostname)) {
    throw Object.assign(
      new Error(`Cleartext is only allowed for localhost, 127.0.0.1, and ::1. Use https for ${url.host}.`),
      { code: 'bad_server' },
    );
  }
  return `${url.protocol}//${url.host}`;
}

/**
 * `--server` wins, then SURFCAD_AGENT_SERVER, then the server stored with
 * the login, then https://surfcad.com.
 * @param {{ flag?: string, env?: NodeJS.ProcessEnv, saved?: { server?: string } | null }} [options]
 */
export function resolveServerUrl(options = {}) {
  const env = options.env || process.env;
  const flag = typeof options.flag === 'string' ? options.flag.trim() : '';
  if (flag) return normalizeServer(flag);
  const fromEnv = typeof env.SURFCAD_AGENT_SERVER === 'string' ? env.SURFCAD_AGENT_SERVER.trim() : '';
  if (fromEnv) return normalizeServer(fromEnv);
  const saved = options.saved && typeof options.saved.server === 'string' ? options.saved.server.trim() : '';
  if (saved) return normalizeServer(saved);
  return DEFAULT_AGENT_SERVER;
}

/**
 * @param {string} origin http(s) origin, no path
 */
export function agentUrls(origin) {
  const base = normalizeServer(origin);
  const url = new URL(base);
  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return {
    origin: base,
    approvalUrl: `${base}/agent`,
    wsUrl: `${wsProtocol}//${url.host}/agent`,
    pairUrl: `${base}/agent/pair`,
    pollUrl: `${base}/agent/pair/poll`,
    joinUrl: `${base}/agent/join/redeem`,
    commandsUrl: `${base}/agent/commands`,
    promptsUrl: `${base}/agent/prompts`,
  };
}

/**
 * Name sent at login and on the hello frame.
 * `--name`, then SURFCAD_AGENT_NAME, then the name stored at login, then
 * the MCP client's `clientInfo.name`. Empty means the server says "an agent".
 * `login` has no MCP client, so it never sees clientInfo.
 * @param {{
 *   name?: string,
 *   savedName?: string,
 *   clientInfo?: { name?: string } | null,
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 */
export function resolveAgentName(options = {}) {
  const env = options.env || process.env;
  const flag = typeof options.name === 'string' ? options.name.trim() : '';
  if (flag) return flag;
  const fromEnv = typeof env.SURFCAD_AGENT_NAME === 'string' ? env.SURFCAD_AGENT_NAME.trim() : '';
  if (fromEnv) return fromEnv;
  const saved = typeof options.savedName === 'string' ? options.savedName.trim() : '';
  if (saved) return saved;
  const fromClient = options.clientInfo && typeof options.clientInfo.name === 'string'
    ? options.clientInfo.name.trim()
    : '';
  return fromClient;
}

/**
 * Loopback settings that must keep the local relay even after a login,
 * so goldens and an existing local MCP config are not taken over.
 * @param {NodeJS.ProcessEnv} env
 */
function explicitLocalRelay(env) {
  const url = env.SURFCAD_AGENT_BRIDGE_WS_URL;
  if (typeof url === 'string' && url.trim()) return true;
  const port = env.SURFCAD_AGENT_BRIDGE_WS_PORT;
  if (typeof port === 'string' && port.trim()) return true;
  const code = env.SURFCAD_PAIRING_CODE;
  if (typeof code === 'string' && code.trim()) return true;
  return false;
}

/**
 * First match wins:
 * 1. `--remote` → remote
 * 2. `--local` → local
 * 3. an explicit loopback URL, port, or pairing code → local
 * 4. a saved login → remote
 * 5. local
 * @param {{
 *   remote?: boolean,
 *   local?: boolean,
 *   loggedIn?: boolean,
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 * @returns {{ ok: true, mode: 'local' | 'remote' } | { ok: false, error: string }}
 */
export function selectRelayMode(options = {}) {
  const env = options.env || process.env;
  if (options.remote && options.local) {
    return { ok: false, error: 'Pass either --remote or --local, not both.' };
  }
  if (options.remote) return { ok: true, mode: 'remote' };
  if (options.local) return { ok: true, mode: 'local' };
  if (explicitLocalRelay(env)) return { ok: true, mode: 'local' };
  if (options.loggedIn) return { ok: true, mode: 'remote' };
  return { ok: true, mode: 'local' };
}
