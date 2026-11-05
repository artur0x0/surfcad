import assert from 'node:assert/strict';
import test from 'node:test';
import { tabAdvertisesTool } from '../src/unlistedTools.mjs';

/**
 * A tool the tab lists but this package's shipped catalog lacks (one the app
 * added after the npm release) is forwarded once the tab confirms it; the
 * answer is cached per process; a tab that does not know it, or a failing
 * read, stays unknown.
 */

function fakeSession(known, { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async call(name, args) {
      calls.push([name, args]);
      if (fail) throw Object.assign(new Error('not paired'), { code: 'not_paired' });
      const wanted = Array.isArray(args?.names) ? args.names : [];
      return { commands: wanted.filter((n) => known.includes(n)).map((n) => ({ name: n, schema: {}, example: {} })) };
    },
  };
}

test('a name the tab advertises is accepted and asked about once', async () => {
  const session = fakeSession(['insert_boss']);
  const cache = new Map();
  assert.equal(await tabAdvertisesTool(session, 'insert_boss', cache), true);
  assert.equal(await tabAdvertisesTool(session, 'insert_boss', cache), true);
  assert.deepEqual(session.calls, [['list_commands', { names: ['insert_boss'] }]]);
});

test('a name the tab does not know stays unknown, and so does a failed read', async () => {
  const session = fakeSession(['insert_boss']);
  const cache = new Map();
  assert.equal(await tabAdvertisesTool(session, 'nope', cache), false);
  assert.equal(await tabAdvertisesTool(session, 'nope', cache), false);
  assert.equal(session.calls.length, 1, 'the no is cached too');
  const broken = fakeSession(['insert_boss'], { fail: true });
  assert.equal(await tabAdvertisesTool(broken, 'insert_boss', new Map()), false);
  assert.equal(await tabAdvertisesTool(session, '', cache), false);
});
