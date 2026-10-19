import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';

const SCRIPT = `// --- cube begin id=cube1 ---
let part = Manifold.cube([10, 10, 10], true);
// --- cube end ---
// --- fillet-mode begin id=fillet1 ---
part = filletEdges(part, convexEdges(part).slice(0, 2), 1);
// --- fillet-mode end ---
return part;
`;

function host(overrides = {}) {
  let script = SCRIPT;
  let activeChipId = null;
  let rollbackAnchor = null;
  let session = null;
  let draft = {};
  return {
    getScript: () => script,
    setEditor(src) { script = src; },
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory: () => {},
    execute: async () => ({ ok: true, errors: [], volume: 2, bbox: null, partName: '' }),
    readStatus: () => ({ volume: 2, bbox: null, partName: '', featureCount: 2 }),
    readFeatureTree: () => ({
      features: [
        { id: 'cube1', kind: 'cube', index: 0 },
        { id: 'fillet1', kind: 'fillet', index: 1 },
      ],
      rollbackAnchor,
      activeChipId,
    }),
    openFeature({ index }) {
      if (index === 1) {
        session = { id: 'fillet1', kind: 'fillet', index: 1 };
        return { result: { id: 'fillet1', kind: 'fillet', index: 1 } };
      }
      return { error: { code: 'bad_index', message: 'nope' } };
    },
    editFeature({ params }) {
      draft = { ...draft, ...params };
      return { result: { params: draft } };
    },
    prepareFeatureConfirm() {
      if (!session) return { error: { code: 'no_feature_edit', message: 'closed' } };
      const next = script.replace(
        'filletEdges(part, convexEdges(part).slice(0, 2), 1)',
        'filletEdges(part, convexEdges(part).slice(0, 2), 2)',
      );
      return {
        changed: true,
        source: next,
        featureId: 'fillet1',
        message: 'Edit fillet',
      };
    },
    dismissFeatureConfirmSession() {
      session = null;
      draft = {};
    },
    cancelFeature() {
      if (!session) return { error: { code: 'no_feature_edit', message: 'closed' } };
      session = null;
      return { result: { cancelled: true } };
    },
    rollbackTo({ id }) {
      if (id === 'cube1') {
        rollbackAnchor = 'cube1';
        return { result: { rollbackAnchor: 'cube1' } };
      }
      return { error: { code: 'unknown_feature', message: 'bad' } };
    },
    activateFeature({ id }) {
      activeChipId = id;
      return { result: { activeChipId: id } };
    },
    ...overrides,
  };
}

test('open_feature and confirm_feature route through host', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  const open = await api.call('open_feature', { index: 1 });
  assert.equal(open.ok, true);
  assert.equal(open.result.id, 'fillet1');
  const edit = await api.call('edit_feature', { params: { radius: 2 } });
  assert.equal(edit.result.params.radius, 2);
  const confirm = await api.call('confirm_feature', {});
  assert.equal(confirm.ok, true);
  assert.equal(confirm.result.status?.volume, 2);
  const tree = await api.call('feature_tree', '{}');
  assert.equal(tree.ok, true);
});

test('cancel_feature after open_feature', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  await api.call('open_feature', { index: 1 });
  const cancel = await api.call('cancel_feature', {});
  assert.equal(cancel.ok, true);
  assert.equal(cancel.result.cancelled, true);
});

test('rollback_to and activate_feature', async () => {
  const h = host();
  const api = createSurfcadBridge({ resolve: () => h });
  const chip = await api.call('activate_feature', { id: 'cube1' });
  assert.equal(chip.result.activeChipId, 'cube1');
  const rb = await api.call('rollback_to', { id: 'cube1' });
  assert.equal(rb.result.rollbackAnchor, 'cube1');
  const bad = await api.call('open_feature', { index: 99 });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'bad_index');
});

test('an unchanged confirm on a failed part says ok: false with the errors (bike PR 1)', async () => {
  const h = host({
    readStatus: () => ({ volume: null, bbox: null, partName: '', featureCount: 2, runState: 'failed' }),
    readActivePartStatus: () => ({ partId: 'p', partName: '', script: SCRIPT, runState: 'failed', volume: null, bbox: null, featureCount: 2, bodyCount: null }),
    readParts: () => ({ activeId: 'p', assemblyName: 'A', parts: [{ id: 'p', name: 'p', visible: true }] }),
    execute: async () => ({ ok: false, errors: ['move: that point is not a body centroid — re-pick the body'], volume: null, bbox: null, partName: '' }),
    prepareFeatureConfirm() {
      return { changed: false, source: SCRIPT, featureId: 'fillet1', message: 'Edit fillet' };
    },
  });
  const api = createSurfcadBridge({ resolve: () => h });
  await api.call('run', {});
  const confirm = await api.call('confirm_feature', {});
  assert.equal(confirm.ok, true);
  assert.equal(confirm.result.ok, false);
  assert.equal(confirm.result.unchanged, true);
  assert.ok(confirm.result.errors.some((row) => /not a body centroid/.test(row)), JSON.stringify(confirm.result));
});
