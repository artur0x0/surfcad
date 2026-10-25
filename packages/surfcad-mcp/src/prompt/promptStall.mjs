/**
 * No agent activity for this long is a stall, not a silent return to idle.
 * The in-viewer prompt and the MCP prompt session share this one window.
 * Relayed tool calls, status, replies, and read_messages start it over.
 */
export const AGENT_PROMPT_STALL_MS = 5 * 60 * 1000;
