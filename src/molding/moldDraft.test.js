import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { stampedFaceTable } from '../utils/faceIdentity.js';
import { buildSolidGeometry } from '../utils/partSolidCache.js';
import { moldFitFromGeometry } from './fromGeometry.js';
import { PARTING_ROLE_RGB } from './parting.js';
import { analyzePullDirection, analyzeWallOnly, MOLD_REGION_NORMAL_DEG } from './pullDirection.js';
import {
  MOLD_DRAFT_CLUSTER_DEG,
  MOLD_DRAFT_HATCH_RGB,
  MOLD_DRAFT_MIN_DEG,
  MOLD_DRAFT_NEEDS_WORK_RGB,
  MOLD_DRAFT_NEGATIVE_RGB,
  MOLD_DRAFT_POSITIVE_RGB,
  MOLD_DRAFT_PRESETS,
  analyzeMoldDraft,
  classifyMoldDraft,
  draftAngleDeg,
  moldDraftLegendModel,
  moldDraftSwatchChannels,
  parseDraftThreshold,
  signedDraftDeg,
} from './moldDraft.js';

function surfaceOf(mesh) {
  const positions = mesh.positions;
  const indices = mesh.indices;
  let area = 0;
  let count = 0;
  const vert = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  for (let t = 0; t < indices.length; t += 3) {
    const a = vert(indices[t]);
    const b = vert(indices[t + 1]);
    const c = vert(indices[t + 2]);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const triArea = 0.5 * Math.hypot(cr[0], cr[1], cr[2]);
    if (!(triArea > 1e-12)) continue;
    area += triArea;
    count += 1;
  }
  return { area, count };
}

function assertCoversMesh(draft, mesh) {
  const { area, count } = surfaceOf(mesh);
  assert.equal(draft.triangleCount, count);
  assert.equal(new Set(draft.triangles.map((row) => row.index)).size, count);
  const classArea = draft.positive.area + draft.negative.area + draft.below.area;
  assert.ok(Math.abs(classArea - area) < 1e-3, `${classArea} vs ${area}`);
  for (const row of draft.triangles) {
    assert.ok(row.state === 'positive' || row.state === 'negative' || row.state === 'below');
  }
}

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

