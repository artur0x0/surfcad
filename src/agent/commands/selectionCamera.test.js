import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';

function host(overrides = {}) {
  return {
    getScript: () => '',
    setEditor: () => {},
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory: () => {},
    execute: async () => ({ ok: true, errors: [] }),
    screenshot: () => 'data:image/png;base64,AA==',
    readSelection: () => ({ activePartId: 'p1', face: null, edges: [], contour: {} }),
    readCamera: () => ({ position: [0, 0, 10], target: [0, 0, 0], quaternion: null, zoom: null, fov: 50 }),
    clearSelection: null,
    selectFaces() { return { count: 1 }; },
    setCamera() { return { ok: true }; },
    setActivePart(partId) {
      if (partId === 'missing') return { error: { code: 'unknown_part', message: 'nope' } };
      return { ok: true };
    },
    ...overrides,
  };
}

test('select_clear calls host clearSelection', async () => {
  let cleared = false;
  const h = host({ clearSelection() { cleared = true; } });
  const api = createSurfcadBridge({ resolve: () => h });
  const env = await api.call('select_clear', {});
  assert.equal(env.ok, true);
  assert.equal(cleared, true);
});

test('set_active_part returns unknown_part', async () => {
  const api = createSurfcadBridge({ resolve: () => host() });
  const env = await api.call('set_active_part', { part_id: 'missing' });
  assert.equal(env.ok, false);
  assert.equal(env.error.code, 'unknown_part');
});

test('camera_set with bad view is refused', async () => {
  const api = createSurfcadBridge({ resolve: () => host() });
  const env = await api.call('camera_set', { view: 'diagonal' });
  assert.equal(env.ok, false);
  assert.equal(env.error.code, 'bad_view');
});

test('selection reader sees face after select_faces', async () => {
  const face = { key: { at: [0, 0, 1], n: [0, 0, 1], area: 4 }, center: [0, 0, 1], normal: [0, 0, 1] };
  const h = host({
    selectFaces() { return { count: 1 }; },
    readSelection() {
      return { activePartId: 'p1', cadPartId: null, face, edges: [], contour: {} };
    },
  });
  const api = createSurfcadBridge({ resolve: () => h });
  const picked = await api.call('select_faces', { keys: [{ at: [0, 0, 1], n: [0, 0, 1], area: 4 }] });
  assert.equal(picked.ok, true);
  const sel = await api.call('selection', {});
  assert.equal(sel.result.face?.center[2], 1);
});

test('camera_set top updates camera reader', async () => {
  let cam = { position: [5, 5, 5], target: [0, 0, 0], quaternion: null, zoom: null, fov: 50 };
  const h = host({
    setCamera({ view }) {
      if (view === 'top') cam = { position: [0, 0, 40], target: [0, 0, 0], quaternion: null, zoom: null, fov: 50 };
      return { ok: true };
    },
    readCamera: () => cam,
  });
  const api = createSurfcadBridge({ resolve: () => h });
  await api.call('camera_set', { view: 'top' });
  const after = await api.call('camera', {});
  assert.ok(after.result.position[2] > after.result.position[0]);
});
