import assert from 'node:assert/strict';
import test from 'node:test';
import { moldPullCommand } from './moldPull.js';

test('mold_pull forwards auto, a plane, and a face normal', () => {
  const seen = [];
  const ctx = {
    moldPull: (args) => {
      seen.push(args);
      return { mode: args.mode, pull: args.pull || [0, 0, 1], pullSource: args.mode === 'auto' ? 'search' : 'override' };
    },
  };
  const auto = moldPullCommand.run(ctx, { mode: 'auto' });
  assert.equal(auto.result.pullSource, 'search');
  const plane = moldPullCommand.run(ctx, { mode: 'plane', plane: 'front' });
  assert.equal(plane.result.mode, 'plane');
  const face = moldPullCommand.run(ctx, { mode: 'face', normal: [0, 0, 2] });
  assert.deepEqual(face.result.pull, [0, 0, 2]);
  assert.equal(seen[1].plane, 'front');
  assert.equal(moldPullCommand.checkArgs({ mode: 'plane' }).code, 'bad_args');
  assert.equal(moldPullCommand.checkArgs({ mode: 'face', normal: [0, 0, 0] }).code, 'bad_args');
  assert.equal(moldPullCommand.run({}, { mode: 'auto' }).error.code, 'internal');
});
