import assert from 'node:assert/strict';
import test from 'node:test';
import { sheetDraftExtraCount } from './sheetMetalMode.js';

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
