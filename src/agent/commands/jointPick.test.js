import assert from 'node:assert/strict';
import test from 'node:test';
import { v1Registry } from './index.js';

const pick = v1Registry.get('joint_pick');

test('joint_pick with part_id alone is a whole-part pick; kind part takes no geometry (bike joints 3)', () => {
  assert.equal(pick.checkArgs({ part_id: 'p1' }), null);
  assert.equal(pick.checkArgs({ part_id: 'p1', kind: 'part' }), null);
  assert.equal(pick.checkArgs({ picks: [{ part_id: 'p1' }, { part_id: 'p2', face_id: 'f1' }] }), null);
  assert.match(pick.checkArgs({ part_id: 'p1', kind: 'part', face_id: 'f1' }).message, /takes no face_id/);
  assert.match(pick.checkArgs({}).message, /needs part_id/);
  assert.match(pick.checkArgs({ picks: [{ face_id: 'f1' }] }).message, /needs part_id/);
  assert.ok(pick.schema.properties.kind.enum.includes('part'));

  const seen = [];
  const ctx = { jointApplyPicks: (args) => { seen.push(args); return { result: { picked: ['p1'], count: 1 } }; } };
  const out = pick.run(ctx, { part_id: 'p1' });
  assert.deepEqual(out, { result: { picked: ['p1'], count: 1 } });
  assert.deepEqual(seen[0], { picks: [{ part_id: 'p1' }] });
  pick.run(ctx, { part_id: 'p1', kind: 'part' });
  assert.deepEqual(seen[1], { picks: [{ part_id: 'p1', kind: 'part' }] });
});
