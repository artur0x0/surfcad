/**
 * No agent activity for this long is a stall, not a silent return to idle.
 * The in-viewer prompt and the MCP prompt session share this one window.
 * It applies to both typing (the pane is responding) and working (the
 * agent is building). Relayed tool calls, status, replies, and
 * read_messages start it over.
 */
export const AGENT_PROMPT_STALL_MS = 15 * 60 * 1000;

/**
 * Whole minutes for the stall notice and for tool text that names the window.
 * @param {number} [timeoutMs]
 */
export function agentPromptStallMinutes(timeoutMs = AGENT_PROMPT_STALL_MS) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return 1;
  return Math.max(1, Math.round(ms / 60_000));
}
