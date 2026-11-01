import assert from 'node:assert/strict';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { analyzePullDirection } from './pullDirection.js';
import { MOLD_REGION_NORMAL_DEG } from './pullDirection.js';
import {
  SIDE_ACTION_ALIGN_DEG,
  groupSideActions,
  sideActionLegendModel,
  suggestSidePull,
} from './sideActions.js';

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

function appendMesh(dstPos, dstIdx, positions, indices) {
  const base = dstPos.length / 3;
  for (let i = 0; i < positions.length; i++) dstPos.push(positions[i]);
  for (let t = 0; t < indices.length; t++) dstIdx.push(indices[t] + base);
}

/**
 * Outer box, a +Z shelf (lifter on a +Z pull), and a tilted +X wall (slide).
 */
function shelfAndSlide() {
  const positions = [];
  const indices = [];
  const box = boxMesh([0, 0, 0], [20, 20, 20]);
  appendMesh(positions, indices, box.positions, box.indices);
  appendMesh(positions, indices, [
    2, 2, 6, 6, 2, 6, 6, 6, 6, 2, 6, 6,
  ], [
    0, 1, 2, 0, 2, 3,
  ]);
  appendMesh(positions, indices, [
    10, 8, 8, 10, 12, 8, 12, 12, 12, 12, 8, 12,
  ], [
    0, 1, 2, 0, 2, 3,
  ]);
  return { positions, indices };
}

function region(id, normal, side, extra = {}) {
  return {
    id,
    area: 2,
    side,
    normal,
    centroid: [id, 0, 0],
    triangles: [id],
    ...extra,
  };
}

test('the align angle matches the undercut region angle', () => {
  assert.equal(SIDE_ACTION_ALIGN_DEG, MOLD_REGION_NORMAL_DEG);
});

test('a sideways normal is a slide and a pull-facing normal is a lifter', () => {
  const slide = suggestSidePull([1, 0, 0.2], [0, 0, 1]);
  assert.equal(slide.kind, 'slide');
  assert.ok(slide.pull[0] > 0.9);
  assert.ok(Math.abs(slide.pull[2]) < 1e-6);
  const lifter = suggestSidePull([0, 0, 1], [0, 0, 1]);
  assert.equal(lifter.kind, 'lifter');
  assert.deepEqual(lifter.pull, [0, 0, 1]);
  assert.equal(suggestSidePull([0, 0, 0], [0, 0, 1]), null);
});

test('same-direction regions on one side are one action, even far apart', () => {
  const grouped = groupSideActions([
    region(0, [1, 0, 0.2], 1, { centroid: [0, 0, 0] }),
    region(1, [0.98, 0.1, 0.15], 1, { centroid: [80, 0, 0] }),
    region(2, [-1, 0, 0.2], 1),
    region(3, [1, 0, 0.2], -1),
    region(4, [0, 0.2, 1], 1, { area: 4 }),
  ], [0, 0, 1]);
  assert.equal(grouped.heuristic, true);
  assert.equal(grouped.slideCount, 3);
  assert.equal(grouped.lifterCount, 1);
  assert.equal(grouped.count, 4);
  const slides = grouped.groups.filter((group) => group.kind === 'slide');
  const merged = slides.find((group) => group.regionIds.length === 2);
  assert.ok(merged);
  assert.deepEqual(merged.regionIds.slice().sort(), [0, 1]);
  assert.equal(merged.pull[0] > 0.9, true);
  assert.equal(slides.some((group) => group.side === -1), true);
  assert.equal(slides.some((group) => group.pull[0] < -0.9), true);
  assert.equal(grouped.groups[grouped.groups.length - 1].kind, 'lifter');
  const legend = sideActionLegendModel(grouped);
  assert.equal(legend.heuristic, true);
  assert.equal(legend.rows.length, 4);
  assert.equal(legend.more, 0);
  assert.equal(legend.rows[0].label, 'Slide');
  assert.equal(legend.rows[0].areaLabel, '4 mm²');
});

test('a wall within half a degree of vertical is not a side action', () => {
  const grouped = groupSideActions([
    region(0, [1, 0, 0], 1, { area: 40 }),
    region(1, [1, 0, Math.sin((0.25 * Math.PI) / 180)], 1, { area: 30 }),
    region(2, [0, 0, -1], -1, { area: 12 }),
  ], [0, 0, 1]);
  assert.equal(grouped.count, 1);
  assert.equal(grouped.slideCount, 0);
  assert.equal(grouped.lifterCount, 1);
  assert.equal(grouped.groups[0].area, 12);
  assert.deepEqual(grouped.groups[0].pull, [0, 0, -1]);
  const legend = sideActionLegendModel(grouped);
  assert.equal(legend.rows[0].label, 'Lifter');
  assert.equal(legend.rows[0].pull, '-Z');
  assert.equal(legend.rows[0].areaLabel, '12 mm²');
});

/**
 * Closed box plus one internal wall. At 0° the wall is vertical and must
 * not be a slide. At 2° it is a true undercut (occluded, outside the half
 * degree band) and becomes one slide. The 10° drafted-area band must not
 * swallow it.
 */
