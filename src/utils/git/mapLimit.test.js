import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapLimit } from './mapLimit.js';

test('mapLimit keeps input order and never runs more than limit at once', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3, 0], 3, async (ms, i) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, ms));
    running -= 1;
    return `${i}:${ms}`;
  });
  assert.deepEqual(out, ['0:5', '1:1', '2:4', '3:2', '4:3', '5:0']);
  assert.equal(peak, 3);
});

test('mapLimit: empty input, limit floor, and the first rejection wins', async () => {
  assert.deepEqual(await mapLimit([], 8, async () => 1), []);
  let peak = 0;
  let running = 0;
  await mapLimit([1, 2, 3], 0, async () => { running += 1; peak = Math.max(peak, running); await 0; running -= 1; });
  assert.equal(peak, 1, 'a limit below 1 runs one at a time');
  let started = 0;
  await assert.rejects(
    () => mapLimit([1, 2, 3, 4, 5, 6], 2, async (x) => { started += 1; if (x === 2) throw new Error('boom'); await new Promise((r) => setTimeout(r, 2)); return x; }),
    /boom/,
  );
  assert.ok(started < 6, `the failure stops the queue (${started} started)`);
});
