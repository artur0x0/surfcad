import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { errorsCommand } from './errors.js';

function host(overrides = {}) {
  return {
    getScript: () => '',
    setEditor() {},
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory() {},
    async execute() {
      return { ok: true, errors: [], volume: null, bbox: null, partName: '' };
    },
    screenshot: () => 'data:image/png;base64,',
    ...overrides,
  };
}

test('H2 reader commands resolve immediately through the bridge', async () => {
  const api = createSurfcadBridge(host({
    readFeatureTree: () => ({ features: [{ id: 'cube1', kind: 'cube', index: 0 }], rollbackAnchor: null, activeChipId: null }),
    readSelection: () => ({
      activePartId: 'p1',
      cadPartId: null,
      face: null,
      edges: [],
      contour: { armedId: null, planeId: null },
    }),
    readMode: () => ({
      app: 'cad',
      viewport: 'fillet',
      contour: null,
      fillet: { entry: 'filletEdges', edgeCount: 1 },
      featureEdit: null,
      sheetMetal: null,
    }),
    readDirty: () => ({
      workspaceDirty: true,
      assemblyDirty: false,
      renamePending: false,
      legacyCleanup: false,
      partIds: ['p1'],
    }),
    readToasts: () => ({ toasts: [{ id: 'upload', kind: 'error', message: 'fail' }] }),
    readParts: () => ({ activeId: 'p1', assemblyName: 'Asm', parts: [] }),
    readCamera: () => ({ position: [0, 0, 10], quaternion: null, target: null, zoom: null, fov: 50 }),
  }));

  const tree = await api.call('feature_tree', '{}');
  assert.equal(tree.ok, true);
  assert.equal(tree.result.features[0].id, 'cube1');

  const selection = await api.call('selection', '{}');
  assert.equal(selection.result.activePartId, 'p1');

  const mode = await api.call('mode', '{}');
  assert.equal(mode.result.viewport, 'fillet');

  const dirty = await api.call('dirty', '{}');
  assert.equal(dirty.result.workspaceDirty, true);

  const toasts = await api.call('toasts', '{}');
  assert.equal(toasts.result.toasts[0].message, 'fail');

  const parts = await api.call('parts', '{}');
  assert.equal(parts.result.activeId, 'p1');

  const camera = await api.call('camera', '{}');
  assert.deepEqual(camera.result.position, [0, 0, 10]);
});

test('errors command returns structured rows', () => {
  const out = errorsCommand.run({
    readStructuredErrors: () => [{ code: 'build_failed', message: 'nope' }],
    readErrors: () => ['nope'],
  });
  assert.deepEqual(out.result.errors, [{ code: 'build_failed', message: 'nope' }]);
});
