import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { TOKEN_TTL_MS } from './limits.js';

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
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        lastUsedAt: row.lastUsedAt,
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
        createdAt: doc.createdAt,
        expiresAt: doc.expiresAt,
        revokedAt: doc.revokedAt ?? null,
        lastUsedAt: doc.lastUsedAt ?? null,
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
        createdAt: doc.createdAt,
        expiresAt: doc.expiresAt,
        revokedAt: doc.revokedAt ?? null,
        lastUsedAt: doc.lastUsedAt ?? null,
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
   * @param {Record<string, unknown> | null} row
   * @returns {'ok' | 'revoked' | 'expired' | 'missing'}
   */
  function liveness(row) {
    if (!row) return 'missing';
    if (row.revokedAt) return 'revoked';
    if (new Date(String(row.expiresAt)).getTime() <= now()) return 'expired';
    return 'ok';
  }

  return {
    /** @param {ReturnType<typeof createMemoryTokenStore>} store */
    setStore(store) {
      holder.store = store;
    },
    /**
     * @param {{ userId: string, label: string }} fields
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
      if (typeof raw !== 'string' || raw.length < 32) return null;
      const tokenHash = hashToken(raw);
      const row = await rowByHash(tokenHash);
      if (!row || liveness(row) !== 'ok') return null;
      return {
        userId: String(row.userId),
        id: String(row.id),
        tokenHash,
        label: String(row.label || ''),
      };
    },
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
    /** @param {{ tokenHash: string }} auth */
    async markUsed(auth) {
      await holder.store.touch(auth.tokenHash, new Date(now()).toISOString());
    },
    /** @param {string} userId */
    async list(userId) {
      const rows = await holder.store.listByUser(String(userId));
      return rows.map((row) => publicToken(row));
    },
    /**
     * @param {string} userId
     * @param {string} id
     */
    async revoke(userId, id) {
      return holder.store.revoke(String(userId), String(id));
    },
  };
}
