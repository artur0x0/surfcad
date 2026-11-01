import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePullDirection, analyzeWallOnly, MOLD_REGION_NORMAL_DEG } from './pullDirection.js';
import {
  MOLD_DRAFT_CLUSTER_DEG,
  MOLD_DRAFT_MIN_DEG,
  MOLD_DRAFT_PRESETS,
  analyzeMoldDraft,
  classifyMoldDraft,
  draftAngleDeg,
  moldDraftLegendModel,
  parseDraftThreshold,
  signedDraftDeg,
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
  assert.deepEqual(MOLD_DRAFT_PRESETS, [0.5, 1, 2, 3, 5]);
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
  assert.equal(draft.positiveAbove.count, 0);
  assert.equal(draft.positiveBelow.count, 4);
  assert.equal(draft.positiveBelow.area, 400);
  assert.equal(draft.negative.count, 0);
  assert.equal(draft.ejectors.heuristic, true);
  assert.equal(draft.ejectors.pinCount, 0);
  assert.equal(draft.ejectors.sleeveCount, 0);
  assert.equal(result.fit, 'good');
  const legend = moldDraftLegendModel(draft);
  assert.equal(legend.violations, 4);
  assert.equal(legend.positiveBelow.count, 4);
  assert.equal(legend.positiveBelow.area, 400);
  assert.equal(legend.negative.area, 0);
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
  assert.equal(three.positiveAbove.count, 1);
  assert.equal(three.negative.count, 0);
  assert.equal(three.minDraftDeg, 3);
  const one = analyzeMoldDraft([tilt(1)], [0, 0, 1], null);
  assert.equal(one.violationCount, 0);
  assert.equal(one.positiveAbove.count, 1);
  assert.equal(one.positiveBelow.count, 0);
  const zero = analyzeMoldDraft([tilt(0)], [0, 0, 1], null);
  assert.equal(zero.violationCount, 1);
  assert.equal(zero.positiveBelow.count, 1);
  assert.equal(zero.negative.count, 0);
  assert.equal(zero.minDraftDeg, 0);
  const wider = classifyMoldDraft(three, 5);
  assert.equal(wider.samples, three.samples);
  assert.equal(wider.positiveAbove.count, 0);
  assert.equal(wider.positiveBelow.count, 1);
  assert.equal(wider.negative.count, 0);
  assert.equal(analyzeMoldDraft([], [0, 0, 1]).violationCount, 0);
  assert.equal(parseDraftThreshold(undefined).threshold, null);
  assert.equal(parseDraftThreshold(2).threshold, 2);
  assert.equal(parseDraftThreshold(0).error.code, 'bad_args');
  assert.equal(parseDraftThreshold(90).threshold, 90);
  assert.equal(parseDraftThreshold(91).error.code, 'bad_args');
  assert.equal(signedDraftDeg([1, 0, 0], [0, 0, 1], [5, 0, 0], [0, 0, 0]), 0);
});

test('a thin rib yields pins and a thick boss yields one sleeve', () => {
  const shell = uniformShell();
  const rib = analyzePullDirection({
    ...withPart(shell, boxMesh([10, 9, 9], [10.8, 11.5, 11.5])),
    pull: [0, 0, 1],
  });
  // The whole rib is the 0.8 mm wall, including the ends, so both side pairs are thin.
  assert.equal(rib.moldDraft.ejectors.pinCount, 4);
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
  assert.equal(plain.moldDraft.positiveBelow.count, 8);
  assert.equal(plain.moldDraft.negative.count, 0);
});

function addLoop(positions, loop, z) {
  const base = positions.length / 3;
  for (const [x, y] of loop) positions.push(x, y, z);
  return base;
}

function capLoop(indices, base, n, up) {
  for (let i = 1; i < n - 1; i++) {
    if (up) indices.push(base, base + i, base + i + 1);
    else indices.push(base, base + i + 1, base + i);
  }
}

function wallLoop(indices, bottom, top, n, out) {
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (out) indices.push(bottom + i, bottom + j, top + j, bottom + i, top + j, top + i);
    else indices.push(bottom + i, top + j, bottom + j, bottom + i, top + i, top + j);
  }
}

function annulus(indices, outer, inner, n, up) {
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (up) indices.push(outer + i, outer + j, inner + j, outer + i, inner + j, inner + i);
    else indices.push(outer + i, inner + j, outer + j, outer + i, inner + i, inner + j);
  }
}

