/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { metaForCommand, BLEND_COST_NOTE } from './commandMeta.js';

test('fillet and chamfer tool descriptions carry the cost note, other inserts do not', () => {
  for (const name of ['insert_fillet_edges', 'insert_chamfer_edges']) {
    const meta = metaForCommand(name);
    assert.ok(meta.description.includes(BLEND_COST_NOTE.trim()), `${name} lacks the cost note`);
    assert.match(meta.description, /slow features/);
    assert.match(meta.description, /30 s block budget/);
    assert.equal(meta.mutates, true);
    assert.deepEqual(meta.errors, metaForCommand('insert_cube').errors);
  }
  for (const name of ['insert_cube', 'insert_move', 'insert_code_snippet']) {
    assert.ok(!metaForCommand(name).description.includes('slow features'), `${name} should not carry the cost note`);
  }
});

test('the cost note sits before the Writes (defaults) line so the emitted code stays last', () => {
  const desc = metaForCommand('insert_fillet_edges').description;
  const cost = desc.indexOf('Cost: fillets and chamfers');
  const writes = desc.indexOf('Writes (defaults):');
  assert.ok(cost > 0);
  if (writes >= 0) assert.ok(cost < writes, 'Writes line must stay last');
});
