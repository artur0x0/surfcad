/**
 * Copy-paste prompt for the user's AI agent to install the local MCP relay.
 */

export const MCP_INSTALL_COMMAND = 'npx -y surfcad-mcp';

export const AGENT_PAIRING_PROMPT = `Install and run the SurfCAD MCP server on my machine, then connect your MCP client to it:

${MCP_INSTALL_COMMAND}

When SurfCAD shows a pairing code in the profile menu, send me that code so I can approve the connection.`;

/**
 * @param {number} [maxLen]
 */
export function pairingPromptPreview(maxLen = 140) {
  const flat = AGENT_PAIRING_PROMPT.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxLen) return flat;
  return `${flat.slice(0, maxLen - 1)}…`;
}
