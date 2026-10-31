import assert from 'node:assert/strict';
import test from 'node:test';
import { moldFitCommand } from './moldFit.js';

test('mold_fit forwards the part and the override pull', () => {
  const seen = [];
  const ctx = {
    moldFit(args) {
      seen.push(args);
      return {
        partId: 'p1',
        frame: 'local',
        fit: 'fixable',
        undercutCount: 2,
        pull: [0, 1, 0],
        pullSource: 'search',
      };
    },
  };
  const searched = moldFitCommand.run(ctx, {});
  assert.equal(searched.result.fit, 'fixable');
  assert.deepEqual(seen[0], { partId: undefined, pull: undefined });
  const overridden = moldFitCommand.run(ctx, { part_id: 'p1', pull: [0, 0, 1] });
  assert.deepEqual(seen[1], { partId: 'p1', pull: [0, 0, 1] });
  assert.equal(overridden.result.partId, 'p1');
});

test('mold_fit rejects a bad pull and a missing handler', () => {
  const bad = moldFitCommand.checkArgs({ pull: [1, 0] });
  assert.equal(bad.code, 'bad_args');
  assert.equal(moldFitCommand.checkArgs({ pull: [0, 0, 0] }).code, 'bad_args');
  assert.equal(moldFitCommand.checkArgs({}), null);
  const missing = moldFitCommand.run({}, {});
  assert.equal(missing.error.code, 'internal');
  const noMesh = moldFitCommand.run({ moldFit: () => ({ error: { code: 'no_mesh', message: 'No mesh for that part' } }) }, {});
  assert.equal(noMesh.error.code, 'no_mesh');
});
