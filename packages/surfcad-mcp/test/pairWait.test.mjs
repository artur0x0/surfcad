import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForPairing } from '../src/pairWait.mjs';

test('a pairing attempt that does not settle in time is pair_pending, not a promise chaining cycle (B4)', async () => {
  const never = new Promise(() => {});
  await assert.rejects(waitForPairing(never, 20), (err) => {
    assert.equal(err.code, 'pair_pending', String(err));
    assert.doesNotMatch(String(err.message), /Chaining cycle/);
    return true;
  });
});

test('a pairing attempt that settles in time passes its result or error through', async () => {
  assert.deepEqual(await waitForPairing(Promise.resolve({ paired: true }), 1000), { paired: true });
  const refused = Object.assign(new Error('Pairing rejected in SurfCAD (user clicked Deny)'), { code: 'pair_rejected' });
  await assert.rejects(waitForPairing(Promise.reject(refused), 1000), (err) => err.code === 'pair_rejected');
});
