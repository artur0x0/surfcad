import assert from 'node:assert/strict';
import test from 'node:test';
import { isSurfId, isV2SurfId, mintSurfId } from './surfId.js';

const STAMP = '2026-10-07-20-56-31-0423-a3f9';

test('a pinned rand keeps the stamp and a stored id still parses', () => {
  const now = new Date('2026-10-07T20:56:31.423Z');
  assert.equal(mintSurfId({ now, rand: 'a3f9' }), STAMP);
  assert.equal(mintSurfId({ now, rand: 'a3f9' }), STAMP);
  assert.equal(isSurfId(STAMP), true);
  assert.equal(isV2SurfId(STAMP), true);
  assert.equal(isSurfId(`local-${STAMP}`), true);
  assert.equal(isV2SurfId(`local-${STAMP}`), false);
});

test('mintSurfId stays unique across 100k ids in one millisecond', () => {
  const now = new Date('2026-10-25T03:07:13.016Z');
  const n = 100_000;
  const ids = new Set();
  for (let i = 0; i < n; i += 1) ids.add(mintSurfId({ now }));
  assert.equal(ids.size, n);
  const stamps = new Set();
  for (const id of ids) {
    assert.equal(isSurfId(id), true, id);
    assert.equal(isV2SurfId(id), true, id);
    stamps.add(id.slice(0, id.lastIndexOf('-')));
  }
  // 16 bits hold 65536 suffixes per millisecond, so 100k needs a second
  // stamp and must not spill past a third (a full walk, then a partial).
  assert.ok(stamps.size === 2 || stamps.size === 3, `stamps ${[...stamps].join(' ')}`);
});