function occludedWall(deg) {
  const positions = [];
  const indices = [];
  const box = boxMesh([0, 0, 0], [20, 20, 12]);
  appendMesh(positions, indices, box.positions, box.indices);
  const lean = Math.tan((deg * Math.PI) / 180);
  const z0 = 2;
  const z1 = 8;
  const x0 = 8;
  const x1 = 8 + (z1 - z0) * lean;
  const base = positions.length / 3;
  positions.push(x0, 6, z0, x0, 14, z0, x1, 14, z1, x1, 6, z1);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  return { positions, indices, pull: [0, 0, 1] };
}

test('an occluded wall is a slide only once it leaves the vertical band', () => {
  const upright = analyzePullDirection(occludedWall(0));
  assert.equal(upright.undercutCount, 0);
  assert.equal(upright.sideActions.count, 0);
  const grazing = analyzePullDirection(occludedWall(0.25));
  assert.equal(grazing.undercutCount, 0);
  assert.equal(grazing.sideActions.count, 0);
  const drafted = analyzePullDirection(occludedWall(2));
  assert.equal(drafted.error, undefined);
  assert.equal(drafted.undercutCount, 1);
  assert.equal(drafted.sideActions.count, 1);
  assert.equal(drafted.sideActions.slideCount, 1);
  assert.equal(drafted.sideActions.lifterCount, 0);
  assert.ok(drafted.sideActions.groups[0].pull[0] > 0.9);
  assert.ok(drafted.sideActions.groups[0].area > 40);
});

test('a zero pull and a missing list are zero groups', () => {
  const zero = groupSideActions([region(0, [1, 0, 0], 1)], [0, 0, 0]);
  assert.equal(zero.count, 0);
  assert.deepEqual(zero.groups, []);
  assert.equal(groupSideActions(null, [0, 0, 1]).count, 0);
  assert.equal(sideActionLegendModel(zero).rows.length, 0);
  assert.equal(sideActionLegendModel(null), null);
});

test('a box has no side actions and a shelf plus a tilted wall splits', () => {
  const box = analyzePullDirection(boxMesh([0, 0, 0], [10, 10, 10]));
  assert.equal(box.sideActions.count, 0);
  assert.equal(box.sideActions.slideCount, 0);
  assert.equal(box.sideActions.lifterCount, 0);
  assert.equal(box.sideActions.heuristic, true);
  const part = analyzePullDirection({ ...shelfAndSlide(), pull: [0, 0, 1] });
  assert.equal(part.error, undefined);
  assert.equal(part.sideActions.slideCount, 1);
  assert.equal(part.sideActions.lifterCount, 1);
  assert.equal(part.sideActions.count, 2);
  const slide = part.sideActions.groups.find((group) => group.kind === 'slide');
  const lifter = part.sideActions.groups.find((group) => group.kind === 'lifter');
  assert.ok(slide.pull[0] > 0.9);
  assert.deepEqual(lifter.pull, [0, 0, 1]);
  assert.ok(slide.triangles.length >= 1);
  assert.ok(lifter.triangles.length >= 1);
  assert.equal(part.fit, 'fixable');
  assert.equal(part.undercutCount, 2);
});

const SHELL_FILLET = `
// --- cube begin id=cube1 ---
let box1 = Manifold.cube([68.7, 74.10000000000001, 37.5], true);
let part = box1;
// --- cube end id=cube1 ---
// --- fillet-mode begin id=fillet1 ---
const selEdges = edgesNamed(part, "cube1.back~cube1.right", "cube1.back~cube1.bottom", "cube1.bottom~cube1.right", "cube1.bottom~cube1.left", "cube1.bottom~cube1.front", "cube1.front~cube1.left", "cube1.back~cube1.left", "cube1.front~cube1.right");
part = filletEdges(part, selEdges, 4, { sphericalCorners: true });
// --- fillet-mode end id=fillet1 ---
part = hollow(part, 1.85, { center: [0.0003, -0.0003, 18.75], normal: [0, 0, 1] });
return part;
`;

test('Shell_Fillet_Test has no side actions on the searched pull', { timeout: 120_000 }, async () => {
  const ran = await runScript(SHELL_FILLET);
  assert.equal(ran.status, 'NoError', ran.status);
  const np = ran.mesh.numProp || 3;
  const src = ran.mesh.vertProperties;
  const positions = new Float64Array((src.length / np) * 3);
  for (let i = 0, v = 0; i < src.length; i += np, v += 3) {
    positions[v] = src[i];
    positions[v + 1] = src[i + 1];
    positions[v + 2] = src[i + 2];
  }
  const result = analyzePullDirection({ positions, indices: ran.mesh.triVerts });
  assert.equal(result.error, undefined);
  assert.equal(result.fit, 'good');
  assert.deepEqual(result.pull, [0, 0, 1]);
  assert.equal(result.undercutCount, 0);
  assert.equal(result.sideActions.count, 0);
  assert.equal(result.sideActions.slideCount, 0);
  assert.equal(result.sideActions.lifterCount, 0);
});
