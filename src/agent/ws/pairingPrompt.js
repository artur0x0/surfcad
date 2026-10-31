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
 * `npx surfcad-mcp login` against the page origin. The CLI default is
 * https://surfcad.com, so that host omits `--server`. Every other origin
 * (www, staging, plain http) is passed through so the device code is
 * minted for the page the user has open.
 *
 * @param {{ protocol?: string, host?: string } | null | undefined} [location]
 */
export function serverLoginCommand(location) {
  const origin = agentPageOrigin(location);
  if (origin === DEFAULT_AGENT_APPROVAL_ORIGIN) return MCP_LOGIN_COMMAND;
  return `${MCP_LOGIN_COMMAND} --server ${origin}`;
}

/**
 * @param {{ protocol?: string, host?: string } | null | undefined} [location]
 */
export function serverPairingPrompt(location) {
  return `Pair with the SurfCAD tab I have open. Run:\n\n${serverLoginCommand(location)}\n\nEnter the device code at ${agentApprovalUrl(location)}`;
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
