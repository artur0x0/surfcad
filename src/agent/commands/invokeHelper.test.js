import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfcadBridge } from '../../utils/agentBridge.js';
import { helperCommandName, schemaPropertiesForHelper } from '../helperPaletteAgent.js';
import { HELPER_PALETTE_ITEMS } from '../../utils/helperPaletteSnippets.js';
import { invokeHelperCommand } from './invokeHelper.js';

function host(overrides = {}) {
  return {
    getScript: () => '',
    setEditor: () => {},
    readHistory: () => ({ commits: [], head: -1 }),
    writeHistory: () => {},
    execute: async () => ({ ok: true, errors: [], volume: 1, bbox: null, partName: '' }),
    prepareHelperInsert({ helperId }) {
      if (helperId === 'cube') return { source: 'let part = Manifold.cube([1,1,1], true);\nreturn part;\n' };
      return { error: { code: 'insert_failed', message: 'nope' } };
    },
    ...overrides,
  };
}

test('invoke_helper refuses unknown id', async () => {
  const api = createSurfcadBridge({ resolve: () => host() });
  const env = await api.call('invoke_helper', { id: 'not_a_helper' });
  assert.equal(env.ok, false);
  assert.equal(env.error.code, 'unknown_helper');
});

test('invoke_helper inserts and mutates', async () => {
  let wrote = '';
  const h = host({
    setEditor(src) { wrote = src; },
    prepareHelperInsert() {
      return { source: 'let part = Manifold.cube([10,10,10], true);\nreturn part;\n' };
    },
  });
  const api = createSurfcadBridge({ resolve: () => h });
  const env = await api.call('invoke_helper', { id: 'cube', params: {} });
  assert.equal(env.ok, true);
  assert.equal(env.result?.helperId, 'cube');
  assert.match(wrote, /Manifold\.cube/);
});

test('insert_cube alias is registered', () => {
  assert.equal(helperCommandName('cube'), 'insert_cube');
  assert.equal(invokeHelperCommand.name, 'invoke_helper');
});

test('use_selection is declared only where compose reads the face or edge context', () => {
  // Builds that read faceContext / edgeContext from selectionContextFromArgs.
  // shell and addDraft take a face argument but only use it when scope is
  // 'selected', which their agent enums cannot set.
  const readsContext = new Set([
    'filletEdges', 'chamferEdges', 'crossSection', 'sweepPath',
    'hole', 'holePattern', 'clearanceHole', 'tapDrillHole', 'cboreHole', 'cskHole',
    'cut', 'workplane', 'moveFace', 'deleteFace',
  ]);
  const ignoresContext = new Set([
    'cube', 'roundedBox', 'cylinder', 'sphere', 'tube', 'hexPrism',
    'boolean', 'center', 'align', 'mirror', 'array3D', 'polarArray',
    'shell', 'addDraft',
    'makeExtrude', 'makeRevolve', 'makeSweep', 'makeLoft',
    'codeSnippet', 'patternPoints',
  ]);
  const ids = HELPER_PALETTE_ITEMS.map((item) => item.id);
  assert.deepEqual(
    new Set([...readsContext, ...ignoresContext, 'move']),
    new Set(ids),
    'every palette helper must be classified',
  );
  assert.equal(readsContext.size + ignoresContext.size + 1, ids.length);

  for (const item of HELPER_PALETTE_ITEMS) {
    const props = schemaPropertiesForHelper(item);
    if (item.id === 'move') {
      assert.equal(props.use_selection?.type, 'boolean');
      assert.match(props.use_selection.description, /selected face/);
      assert.match(props.use_selection.description, /body_index/);
    } else if (readsContext.has(item.id)) {
      assert.equal(props.use_selection?.type, 'boolean', item.id);
      assert.equal(typeof props.use_selection.description, 'string', item.id);
      assert.ok(props.use_selection.description.length > 20, item.id);
    } else {
      assert.equal(props.use_selection, undefined, `${item.id} ignores selection context`);
    }
  }

  const byId = (id) => schemaPropertiesForHelper(HELPER_PALETTE_ITEMS.find((row) => row.id === id));
  assert.match(byId('filletEdges').use_selection.description, /selected edges/);
  assert.match(byId('filletEdges').use_selection.description, /convex edge/);
  assert.match(byId('sweepPath').use_selection.description, /selected edges/);
  assert.match(byId('sweepPath').use_selection.description, /refused/);
  assert.match(byId('hole').use_selection.description, /planar or cylindrical/);
  assert.match(byId('cut').use_selection.description, /XY through the origin/);
  assert.match(byId('workplane').use_selection.description, /planar face/);
  assert.match(byId('moveFace').use_selection.description, /face list is empty/);
  assert.match(byId('crossSection').use_selection.description, /\+Z top face/);
  assert.equal(byId('cube').use_selection, undefined);
  assert.equal(byId('shell').use_selection, undefined);
  assert.equal(byId('addDraft').use_selection, undefined);
  assert.equal(byId('makeSweep').use_selection, undefined);
});

test('insert_move with a very large translation fails with the axis and the limit', async () => {
  let executed = 0;
  const api = createSurfcadBridge({
    resolve: () => host({
      async execute() {
        executed += 1;
        return { ok: true, errors: [], volume: 1, bbox: null, partName: '' };
      },
    }),
  });
  // The hard cap is ±1,000,000 mm (bike PR 2); 2,000,000 is beyond it.
  const env = await api.call('insert_move', { dx: 2000000, dy: 0, dz: 0 });
  assert.equal(env.ok, false);
  assert.equal(env.error.code, 'bad_args');
  assert.match(env.error.message, /Move/);
  assert.match(env.error.message, /2000000/);
  assert.match(env.error.message, /1000000/);
  assert.equal(env.error.message.includes('Feature failed'), false);
  assert.equal(executed, 0);
});

