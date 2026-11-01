import assert from 'node:assert/strict';
import test from 'node:test';
import { moldSideActionsCommand } from './moldSideActions.js';

test('mold_side_actions aliases mold_parting and returns the same counts', () => {
  const seen = [];
  const ctx = {
    moldParting: (args) => {
      seen.push(args);
      return {
        on: true,
        sideActions: {
          count: 2,
          slides: 1,
          lifters: 1,
          groups: [{ id: 0, kind: 'slide', pull: [1, 0, 0], area: 4 }],
          selected: null,
        },
      };
    },
  };
  const out = moldSideActionsCommand.run(ctx, { on: true });
  assert.deepEqual(seen, [{ on: true, group: undefined }]);
  assert.equal(out.result.replacedBy, 'mold_parting');
  assert.equal(out.result.on, true);
  assert.equal(out.result.count, 2);
  assert.equal(out.result.slides, 1);
  assert.equal(out.result.lifters, 1);
  assert.equal(out.result.groups.length, 1);
  assert.equal(out.error, undefined);
});

test('mold_side_actions on false names mold_parting and does not hide the split', () => {
  let called = false;
  const ctx = {
    moldParting: () => {
      called = true;
      return { on: false };
    },
  };
  const hidden = moldSideActionsCommand.run(ctx, { on: false });
  assert.equal(called, false);
  assert.equal(hidden.result.on, false);
  assert.equal(hidden.result.replacedBy, 'mold_parting');
  assert.match(hidden.result.message, /mold_parting/);
  const opened = moldSideActionsCommand.run(ctx, {});
  assert.equal(called, true);
  assert.equal(opened.result.on, true);
  assert.equal(opened.result.replacedBy, 'mold_parting');
  const missing = moldSideActionsCommand.run({}, { on: true });
  assert.equal(missing.error.code, 'internal');
  assert.match(missing.error.message, /mold_parting/);
});
