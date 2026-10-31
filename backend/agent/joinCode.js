import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRateLimiter } from '../services/rateLimiter.js';
import {
  JOIN_CREATE_LIMIT,
  JOIN_CREATE_WINDOW_MS,
  JOIN_GLOBAL_REDEEM_LIMIT,
  JOIN_GLOBAL_REDEEM_WINDOW_MS,
  JOIN_MAX_PENDING,
  JOIN_MAX_TRIES,
  JOIN_REDEEM_IP_LIMIT,
  JOIN_REDEEM_IP_WINDOW_MS,
  JOIN_TTL_MS,
  PAIR_RETENTION_MS,
} from './limits.js';
import { formatUserCode, normalizeUserCode, USER_CODE_ALPHABET } from './pairing.js';
import { hashesMatch } from './tokens.js';

const LABEL_MAX = 80;
/** 256 % 31 === 8, so bytes at or above this limit would bias the alphabet. */
const UNBIASED_BYTE_LIMIT = 256 - (256 % USER_CODE_ALPHABET.length);
const DUMMY_CODE_HASH = createHash('sha256').update('surfcad-join-code-dummy').digest('hex');

/**
 * Eight characters from the no-lookalike alphabet. Bytes at or above the
 * unbiased limit are skipped (rejection sampling).
 * @param {Iterable<number>} bytes
 * @returns {string} raw code, no hyphen; shorter than 8 when `bytes` runs out
 */
export function joinCodeFromBytes(bytes) {
  let raw = '';
  for (const byte of bytes) {
    if (byte >= UNBIASED_BYTE_LIMIT) continue;
    raw += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
    if (raw.length === 8) break;
  }
  return raw;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stripControls(value) {
  let out = '';
  for (const char of String(value ?? '')) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) continue;
    out += char;
  }
  return out;
}

/**
 * @param {unknown} value
 * @param {string} fallback
 */
