/**
 * In-memory sliding-window rate limiter keyed by a caller id (user id).
 * The key map is bounded: expired keys are swept, then the oldest key is
 * evicted, so a flood of distinct keys cannot grow memory without limit.
 */

/**
 * @param {{ limit: number, windowMs: number, maxKeys?: number, now?: () => number }} opts
 */
export function createRateLimiter({ limit, windowMs, maxKeys = 10_000, now = () => Date.now() }) {
  /** @type {Map<string, number[]>} */
  let buckets = new Map();

  function sweep(t) {
    for (const [key, stamps] of buckets) {
      if (!stamps.some((ts) => ts > t - windowMs)) buckets.delete(key);
    }
  }

  /**
   * @param {string} key
   * @returns {{ allowed: boolean, retryAfterSec?: number }}
   */
  function check(key) {
    const t = now();
    const id = String(key || 'unknown');
    const recent = (buckets.get(id) || []).filter((ts) => ts > t - windowMs);
    if (recent.length >= limit) {
      buckets.set(id, recent);
      const retryAfterSec = Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000));
      return { allowed: false, retryAfterSec };
    }
    recent.push(t);
    buckets.delete(id);
    if (buckets.size >= maxKeys) sweep(t);
    while (buckets.size >= maxKeys) {
      buckets.delete(buckets.keys().next().value);
    }
    buckets.set(id, recent);
    return { allowed: true };
  }

  function reset() {
    buckets = new Map();
  }

  return { check, reset, size: () => buckets.size };
}

/**
 * Express middleware. Responds 429 with Retry-After when the caller is over the limit.
 * @param {ReturnType<typeof createRateLimiter>} limiter
 * @param {(req: any) => string} keyFor
 * @param {string} message
 */
export function rateLimitMiddleware(limiter, keyFor, message, extras = {}) {
  return (req, res, next) => {
    const verdict = limiter.check(keyFor(req));
    if (!verdict.allowed) {
      res.set('Retry-After', String(verdict.retryAfterSec));
      return res.status(429).json({
        error: message,
        retryAfterSec: verdict.retryAfterSec,
        ...extras,
      });
    }
    return next();
  };
}

export function userKey(req) {
  const id = req.user?._id ?? req.user?.id;
  return id ? `user:${id}` : `ip:${req.ip || 'unknown'}`;
}
