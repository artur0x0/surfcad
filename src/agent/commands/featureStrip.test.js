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

// A saved contour reopens in the contour sketch (MVP-2 step 8, bike M7):
// edit_feature patches that sketch, confirm_feature saves and closes it,
// cancel_feature closes it, and nothing is left open behind the agent.
const CONTOUR_SCRIPT = `// --- cube begin id=cube1 ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
const c1 = makeCrossSection({ center: [0, 0, 10], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, profileRectangle(30, 20, true)); // @contour id=c1
return part;
`;

function contourHost(overrides = {}) {
  let script = CONTOUR_SCRIPT;
  let session = null;
  let sketch = null;
  const calls = [];
  const h = {
    calls,
    getScript: () => script,
    setEditor(src) { script = src; },
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory: () => {},
    execute: async () => ({ ok: true, errors: [], volume: 2, bbox: null, partName: '' }),
    readStatus: () => ({ volume: 2, bbox: null, partName: '', featureCount: 2 }),
    readMode: () => ({ app: 'cad', viewport: sketch ? 'contour' : 'idle', contour: sketch, fillet: null, featureEdit: null, sheetMetal: null }),
    readFeatureTree: () => ({
      features: [
        { id: 'cube1', kind: 'cube', index: 0 },
        { id: 'contour:c1', kind: 'contour', index: 1 },
      ],
      rollbackAnchor: null,
      activeChipId: null,
    }),
    openFeature({ id }) {
      if (id !== 'contour:c1') return { error: { code: 'unknown_feature', message: 'nope' } };
      session = { id, kind: 'contour', index: 1, contourId: 'c1' };
      sketch = { entry: 'crossSection', tool: 'rectangle', contourId: 'c1', params: { width: 30, height: 20, centered: true } };
      return { result: { id, kind: 'contour', index: 1, contourId: 'c1', sketchOpen: true } };
    },
    readFeatureSession: () => ({
      open: !!session,
      id: session?.id ?? null,
      kind: session?.kind ?? null,
      index: session?.index ?? null,
      contourId: session?.contourId ?? null,
      sketchOpen: !!(session?.contourId && sketch),
      tool: sketch?.tool ?? null,
    }),
    editFeature({ params }) {
      calls.push(['editFeature', params]);
      return { result: { params } };
    },
    sketchAdd({ tool, params }) {
      calls.push(['sketchAdd', { tool, params }]);
      if (!sketch) return { error: { code: 'no_sketch', message: 'closed' } };
      sketch = { ...sketch, tool, params: { ...sketch.params, ...params } };
      return { result: { tool } };
    },
    prepareSketchCommit() {
      calls.push(['prepareSketchCommit']);
      if (!sketch) return { error: { code: 'no_sketch', message: 'closed' } };
      return { payload: { partId: 'p', tool: sketch.tool, params: sketch.params, entry: 'crossSection', contourId: 'c1' } };
    },
    prepareContourMutate(payload) {
      calls.push(['prepareContourMutate', payload]);
      const profile = payload.tool === 'rectangle'
        ? `profileRectangle(${payload.params.width}, ${payload.params.height}, true)`
        : `profilePolygon([${payload.params.points.map((p) => `[${p[0]}, ${p[1]}]`).join(', ')}])`;
      const next = script.replace(/makeCrossSection\(([^;]*?), (profile\w+\([^;]*\))\); \/\/ @contour id=c1/, `makeCrossSection($1, ${profile}); // @contour id=c1`);
      return { changed: next !== script, source: next, message: 'Contour c1', finish: { payload } };
    },
    applyContourMutateExtras() {},
    finishContourCommit() { calls.push(['finishContourCommit']); sketch = null; },
    sketchCancel() { calls.push(['sketchCancel']); sketch = null; return { result: { ok: true } }; },
    prepareFeatureConfirm() {
      calls.push(['prepareFeatureConfirm']);
      return { error: { code: 'no_feature_edit', message: 'No feature edit session is open' } };
    },
    dismissFeatureConfirmSession() { calls.push(['dismiss']); session = null; },
    cancelFeature() {
      if (!session) return { error: { code: 'no_feature_edit', message: 'closed' } };
      session = null;
      return { result: { cancelled: true } };
    },
    ...overrides,
  };
  return h;
}