function cleanLabel(value, fallback) {
  const text = stripControls(value).trim().slice(0, LABEL_MAX);
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
 * @param {unknown} value
 * @returns {string | null}
 */
function cleanIp(value) {
  if (typeof value !== 'string') return null;
  const text = stripControls(value).trim().slice(0, 64);
  if (!text || text === 'unknown') return null;
  return text;
}

/**
 * @param {unknown} input
 * @returns {string | null} 8-character normalized code, or null when it is not one
 */
function canonicalCode(input) {
  const normalized = normalizeUserCode(input);
  if (normalized.length !== 8) return null;
  for (const char of normalized) {
    if (!USER_CODE_ALPHABET.includes(char)) return null;
  }
  return normalized;
}

/**
 * @param {string} normalized
 */
function hashCode(normalized) {
  return createHash('sha256').update(`join:${normalized}`).digest('hex');
}

/**
 * In-memory one-time join codes. The raw code is returned once from
 * `create` and is not stored. Redeem binds the token to the account that
 * created the code and ignores any account fields on the request.
 *
 * A wrong guess cannot be pinned to a live code (the code is the lookup
 * key). Those attempts hit the per-IP limiter and the global attempt
 * limiter. Five non-issuing presentations of a code that does match
 * (expired, used, or superseded) kill that code. Five wrong codes that
 * name the code's non-secret id do the same, so a live code dies before
 * it can be redeemed.
 *
 * @param {{
 *   tokens: { issue: (fields: { userId: string, label: string, machine?: string, city?: string | null, ip?: string | null }) => Promise<{ token: string, id: string }> },
 *   now?: () => number,
 *   ttlMs?: number,
 *   maxTries?: number,
 *   createLimit?: number,
 *   createWindowMs?: number,
 *   redeemIpLimit?: number,
 *   redeemIpWindowMs?: number,
 *   globalRedeemLimit?: number,
 *   globalRedeemWindowMs?: number,
 *   maxPending?: number,
 *   retentionMs?: number,
 *   randomBytes?: (size: number) => Buffer,
 * }} opts
 */
export function createJoinCodeService(opts) {
  const now = opts.now || (() => Date.now());
  const ttlMs = opts.ttlMs ?? JOIN_TTL_MS;
  const retentionMs = opts.retentionMs ?? PAIR_RETENTION_MS;
  const maxTries = opts.maxTries ?? JOIN_MAX_TRIES;
  const maxPending = opts.maxPending ?? JOIN_MAX_PENDING;
  const bytes = opts.randomBytes || randomBytes;
  /** @type {Map<string, any>} */
  const byHash = new Map();
  /** @type {Map<string, any>} */
  const byId = new Map();
  /** @type {Map<string, any>} */
  const byUser = new Map();
  const createLimiter = createRateLimiter({
    limit: opts.createLimit ?? JOIN_CREATE_LIMIT,
    windowMs: opts.createWindowMs ?? JOIN_CREATE_WINDOW_MS,
    now,
  });
  const redeemIpLimiter = createRateLimiter({
    limit: opts.redeemIpLimit ?? JOIN_REDEEM_IP_LIMIT,
    windowMs: opts.redeemIpWindowMs ?? JOIN_REDEEM_IP_WINDOW_MS,
    now,
  });
  const globalRedeemLimiter = createRateLimiter({
    limit: opts.globalRedeemLimit ?? JOIN_GLOBAL_REDEEM_LIMIT,
    windowMs: opts.globalRedeemWindowMs ?? JOIN_GLOBAL_REDEEM_WINDOW_MS,
    now,
  });

  /**
   * @param {() => Buffer} nextBytes
   */
  function drawCode(nextBytes) {
    let raw = '';
    for (let round = 0; round < 8 && raw.length < 8; round += 1) {
      raw += joinCodeFromBytes(nextBytes());
    }
    if (raw.length < 8) {
      throw new Error('join code RNG exhausted');
    }
    return raw.slice(0, 8);
  }

  /** @param {any} record */
  function expireIfNeeded(record) {
    if (record.status === 'pending' && now() >= record.createdAt + ttlMs) {
      record.status = 'expired';
    }
    return record;
  }

  function sweep() {
    const dropBefore = now() - ttlMs - retentionMs;
    for (const [codeHash, record] of byHash) {
      expireIfNeeded(record);
      if (record.status !== 'pending' && record.createdAt <= dropBefore) {
        byHash.delete(codeHash);
        byId.delete(record.id);
        if (byUser.get(record.userId) === record) byUser.delete(record.userId);
      }
    }
  }

  function pendingCount() {
    let count = 0;
    for (const record of byHash.values()) {
      expireIfNeeded(record);
      if (record.status === 'pending') count += 1;
    }
    return count;
  }

  /**
   * @param {any} record
   */
  function noteFailure(record) {
    if (!record || record.status === 'dead') return;
    record.failedTries += 1;
    if (record.failedTries >= maxTries) record.status = 'dead';
  }

  /**
   * @param {string} userId
   */
  function publicStatus(userId) {
    const record = byUser.get(String(userId));
    if (!record) return { status: 'none' };
    expireIfNeeded(record);
    if (record.status === 'pending') {
      return {
        status: 'pending',
        id: record.id,
        expiresAt: new Date(record.createdAt + ttlMs).toISOString(),
      };
    }
    if (record.status === 'expired') return { status: 'expired', id: record.id };
    if (record.status === 'used' || record.status === 'dead' || record.status === 'superseded') {
      return { status: 'used', id: record.id };
    }
    return { status: 'none' };
  }

  return {
    /**
     * One live code per account. The previous code can no longer be redeemed.
     * @param {{ userId: string }} fields
     */
    create(fields) {
      sweep();
      const userId = String(fields.userId || '');
      if (!userId) return { ok: false, error: 'unavailable' };
      const created = createLimiter.check(`acct:${userId}`);
      if (!created.allowed) {
        return { ok: false, error: 'rate_limited', retryAfterSec: created.retryAfterSec || 1 };
      }
      const previous = byUser.get(userId);
      if (previous) expireIfNeeded(previous);
      const replacing = previous && previous.status === 'pending';
      if (!replacing && pendingCount() >= maxPending) {
        return { ok: false, error: 'unavailable' };
      }
      if (replacing) previous.status = 'superseded';
      let raw = drawCode(() => bytes(16));
      let codeHash = hashCode(raw);
      for (let attempt = 0; attempt < 5 && byHash.has(codeHash); attempt += 1) {
        raw = drawCode(() => bytes(16));
        codeHash = hashCode(raw);
      }
      if (byHash.has(codeHash)) return { ok: false, error: 'unavailable' };
      const record = {
        id: randomUUID(),
        userId,
        codeHash,
        createdAt: now(),
        failedTries: 0,
        status: 'pending',
      };
      byHash.set(codeHash, record);
      byId.set(record.id, record);
      byUser.set(userId, record);
      return {
        ok: true,
        code: formatUserCode(raw),
        id: record.id,
        expiresAt: new Date(record.createdAt + ttlMs).toISOString(),
      };
    },

    /**
     * Status of this account's latest code. The code itself is not returned.
     * @param {{ userId: string }} fields
     */
    status(fields) {
      sweep();
      return publicStatus(fields.userId);
    },

    /**
     * Account comes only from the stored record. `userId` and `account` on
     * `fields` are ignored. A `cookie` request is refused before lookup so
     * a browser cookie cannot redeem or burn the code.
     * @param {{
     *   code?: unknown,
     *   name?: unknown,
     *   machine?: unknown,
     *   city?: unknown,
     *   ip?: unknown,
     *   id?: unknown,
     *   cookie?: boolean,
     * }} fields
     */
    async redeem(fields) {
      sweep();
      const ip = typeof fields.ip === 'string' && fields.ip ? fields.ip : 'unknown';
      const ipHit = redeemIpLimiter.check(`ip:${ip}`);
      const globalHit = globalRedeemLimiter.check('join-redeem');
      if (!ipHit.allowed || !globalHit.allowed) {
        return {
          ok: false,
          error: 'rate_limited',
          retryAfterSec: ipHit.retryAfterSec || globalHit.retryAfterSec || 1,
        };
      }
      if (fields.cookie) return { ok: false, error: 'invalid_code' };
      const normalized = canonicalCode(fields.code);
      const codeHash = normalized ? hashCode(normalized) : DUMMY_CODE_HASH;
      const record = normalized ? byHash.get(codeHash) : null;
      const compared = hashesMatch(record ? String(record.codeHash) : DUMMY_CODE_HASH, codeHash);
      const namedId = typeof fields.id === 'string' ? fields.id : '';
      const named = namedId ? byId.get(namedId) : null;
      if (!record || !compared) {
        if (named) noteFailure(named);
        return { ok: false, error: 'invalid_code' };
      }
      expireIfNeeded(record);
      if (record.status !== 'pending' || record.failedTries >= maxTries) {
        noteFailure(record);
        return { ok: false, error: 'invalid_code' };
      }
      record.status = 'used';
      const name = cleanLabel(fields.name, 'an agent');
      const machine = cleanLabel(fields.machine, 'an unknown machine');
      const label = `${name} on ${machine}`.slice(0, 160);
      const issued = await opts.tokens.issue({
        userId: record.userId,
        label,
        machine,
        city: cleanCity(fields.city),
        ip: cleanIp(fields.ip),
      });
      return {
        ok: true,
        token: issued.token,
        tokenId: issued.id,
        userId: record.userId,
      };
    },

    /** Records for tests. The raw code is not here. */
    snapshot() {
      return [...byHash.values()].map((record) => ({
        id: record.id,
        userId: record.userId,
        codeHash: record.codeHash,
        status: record.status,
        failedTries: record.failedTries,
      }));
    },
  };
}
