/**
 * Copy-paste prompts for Connect Agent.
 * The local prompt starts a loopback relay. The server prompt asks the
 * agent to log in and enter the device code on this page's /agent URL.
 */

export const MCP_INSTALL_COMMAND = 'npx -y surfcad-mcp';
export const MCP_LOGIN_COMMAND = 'npx surfcad-mcp login';
export const DEFAULT_AGENT_APPROVAL_ORIGIN = 'https://surfcad.com';

export const AGENT_PAIRING_PROMPT = `Install and run the SurfCAD MCP server on my machine, then connect your MCP client to it:

${MCP_INSTALL_COMMAND}

When SurfCAD shows a pairing code, send me that code so I can approve the connection.`;

/**
 * Page origin for the approval URL. Missing host falls back to surfcad.com
 * so a prompt never points at "undefined".
 *
 * @param {{ protocol?: string, host?: string } | null | undefined} [location]
 */
export function agentPageOrigin(location) {
  const protocol = location?.protocol;
  const host = location?.host;
  if ((protocol === 'https:' || protocol === 'http:') && host) {
    return `${protocol}//${host}`;
  }
  return DEFAULT_AGENT_APPROVAL_ORIGIN;
}

/**
 * @param {{ protocol?: string, host?: string } | null | undefined} [location]
 */
export function agentApprovalUrl(location) {
  return `${agentPageOrigin(location)}/agent`;
}

/**
 * The CLI accepts cleartext only for localhost, 127.0.0.1, and ::1.
 * Match that set so a prompt never tells the agent to pass a URL login
 * will reject.
 *
 * @param {string} hostname
 */
function isCleartextLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * @param {{ protocol?: string, host?: string } | null | undefined} [location]
 * @returns {URL | null}
 */
function pageUrl(location) {
  try {
    return new URL(agentPageOrigin(location));
  } catch {
    return null;
  }
}

/**
 * Plain http to a LAN or public host. The page is real, but
 * `npx surfcad-mcp login --server` of that origin throws.
 *
 * @param {{ protocol?: string, host?: string } | null | undefined} [location]
 */
export function serverLoginNeedsLoopback(location) {
  const url = pageUrl(location);
  return !!url && url.protocol === 'http:' && !isCleartextLoopbackHost(url.hostname);
}

/**
 * `npx surfcad-mcp login` against the page origin. The CLI default is
 * https://surfcad.com, so that host omits `--server`. https and loopback
 * http are passed through so the device code is minted for the page the
 * user has open. Plain http to any other host uses `http://localhost` and
 * the page's port: login accepts that, and it reaches this backend only
 * when the command runs on the machine serving the page.
 *
 * @param {{ protocol?: string, host?: string } | null | undefined} [location]
 */
export function serverLoginCommand(location) {
  const origin = agentPageOrigin(location);
  if (origin === DEFAULT_AGENT_APPROVAL_ORIGIN) return MCP_LOGIN_COMMAND;
  const url = pageUrl(location);
  // An origin we cannot parse must not become `--server <raw>`. Login
  // refuses cleartext except localhost, 127.0.0.1, and ::1.
  if (!url) return MCP_LOGIN_COMMAND;
  if (url.protocol === 'http:' && !isCleartextLoopbackHost(url.hostname)) {
    const port = url.port ? `:${url.port}` : '';
    return `${MCP_LOGIN_COMMAND} --server http://localhost${port}`;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return MCP_LOGIN_COMMAND;
  return `${MCP_LOGIN_COMMAND} --server ${origin}`;
}

/**
 * @param {{ protocol?: string, host?: string } | null | undefined} [location]
 */
/**
 * Join-code login. `npx -y` so the agent can run it without a prompt.
 * `--server` follows `serverLoginCommand`: omitted on https://surfcad.com,
 * passed through for other https origins and loopback http, and rewritten
 * to localhost for plain http to any other host.
 *
 * @param {{ protocol?: string, host?: string } | null | undefined} [location]
 * @param {string} code formatted `ABCD-EFGH`
 */
export function serverJoinLoginCommand(location, code) {
  const formatted = String(code || '').trim();
  const login = serverLoginCommand(location).replace(
    MCP_LOGIN_COMMAND,
    'npx -y surfcad-mcp login',
  );
  return `${login} --code ${formatted}`;
}

/**
 * Full prompt copied from the join-code screen. The code is in the command.
 * The agent does not print a second code for the user to carry back.
 *
 * @param {{ protocol?: string, host?: string } | null | undefined} [location]
 * @param {string} code
 */
export function serverJoinPrompt(location, code) {
  const command = serverJoinLoginCommand(location, code);
  const where = serverLoginNeedsLoopback(location)
    ? '\n\nRun that command on the machine serving this page. localhost is that machine, not the computer where this chat is running.'
    : '';
  return `Pair with the SurfCAD tab I have open. Run:\n\n${command}${where}`;
}

export function serverPairingPrompt(location) {
  const command = serverLoginCommand(location);
  const approval = agentApprovalUrl(location);
  const where = serverLoginNeedsLoopback(location)
    ? '\n\nRun that command on the machine serving this page. localhost is that machine, not the computer where this chat is running.'
    : '';
  return `Pair with the SurfCAD tab I have open. Run:\n\n${command}\n\nEnter the device code at ${approval}${where}`;
}

/**
 * @param {string} text
 * @param {number} [maxLen]
 */
export function clipPairingPrompt(text, maxLen = 140) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= maxLen) return flat;
  return `${flat.slice(0, maxLen - 1)}…`;
}

/**
 * @param {number} [maxLen]
 */
export function pairingPromptPreview(maxLen = 140) {
  return clipPairingPrompt(AGENT_PAIRING_PROMPT, maxLen);
}