test('a box flags four vertical walls and classifies the caps', () => {
  const mesh = boxMesh([0, 0, 0], [10, 10, 10]);
  const result = analyzePullDirection({ ...mesh, pull: [0, 0, 1] });
  const draft = result.moldDraft;
  assert.equal(draft.violationCount, 4);
  assert.equal(draft.triangleCount, 12);
  assert.equal(draft.minDraftDeg, -90);
  assert.equal(draft.minDeg, 1);
  assert.equal(draft.positive.count, 1);
  assert.equal(draft.positive.area, 100);
  assert.equal(draft.negative.count, 1);
  assert.equal(draft.negative.area, 100);
  assert.equal(draft.below.count, 4);
  assert.equal(draft.below.area, 400);
  assert.equal(draft.below.positive.count, 4);
  assert.equal(draft.below.positive.area, 400);
  assert.equal(draft.below.negative.count, 0);
  assert.equal(draft.triangles.filter((row) => row.state === 'below' && row.sign === 'positive').length, 8);
  assertCoversMesh(draft, mesh);
  assert.equal(draft.ejectors.heuristic, true);
  assert.equal(draft.ejectors.pinCount, 0);
  assert.equal(draft.ejectors.sleeveCount, 0);
  assert.equal(result.fit, 'good');
  const legend = moldDraftLegendModel(draft);
  assert.equal(legend.violations, 4);
  assert.equal(legend.below.count, 4);
  assert.equal(legend.below.area, 400);
  assert.equal(legend.below.positive.count, 4);
  assert.equal(legend.positive.area, 100);
  assert.equal(legend.negative.area, 100);
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
  assert.equal(three.positive.count, 1);
  assert.equal(three.negative.count, 0);
  assert.equal(three.below.count, 0);
  assert.equal(three.minDraftDeg, 3);
  assert.equal(three.triangles[0].state, 'positive');
  assert.equal(three.triangles[0].sign, 'positive');
  const one = analyzeMoldDraft([tilt(1)], [0, 0, 1], null);
  assert.equal(one.violationCount, 0);
  assert.equal(one.positive.count, 1);
  assert.equal(one.below.count, 0);
  const zero = analyzeMoldDraft([tilt(0)], [0, 0, 1], null);
  assert.equal(zero.violationCount, 1);
  assert.equal(zero.below.count, 1);
  assert.equal(zero.below.positive.count, 1);
  assert.equal(zero.negative.count, 0);
  assert.equal(zero.triangles[0].sign, 'positive');
  assert.equal(zero.minDraftDeg, 0);
  const shallow = analyzeMoldDraft([tilt(-0.4)], [0, 0, 1], null);
  assert.equal(shallow.positive.count, 0);
  assert.equal(shallow.negative.count, 0);
  assert.equal(shallow.below.count, 1);
  assert.equal(shallow.below.negative.count, 1);
  assert.equal(shallow.below.positive.count, 0);
  assert.equal(shallow.triangles[0].state, 'below');
  assert.equal(shallow.triangles[0].sign, 'negative');
  assert.equal(shallow.violationCount, 1);
  const steep = analyzeMoldDraft([tilt(-3)], [0, 0, 1], null);
  assert.equal(steep.negative.count, 1);
  assert.equal(steep.below.count, 0);
  assert.equal(steep.triangles[0].state, 'negative');
  assert.equal(steep.triangles[0].sign, 'negative');
  assert.equal(steep.violationCount, 0);
  const onLine = analyzeMoldDraft([tilt(-1)], [0, 0, 1], null);
  assert.equal(onLine.negative.count, 1);
  assert.equal(onLine.below.count, 0);
  const wider = classifyMoldDraft(three, 5);
  assert.equal(wider.samples, three.samples);
  assert.equal(wider.positive.count, 0);
  assert.equal(wider.below.count, 1);
  assert.equal(wider.below.positive.count, 1);
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
  assert.equal(plain.moldDraft.below.count, 8);
  assert.equal(plain.moldDraft.below.positive.count, 8);
  assert.ok(plain.moldDraft.positive.count > 0);
  assert.ok(plain.moldDraft.negative.count > 0);
  assertCoversMesh(plain.moldDraft, shell);
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

test('a plate, a tray, a snap hook, and a through hole classify every face', () => {
  const plateMesh = boxMesh([0, 0, 0], [20, 20, 2]);
  const plate = draftOf(plateMesh);
  assert.equal(plate.positive.count, 1);
  assert.equal(plate.positive.area, 400);
  assert.equal(plate.below.count, 4);
  assert.equal(plate.below.area, 160);
  assert.equal(plate.below.positive.count, 4);
  assert.equal(plate.negative.count, 1);
  assert.equal(plate.negative.area, 400);
  assert.equal(plate.minDraftDeg, -90);
  assertCoversMesh(plate, plateMesh);

  const trayMesh = openTray();
  const tray = draftOf(trayMesh);
  assert.ok(tray.positive.area > 0);
  assert.ok(tray.below.area > 0);
  assert.ok(tray.negative.area > 0);
  assertCoversMesh(tray, trayMesh);

  const hookMesh = snapHook();
  const hook = draftOf(hookMesh);
  assert.ok(hook.below.area > 0);
  assert.ok(hook.positive.area + hook.negative.area > 0);
  assertCoversMesh(hook, hookMesh);

  const holeMesh = throughHole();
  const hole = draftOf(holeMesh);
  assert.equal(hole.positive.count, 1);
  assert.ok(Math.abs(hole.positive.area - 256) < 1e-3);
  assert.equal(hole.below.count, 8);
  assert.equal(hole.below.positive.count, 8);
  assert.equal(hole.negative.count, 1);
  assert.ok(Math.abs(hole.negative.area - 256) < 1e-3);
  assert.ok(Math.abs(hole.below.area - 1248) < 1e-3);
  assertCoversMesh(hole, holeMesh);
});

test('a drafted cup is positive at or above 1° and an inverted cup is negative at or above 1°', () => {
  const cupMesh = taperedCup(true);
  const cup = draftOf(cupMesh);
  const cupWalls = cup.samples.filter((sample) => Math.abs(sample.signedDeg) < 45);
  assert.ok(cupWalls.length > 0);
  assert.ok(cupWalls.some((sample) => sample.signedDeg > 4 && sample.signedDeg < 5));
  assert.ok(cupWalls.every((sample) => sample.signedDeg > 1));
  assert.equal(cup.below.count, 0);
  assert.ok(cup.positive.count > 0);
  assert.ok(cup.positive.area > 0);
  assert.ok(cup.negative.area > 0);
  assert.equal(cup.minDraftDeg, -90);
  assertCoversMesh(cup, cupMesh);

  const split = classifyMoldDraft(cup, 5);
  assert.equal(split.samples, cup.samples);
  assert.ok(split.negative.count > 0);
  assert.ok(split.positive.count > 0);
  assert.ok(split.below.count > 0);
  assert.ok(split.below.positive.count > 0);
  assert.equal(split.below.negative.count, 0);
  assert.ok(split.positive.area > 0);
  assert.ok(split.below.area > 0);

  const backMesh = taperedCup(false);
  const back = draftOf(backMesh);
  const backWalls = back.samples.filter((sample) => Math.abs(sample.signedDeg) < 45);
  assert.ok(backWalls.length > 0);
  assert.ok(backWalls.some((sample) => sample.signedDeg < -4 && sample.signedDeg > -5));
  assert.ok(backWalls.every((sample) => sample.signedDeg < -1));
  assert.equal(back.below.count, 0);
  assert.ok(back.negative.count > 0);
  assert.ok(back.negative.area > 0);
  assert.ok(back.positive.area > 0);
  assert.ok(back.minDraftDeg < 0);
  assertCoversMesh(back, backMesh);
});

test('a stamp along the pull does not drop a geometrically vertical fillet facet', () => {
  const facet = {
    t: 0,
    ia: 0,
    ib: 1,
    ic: 2,
    n: [0, 0, -1],
    nGeom: [1, 0, 0],
    area: 12,
    centroid: [8, 0, 4],
  };
  const cap = {
    t: 1,
    ia: 3,
    ib: 4,
    ic: 5,
    n: [0, 0, 1],
    nGeom: [0, 0, 1],
    area: 40,
    centroid: [0, 0, 10],
  };
  const draft = analyzeMoldDraft([facet, cap], [0, 0, 1]);
  assert.equal(draft.triangleCount, 2);
  assert.equal(draft.triangles.find((row) => row.index === 0).state, 'below');
  assert.equal(draft.triangles.find((row) => row.index === 0).sign, 'positive');
  const classArea = draft.positive.area + draft.negative.area + draft.below.area;
  assert.ok(Math.abs(classArea - 52) < 1e-6);
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

test('Shell_Fillet_Test classifies every face, including fillets, and the areas sum', { timeout: 120_000 }, async () => {
  const ran = await runScript(SHELL_FILLET);
  assert.equal(ran.status, 'NoError', ran.status);
  const { geometry, faceIDs } = buildSolidGeometry(ran.mesh);
  ran.manifold?.delete?.();
  const result = moldFitFromGeometry(geometry, faceIDs);
  assert.equal(result.error, undefined);
  const draft = result.moldDraft;
  const table = stampedFaceTable(geometry, faceIDs);
  const classified = new Map(draft.triangles.map((row) => [row.index, row]));
  const pos = geometry.attributes.position.array;
  const idx = geometry.index.array;
  let meshArea = 0;
  let filletTris = 0;
  const vert = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  for (let t = 0; t < idx.length / 3; t++) {
    const a = vert(idx[t * 3]);
    const b = vert(idx[t * 3 + 1]);
    const c = vert(idx[t * 3 + 2]);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const triArea = 0.5 * Math.hypot(cr[0], cr[1], cr[2]);
    if (!(triArea > 1e-12)) continue;
    meshArea += triArea;
    const row = classified.get(t);
    assert.ok(row, `triangle ${t} unclassified`);
    assert.ok(row.state === 'positive' || row.state === 'negative' || row.state === 'below');
    const name = table?.faces?.[table.triFace?.[t]]?.name || '';
    if (/fillet/i.test(name)) filletTris += 1;
  }
  assert.ok(filletTris > 0, 'Shell_Fillet_Test has no stamped fillet triangles');
  const classArea = draft.positive.area + draft.negative.area + draft.below.area;
  assert.ok(Math.abs(classArea - meshArea) < 1e-2, `${classArea} vs ${meshArea}`);
});

test('positive and negative draft colours are the cavity and core colours', () => {
  assert.equal(MOLD_DRAFT_POSITIVE_RGB, PARTING_ROLE_RGB.cavity);
  assert.equal(MOLD_DRAFT_NEGATIVE_RGB, PARTING_ROLE_RGB.core);
  const swatches = moldDraftSwatchChannels();
  assert.equal(swatches.positive, '46 115 199');
  assert.equal(swatches.negative, '184 92 46');
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  assert.match(css, /--mold-draft-needs-work:\s*248 113 113/);
  assert.match(css, /--mold-draft-hatch:\s*15 23 42/);
  assert.deepEqual(MOLD_DRAFT_NEEDS_WORK_RGB.map((channel) => Math.round(channel * 255)), [248, 113, 113]);
  assert.deepEqual(MOLD_DRAFT_HATCH_RGB.map((channel) => Math.round(channel * 255)), [15, 23, 42]);
  assert.doesNotMatch(css, /--mold-draft-above:/);
  assert.doesNotMatch(css, /--mold-draft-below:/);
});