test('a reopened contour: edit_feature patches the sketch and confirm_feature saves and closes it', async () => {
  const h = contourHost();
  const api = createSurfcadBridge({ resolve: () => h });
  const open = await api.call('open_feature', { id: 'contour:c1' });
  assert.equal(open.ok, true);
  assert.equal(open.result.sketchOpen, true);
  assert.equal(open.result.contourId, 'c1');

  const edit = await api.call('edit_feature', { params: { width: 44 } });
  assert.equal(edit.ok, true, JSON.stringify(edit));
  assert.deepEqual(edit.result.sketch, { tool: 'rectangle', params: { width: 44 } });
  assert.equal(edit.result.contourId, 'c1');
  assert.equal(edit.result.ignored, undefined);
  const added = h.calls.find((row) => row[0] === 'sketchAdd');
  assert.deepEqual(added[1], { tool: 'rectangle', params: { width: 44 } });

  const confirm = await api.call('confirm_feature', {});
  assert.equal(confirm.ok, true, JSON.stringify(confirm));
  assert.equal(confirm.result.ok, true);
  assert.equal(confirm.result.sketchClosed, true);
  assert.equal(confirm.result.id, 'contour:c1');
  assert.equal(confirm.result.unchanged, false);
  assert.match(h.getScript(), /profileRectangle\(44, 20, true\)\); \/\/ @contour id=c1/);
  assert.equal((h.getScript().match(/@contour id=/g) || []).length, 1);
  assert.equal(h.readFeatureSession().sketchOpen, false, 'sketch closed');
  assert.equal(h.readFeatureSession().open, false, 'session closed');
  assert.ok(!h.calls.some((row) => row[0] === 'prepareFeatureConfirm'), 'the card confirm path is not used for a contour');
});

test('a reopened contour: points replace the profile and drop a solved sketch', async () => {
  const h = contourHost();
  const api = createSurfcadBridge({ resolve: () => h });
  await api.call('open_feature', { id: 'contour:c1' });
  const edit = await api.call('edit_feature', { params: { points: [[0, 0], [20, 0], [10, 15]], distance: 5 } });
  assert.equal(edit.ok, true, JSON.stringify(edit));
  assert.equal(edit.result.sketch.tool, 'polyline');
  assert.deepEqual(edit.result.sketch.params, { points: [[0, 0], [20, 0], [10, 15]], contour: null });
  assert.deepEqual(edit.result.ignored, ['distance']);
  assert.match(edit.result.hint, /profile params/);
  const confirm = await api.call('confirm_feature', {});
  assert.equal(confirm.ok, true, JSON.stringify(confirm));
  assert.match(h.getScript(), /profilePolygon\(\[\[0, 0\], \[20, 0\], \[10, 15\]\]\)\); \/\/ @contour id=c1/);
  assert.equal(h.readFeatureSession().sketchOpen, false);
});

test('a reopened contour: a bad edit is refused with the hint and the sketch stays open for the next edit', async () => {
  const h = contourHost();
  const api = createSurfcadBridge({ resolve: () => h });
  await api.call('open_feature', { id: 'contour:c1' });
  const bad = await api.call('edit_feature', { params: { distance: 5 } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'bad_args');
  assert.match(bad.error.message, /points \[\[u, v\]/);
  assert.equal(h.readFeatureSession().sketchOpen, true);
  const fewPoints = await api.call('edit_feature', { params: { points: [[0, 0], [1, 1]] } });
  assert.equal(fewPoints.error.code, 'bad_args');
  const cancel = await api.call('cancel_feature', {});
  assert.equal(cancel.ok, true);
  assert.equal(cancel.result.cancelled, true);
  assert.equal(cancel.result.sketchClosed, true);
  assert.equal(h.readFeatureSession().sketchOpen, false);
  assert.equal(h.readFeatureSession().open, false);
});

test('a reopened contour: a profile the sketch cannot save is an error and the sketch is closed', async () => {
  const h = contourHost({
    prepareSketchCommit() {
      return { error: { code: 'invalid_profile', message: 'Rectangle width must be positive' } };
    },
  });
  const api = createSurfcadBridge({ resolve: () => h });
  await api.call('open_feature', { id: 'contour:c1' });
  await api.call('edit_feature', { params: { width: -1 } });
  const confirm = await api.call('confirm_feature', {});
  assert.equal(confirm.ok, false);
  assert.equal(confirm.error.code, 'invalid_profile');
  assert.match(confirm.error.message, /closed without saving/);
  assert.ok(h.calls.some((row) => row[0] === 'sketchCancel'));
  assert.equal(h.readFeatureSession().sketchOpen, false);
  assert.equal(h.readFeatureSession().open, false);
});

test('contourSketchPatch infers the tool from the keys and patches only what was sent', async () => {
  const { contourSketchPatch } = await import('./featureStrip.js');
  assert.deepEqual(contourSketchPatch({ radius: 7 }, 'circle'), { tool: 'circle', params: { radius: 7 }, ignored: [] });
  assert.deepEqual(contourSketchPatch({ radius: 7 }, 'polygon'), { tool: 'polygon', params: { radius: 7 }, ignored: [] });
  assert.deepEqual(contourSketchPatch({ height: 9 }, 'rectangle'), { tool: 'rectangle', params: { height: 9 }, ignored: [] });
  assert.deepEqual(contourSketchPatch({ tool: 'circle' }, 'rectangle'), { tool: 'circle', params: {}, ignored: [] });
  assert.equal(contourSketchPatch({ tool: 'spline' }, 'rectangle').error.code, 'bad_args');
  assert.equal(contourSketchPatch({}, 'rectangle').error.code, 'bad_args');
});
