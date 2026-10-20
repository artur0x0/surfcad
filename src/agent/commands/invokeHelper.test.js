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
