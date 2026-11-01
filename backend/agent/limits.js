/** Largest command or handshake frame the server relay will accept. */
export const MAX_AGENT_MESSAGE_BYTES = 256 * 1024;

/** How long a command waits for a tab to reconnect. */
export const TAB_ASLEEP_MS = 30_000;

/** Device-code lifetime. */
export const PAIR_TTL_MS = 10 * 60 * 1000;

/** Wrong user-code entries, per account and per IP, before lockout. */
export const MAX_WRONG_TRIES = 5;

/** Successful and failed code entry share this window. */
export const PAIR_ENTRY_WINDOW_MS = 10 * 60 * 1000;

/** Code-entry attempts allowed per account and per IP in that window. */
export const PAIR_ENTRY_LIMIT = 20;

/** New pairing starts allowed per IP in the entry window. */
export const PAIR_START_LIMIT = 10;

/** Device-secret polls allowed per IP per minute. */
export const PAIR_POLL_LIMIT = 60;

export const PAIR_POLL_WINDOW_MS = 60 * 1000;

/**
 * Held commands waiting on a tab, per agent token. A further command is
 * rejected instead of queued.
 */
export const MAX_PENDING = 32;

/** Commands accepted per token per minute. */
export const COMMAND_LIMIT = 60;

export const COMMAND_WINDOW_MS = 60 * 1000;

/**
 * Absolute lifetime of an agent pairing, measured from issue (`createdAt`).
 * Use does not extend it. A token stored with a longer `expiresAt` is
 * capped to this window from `createdAt`. A token with no `createdAt` is
 * capped to 7 days from the first check, and that time is stored so the
 * window does not slide. Join codes stay at `JOIN_TTL_MS` (10 minutes).
 */
export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** In-memory command results are dropped after this if nobody reads them. */
export const RESULT_RETENTION_MS = 2 * 60 * 1000;

/** Suggested device-code poll interval, in seconds. */
export const PAIR_POLL_INTERVAL_SEC = 5;

/** Cookie and approval-page routes per IP per minute. */
export const BROWSER_ROUTE_LIMIT = 120;

export const BROWSER_ROUTE_WINDOW_MS = 60 * 1000;

/**
 * Long-poll and SSE reads per token per minute. Separate from
 * `COMMAND_LIMIT` so a 30-second wait loop is not rejected as a command.
 */
export const COMMAND_READ_LIMIT = 120;

export const COMMAND_READ_WINDOW_MS = 60 * 1000;

/** WebSocket upgrades per client IP per minute. */
export const SOCKET_CONNECT_LIMIT = 30;

export const SOCKET_CONNECT_WINDOW_MS = 60 * 1000;

/** Live browser tabs for one account. A further tab is closed. */
export const MAX_TABS_PER_USER = 8;

/** Live agent sockets for one account. A further socket is closed. */
export const MAX_AGENTS_PER_USER = 8;

/**
 * How long a tab prompt waits for an agent socket or an HTTPS pull
 * before the tab is told delivery failed.
 */
export const PROMPT_HOLD_MS = 8_000;

/** Tab prompts held for one account while no agent socket is up. */
export const MAX_HELD_PROMPTS = 20;

/**
 * Minimum gap between unsolicited agent messages for one account.
 * A paired agent can post without a prompt id; this stops a flood.
 */
export const SESSION_MESSAGE_GAP_MS = 1000;

/** Pending device codes held in this process. */
export const MAX_PENDING_PAIRINGS = 500;

/** Join-code lifetime. A new code for the same account replaces the old one. */
export const JOIN_TTL_MS = PAIR_TTL_MS;

/** Non-issuing presentations of one join code before that code dies. */
export const JOIN_MAX_TRIES = 5;

/** Join codes one account may create in the entry window. */
export const JOIN_CREATE_LIMIT = 10;

export const JOIN_CREATE_WINDOW_MS = PAIR_ENTRY_WINDOW_MS;

/** Redeem attempts allowed per IP in the entry window. */
export const JOIN_REDEEM_IP_LIMIT = 20;

export const JOIN_REDEEM_IP_WINDOW_MS = PAIR_ENTRY_WINDOW_MS;

/**
 * Redeem attempts allowed across every live code in one minute.
 * Stops one client from spraying the pending set.
 */
export const JOIN_GLOBAL_REDEEM_LIMIT = 300;

export const JOIN_GLOBAL_REDEEM_WINDOW_MS = 60 * 1000;

/** Pending join codes held in this process. */
export const JOIN_MAX_PENDING = MAX_PENDING_PAIRINGS;

/**
 * How long a finished or expired pairing stays after its TTL, so a poll
 * can still observe `expired` or `consumed` before the record is dropped.
 */
export const PAIR_RETENTION_MS = PAIR_TTL_MS;

/** Ping interval. A socket that misses the previous pong is terminated. */
export const SOCKET_PING_INTERVAL_MS = 30 * 1000;

/**
 * One presence clock for an account. Any agent socket frame, prompt poll,
 * accepted relay command, or progress update stamps last-seen. The agent
 * is offline after this with no activity. A socket close does not.
 */
export const AGENT_PRESENCE_TTL_MS = 10 * 60 * 1000;

/**
 * @param {unknown} value
 * @returns {number}
 */
export function messageByteLength(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return Buffer.byteLength(text);
}
