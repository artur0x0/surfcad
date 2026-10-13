import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptBaseEdit,
  deleteDraftFeature,
  editSheetChip,
  sheetDraftExtraCount,
} from './sheetMetalMode.js';

const spec = {
  bends: [
    { id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 20 },
    { id: 'b2', panel: 'b1', edge: 'u+', angle: 90, length: 15 },
  ],
  tabs: [{ id: 't1', panel: 'b2', edge: 'u+' }],
  holes: [
    { id: 'h1', panel: 'b1' },
    { id: 'h2', panel: 'base' },
  ],
};

test('a bend delete counts child bends, tabs, and holes, not itself', () => {
  const editing = { spec, draft: { kind: 'bend', id: 'b1', isNew: false, panel: 'base' } };
  assert.equal(sheetDraftExtraCount(editing), 3);
  assert.equal(sheetDraftExtraCount({
    spec,
    draft: { kind: 'bend', id: 'b1', isNew: true, panel: 'base' },
  }), 0);
  assert.equal(sheetDraftExtraCount({
    spec,
    draft: { kind: 'hole', id: 'h1', isNew: false },
  }), 0);
  assert.equal(sheetDraftExtraCount({
    spec,
    draft: { kind: 'tab', id: 't1', isNew: false },
  }), 0);
  assert.equal(sheetDraftExtraCount({
    spec,
    draft: { kind: 'bend', id: 'b2', isNew: false, panel: 'b1' },
  }), 1);
});

test('a base delete counts every bend, tab, and hole', () => {
  assert.equal(sheetDraftExtraCount({
    spec,
    draft: { kind: 'base', id: 'base', isNew: false },
  }), 5);
});

test('a contour ref is not a sheet delete user', () => {
  const editing = {
    spec,
    script: "contour({ refKey: 'wall:b2:u+:w0' })",
    draft: { kind: 'bend', id: 'b2', isNew: false, panel: 'b1' },
  };
  assert.equal(sheetDraftExtraCount(editing), 1);
  assert.equal(sheetDraftExtraCount(editing), sheetDraftExtraCount({ spec, draft: editing.draft }));
});

test('a grouped bend delete drops every member and its children', () => {
  const grouped = {
    bends: [
      { id: 'b1', feature: 'lip', panel: 'base', edge: 'u+' },
      { id: 'b2', feature: 'lip', panel: 'base', edge: 'u-' },
      { id: 'b3', panel: 'b1', edge: 'u+' },
    ],
    tabs: [{ id: 't1', panel: 'b2', edge: 'u+' }],
    holes: [{ id: 'h1', panel: 'b1' }],
  };
  const mode = {
    stage: 'edit',
    spec: grouped,
    draft: { kind: 'bend', id: 'b1', isNew: false, memberIds: ['b1', 'b2'], panel: 'base' },
  };
  assert.equal(sheetDraftExtraCount(mode), 3);
  const { spec, removeBlock } = deleteDraftFeature(mode);
  assert.equal(removeBlock, false);
  assert.deepEqual(spec.bends, []);
  assert.deepEqual(spec.tabs, []);
  assert.deepEqual(spec.holes, []);
});

test('base edit keeps bends and base delete removes the block', () => {
  const mode = {
    stage: 'edit',
    spec: { ...spec, plane: 'XY', width: 100, height: 60 },
    draft: { kind: 'base', id: 'base', isNew: false, plane: 'XY', width: 120, height: 80 },
  };
  const edited = acceptBaseEdit(mode);
  assert.equal(edited.spec.width, 120);
  assert.equal(edited.spec.bends.length, 2);
  assert.equal(edited.spec.tabs.length, 1);
  const full = { ...spec, plane: 'XY', width: 100, height: 60 };
  const opened = editSheetChip({ stage: 'edit', spec: full }, { sheet: true, sheetKind: 'base', memberIds: ['base'] });
  assert.equal(opened.stage, 'edit');
  assert.equal(opened.draft.kind, 'base');
  assert.equal(opened.draft.width, 100);
  const removed = deleteDraftFeature(opened);
  assert.equal(removed.removeBlock, true);
  assert.equal(removed.spec, null);
  assert.equal(removed.mode.spec, null);
});
