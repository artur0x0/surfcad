import assert from 'node:assert/strict';
import test from 'node:test';
import { createMoldToolCache, meshStamp, pullStamp } from './moldToolCache.js';

function mesh(size, z = 0) {
  const positions = [0, 0, z, size, 0, z, 0, size, z];
  const indices = [0, 1, 2];
  return { positions, indices };
}

test('mesh and pull stamps ignore object identity', () => {
  const a = mesh(2);
  const b = { positions: a.positions.slice(), indices: a.indices.slice() };
  assert.equal(meshStamp(a), meshStamp(b));
  assert.notEqual(meshStamp(a), meshStamp(mesh(3)));
  assert.equal(pullStamp(null), 'auto');
  assert.equal(pullStamp([0, 0, 1]), pullStamp([0, 0, 1.0000004]));
  assert.notEqual(pullStamp([0, 0, 1]), pullStamp([1, 0, 0]));
});

test('a cache hit returns the stored result and a miss does not', () => {
  const cache = createMoldToolCache();
  const part = mesh(4);
  assert.equal(cache.get('wall', part, null).hit, false);
  assert.equal(cache.set('wall', part, null, { nominal: 2 }), true);
  assert.equal(cache.set('report', part, null, { sideActionCount: 0 }), true);
  const wall = cache.get('wall', { positions: part.positions.slice(), indices: part.indices.slice() }, [1, 0, 0]);
  assert.equal(wall.hit, true);
  assert.equal(wall.value.nominal, 2);
  const report = cache.get('report', part, null);
  assert.equal(report.hit, true);
  assert.equal(report.value.sideActionCount, 0);
  assert.equal(cache.get('draft', part, null).hit, false);
  assert.equal(cache.get('wall', mesh(9), null).hit, false);
});

test('a pull change drops parting, draft, and the report, and keeps wall thickness', () => {
  const cache = createMoldToolCache();
  const part = mesh(4);
  cache.set('wall', part, null, { nominal: 2 });
  cache.set('parting', part, null, { core: 1 });
  cache.set('draft', part, [0, 0, 1], { violations: 0 });
  cache.set('report', part, [0, 0, 1], { sideActionCount: 1 });
  assert.equal(cache.invalidatePull(), 3);
  assert.equal(cache.get('wall', part, [1, 0, 0]).hit, true);
  assert.equal(cache.get('parting', part, null).hit, false);
  assert.equal(cache.get('draft', part, [0, 0, 1]).hit, false);
  assert.equal(cache.get('report', part, [0, 0, 1]).hit, false);
  assert.equal(cache.get('report', part, [1, 0, 0]).hit, false);
});

test('a mesh change drops every tool for that mesh and leaves the other mesh', () => {
  const cache = createMoldToolCache();
  const plate = mesh(4);
  const hook = mesh(4, 1);
  cache.set('wall', plate, null, { nominal: 2 });
  cache.set('report', plate, null, { sideActionCount: 0 });
  cache.set('wall', hook, null, { nominal: 1 });
  cache.set('parting', hook, [0, 0, 1], { core: 3 });
  assert.ok(cache.invalidateMesh(plate) >= 2);
  assert.equal(cache.get('wall', plate, null).hit, false);
  assert.equal(cache.get('report', plate, null).hit, false);
  assert.equal(cache.get('wall', hook, null).value.nominal, 1);
  assert.equal(cache.get('parting', hook, [0, 0, 1]).hit, true);
  assert.equal(cache.invalidateMesh(null), 0);
});
