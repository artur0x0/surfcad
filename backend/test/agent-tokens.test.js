import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createManualClock } from '../agent/clock.js';
import { createMongoTokenStore, createMemoryTokenStore, createTokenService, hashToken } from '../agent/tokens.js';

const USER_A = 'a'.repeat(24);
const USER_B = 'b'.repeat(24);

function memoryService(ttlMs = 1000) {
  const clock = createManualClock(1_700_000_000_000);
  const store = createMemoryTokenStore();
  const tokens = createTokenService({ store, now: () => clock.now(), ttlMs });
  return { clock, store, tokens };
}

function fakeModel() {
  const docs = [];
  return {
    docs,
    async create(row) {
      if (Object.prototype.hasOwnProperty.call(row, 'token')) {
        throw new Error('raw token');
      }
      const doc = { ...row, _id: `mongo-${docs.length + 1}` };
      docs.push(doc);
      return doc;
    },
    findOne(query) {
      return {
        lean: async () => docs.find((doc) => doc.tokenHash === query.tokenHash) || null,
      };
    },
    find(query) {
      const matched = () => docs.filter((doc) => {
        if (query.userId && String(doc.userId) !== String(query.userId)) return false;
        if (query.revokedAt === null && doc.revokedAt) return false;
        return true;
      });
      const chain = {
        sort() { return chain; },
        select() { return chain; },
        lean: async () => matched(),
      };
      return chain;
    },
    async updateMany(filter, update) {
      const hits = docs.filter((doc) => {
        if (filter.userId && String(doc.userId) !== String(filter.userId)) return false;
        if (filter.revokedAt === null && doc.revokedAt) return false;
        return true;
      });
      for (const doc of hits) Object.assign(doc, update.$set);
      return { matchedCount: hits.length, modifiedCount: hits.length };
    },
    async updateOne(filter, update) {
      const doc = docs.find((item) => {
        if (filter.tokenHash && item.tokenHash !== filter.tokenHash) return false;
        if (filter._id && String(item._id) !== String(filter._id)) return false;
        if (filter.userId && String(item.userId) !== String(filter.userId)) return false;
        if (filter.revokedAt === null && item.revokedAt) return false;
        return Boolean(filter.tokenHash || filter._id);
      });
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
}

describe('agent token hashes', () => {
  test('memory store keeps the SHA-256 hash and not the token', async () => {
    const { tokens, store } = memoryService();
    const issued = await tokens.issue({
      userId: 'user-a',
      label: 'Cursor on laptop',
      machine: 'laptop',
      city: 'Lisbon',
    });
    assert.equal(Buffer.from(issued.token, 'base64url').length >= 32, true);
    const row = store.dump()[0];
    assert.equal(row.tokenHash, hashToken(issued.token));
    assert.equal(row.token, undefined);
    assert.equal(JSON.stringify(store.dump()).includes(issued.token), false);
    const listed = await tokens.list('user-a');
    assert.equal(listed[0].label, 'Cursor on laptop');
    assert.equal(listed[0].machine, 'laptop');
    assert.equal(listed[0].city, 'Lisbon');
    assert.equal(JSON.stringify(listed).includes('tokenHash'), false);
    assert.equal(JSON.stringify(listed).includes(issued.token), false);
    assert.equal((await tokens.list('user-b')).length, 0);
  });

  test('revoke blocks later use and does not affect another user', async () => {
    const { clock, tokens } = memoryService();
    const issued = await tokens.issue({ userId: 'user-a', label: 'Cursor on laptop' });
    assert.equal((await tokens.revoke('user-b', issued.id)), false);
    assert.equal((await tokens.authenticate(issued.token)).userId, 'user-a');
    clock.advance(10);
    await tokens.markUsed(await tokens.authenticate(issued.token));
    const listed = await tokens.list('user-a');
    assert.equal(listed[0].lastUsedAt, new Date(clock.now()).toISOString());
    assert.equal(await tokens.revoke('user-a', issued.id), true);
    assert.equal(await tokens.authenticate(issued.token), null);
    assert.ok((await tokens.list('user-a'))[0].revokedAt);
  });

  test('revokeAll drops every live token for that account only', async () => {
    const { tokens } = memoryService();
    const first = await tokens.issue({ userId: 'user-a', label: 'laptop' });
    const second = await tokens.issue({ userId: 'user-a', label: 'phone' });
    const other = await tokens.issue({ userId: 'user-b', label: 'other' });
    const ids = await tokens.revokeAll('user-a');
    assert.deepEqual(ids.sort(), [first.id, second.id].sort());
    assert.equal(await tokens.authenticate(first.token), null);
    assert.equal(await tokens.authenticate(second.token), null);
    assert.equal((await tokens.authenticate(other.token)).userId, 'user-b');
    assert.deepEqual(await tokens.revokeAll('user-a'), []);
  });

  test('an expired token is rejected', async () => {
    const { clock, tokens } = memoryService(1000);
    const issued = await tokens.issue({ userId: 'user-a', label: 'Cursor on laptop' });
    clock.advance(999);
    assert.equal((await tokens.authenticate(issued.token)).userId, 'user-a');
    clock.advance(1);
    assert.equal(await tokens.authenticate(issued.token), null);
  });

  test('mongo adapter writes the hash only', async () => {
    const model = fakeModel();
    const clock = createManualClock(1_700_000_000_000);
    const tokens = createTokenService({
      store: createMongoTokenStore(model),
      now: () => clock.now(),
      ttlMs: 5000,
    });
    const issued = await tokens.issue({
      userId: USER_A,
      label: 'Cursor on laptop',
      machine: 'laptop',
      city: 'Lisbon',
    });
    assert.equal(model.docs[0].tokenHash, hashToken(issued.token));
    assert.equal(model.docs[0].machine, 'laptop');
    assert.equal(model.docs[0].city, 'Lisbon');
    assert.equal(model.docs[0].token, undefined);
    assert.equal(JSON.stringify(model.docs).includes(issued.token), false);
    assert.equal((await tokens.list(USER_A))[0].id, 'mongo-1');
    assert.equal((await tokens.list(USER_B)).length, 0);
    assert.equal(await tokens.revoke(USER_B, 'mongo-1'), false);
    assert.equal((await tokens.authenticate(issued.token)).userId, USER_A);
    assert.equal(await tokens.revoke(USER_A, 'mongo-1'), true);
    assert.equal(await tokens.authenticate(issued.token), null);
    const again = await tokens.issue({ userId: USER_A, label: 'phone' });
    const spare = await tokens.issue({ userId: USER_B, label: 'other' });
    const ids = await tokens.revokeAll(USER_A);
    assert.deepEqual(ids, [again.id]);
    assert.equal(await tokens.authenticate(again.token), null);
    assert.equal((await tokens.authenticate(spare.token)).userId, USER_B);
  });
});