test('a refused fillet insert names the missing edge', async () => {
  const api = createSurfcadBridge({
    resolve: () => host({
      prepareHelperInsert() {
        return null;
      },
    }),
  });
  const env = await api.call('insert_fillet_edges', {});
  assert.equal(env.ok, false);
  assert.equal(env.error.code, 'insert_failed');
  assert.match(env.error.message, /Fillet/);
  assert.match(env.error.message, /selected edge/);
  assert.equal(env.error.message.includes('Feature failed'), false);
  assert.equal(env.error.message.includes('check params'), false);
});

test('use_selection with nothing selected is no_selection, not the default face', async () => {
  let prepared = 0;
  let executed = 0;
  const api = createSurfcadBridge({
    resolve: () => host({
      readSelection: () => ({ face: null, edges: [] }),
      readHelperEdgeContext: () => [],
      prepareHelperInsert() {
        prepared += 1;
        return { source: 'let part = Manifold.cube([10,10,10], true);\nreturn part;\n' };
      },
      async execute() {
        executed += 1;
        return { ok: true, errors: [], volume: 1, bbox: null, partName: '' };
      },
    }),
  });
  for (const [name, args] of [
    ['insert_hole', { use_selection: true, size: 'M6' }],
    ['insert_fillet_edges', { use_selection: true, radius: 1 }],
    ['invoke_helper', { id: 'crossSection', use_selection: true }],
  ]) {
    const env = await api.call(name, args);
    assert.equal(env.ok, false, name);
    assert.equal(env.error.code, 'no_selection', name);
    assert.match(env.error.message, /nothing is selected/);
    assert.match(env.error.message, /clear after every rebuild/);
    assert.match(env.error.message, /pick_faces|select_faces/);
  }
  assert.equal(prepared, 0, 'nothing is composed');
  assert.equal(executed, 0, 'nothing is written or run');
});

test('a selected face is used once: usedSelection true, then the rebuild clears it', async () => {
  const top = { type: 'planar', center: [0, 0, 5], normal: [0, 0, 1], area: 100 };
  let selection = { face: top, edges: [] };
  const contexts = [];
  const api = createSurfcadBridge({
    resolve: () => host({
      readSelection: () => selection,
      readHelperEdgeContext: () => [],
      prepareHelperInsert({ faceContext, edgeContext }) {
        contexts.push({ faceContext, edgeContext });
        return { source: 'let part = Manifold.cube([10,10,10], true);\nreturn part;\n' };
      },
      async execute() {
        // The viewport clears stale picks after every successful rebuild.
        selection = { face: null, edges: [] };
        return { ok: true, errors: [], volume: 1, bbox: null, partName: '' };
      },
    }),
  });
  const first = await api.call('insert_hole', { use_selection: true, size: 'M6' });
  assert.equal(first.ok, true);
  assert.equal(first.result.usedSelection, true);
  assert.deepEqual(contexts[0].faceContext, top);

  const second = await api.call('insert_hole', { use_selection: true, size: 'M6' });
  assert.equal(second.ok, false, 'the second insert must not fall back to the default face');
  assert.equal(second.error.code, 'no_selection');
  assert.equal(contexts.length, 1, 'the refused insert composes nothing');
});

test('without use_selection the helper default is used and usedSelection is false', async () => {
  const top = { type: 'planar', center: [0, 0, 5], normal: [0, 0, 1], area: 100 };
  const contexts = [];
  const api = createSurfcadBridge({
    resolve: () => host({
      readSelection: () => ({ face: top, edges: [] }),
      prepareHelperInsert({ faceContext, edgeContext }) {
        contexts.push({ faceContext, edgeContext });
        return { source: 'let part = Manifold.cube([10,10,10], true);\nreturn part;\n' };
      },
    }),
  });
  const env = await api.call('insert_hole', { size: 'M6' });
  assert.equal(env.ok, true);
  assert.equal(env.result.usedSelection, false);
  assert.equal(contexts[0].faceContext, null, 'the selection is not read unless asked for');
  const edges = await api.call('insert_fillet_edges', { radius: 1 });
  assert.equal(edges.ok, true);
  assert.equal(edges.result.usedSelection, false);
});

test('insert_move keeps its own no_body contract and reports usedSelection', async () => {
  const api = createSurfcadBridge({
    resolve: () => host({
      resolveMoveAnchor({ useSelection }) {
        return useSelection ? { at: [1, 2, 3] } : { error: { code: 'no_body', message: 'no body' } };
      },
      prepareHelperInsert() {
        return { source: 'let part = Manifold.cube([10,10,10], true);\nreturn part;\n' };
      },
    }),
  });
  const bySelection = await api.call('insert_move', { use_selection: true, dx: 1 });
  assert.equal(bySelection.ok, true);
  assert.equal(bySelection.result.usedSelection, true);
  const named = await api.call('insert_move', { use_selection: true, body_index: 0, dx: 1 });
  assert.equal(named.ok, true);
  assert.equal(named.result.usedSelection, false, 'a named body wins over the selection');
  const none = await api.call('insert_move', { dx: 1 });
  assert.equal(none.error.code, 'no_body');
});

test('every use_selection description states the single-use rule', () => {
  for (const item of HELPER_PALETTE_ITEMS) {
    const props = schemaPropertiesForHelper(item);
    if (!props.use_selection || item.id === 'move') continue;
    assert.match(props.use_selection.description, /no_selection/, item.id);
    assert.match(props.use_selection.description, /clear after every rebuild/, item.id);
  }
  assert.match(invokeHelperCommand.schema.properties.use_selection.description, /no_selection/);
});
