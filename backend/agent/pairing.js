import { randomBytes, randomInt } from 'node:crypto';
import { approvalSentence } from './approvalCopy.js';
import {
  MAX_WRONG_TRIES,
  PAIR_ENTRY_LIMIT,
  PAIR_ENTRY_WINDOW_MS,
  PAIR_POLL_INTERVAL_SEC,
  PAIR_POLL_LIMIT,
  PAIR_POLL_WINDOW_MS,
  PAIR_START_LIMIT,
  PAIR_TTL_MS,
} from './limits.js';
import { createRateLimiter } from '../services/rateLimiter.js';
import { hashToken } from './tokens.js';

/** Crockford-like alphabet: no 0, O, 1, I, or L. */
export const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const LABEL_MAX = 80;

/**
 * @param {string} value
 * @returns {string}
 */
function stripControls(value) {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) continue;
    out += char;
  }
  return out;
}

/**
 * @param {string} raw 8-character code without a hyphen
 * @returns {string}
 */
export function formatUserCode(raw) {
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

/**
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeUserCode(input) {
  return String(input || '').toUpperCase().replace(/[\s-]/g, '');
}

/**
 * @param {unknown} value
 * @param {string} fallback
 */
function cleanLabel(value, fallback) {
  const text = stripControls(String(value ?? '')).trim().slice(0, LABEL_MAX);
  return text || fallback;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function cleanCity(value) {
  if (typeof value !== 'string') return null;
  const text = stripControls(value).replace(/,/g, '').trim().slice(0, LABEL_MAX);
  return text || null;
}

/**
 * @param {() => number} randomIndex
 * @returns {string}
 */
function generateUserCode(randomIndex) {
  let raw = '';
  for (let i = 0; i < 8; i += 1) {
    raw += USER_CODE_ALPHABET[randomIndex(USER_CODE_ALPHABET.length)];
  }
  return raw;
}

/**
 * In-memory device-code pairing. Pending codes and the one-time token
 * handoff live only in this process. A restart drops them. Token hashes
 * are the durable part and live in the token service.
 *
 * Wrong tries: five unknown user codes lock that account and that IP for
 * the entry window. Five polls that name a live code with the wrong device
 * secret kill that pairing.
 *
 * @param {{
 *   tokens: { issue: (fields: { userId: string, label: string }) => Promise<{ token: string, id: string }> },
 *   now?: () => number,
 *   ttlMs?: number,
 *   maxWrongTries?: number,
 *   entryLimit?: number,
 *   entryWindowMs?: number,
 *   startLimit?: number,
 *   pollLimit?: number,
 *   pollWindowMs?: number,
 *   randomBytes?: (size: number) => Buffer,
 *   randomInt?: (max: number) => number,
 * }} opts
 */
export function createPairingService(opts) {
  const now = opts.now || (() => Date.now());
  const ttlMs = opts.ttlMs ?? PAIR_TTL_MS;
  const maxWrongTries = opts.maxWrongTries ?? MAX_WRONG_TRIES;
  const entryWindowMs = opts.entryWindowMs ?? PAIR_ENTRY_WINDOW_MS;
  const nextBytes = opts.randomBytes || randomBytes;
  const nextInt = opts.randomInt || ((max) => randomInt(max));
  const accountLimiter = createRateLimiter({
    limit: opts.entryLimit ?? PAIR_ENTRY_LIMIT,
    windowMs: entryWindowMs,
    now,
  });
  const ipLimiter = createRateLimiter({
    limit: opts.entryLimit ?? PAIR_ENTRY_LIMIT,
    windowMs: entryWindowMs,
    now,
  });
  const startLimiter = createRateLimiter({
    limit: opts.startLimit ?? PAIR_START_LIMIT,
    windowMs: entryWindowMs,
    now,
  });
  const pollLimiter = createRateLimiter({
    limit: opts.pollLimit ?? PAIR_POLL_LIMIT,
    windowMs: opts.pollWindowMs ?? PAIR_POLL_WINDOW_MS,
    now,
  });

  /** @type {Map<string, any>} */
  const byCode = new Map();
  /** @type {Map<string, any>} */
  const bySecret = new Map();
  /** @type {Map<string, { count: number, start: number }>} */
  const wrongByActor = new Map();

  /**
   * @param {string} key
   */
  function wrongState(key) {
    const entry = wrongByActor.get(key);
    if (!entry) return { count: 0, start: now() };
    if (now() - entry.start >= entryWindowMs) {
      wrongByActor.delete(key);
      return { count: 0, start: now() };
    }
    return entry;
  }

  /** @param {string} key */
  function isLocked(key) {
    return wrongState(key).count >= maxWrongTries;
  }

  /**
   * @param {string} key
   * @returns {boolean} true once the actor has reached the lockout
   */
  function noteWrong(key) {
    const entry = wrongState(key);
    if (entry.count === 0) entry.start = now();
    entry.count += 1;
    wrongByActor.set(key, entry);
    return entry.count >= maxWrongTries;
  }

  /**
   * @param {string} userId
   * @param {string} ip
   */
  function takeEntry(userId, ip) {
    const accountKey = `acct:${userId}`;
    const ipKey = `ip:${ip || 'unknown'}`;
    if (isLocked(accountKey) || isLocked(ipKey)) {
      return { ok: false, error: 'too_many_wrong_tries', accountKey, ipKey };
    }
    const accountHit = accountLimiter.check(accountKey);
    const ipHit = ipLimiter.check(ipKey);
    if (!accountHit.allowed || !ipHit.allowed) {
      return {
        ok: false,
        error: 'rate_limited',
        retryAfterSec: accountHit.retryAfterSec || ipHit.retryAfterSec || 1,
        accountKey,
        ipKey,
      };
    }
    return { ok: true, accountKey, ipKey };
  }

  /**
   * @param {string} userCode
   */
  function findCode(userCode) {
    const normalized = normalizeUserCode(userCode);
    if (normalized.length !== 8) return null;
    for (const ch of normalized) {
      if (!USER_CODE_ALPHABET.includes(ch)) return null;
    }
    return byCode.get(normalized) || null;
  }

  /** @param {any} record */
  function expireIfNeeded(record) {
    if (record.status === 'pending' && now() >= record.createdAt + ttlMs) {
      record.status = 'expired';
    }
    return record;
  }

  /**
   * @param {string} accountKey
   * @param {string} ipKey
   */
  function miss(accountKey, ipKey) {
    const accountLocked = noteWrong(accountKey);
    const ipLocked = noteWrong(ipKey);
    return { ok: false, error: accountLocked || ipLocked ? 'too_many_wrong_tries' : 'invalid_code' };
  }

  /** @param {any} record */
  function statusError(record) {
    expireIfNeeded(record);
    if (record.status === 'expired') return { ok: false, error: 'expired' };
    if (record.status === 'dead') return { ok: false, error: 'dead' };
    if (record.status === 'pending') return null;
    record.wrongTries += 1;
    if (record.wrongTries >= maxWrongTries) record.status = 'dead';
    return { ok: false, error: record.status === 'dead' ? 'dead' : 'already_used' };
  }

  /**
   * The first signed-in account to claim or approve a still-pending code owns it.
   * @param {any} record
   * @param {string} userId
   * @returns {{ ok: false, error: 'claimed' } | null}
   */
  function lockToUser(record, userId) {
    const id = String(userId);
    if (!record.userId) {
      record.userId = id;
      return null;
    }
    if (record.userId !== id) return { ok: false, error: 'claimed' };
    return null;
  }

  /** @param {any} record */
  function describe(record) {
    return {
      ok: true,
      name: record.name,
      machine: record.machine,
      city: record.city,
      sentence: approvalSentence(record),
      userCode: formatUserCode(record.userCode),
    };
  }

  return {
    /**
     * @param {{ name?: string, machine?: string, city?: string | null, ip?: string }} fields
     */
    start(fields) {
      const ip = fields.ip || 'unknown';
      const started = startLimiter.check(`ip:${ip}`);
      if (!started.allowed) {
        return { ok: false, error: 'rate_limited', retryAfterSec: started.retryAfterSec || 1 };
      }
      let raw = generateUserCode(nextInt);
      for (let attempt = 0; attempt < 5 && byCode.has(raw); attempt += 1) {
        raw = generateUserCode(nextInt);
      }
      if (byCode.has(raw)) return { ok: false, error: 'unavailable' };
      const deviceSecret = nextBytes(32).toString('base64url');
      const record = {
        userCode: raw,
        deviceSecretHash: hashToken(deviceSecret),
        name: cleanLabel(fields.name, 'an agent'),
        machine: cleanLabel(fields.machine, 'an unknown machine'),
        city: cleanCity(fields.city),
        createdAt: now(),
        wrongTries: 0,
        status: 'pending',
        tokenPlain: /** @type {string | null} */ (null),
        userId: /** @type {string | null} */ (null),
      };
      byCode.set(raw, record);
      bySecret.set(record.deviceSecretHash, record);
      return {
        ok: true,
        userCode: formatUserCode(raw),
        deviceSecret,
        expiresAt: new Date(record.createdAt + ttlMs).toISOString(),
        interval: PAIR_POLL_INTERVAL_SEC,
      };
    },

    /**
     * @param {{ deviceSecret?: string, userCode?: string, ip?: string }} fields
     */
    poll(fields) {
      const ip = fields.ip || 'unknown';
      const polled = pollLimiter.check(`ip:${ip}`);
      if (!polled.allowed) {
        return { ok: false, error: 'rate_limited', retryAfterSec: polled.retryAfterSec || 1 };
      }
      const secret = typeof fields.deviceSecret === 'string' ? fields.deviceSecret : '';
      const record = secret ? bySecret.get(hashToken(secret)) : null;
      if (!record) {
        const named = fields.userCode ? findCode(fields.userCode) : null;
        if (named) expireIfNeeded(named);
        if (named && named.status === 'pending') {
          named.wrongTries += 1;
          if (named.wrongTries >= maxWrongTries) {
            named.status = 'dead';
            return { ok: true, status: 'dead' };
          }
        }
        return { ok: false, error: 'unknown_device' };
      }
      expireIfNeeded(record);
      if (record.status === 'expired') return { ok: true, status: 'expired' };
      if (record.status === 'dead') return { ok: true, status: 'dead' };
      if (record.status === 'denied') return { ok: true, status: 'denied' };
      if (record.status === 'pending') return { ok: true, status: 'pending', interval: PAIR_POLL_INTERVAL_SEC };
      if (record.status === 'approved' && record.tokenPlain) {
        const token = record.tokenPlain;
        record.tokenPlain = null;
        record.status = 'consumed';
        return { ok: true, status: 'approved', token };
      }
      return { ok: true, status: 'consumed' };
    },

    /**
     * @param {{ userCode?: string, userId: string, ip?: string }} fields
     */
    claim(fields) {
      const gate = takeEntry(fields.userId, fields.ip || 'unknown');
      if (!gate.ok) return gate;
      const record = findCode(fields.userCode);
      if (!record) return miss(gate.accountKey, gate.ipKey);
      const blocked = statusError(record);
      if (blocked) return blocked;
      const locked = lockToUser(record, fields.userId);
      if (locked) return locked;
      return describe(record);
    },

    /**
     * @param {{ userCode?: string, userId: string, ip?: string }} fields
     */
    async approve(fields) {
      const gate = takeEntry(fields.userId, fields.ip || 'unknown');
      if (!gate.ok) return gate;
      const record = findCode(fields.userCode);
      if (!record) return miss(gate.accountKey, gate.ipKey);
      const blocked = statusError(record);
      if (blocked) return blocked;
      const locked = lockToUser(record, fields.userId);
      if (locked) return locked;
      const label = `${record.name} on ${record.machine}`.slice(0, 160);
      const issued = await opts.tokens.issue({
        userId: String(fields.userId),
        label,
        machine: record.machine,
        city: record.city,
      });
      record.status = 'approved';
      record.userId = String(fields.userId);
      record.tokenPlain = issued.token;
      return { ok: true, sentence: approvalSentence(record) };
    },

    /**
     * @param {{ userCode?: string, userId: string, ip?: string }} fields
     */
    deny(fields) {
      const gate = takeEntry(fields.userId, fields.ip || 'unknown');
      if (!gate.ok) return gate;
      const record = findCode(fields.userCode);
      if (!record) return miss(gate.accountKey, gate.ipKey);
      const blocked = statusError(record);
      if (blocked) return blocked;
      const locked = lockToUser(record, fields.userId);
      if (locked) return locked;
      record.status = 'denied';
      record.tokenPlain = null;
      return { ok: true };
    },

    /** Plaintext tokens still waiting for the agent's poll, for tests. */
    plaintextHeld() {
      /** @type {string[]} */
      const values = [];
      for (const record of byCode.values()) {
        if (record.tokenPlain) values.push(record.tokenPlain);
      }
      return values;
    },

    snapshot() {
      return [...byCode.values()].map((record) => ({
        userCode: formatUserCode(record.userCode),
        deviceSecretHash: record.deviceSecretHash,
        status: record.status,
        wrongTries: record.wrongTries,
        city: record.city,
        name: record.name,
        machine: record.machine,
        userId: record.userId,
      }));
    },
  };
}
