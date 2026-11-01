import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { TOKEN_TTL_MS } from './limits.js';
import { storedApprovingSession } from './sessionKey.js';

/**
 * @param {string} raw
 * @returns {string}
 */
export function hashToken(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
export function hashesMatch(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * @param {Record<string, unknown>} row
 */
export function publicToken(row) {
  return {
    id: String(row.id),
    label: row.label || '',
    machine: row.machine || '',
    city: row.city || null,
    ip: row.ip || null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt ?? null,
    revokedAt: row.revokedAt ?? null,
  };
}

export function createMemoryTokenStore() {
  /** @type {Map<string, Record<string, unknown>>} */
  const byHash = new Map();
  /** @type {Map<string, Record<string, unknown>>} */
  const byId = new Map();

  return {
    /**
     * @param {Record<string, unknown>} row
     */
    async insert(row) {
      const stored = { ...row };
      if (Object.prototype.hasOwnProperty.call(stored, 'token')) {
        throw new Error('refusing to store a raw agent token');
      }
      byHash.set(String(stored.tokenHash), stored);
      byId.set(String(stored.id), stored);
      return stored;
    },
    /** @param {string} tokenHash */
    async findByHash(tokenHash) {
      const row = byHash.get(tokenHash);
      return row ? { ...row } : null;
    },
    /** @param {string} userId */
    async listByUser(userId) {
      return [...byId.values()]
        .filter((row) => String(row.userId) === String(userId))
        .map((row) => ({ ...row }));
    },
    /**
     * @param {string} userId
     * @param {string} id
     */
    async revoke(userId, id) {
      const row = byId.get(String(id));
      if (!row || String(row.userId) !== String(userId) || row.revokedAt) return false;
      row.revokedAt = new Date().toISOString();
      return true;
    },
    /**
     * Revoke every live token for the account. Already-revoked rows stay as they are.
     * @param {string} userId
     * @returns {Promise<string[]>}
     */
    async revokeAll(userId) {
      const ids = [];
      const when = new Date().toISOString();
      for (const row of byId.values()) {
        if (String(row.userId) !== String(userId) || row.revokedAt) continue;
        row.revokedAt = when;
        ids.push(String(row.id));
      }
      return ids;
    },
    /**
     * Revoke live tokens issued from one browser session. A row with no
     * session key is left alone. `sessionKey` must be the stored hash.
     * @param {string} userId
     * @param {string} sessionKey
     * @returns {Promise<string[]>}
     */
    async revokeBySession(userId, sessionKey) {
      const key = storedApprovingSession(sessionKey);
      if (!key) return [];
      const ids = [];
      const when = new Date().toISOString();
      for (const row of byId.values()) {
        if (String(row.userId) !== String(userId) || row.revokedAt) continue;
        if (row.sessionKey !== key) continue;
        row.revokedAt = when;
        ids.push(String(row.id));
      }
      return ids;
    },
    /**
     * @param {string} tokenHash
     * @param {string} when
     */
    async touch(tokenHash, when) {
      const row = byHash.get(tokenHash);
      if (!row) return false;
      row.lastUsedAt = when;
      return true;
    },
    dump() {
      return [...byId.values()].map((row) => ({ ...row }));
    },
  };
}

/**
 * Mongo adapter. Documents store `tokenHash` only. The raw token never
 * enters this object.
 * @param {import('mongoose').Model<any>} model
 */
export function createMongoTokenStore(model) {
  return {
    /** @param {Record<string, unknown>} row */
    async insert(row) {
      if (Object.prototype.hasOwnProperty.call(row, 'token')) {
        throw new Error('refusing to store a raw agent token');
      }
      const doc = await model.create({
        userId: row.userId,
        tokenHash: row.tokenHash,
        label: row.label,
        machine: row.machine || '',
        city: row.city || null,
        ip: row.ip || null,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        lastUsedAt: row.lastUsedAt,
        sessionKey: row.sessionKey || null,
      });
      return { ...row, id: String(doc._id) };
    },
    /** @param {string} tokenHash */
    async findByHash(tokenHash) {
      const doc = await model.findOne({ tokenHash }).lean();
      if (!doc) return null;
      return {
        id: String(doc._id),
        userId: String(doc.userId),
        tokenHash: doc.tokenHash,
        label: doc.label || '',
        machine: doc.machine || '',
        city: doc.city || null,
        ip: doc.ip || null,
        createdAt: doc.createdAt,
        expiresAt: doc.expiresAt,
        revokedAt: doc.revokedAt ?? null,
        lastUsedAt: doc.lastUsedAt ?? null,
        sessionKey: doc.sessionKey ?? null,
      };
    },
    /** @param {string} userId */
    async listByUser(userId) {
      const docs = await model.find({ userId }).sort({ createdAt: -1 }).lean();
      return docs.map((doc) => ({
        id: String(doc._id),
        userId: String(doc.userId),
        tokenHash: doc.tokenHash,
        label: doc.label || '',
        machine: doc.machine || '',
        city: doc.city || null,
        ip: doc.ip || null,
        createdAt: doc.createdAt,
        expiresAt: doc.expiresAt,
        revokedAt: doc.revokedAt ?? null,
        lastUsedAt: doc.lastUsedAt ?? null,
        sessionKey: doc.sessionKey ?? null,
      }));
    },
    /**
     * @param {string} userId
     * @param {string} id
     */
    async revoke(userId, id) {
      const result = await model.updateOne(
        { _id: id, userId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      return result.matchedCount > 0;
    },
    /**
     * @param {string} userId
     * @returns {Promise<string[]>}
     */
    async revokeAll(userId) {
      const docs = await model.find({ userId, revokedAt: null }).select('_id').lean();
      const ids = docs.map((doc) => String(doc._id));
      if (ids.length === 0) return [];
      await model.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
      return ids;
    },
    /**
     * @param {string} userId
     * @param {string} sessionKey
     * @returns {Promise<string[]>}
     */
    async revokeBySession(userId, sessionKey) {
      const key = storedApprovingSession(sessionKey);
      if (!key) return [];
      const docs = await model.find({ userId, revokedAt: null, sessionKey: key }).select('_id').lean();
      const ids = docs.map((doc) => String(doc._id));
      if (ids.length === 0) return [];
      await model.updateMany(
        { userId, revokedAt: null, sessionKey: key },
        { $set: { revokedAt: new Date() } },
      );
      return ids;
    },
    /**
     * @param {string} tokenHash
     * @param {string} when
     */
    async touch(tokenHash, when) {
      const result = await model.updateOne({ tokenHash }, { $set: { lastUsedAt: when } });
      return result.matchedCount > 0;
    },
  };
}

/**
 * @param {{
 *   store?: ReturnType<typeof createMemoryTokenStore>,
 *   now?: () => number,
 *   ttlMs?: number,
 *   randomBytes?: (size: number) => Buffer,
 * }} [opts]
 */
export function createTokenService(opts = {}) {
  const holder = { store: opts.store || createMemoryTokenStore() };
  const now = opts.now || (() => Date.now());
  const ttlMs = opts.ttlMs ?? TOKEN_TTL_MS;
  const bytes = opts.randomBytes || randomBytes;

  /**
   * @param {string} tokenHash
   */
  async function rowByHash(tokenHash) {
    const row = await holder.store.findByHash(tokenHash);
    if (!row || !hashesMatch(String(row.tokenHash), tokenHash)) return null;
    return row;
  }

  /**
   * @param {unknown} value
   * @returns {number}
   */
  function instantMs(value) {
    if (value instanceof Date) {
      const n = value.getTime();
      return Number.isFinite(n) ? n : NaN;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const n = Date.parse(String(value ?? ''));
    return Number.isFinite(n) ? n : NaN;
  }

  /**
   * Absolute expiry. A stored `expiresAt` longer than `ttlMs` from
   * `createdAt` is capped. Missing dates are already expired.
   * @param {Record<string, unknown>} row
   * @returns {number}
   */
  function effectiveExpiryMs(row) {
    const stored = instantMs(row.expiresAt);
    const created = instantMs(row.createdAt);
    const cap = Number.isFinite(created) ? created + ttlMs : NaN;
    if (Number.isFinite(stored) && Number.isFinite(cap)) return Math.min(stored, cap);
    if (Number.isFinite(cap)) return cap;
    if (Number.isFinite(stored)) return stored;
    return 0;
  }

  /**
   * @param {Record<string, unknown> | null} row
   * @returns {'ok' | 'revoked' | 'expired' | 'missing'}
   */
  function liveness(row) {
    if (!row) return 'missing';
    if (row.revokedAt) return 'revoked';
    if (effectiveExpiryMs(row) <= now()) return 'expired';
    return 'ok';
  }

  /**
   * @param {string | undefined | null} raw
   * @returns {Promise<{ status: 'ok' | 'revoked' | 'expired' | 'missing', auth: { userId: string, id: string, tokenHash: string, label: string } | null }>}
   */
  async function inspect(raw) {
    if (typeof raw !== 'string' || raw.length < 32) return { status: 'missing', auth: null };
    const tokenHash = hashToken(raw);
    const row = await rowByHash(tokenHash);
    if (!row) return { status: 'missing', auth: null };
    return {
      status: liveness(row),
      auth: {
        userId: String(row.userId),
        id: String(row.id),
        tokenHash,
        label: String(row.label || ''),
      },
    };
  }

  return {
    /** @param {ReturnType<typeof createMemoryTokenStore>} store */
    setStore(store) {
      holder.store = store;
    },
    /**
     * @param {{
     *   userId: string,
     *   label: string,
     *   machine?: string,
     *   city?: string | null,
     *   ip?: string | null,
     *   sessionKey?: string | null,
     * }} fields
     * @returns {Promise<{ token: string, id: string }>}
     */
    async issue(fields) {
      const raw = bytes(32);
      if (!Buffer.isBuffer(raw) || raw.length < 32) {
        throw new Error('agent token is shorter than 32 bytes');
      }
      const token = raw.toString('base64url');
      const id = randomUUID();
      const row = {
        id,
        userId: String(fields.userId),
        tokenHash: hashToken(token),
        label: fields.label,
        machine: typeof fields.machine === 'string' ? fields.machine : '',
        city: typeof fields.city === 'string' && fields.city ? fields.city : null,
        ip: typeof fields.ip === 'string' && fields.ip ? fields.ip : null,
        sessionKey: storedApprovingSession(fields.sessionKey),
        createdAt: new Date(now()).toISOString(),
        expiresAt: new Date(now() + ttlMs).toISOString(),
        revokedAt: null,
        lastUsedAt: null,
      };
      const stored = await holder.store.insert(row);
      return { token, id: String(stored.id || id) };
    },
    /**
     * @param {string | undefined | null} raw
     */
    async authenticate(raw) {
      const found = await inspect(raw);
      if (found.status !== 'ok') return null;
      return found.auth;
    },
    /**
     * Same lookup as authenticate, including a dead token, so a caller can
     * tell expired from revoked. Does not slide `expiresAt`.
     * @param {string | undefined | null} raw
     */
    inspect,
    /**
     * Re-check a socket that already authenticated. `ok` is the only state
     * that may run another command.
     * @param {string} tokenHash
     * @returns {Promise<'ok' | 'revoked' | 'expired' | 'missing'>}
     */
    async status(tokenHash) {
      if (typeof tokenHash !== 'string' || tokenHash.length === 0) return 'missing';
      return liveness(await rowByHash(tokenHash));
    },
    /**
     * Records `lastUsedAt` only. The pairing expiry stays at issue time
     * plus the absolute TTL.
     * @param {{ tokenHash: string }} auth
     */
    async markUsed(auth) {
      await holder.store.touch(auth.tokenHash, new Date(now()).toISOString());
    },
    /** @param {string} userId */
    async list(userId) {
      const rows = await holder.store.listByUser(String(userId));
      return rows.map((row) => {
        const pub = publicToken(row);
        pub.expiresAt = new Date(effectiveExpiryMs(row)).toISOString();
        return pub;
      });
    },
    /**
     * @param {string} userId
     * @param {string} id
     */
    async revoke(userId, id) {
      return holder.store.revoke(String(userId), String(id));
    },
    /**
     * @param {string} userId
     * @returns {Promise<string[]>} ids that were live and are now revoked
     */
    async revokeAll(userId) {
      return holder.store.revokeAll(String(userId));
    },
    /**
     * Live tokens whose stored session hash matches. Missing hashes stay.
     * @param {string} userId
     * @param {string | null} sessionKey
     * @returns {Promise<string[]>}
     */
    async revokeBySession(userId, sessionKey) {
      if (!sessionKey) return [];
      return holder.store.revokeBySession(String(userId), sessionKey);
    },
    /**
     * @param {string} userId
     * @returns {Promise<number>}
     */
    async countLive(userId) {
      const rows = await holder.store.listByUser(String(userId));
      return rows.filter((row) => liveness(row) === 'ok').length;
    },
  };
}
