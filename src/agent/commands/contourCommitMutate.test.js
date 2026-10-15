import assert from 'node:assert/strict';
import test from 'node:test';
import { runContourCommitMutate } from './contourCommitMutate.js';

test('runContourCommitMutate uses mutate and returns refreshed status', async () => {
  let mutated = false;
  const ctx = {
    readStatus: () => ({ volume: 1, featureCount: 0 }),
    prepareContourMutate() {
      return {
        changed: true,
        source: 'next script',
        message: 'Contour extrude',
        placement: { key: 'k', stored: null, placed: { buffer: 'next', anchor: 0 } },
        finish: { payload: { entry: 'makeExtrude' }, fromSlot: true },
      };
    },
    async mutate(src, msg) {
      mutated = true;
      assert.equal(src, 'next script');
      assert.equal(msg, 'Contour extrude');
      return {
        ok: true,
        errors: [],
        status: { volume: 48000, featureCount: 2 },
      };
    },
    applyContourMutateExtras() {},
    finishContourCommit() {},
  };
  const out = await runContourCommitMutate(ctx, {
    prepare: () => ({ payload: { entry: 'makeExtrude' } }),
    fromSlot: true,
  });
  assert.equal(mutated, true);
  assert.equal(out.result?.status?.featureCount, 2);
  assert.equal(out.result?.written, true);
});
