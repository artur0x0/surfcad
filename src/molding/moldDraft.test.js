import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePullDirection, analyzeWallOnly, MOLD_REGION_NORMAL_DEG } from './pullDirection.js';
import {
  MOLD_DRAFT_CLUSTER_DEG,
  MOLD_DRAFT_MIN_DEG,
  analyzeMoldDraft,
  draftAngleDeg,
  moldDraftLegendModel,
} from './moldDraft.js';

function boxMesh(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const positions = [
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ];
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    1, 2, 6, 1, 6, 5,
    0, 4, 7, 0, 7, 3,
    3, 7, 6, 3, 6, 2,
    0, 1, 5, 0, 5, 4,
  ];
  return { positions, indices };
}

function appendMesh(dstPos, dstIdx, src, flip) {
  const base = dstPos.length / 3;
  for (let i = 0; i < src.positions.length; i++) dstPos.push(src.positions[i]);
  const indices = src.indices;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] + base;
    const b = indices[t + 1] + base;
    const c = indices[t + 2] + base;
    if (flip) dstIdx.push(a, c, b);
    else dstIdx.push(a, b, c);
  }
}

function uniformShell() {
  const positions = [];
  const indices = [];
  appendMesh(positions, indices, boxMesh([0, 0, 0], [20, 20, 20]), false);
  appendMesh(positions, indices, boxMesh([2, 2, 2], [18, 18, 18]), true);
  return { positions, indices };
}

function withPart(shell, part) {
  const positions = shell.positions.slice();
  const indices = shell.indices.slice();
  appendMesh(positions, indices, part, false);
  return { positions, indices };
}

test('the draft cluster angle matches the undercut region angle', () => {
  assert.equal(MOLD_DRAFT_CLUSTER_DEG, MOLD_REGION_NORMAL_DEG);
  assert.equal(MOLD_DRAFT_MIN_DEG, 1);
});

test('a vertical wall is 0° and a pull-facing face is 90°', () => {
  assert.equal(draftAngleDeg([1, 0, 0], [0, 0, 1]), 0);
  assert.equal(draftAngleDeg([0, 0, 1], [0, 0, 1]), 90);
  assert.equal(draftAngleDeg([0, 0, 0], [0, 0, 1]), null);
  const one = Math.sin((1 * Math.PI) / 180);
  assert.equal(draftAngleDeg([Math.cos((1 * Math.PI) / 180), 0, one], [0, 0, 1]), 1);
});

test('a box flags four vertical walls and no ejectors', () => {
  const result = analyzePullDirection({ ...boxMesh([0, 0, 0], [10, 10, 10]), pull: [0, 0, 1] });
  const draft = result.moldDraft;
  assert.equal(draft.violationCount, 4);
  assert.equal(draft.triangleCount, 8);
  assert.equal(draft.minDraftDeg, 0);
  assert.equal(draft.minDeg, 1);
  assert.equal(draft.ejectors.heuristic, true);
  assert.equal(draft.ejectors.pinCount, 0);
  assert.equal(draft.ejectors.sleeveCount, 0);
  assert.equal(result.fit, 'good');
  const legend = moldDraftLegendModel(draft);
  assert.equal(legend.violations, 4);
  assert.equal(legend.heuristic, true);
  assert.equal(moldDraftLegendModel(null), null);
  const wallOnly = analyzeWallOnly(boxMesh([0, 0, 0], [10, 10, 10]));
  assert.equal(wallOnly.moldDraft, undefined);
});

test('a 3° wall is not a violation and 1° stays clear', () => {
  const tilt = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return {
      t: 0,
      ia: 0,
      ib: 1,
      ic: 2,
      n: [Math.cos(rad), 0, Math.sin(rad)],
      area: 4,
      centroid: [0, 0, 0],
    };
  };
  const three = analyzeMoldDraft([tilt(3)], [0, 0, 1], null);
  assert.equal(three.violationCount, 0);
  const one = analyzeMoldDraft([tilt(1)], [0, 0, 1], null);
  assert.equal(one.violationCount, 0);
  const zero = analyzeMoldDraft([tilt(0)], [0, 0, 1], null);
  assert.equal(zero.violationCount, 1);
  assert.equal(analyzeMoldDraft([], [0, 0, 1]).violationCount, 0);
});

test('a thin rib yields pins and a thick boss yields one sleeve', () => {
  const shell = uniformShell();
  const rib = analyzePullDirection({
    ...withPart(shell, boxMesh([10, 9, 9], [10.8, 11.5, 11.5])),
    pull: [0, 0, 1],
  });
  assert.equal(rib.moldDraft.ejectors.pinCount, 2);
  assert.equal(rib.moldDraft.ejectors.sleeveCount, 0);
  for (const pin of rib.moldDraft.ejectors.pins) {
    assert.ok(pin.center[0] > 9.5 && pin.center[0] < 11.2);
    assert.equal(pin.kind, 'pin');
  }
  const boss = analyzePullDirection({
    ...withPart(shell, boxMesh([8, 8, 8], [12, 16, 12])),
    pull: [0, 0, 1],
  });
  assert.equal(boss.moldDraft.ejectors.sleeveCount, 1);
  assert.equal(boss.moldDraft.ejectors.pinCount, 0);
  const sleeve = boss.moldDraft.ejectors.sleeves[0];
  assert.equal(sleeve.kind, 'sleeve');
  assert.ok(Math.abs(sleeve.center[2] - 8) < 0.5);
  const plain = analyzePullDirection({ ...shell, pull: [0, 0, 1] });
  assert.equal(plain.moldDraft.ejectors.pinCount, 0);
  assert.equal(plain.moldDraft.ejectors.sleeveCount, 0);
  assert.equal(plain.moldDraft.violationCount, 8);
});
