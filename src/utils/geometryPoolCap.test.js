import assert from 'node:assert/strict';
import test from 'node:test';
import {
  geometryWorkerCap,
  detectPhoneClass,
  parseWorkerOverride,
  readGeometryWorkerOverride,
  liveGeometryWorkerCap,
  GEOMETRY_WORKERS_STORAGE_KEY,
} from './geometryPoolCap.js';

test('the cap follows memory and cores: min(cores − 1, GB), clamped per device class', () => {
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 8, deviceMemory: 8 }), 7);
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 16, deviceMemory: 8 }), 8);
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 24, deviceMemory: 32 }), 8);
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 8, deviceMemory: 2 }), 2);
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 2, deviceMemory: 8 }), 1);
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 1, deviceMemory: 8 }), 1);
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 8, deviceMemory: 4, phone: true }), 4);
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 8, deviceMemory: 8, phone: true }), 4);
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 6, deviceMemory: 0.5, phone: true }), 1);
});

test('no deviceMemory (Safari, Firefox): 2 on a phone, 4 on a desktop, still at most cores − 1', () => {
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 8 }), 4);
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 8, phone: true }), 2);
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 2, phone: true }), 1);
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 4 }), 3);
  assert.equal(geometryWorkerCap({}), 1);
});

test('a dev override wins and is bounded', () => {
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 2, deviceMemory: 1, override: 6 }), 6);
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 8, deviceMemory: 8, override: '1' }), 1);
  assert.equal(geometryWorkerCap({ hardwareConcurrency: 8, deviceMemory: 8, override: 999 }), 16);
  assert.equal(parseWorkerOverride('abc'), null);
  assert.equal(parseWorkerOverride('0'), null);
  assert.equal(parseWorkerOverride('3.7'), 3);
  assert.equal(parseWorkerOverride(null), null);
});

test('readGeometryWorkerOverride: URL first, then localStorage, never throws', () => {
  const storage = { getItem: (k) => (k === GEOMETRY_WORKERS_STORAGE_KEY ? '3' : null) };
  assert.equal(readGeometryWorkerOverride({ window: { location: { search: '?geometryWorkers=5' } }, storage }), 5);
  assert.equal(readGeometryWorkerOverride({ window: { location: { search: '?x=1' } }, storage }), 3);
  assert.equal(readGeometryWorkerOverride({ window: { location: { search: '' } }, storage: { getItem() { throw new Error('blocked'); } } }), null);
  assert.equal(readGeometryWorkerOverride({ window: null, storage: null }), null);
});

test('detectPhoneClass: touch plus a small screen or low memory', () => {
  assert.equal(detectPhoneClass({ navigator: { maxTouchPoints: 5, deviceMemory: 4 }, window: { innerWidth: 1280, innerHeight: 800 } }), true);
  assert.equal(detectPhoneClass({ navigator: { maxTouchPoints: 5 }, window: { innerWidth: 390, innerHeight: 844 } }), true);
  assert.equal(detectPhoneClass({ navigator: { maxTouchPoints: 5, deviceMemory: 8 }, window: { innerWidth: 1280, innerHeight: 1024 } }), false);
  assert.equal(detectPhoneClass({ navigator: { maxTouchPoints: 0 }, window: { innerWidth: 390, innerHeight: 844 } }), false);
  assert.equal(detectPhoneClass({ navigator: null }), false);
});

test('liveGeometryWorkerCap reads the environment it is given', () => {
  const env = {
    navigator: { hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0 },
    window: { innerWidth: 1920, innerHeight: 1080, location: { search: '' }, localStorage: { getItem: () => null } },
  };
  assert.equal(liveGeometryWorkerCap(env), 7);
  env.window.location.search = '?geometryWorkers=2';
  assert.equal(liveGeometryWorkerCap(env), 2);
});
