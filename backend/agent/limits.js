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

/** Agent tokens expire after this unless revoked sooner. */
export const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** In-memory command results are dropped after this if nobody reads them. */
export const RESULT_RETENTION_MS = 2 * 60 * 1000;

/** Suggested device-code poll interval, in seconds. */
export const PAIR_POLL_INTERVAL_SEC = 5;

/**
 * @param {unknown} value
 * @returns {number}
 */
export function messageByteLength(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return Buffer.byteLength(text);
}
