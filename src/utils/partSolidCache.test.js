import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cachedSolidGeometry,
  createSolidCache,
  pruneSolidCacheIn,
  solidCacheStats,
  solidEntryForGeometry,
} from './partSolidCache.js';

// A tetrahedron: enough for buildSolidGeometry to make a real geometry.
const tet = (scale = 1) => ({
  numProp: 3,
  vertProperties: new Float32Array([0, 0, 0, scale, 0, 0, 0, scale, 0, 0, 0, scale]),
  triVerts: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
  numRun: 1,
  runIndex: new Uint32Array([0, 12]),
  runOriginalID: new Uint32Array([3]),
  faceID: new Uint32Array([0, 1, 2, 3]),
});

const shownBy = (...geoms) => {
  const extras = new Map();
  geoms.forEach((g, i) => extras.set(`p${i}`, { geometry: g }));
  return extras;
};

test('a rerun of the same part with the same mesh keeps its geometry (no new upload)', () => {
  const cache = createSolidCache();
  const first = cachedSolidGeometry(cache, tet(), 'A');
  const again = cachedSolidGeometry(cache, tet(), 'A');
  assert.equal(again.geometry, first.geometry);
  assert.equal(cache.stats.builds, 1);
  assert.equal(cache.stats.reuses, 1);
  // The entry follows the newest mesh data; the old object is let go.
  assert.equal(cache.entries.size, 1);
});

test('a changed mesh builds a new geometry; the same mesh under another part id is not shared', () => {
  const cache = createSolidCache();
  const a = cachedSolidGeometry(cache, tet(1), 'A');
  const bigger = cachedSolidGeometry(cache, tet(2), 'A');
  assert.notEqual(bigger.geometry, a.geometry);
  const b = cachedSolidGeometry(cache, tet(1), 'B');
  assert.notEqual(b.geometry, a.geometry);
  assert.equal(cache.stats.builds, 3);
  assert.equal(cache.stats.reuses, 0);
});

test('the same mesh data object always hits, whatever part id is passed', () => {
  const cache = createSolidCache();
  const mesh = tet();
  const first = cachedSolidGeometry(cache, mesh, 'A');
  assert.equal(cachedSolidGeometry(cache, mesh).geometry, first.geometry);
  assert.equal(cachedSolidGeometry(cache, mesh, 'B').geometry, first.geometry);
  assert.equal(cache.stats.builds, 1);
});

test('prune disposes what nothing shows and drops its content key', () => {
  const cache = createSolidCache();
  const a = cachedSolidGeometry(cache, tet(1), 'A');
  const b = cachedSolidGeometry(cache, tet(2), 'B');
  let disposed = 0;
  a.geometry.dispose = () => { disposed += 1; };
  pruneSolidCacheIn(cache, { geometry: b.geometry }, shownBy());
  assert.equal(disposed, 1);
  assert.equal(cache.entries.size, 1);
  assert.equal(cache.stats.disposed, 1);
  // The disposed geometry is never handed out again: a rerun builds afresh.
  const rebuilt = cachedSolidGeometry(cache, tet(1), 'A');
  assert.notEqual(rebuilt.geometry, a.geometry);
  assert.equal(cache.stats.builds, 3);
});

test('solidEntryForGeometry reports the newest mesh data after a reuse', () => {
  const cache = createSolidCache();
  const first = cachedSolidGeometry(cache, tet(), 'A');
  const newest = tet();
  cachedSolidGeometry(cache, newest, 'A');
  assert.equal(solidEntryForGeometry(cache, first.geometry).meshData, newest);
});

test('solidCacheStats sums over live caches', () => {
  const before = solidCacheStats();
  const cache = createSolidCache();
  cachedSolidGeometry(cache, tet(), 'A');
  cachedSolidGeometry(cache, tet(), 'A');
  const after = solidCacheStats();
  assert.equal(after.builds - before.builds, 1);
  assert.equal(after.reuses - before.reuses, 1);
  assert.equal(after.live - before.live, 1);
});
