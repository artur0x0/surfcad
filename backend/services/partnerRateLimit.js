/**
 * In-memory per-IP rate limit for partner form posts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** @type {Map<string, number[]>} */
let buckets = new Map();

export function resetPartnerRateLimits() {
  buckets = new Map();
}

/**
 * @param {string} ip
 * @param {{ limit?: number, windowMs?: number, now?: number }} [opts]
 * @returns {{ allowed: boolean, retryAfterSec?: number }}
 */
export function checkPartnerRateLimit(ip, opts = {}) {
  const limit = opts.limit ?? 2;
  const windowMs = opts.windowMs ?? DAY_MS;
  const now = opts.now ?? Date.now();
  const key = ip || 'unknown';
  const windowStart = now - windowMs;
  const prev = buckets.get(key) || [];
  const recent = prev.filter((ts) => ts > windowStart);
  if (recent.length >= limit) {
    const oldest = recent[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  recent.push(now);
  buckets.set(key, recent);
  return { allowed: true };
}
