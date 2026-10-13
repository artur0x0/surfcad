import assert from 'node:assert/strict';
import test from 'node:test';
import { createSheetSpec, sheetFreeEdges } from './sheetModel.js';
import { sheetContourEdges } from './sheetContourEdges.js';
import {
  acceptBaseEdit,
  acceptDraft,
  bendBlockReason,
  deleteDraftFeature,
  editSheetChip,
  sheetDoneSpec,
  sheetDraftExtraCount,
  sheetTap,
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

const stock = {
  sku: 'T',
  name: 'T',
  thicknessMm: 1.5,
  bendable: true,
  services: ['bending'],
  bend: { radiusIn: 0.05, kFactor: 0.44, maxAngleDeg: 180, minFlangeIn: 0.25 },
};

function editMode(spec, tool = 'bend') {
  return { stage: 'edit', spec, tool };
}

test('two edges confirm as one feature and one spec', () => {
  const spec = createSheetSpec(stock, 'XY', { width: 100, height: 60 });
  let mode = sheetTap(editMode(spec), { kind: 'edge', panel: 'base', edge: 'u+' });
  mode = sheetTap(mode, { kind: 'edge', panel: 'base', edge: 'u-' });
  assert.equal(mode.draft.edges.length, 2);
  assert.equal(mode.draft.feature, 'f1');
  assert.equal(bendBlockReason(mode), null);
  const committed = acceptDraft(mode);
  assert.equal(committed.spec.bends.length, 2);
  assert.equal(committed.spec.bends[0].feature, committed.spec.bends[1].feature);
  assert.notEqual(committed.spec.bends[0].id, committed.spec.bends[1].id);
  const keys = (sheetContourEdges(committed.spec)?.edges || []).map((edge) => edge.refKey);
  for (const row of committed.spec.bends) {
    assert.equal(keys.some((key) => key.startsWith(`bend:${row.id}:`) || key.startsWith(`wall:${row.id}:`)), true);
  }
  const again = sheetTap(editMode(committed.spec), { kind: 'edge', panel: 'base', edge: 'v+' });
  assert.equal(again.draft.edges, undefined);
  assert.equal(again.draft.feature, undefined);
});

test('a second tap on the same edge drops it, and an ineligible edge stays out', () => {
  const spec = createSheetSpec(stock, 'XY', { width: 100, height: 60 });
  let mode = sheetTap(editMode(spec), { kind: 'edge', panel: 'base', edge: 'u+' });
  const id = mode.draft.id;
  mode = sheetTap(mode, { kind: 'edge', panel: 'base', edge: 'u+' });
  assert.equal(mode.draft, null);
  mode = sheetTap(editMode(spec), { kind: 'edge', panel: 'base', edge: 'u+' });
  mode = sheetTap(mode, { kind: 'edge', panel: 'base', edge: 'u-' });
  mode = sheetTap(mode, { kind: 'edge', panel: 'base', edge: 'u-' });
  assert.equal(mode.draft.edges, undefined);
  assert.equal(mode.draft.id, id);
  const walled = {
    ...spec,
    bends: [
      { id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 20, flip: false },
      { id: 'b2', panel: 'base', edge: 'v+', angle: 90, length: 20, flip: false },
    ],
  };
  const toward = sheetFreeEdges(walled).find((edge) => edge.panel === 'b1' && edge.edge === 'v+');
  assert.equal(toward?.eligible, false);
  const blocked = sheetTap(editMode(walled), { kind: 'edge', panel: 'b1', edge: 'v+' });
  assert.equal(blocked.draft, undefined);
});

test('a flange tip and side together disable Confirm', () => {
  const spec = {
    ...createSheetSpec(stock, 'XY', { width: 100, height: 60 }),
    bends: [{ id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 25, flip: false }],
  };
  let mode = sheetTap(editMode(spec), { kind: 'edge', panel: 'b1', edge: 'u+' });
  mode = sheetTap(mode, { kind: 'edge', panel: 'b1', edge: 'v-' });
  assert.equal(mode.draft.edges.length, 2);
  const reason = bendBlockReason(mode);
  assert.equal(typeof reason, 'string');
  assert.equal(reason.length > 0, true);
  const refused = acceptDraft(mode);
  assert.equal(refused.spec, null);
  assert.equal(refused.mode.draft.edges.length, 2);
});

test('two tabs are one feature', () => {
  const spec = createSheetSpec(stock, 'XY', { width: 100, height: 60 });
  let mode = sheetTap(editMode(spec, 'tab'), { kind: 'edge', panel: 'base', edge: 'u+' }, 100);
  mode = sheetTap(mode, { kind: 'edge', panel: 'base', edge: 'v+' }, 100);
  assert.equal(mode.draft.kind, 'tab');
  assert.equal(mode.draft.edges.length, 2);
  const committed = acceptDraft(mode);
  assert.equal(committed.spec.tabs.length, 2);
  assert.equal(committed.spec.tabs[0].feature, committed.spec.tabs[1].feature);
  assert.equal(committed.spec.bends.length, 0);
});

test('Done writes only when the open spec differs and leaves the step stack', () => {
  const saved = {
    ...createSheetSpec(stock, 'XY', { width: 80, height: 50 }),
    bends: [{ id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 20, flip: false }],
  };
  const mode = { stage: 'edit', spec: saved, step: 2, reopen: true };
  const same = sheetDoneSpec(mode, saved);
  assert.equal(same.close, true);
  assert.equal(same.write, false);
  const next = {
    ...mode,
    spec: {
      ...saved,
      bends: [...saved.bends, { id: 'b2', panel: 'base', edge: 'u-', angle: 90, length: 18, flip: false }],
    },
  };
  const diff = sheetDoneSpec(next, saved);
  assert.equal(diff.write, true);
  assert.equal(diff.spec.bends.length, 2);
  assert.equal(next.step, 2);
  assert.equal(sheetDoneSpec({ ...mode, draft: { kind: 'bend' } }, saved).close, false);
  assert.equal(sheetDoneSpec({ ...mode, exportOpen: true }, saved).close, false);
  assert.deepEqual(sheetDoneSpec({ stage: 'edit', spec: null }, null), { close: true, write: false, spec: null });
});
