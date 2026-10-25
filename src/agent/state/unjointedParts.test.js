import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UNJOINTED_PART_HINT,
  placementWarning,
  unjointedPartIds,
  withUnjointedParts,
} from './unjointedParts.js';

const FRAME = '2026-10-07-20-56-31-0423-a3f9';
const WHEEL = '2026-10-07-20-56-31-0423-b4e1';

test('two or more parts with no joint are all unjointed', () => {
  assert.deepEqual(
    unjointedPartIds([{ id: 'frame' }, { id: 'wheel' }], []),
    ['frame', 'wheel'],
  );
});

test('a part named by any joint is omitted', () => {
  const joints = [{ a: { part: 'frame' }, b: { part: 'wheel' } }];
  assert.deepEqual(unjointedPartIds([{ id: 'frame' }, { id: 'wheel' }], joints), []);
});

test('a single part is not an assembly yet', () => {
  assert.deepEqual(unjointedPartIds([{ id: 'frame' }], []), []);
  assert.deepEqual(unjointedPartIds([], [{ a: { part: 'frame' } }]), []);
});

test('a fixed joint grounds the base and leaves the other part unjointed', () => {
  const joints = [{ type: 'fixed', a: { part: 'frame' } }];
  assert.deepEqual(
    unjointedPartIds([{ id: 'frame' }, { id: 'wheel' }, { id: 'seat' }], joints),
    ['wheel', 'seat'],
  );
});

test('joints name the surf id, including when the public row id is a path', () => {
  const parts = [
    { id: 'parts/frame.surf.json', surfId: FRAME },
    { id: 'parts/wheel.surf.json', surfId: WHEEL },
  ];
  const fixed = [{ type: 'fixed', a: { part: FRAME } }];
  assert.deepEqual(unjointedPartIds(parts, fixed), ['parts/wheel.surf.json']);
  const mated = [{ a: { part: FRAME }, b: { part: WHEEL } }];
  assert.deepEqual(unjointedPartIds(parts, mated), []);
});

test('withUnjointedParts reads membership from the document rows, not a second list', () => {
  const state = { activeId: 'parts/wheel.surf.json', parts: [{ id: 'parts/wheel.surf.json' }] };
  const docParts = [
    { id: 'parts/frame.surf.json', surfId: FRAME },
    { id: 'parts/wheel.surf.json', surfId: WHEEL },
  ];
  const out = withUnjointedParts(state, docParts, [{ type: 'fixed', a: { part: FRAME } }]);
  assert.equal(out.activeId, 'parts/wheel.surf.json');
  assert.deepEqual(out.unjointedParts, ['parts/wheel.surf.json']);
});

test('placementWarning fires only for an id in the unjointed list', () => {
  const ctx = {
    readParts: () => ({ parts: [{ id: 'frame' }, { id: 'wheel' }] }),
    readJoints: () => [{ type: 'fixed', a: { part: 'frame' } }],
  };
  assert.equal(placementWarning(ctx, 'frame'), null);
  assert.deepEqual(placementWarning(ctx, 'wheel'), {
    code: 'unjointed_part',
    part_id: 'wheel',
    hint: UNJOINTED_PART_HINT,
  });
  const alone = {
    readParts: () => ({ parts: [{ id: 'frame' }] }),
    readJoints: () => [],
  };
  assert.equal(placementWarning(alone, 'frame'), null);
});