function addShelf(positions, indices, x0, x1, y0, y1, z) {
  const base = positions.length / 3;
  positions.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
  indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

function openTray() {
  const wall = 1.85;
  const height = 8;
  const outer = [
    [3, 0], [17, 0], [20, 3], [20, 13], [17, 16], [3, 16], [0, 13], [0, 3],
  ];
  const inner = [
    [3, wall], [17, wall], [20 - wall, 3], [20 - wall, 13],
    [17, 16 - wall], [3, 16 - wall], [wall, 13], [wall, 3],
  ];
  const positions = [];
  const indices = [];
  const n = outer.length;
  const bottom = addLoop(positions, outer, 0);
  const floor = addLoop(positions, inner, wall);
  const rimOut = addLoop(positions, outer, height);
  const rimIn = addLoop(positions, inner, height);
  capLoop(indices, bottom, n, false);
  capLoop(indices, floor, n, true);
  wallLoop(indices, bottom, rimOut, n, true);
  wallLoop(indices, floor, rimIn, n, false);
  annulus(indices, rimOut, rimIn, n, true);
  return { positions, indices };
}

function taperedCup(openUp) {
  const positions = [];
  const indices = [];
  const wide = [[0, 0], [14, 0], [14, 14], [0, 14]];
  const narrow = [[1, 1], [13, 1], [13, 13], [1, 13]];
  const holeWide = [[1.5, 1.5], [12.5, 1.5], [12.5, 12.5], [1.5, 12.5]];
  const holeNarrow = [[2.5, 2.5], [11.5, 2.5], [11.5, 11.5], [2.5, 11.5]];
  const outerBottom = openUp ? narrow : wide;
  const outerTop = openUp ? wide : narrow;
  const innerBottom = openUp ? holeNarrow : holeWide;
  const innerTop = openUp ? holeWide : holeNarrow;
  const n = 4;
  const ob = addLoop(positions, outerBottom, 0);
  const ib = addLoop(positions, innerBottom, 1.5);
  const ot = addLoop(positions, outerTop, 12);
  const it = addLoop(positions, innerTop, 12);
  capLoop(indices, ob, n, false);
  capLoop(indices, ib, n, true);
  wallLoop(indices, ob, ot, n, true);
  wallLoop(indices, ib, it, n, false);
  annulus(indices, ot, it, n, true);
  return { positions, indices };
}

function throughHole() {
  const positions = [];
  const indices = [];
  const outer = [[0, 0], [20, 0], [20, 16], [0, 16]];
  const inner = [[6, 4], [14, 4], [14, 12], [6, 12]];
  const n = 4;
  const ob = addLoop(positions, outer, 0);
  const ib = addLoop(positions, inner, 0);
  const ot = addLoop(positions, outer, 12);
  const it = addLoop(positions, inner, 12);
  annulus(indices, ob, ib, n, false);
  annulus(indices, ot, it, n, true);
  wallLoop(indices, ob, ot, n, true);
  wallLoop(indices, ib, it, n, false);
  return { positions, indices };
}

function snapHook() {
  const positions = [];
  const indices = [];
  appendMesh(positions, indices, boxMesh([0, 0, 0], [2, 10, 12]), false);
  appendMesh(positions, indices, boxMesh([2, 3, 8], [8, 7, 10]), false);
  addShelf(positions, indices, 6, 8, 3, 7, 6);
  return { positions, indices };
}

function draftOf(mesh) {
  return analyzePullDirection({ ...mesh, pull: [0, 0, 1] }).moldDraft;
}

test('a plate, a tray, a snap hook, and a through hole are positive and below 1°', () => {
  const plate = draftOf(boxMesh([0, 0, 0], [20, 20, 2]));
  assert.equal(plate.positiveAbove.count, 0);
  assert.equal(plate.positiveBelow.count, 4);
  assert.equal(plate.positiveBelow.area, 160);
  assert.equal(plate.negative.count, 0);
  assert.equal(plate.minDraftDeg, 0);

  const tray = draftOf(openTray());
  assert.equal(tray.positiveAbove.count, 0);
  assert.ok(tray.positiveBelow.count > 0);
  assert.ok(tray.positiveBelow.area > 0);
  assert.equal(tray.negative.count, 0);

  const hook = draftOf(snapHook());
  assert.equal(hook.positiveAbove.count, 0);
  assert.ok(hook.positiveBelow.count > 0);
  assert.equal(hook.negative.count, 0);
  assert.equal(hook.negative.area, 0);

  const hole = draftOf(throughHole());
  assert.equal(hole.positiveAbove.count, 0);
  assert.equal(hole.positiveBelow.count, 8);
  assert.equal(hole.negative.count, 0);
  assert.ok(Math.abs(hole.positiveBelow.area - 1248) < 1e-3);
});

test('a drafted cup is positive above 1° and an inverted cup is back-draft', () => {
  const cup = draftOf(taperedCup(true));
  assert.equal(cup.negative.count, 0);
  assert.equal(cup.negative.area, 0);
  assert.equal(cup.positiveBelow.count, 0);
  assert.ok(cup.positiveAbove.count > 0);
  assert.ok(cup.positiveAbove.area > 0);
  assert.ok(cup.minDraftDeg > 4 && cup.minDraftDeg < 5);

  const split = classifyMoldDraft(cup, 5);
  assert.equal(split.samples, cup.samples);
  assert.equal(split.negative.count, 0);
  assert.ok(split.positiveAbove.count > 0);
  assert.ok(split.positiveBelow.count > 0);
  assert.ok(split.positiveAbove.area > 0);
  assert.ok(split.positiveBelow.area > 0);

  const back = draftOf(taperedCup(false));
  assert.equal(back.positiveAbove.count, 0);
  assert.equal(back.positiveBelow.count, 0);
  assert.ok(back.negative.count > 0);
  assert.ok(back.negative.area > 0);
  assert.ok(back.minDraftDeg < 0);
});
